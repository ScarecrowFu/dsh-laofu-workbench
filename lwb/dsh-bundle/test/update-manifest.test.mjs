/**
 * The update client's trust boundary.
 *
 * Everything downstream of `validateRelease` assumes it was handed the release
 * the product actually signed: the downloader writes whatever it is given, and
 * the updater then moves it over the installed application. A regression here
 * does not degrade a feature, it installs arbitrary bytes — so each check is
 * exercised on its own, and the wire order ATS signs is pinned literally.
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  canonicalizeManifest,
  compareVersions,
  isSafeFileName,
  isSemver,
  normalizeChannel,
  parseManifest,
  parseSignature,
  validateRelease,
} from '../updater/manifest.mjs'
import { acknowledgeUpdateResult, readLastUpdateResult, resolveInstallTarget } from '../updater/installer.mjs'

const keyPair = generateKeyPairSync('ed25519')
const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

function release(overrides = {}) {
  return {
    schemaVersion: 1,
    product: 'laofu-workbench',
    version: '0.1.9',
    platform: 'darwin',
    arch: 'arm64',
    channel: 'stable',
    artifactType: 'mac-app-zip',
    fileName: 'laofu-workbench-0.1.9-mac-arm64-portable-unsigned.zip',
    releaseNotes: '修复若干问题',
    downloadUrl: 'https://link.scitiger.cn/media/laofu-workbench/releases/0.1.9.zip',
    sha256: 'a'.repeat(64),
    sizeBytes: '1024',
    mandatory: false,
    minVersion: null,
    minLauncherVersion: null,
    rolloutPercent: 100,
    ...overrides,
  }
}

const expected = {
  product: 'laofu-workbench',
  platform: 'darwin',
  arch: 'arm64',
  channel: 'stable',
  currentVersion: '0.1.8',
}

/** Sign a release the way ATS does: over the canonical JSON, with Ed25519. */
function signRelease(manifest) {
  return sign(null, Buffer.from(canonicalizeManifest(manifest), 'utf8'), keyPair.privateKey).toString('base64')
}

function accepts(manifest, options = {}) {
  return validateRelease(manifest, signRelease(manifest), expected, { publicKey, ...options })
}

function rejects(manifest, pattern, options = {}) {
  assert.throws(() => accepts(manifest, options), pattern)
}

test('the wire order ATS signs is pinned', () => {
  // ATS signs `JSON.stringify` of its own record, so the field order is part of
  // the protocol. Reordering this object would invalidate every signature the
  // server has ever produced, and the failure would look like a network fault.
  assert.deepEqual(Object.keys(JSON.parse(canonicalizeManifest(release()))), [
    'schemaVersion',
    'product',
    'version',
    'platform',
    'arch',
    'channel',
    'artifactType',
    'fileName',
    'releaseNotes',
    'downloadUrl',
    'sha256',
    'sizeBytes',
    'mandatory',
    'minVersion',
    'minLauncherVersion',
    'rolloutPercent',
  ])
})

test('a correctly signed release for this installation is accepted', () => {
  const manifest = parseManifest(release())
  const signature = parseSignature(signRelease(manifest), 'ed25519')
  assert.equal(validateRelease(manifest, signature, expected, { publicKey }).version, '0.1.9')
})

test('the shipped public key is the one enforced when no override is given', () => {
  const manifest = parseManifest(release())
  assert.throws(
    () => validateRelease(manifest, signRelease(manifest), expected),
    /签名校验失败/u,
  )
})

test('a manifest that changed after signing is refused', () => {
  const manifest = parseManifest(release())
  const signature = signRelease(manifest)
  // A hijacked response only has to swap the download URL, which is why the
  // signature has to cover it rather than just the version.
  const tampered = { ...manifest, downloadUrl: 'https://evil.example/payload.zip' }
  assert.throws(() => validateRelease(tampered, signature, expected, { publicKey }), /签名校验失败/u)
})

test('another product, architecture or channel is refused even when signed', () => {
  rejects(release({ product: 'fu-claw' }), /产品或系统架构不匹配/u)
  rejects(release({ arch: 'x64' }), /产品或系统架构不匹配/u)
  rejects(release({ platform: 'win32' }), /产品或系统架构不匹配/u)
  rejects(release({ channel: 'beta' }), /发布通道不匹配/u)
})

test('a downgrade or the installed version itself is refused', () => {
  rejects(release({ version: '0.1.8' }), /版本无效/u)
  rejects(release({ version: '0.1.7' }), /版本无效/u)
  rejects(release({ version: '0.1.9.1' }), /版本无效/u)
})

test('artifact types the installer cannot apply are refused', () => {
  // ATS serves these shapes for launcher-based products. Handing one to the
  // bundle-replacing updater would be an installer for a different product.
  rejects(release({ artifactType: 'launch-package-zip', fileName: 'x.zip' }), /发布类型不匹配/u)
  rejects(release({ artifactType: 'unpacked-zip', fileName: 'x.zip' }), /发布类型不匹配/u)
  rejects(release({ artifactType: 'dmg', fileName: 'x.dmg' }), /发布类型不匹配/u)
})

test('a file name that would escape the staging directory is refused', () => {
  rejects(release({ fileName: '../../etc/passwd.zip' }), /文件信息无效/u)
  rejects(release({ fileName: 'nested/laofu.zip' }), /文件信息无效/u)
  rejects(release({ fileName: '' }), /文件信息无效/u)
  // The extension has to agree with the declared artifact type, or the updater
  // would hand a zip to the Windows replacement path.
  rejects(release({ fileName: 'laofu-workbench.dmg' }), /文件名与发布类型不符/u)
})

