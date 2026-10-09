import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { access, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { collectMachOFiles, isBareLibraryPath, readLibraryReferences, relinkDarwinLibraries } from './darwin-library-paths.mjs'

/**
 * 原生库加载路径的回归防线。
 *
 * 打包版里 ffmpeg / ffprobe / remotion 与七个 `libav*` 系列 dylib 使用的是裸相对名
 * （`libavdevice.dylib`），dyld 只在「未硬化」的进程里才肯按工作目录解析它们。
 * 桌面产物给整个 payload 做了 hardened runtime 签名，于是打包版每次导出视频都
 * SIGABRT（`relative path not allowed in hardened program`），而开发态用的是仓库里
 * 那份未硬化的副本，永远看不出问题。
 *
 * 这里把「重写 + 硬化签名」整条链路跑一遍：只有真的把二进制跑起来才算过。签名本身
 * 也要断言，否则一次没生效的签名会让这条用例变成一个永远通过的空壳。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(HERE, '..', '..')
const ENTITLEMENTS = join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'scripts', 'macos-entitlements.plist')
const CODEX = '/usr/bin/codesign'
const run = promisify(execFile)
const MAC_ONLY = process.platform === 'darwin' ? false : '原生签名与 dyld 行为只在 macOS 上成立'

async function exists(path) {
  return Boolean(await access(path).then(() => true, () => false))
}

/** The compositor package the payload installs; the repository has the same one for development. */
async function compositorSource() {
  const scope = join(PROJECT_ROOT, 'node_modules', '@remotion')
  for (const name of await readdir(scope).catch(() => [])) {
    if (name.startsWith('compositor-darwin-')) return join(scope, name)
  }
  return null
}

/** Mirror the product signature: hardened runtime plus the inherited entitlements. */
async function signHardened(files) {
  for (const file of files) await run(CODEX, ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', ENTITLEMENTS, file])
}

test('重写后的原生库在硬化签名下必须真的能跑', { skip: MAC_ONLY }, async t => {
  if (!await exists(ENTITLEMENTS)) return t.skip('缺少上游 entitlements，无法复现产物签名')
  if (!await exists('/usr/bin/install_name_tool') || !await exists(CODEX)) return t.skip('缺少 Xcode 命令行工具，无法复现产物签名')
  const source = await compositorSource()
  if (!source) return t.skip('未安装 @remotion/compositor-darwin-*')

  const work = await mkdtemp(join(tmpdir(), 'lwb-native-libs-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  await cp(source, work, { recursive: true })

  /* 前置事实：这批二进制确实用裸相对名 —— 这是要修的形态，不是断言它们必须坏。 */
  const before = await readLibraryReferences(join(work, 'ffmpeg'))
  assert.ok(before.dependencies.some(isBareLibraryPath) || before.dependencies.every(name => name.startsWith('@loader_path/')), 'ffmpeg 的依赖要么是裸名，要么已经重写过')

  const outcome = await relinkDarwinLibraries(work)
  const files = await collectMachOFiles(work)
  assert.ok(files.length > 0, '合成器目录里应当有原生文件')
  for (const file of files) {
    const { id, dependencies } = await readLibraryReferences(file)
    assert.deepEqual([id, ...dependencies].filter(isBareLibraryPath), [], `${file} 仍在使用裸相对名`)
  }

  await signHardened(files)
  const signature = await run(CODEX, ['-dvvv', join(work, 'ffmpeg')]).then(result => result.stderr, error => `${error.stderr || ''}`)
  assert.match(signature, /flags=0x[0-9a-f]*\([^)]*runtime[^)]*\)/u, '这条用例必须在硬化签名的前提下才有意义')

  /* 关键断言：硬化签名之后，从任意工作目录都能加载自己的 dylib。 */
  const ffmpeg = await run(join(work, 'ffmpeg'), ['-version'], { cwd: '/' })
  assert.match(ffmpeg.stdout, /^ffmpeg version/u)
  const ffprobe = await run(join(work, 'ffprobe'), ['-version'], { cwd: '/' })
  assert.match(ffprobe.stdout, /^ffprobe version/u)

  /* 合成器是渲染真正要用的那个；它只读一条 JSON 命令就退出，所以只断言 dyld 没拦它。 */
  const compositor = await run(join(work, 'remotion'), ['versions'], { cwd: '/', timeout: 10_000 })
    .then(result => `${result.stdout}${result.stderr}`, error => `${error.stdout || ''}${error.stderr || ''}`)
  assert.doesNotMatch(compositor, /Library not loaded|relative path not allowed/u, '合成器必须能加载自己的 dylib')

  /* 幂等：打包步骤重跑一次不应再改动任何文件。 */
  const again = await relinkDarwinLibraries(work)
  assert.deepEqual(again.patched, [])
  assert.equal(again.scanned, outcome.scanned)
})

test('打包流程必须在签名之前重写原生库路径，并把新字节算进构建 id', async () => {
  const source = await readFile(join(HERE, 'package.mjs'), 'utf8')
  assert.match(source, /import \{ relinkDarwinLibraries \} from '\.\/darwin-library-paths\.mjs'/u)
  assert.match(source, /if \(process\.platform === 'darwin'\) \{\n\s+const relinked = await relinkDarwinLibraries\(join\(payload, 'node_modules'\)/u)
  /* 顺序即正确性：依赖装好之后、electron-builder 签名之前。 */
  const installed = source.indexOf("'ci', '--omit=dev'")
  const relinked = source.indexOf('relinkDarwinLibraries(join(payload')
  const packaged = source.indexOf("'electron-builder'")
  assert.ok(installed !== -1 && relinked > installed, '重写必须发生在依赖安装之后')
  assert.ok(packaged > relinked, '重写必须发生在 electron-builder 之前，否则签的仍是裸名依赖')
  /* 重写改变了 payload 字节，构建 id 必须跟着变，否则已安装的 runtime 副本不会被替换。 */
  assert.match(source, /digest\.update\(`native-libraries:\$\{entry\.file\}:\$\{entry\.sha256\}`\)/u)
})