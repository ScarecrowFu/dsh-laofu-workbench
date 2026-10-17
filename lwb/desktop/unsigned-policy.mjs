/** Explicit test-build adapters for the pinned upstream packaging modules. */
import { parse } from '@babel/parser'
import { execFile } from 'node:child_process'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

function fail(label) {
  throw new Error(`Unsigned Desktop adapter no longer matches upstream: ${label}`)
}

function replaceOnce(source, before, after, label = before) {
  if (source.split(before).length !== 2) fail(label)
  return source.replace(before, after)
}

/** Upstream owns the behaviour; a missing switch must stop the upgrade, not pass silently. */
function ensure(source, snippet, label) {
  if (!source.includes(snippet)) fail(label)
  return source
}

/**
 * Upstream 0.2.1 carries the unsigned switch itself: signing, notarization,
 * staple and updater are gated on `DSH_DESKTOP_UNSIGNED`, and macOS unsigned
 * builds now skip the policy environment. Keep the contract honest by requiring
 * those behaviours verbatim, then patch only the two shapes that remain LWB's
 * own: an unsigned build of any platform drops the policy, and a portable
 * Windows test build has no NSIS installer UI and no dependency collection.
 */
export function adaptUnsignedBuilder(source) {
  for (const [snippet, label] of [
    ["const unsigned = env.DSH_DESKTOP_UNSIGNED === '1'", 'unsigned switch'],
    ['const macOSSigning = packagesMacOS && !unsigned ? resolveMacOSSigningEnvironment(env) : undefined', 'signing environment'],
    ['if (packagesMacOS && !unsigned && !skipNotarization) resolveMacOSNotarizationEnvironment(env)', 'notarization environment'],
    ['forceCodeSigning: !unsigned,', 'code signing enforcement'],
    ["identity: unsigned ? '-' : macOSSigning?.signingIdentity,", 'ad-hoc identity'],
    ['notarize: !unsigned && !skipNotarization,', 'notarization'],
    ['sign: !unsigned,', 'windows signing'],
    ['const update = unsigned ? undefined : resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)', 'auto-update disable'],
    ["if (context.electronPlatformName !== 'darwin' || unsigned) return", 'macOS afterSign guard'],
    ["if (unsigned || !artifact.file.endsWith('.dmg')) return", 'macOS disk image notarization guard'],
  ]) source = ensure(source, snippet, label)
  source = replaceOnce(source,
    'const policy = packagesMacOS && unsigned ? undefined : resolveDesktopPolicyEnvironment(env)',
    'const policy = unsigned ? undefined : resolveDesktopPolicyEnvironment(env)',
    'policy disable')
  source = replaceOnce(source,
    "if (resolvedPlatform === 'win32') installWindowsDirectoryInstaller()",
    "if (resolvedPlatform === 'win32' && env.LWB_DESKTOP_PORTABLE !== '1') installWindowsDirectoryInstaller()",
    'portable installer skip')
  source = replaceOnce(source,
    "if (resolvedPlatform !== 'win32') return true",
    "if (resolvedPlatform !== 'win32' || env.LWB_DESKTOP_PORTABLE === '1') return true",
    'portable dependency collection skip')
  return source
}

/** A darwin gate, whether bare or as one operand of the unsigned conjunction. */
function isDarwinPlatformTest(node) {
  return node?.type === 'BinaryExpression' && node.operator === '==='
    && node.left?.type === 'MemberExpression' && node.left.object?.name === 'process'
    && node.left.property?.name === 'platform' && node.right?.value === 'darwin'
}

function mentionsDarwinTest(node) {
  if (!node || typeof node !== 'object') return false
  if (isDarwinPlatformTest(node)) return true
  if (Array.isArray(node)) return node.some(mentionsDarwinTest)
  return Object.values(node).some(mentionsDarwinTest)
}

/**
 * Locate the signing block structurally; both raw TS and tsx output are accepted.
 * Upstream guards it with `process.platform === 'darwin' && DSH_DESKTOP_UNSIGNED !== '1'`,
 * so the test is a logical expression rather than a bare comparison.
 */
export function adaptUnsignedPreparation(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const matches = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'IfStatement' && mentionsDarwinTest(node.test) && node.consequent.type === 'BlockStatement') {
      const block = source.slice(node.consequent.start, node.consequent.end)
      if (block.includes('sign:dsh-native') && block.includes('sign:primary-native')) matches.push(node)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  }
  visit(ast.program)
  if (matches.length !== 1) fail('preparation signing block')
  const node = matches[0]
  const replacement = `if (process.platform === 'darwin') {\n    const { signAdHocRuntime } = await import(${JSON.stringify(new URL('./unsigned-policy.mjs', import.meta.url).href)});\n    await signAdHocRuntime(DSH_OUTPUT_ROOT);\n    await signAdHocRuntime(join(RUNTIME_ROOT, 'primary-runtime'));\n  }`
  return source.slice(0, node.start) + replacement + source.slice(node.end)
}

/** ARM64 native code needs a valid local signature even without a Developer ID. */
export async function signAdHocRuntime(root) {
  const magic = new Set(['cafebabe', 'cafebabf', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'bebafeca', 'bfbafeca'])
  const files = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const file = await open(path)
        try {
          const header = Buffer.alloc(4)
          const { bytesRead } = await file.read(header, 0, 4, 0)
          if (bytesRead === 4 && magic.has(header.toString('hex'))) files.push(path)
        } finally { await file.close() }
      }
    }
  }
  await walk(root)
  const run = promisify(execFile)
  let next = 0
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const path = files[next++]
      if (!path) return
      await run('/usr/bin/codesign', ['--force', '--sign', '-', path])
      await run('/usr/bin/codesign', ['--verify', path])
    }
  })
  const results = await Promise.allSettled(workers)
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (errors.length) throw new AggregateError(errors, 'Ad-hoc runtime signing failed')
  console.log(`Unsigned test build: verified ${files.length} ad-hoc native signatures.`)
}