test('an oversized or malformed artifact descriptor is refused', () => {
  rejects(release({ sizeBytes: '0' }), /大小超出限制/u)
  rejects(release({ sizeBytes: String(5 * 1024 * 1024 * 1024) }), /大小超出限制/u)
  rejects(release({ sha256: 'not-a-checksum' }), /文件信息无效/u)
  rejects(release({ rolloutPercent: 120 }), /灰度信息无效/u)
  rejects(release({ downloadUrl: 'http://link.scitiger.cn/a.zip' }), /必须使用 HTTPS/u)
})

test('a signature in the wrong algorithm is refused before it is used', () => {
  assert.throws(() => parseSignature('abc', 'rsa'), /签名无效/u)
  assert.throws(() => parseSignature('   ', 'ed25519'), /签名无效/u)
  assert.equal(parseSignature(' abc ', 'ed25519'), 'abc')
})

test('a manifest from another schema version is refused', () => {
  assert.throws(() => parseManifest({ ...release(), schemaVersion: 2 }), /不支持的更新清单版本/u)
  assert.throws(() => parseManifest(null), /发布清单无效/u)
})

test('semantic versions order the way ATS publishes them', () => {
  assert.equal(compareVersions('0.1.9', '0.1.8'), 1)
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('0.1.8', '0.1.8'), 0)
  // A prerelease is older than the release it leads to, which is what keeps a
  // local `-test.N` build from being offered the release it was cut from.
  assert.equal(compareVersions('0.1.9-test.1', '0.1.8'), 1)
  assert.equal(compareVersions('0.1.9-test.1', '0.1.9'), -1)
  assert.equal(compareVersions('0.1.9-test.2', '0.1.9-test.10'), -1)
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0)
  assert.equal(isSemver('0.1.9'), true)
  assert.equal(isSemver('v0.1.9'), false)
})

test('file names are judged as file names, not as paths', () => {
  assert.equal(isSafeFileName('laofu-workbench-0.1.9-mac-arm64.zip'), true)
  assert.equal(isSafeFileName('../x.zip'), false)
  assert.equal(isSafeFileName('..'), false)
  assert.equal(isSafeFileName('a/b.zip'), false)
  assert.equal(isSafeFileName('a\\b.zip'), false)
  assert.equal(isSafeFileName(''), false)
})

test('an unknown channel falls back to stable instead of widening the query', () => {
  assert.equal(normalizeChannel('BETA'), 'beta')
  assert.equal(normalizeChannel('nightly'), 'stable')
  assert.equal(normalizeChannel(undefined), 'stable')
})

test('an installation that cannot replace itself says so instead of failing later', async () => {
  // Both refusals have to arrive before the download, because the alternative is
  // a 400 MB file the user cannot do anything with.
  assert.deepEqual(
    await resolveInstallTarget({ platform: 'darwin', env: {} }),
    { ok: false, reason: '未找到应用包位置，无法自动更新。请重新下载安装。' },
  )
  assert.deepEqual(
    await resolveInstallTarget({ platform: 'win32', env: {} }),
    { ok: false, reason: '当前不是便携版，无法自动替换。请重新下载安装包。' },
  )
  assert.equal((await resolveInstallTarget({ platform: 'linux', env: {} })).ok, false)
})

test('a writable bundle and a writable portable file are both installable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-update-target-'))
  try {
    const bundle = join(root, 'Laofu Workbench.app')
    await mkdir(bundle)
    const executable = join(root, 'laofu-workbench.exe')
    await writeFile(executable, 'binary')
    assert.deepEqual(
      await resolveInstallTarget({ platform: 'darwin', env: { LWB_DESKTOP_APP_BUNDLE: bundle } }),
      { ok: true, platform: 'darwin', target: bundle, kind: 'app-bundle', artifactType: 'mac-app-zip' },
    )
    assert.deepEqual(
      await resolveInstallTarget({ platform: 'win32', env: { LWB_DESKTOP_PORTABLE_FILE: executable } }),
      { ok: true, platform: 'win32', target: executable, kind: 'portable-exe', artifactType: 'portable-exe' },
    )
    // A path that no longer exists is a refusal, not a crash.
    assert.equal((await resolveInstallTarget({ platform: 'darwin', env: { LWB_DESKTOP_APP_BUNDLE: join(root, 'gone.app') } })).ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('what the last updater run left behind is reported honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-update-jobs-'))
  try {
    assert.equal(await readLastUpdateResult(root), undefined, 'no run yet is not a failure')
    const job = join(root, 'jobs', '0.1.9-aaaaaaaa')
    await mkdir(job, { recursive: true })
    await writeFile(join(job, 'job.json'), JSON.stringify({ schemaVersion: 1, version: '0.1.9', createdAt: '2026-10-30T00:00:00.000Z' }))
    // A job directory without a result means the updater never finished, which
    // must not be read as success: the staged artifact is still the only copy.
    const interrupted = await readLastUpdateResult(root)
    assert.equal(interrupted.ok, false)
    assert.match(interrupted.error, /没有留下结果/u)

    await writeFile(join(job, 'result.txt'), 'fail 无法替换旧版本，更新包可能仍在被占用。\n')
    const failed = await readLastUpdateResult(root)
    assert.equal(failed.ok, false)
    assert.equal(failed.error, '无法替换旧版本，更新包可能仍在被占用。')
    assert.equal(failed.version, '0.1.9')

    await writeFile(join(job, 'result.txt'), 'ok 0.1.9\n')
    assert.equal((await readLastUpdateResult(root)).ok, true)

    // Reporting is once: the same run must not greet every later start.
    await acknowledgeUpdateResult(job)
    assert.equal(await readLastUpdateResult(root), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
