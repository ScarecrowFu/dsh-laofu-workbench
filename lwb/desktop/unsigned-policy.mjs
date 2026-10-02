/** Explicit test-build adapters for the pinned upstream packaging modules. */
import { parse } from '@babel/parser'
import { execFile } from 'node:child_process'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Unsigned Desktop adapter no longer matches upstream: ${before}`)
  return source.replace(before, after)
}

export function adaptUnsignedBuilder(source) {
  for (const [before, after] of [
    ["if (unsigned && resolvedPlatform !== 'win32')", "if (unsigned && !['win32', 'darwin'].includes(resolvedPlatform))"],
    ['const policy = resolveDesktopPolicyEnvironment(env)', 'const policy = unsignedPolicyDisabled(env)'],
    ["if (resolvedPlatform === 'win32') installWindowsDirectoryInstaller()", "if (resolvedPlatform === 'win32' && env.LWB_DESKTOP_PORTABLE !== '1') installWindowsDirectoryInstaller()"],
    ["if (resolvedPlatform !== 'win32') return true", "if (resolvedPlatform !== 'win32' || env.LWB_DESKTOP_PORTABLE === '1') return true"],
    ['packagesMacOS ? resolveMacOSSigningEnvironment(env)', 'packagesMacOS && !unsigned ? resolveMacOSSigningEnvironment(env)'],
    ['if (packagesMacOS) resolveMacOSNotarizationEnvironment(env)', 'if (packagesMacOS && !unsigned) resolveMacOSNotarizationEnvironment(env)'],
    ['forceCodeSigning: true,', 'forceCodeSigning: !unsigned,'],
    ['identity: macOSSigning?.signingIdentity,', "identity: unsigned ? '-' : macOSSigning?.signingIdentity,"],
    ['notarize: true,', 'notarize: !unsigned,'],
    ['sign: true,', 'sign: !unsigned,'],
    ["if (context.electronPlatformName !== 'darwin') return", "if (unsigned || context.electronPlatformName !== 'darwin') return"],
    ["if (!artifact.file.endsWith('.dmg')) return", "if (unsigned || !artifact.file.endsWith('.dmg')) return"],
  ]) source = replaceOnce(source, before, after)
  return `${source}\nfunction unsignedPolicyDisabled(env) {\n  return env.DSH_DESKTOP_UNSIGNED === '1' ? undefined : resolveDesktopPolicyEnvironment(env)\n}\n`
}

/** Locate the signing block structurally; both raw TS and tsx output are accepted. */
export function adaptUnsignedPreparation(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const matches = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'IfStatement' && node.test.type === 'BinaryExpression'
      && node.test.operator === '===' && node.test.left.type === 'MemberExpression'
      && node.test.left.object.name === 'process' && node.test.left.property.name === 'platform'
      && node.test.right.value === 'darwin' && node.consequent.type === 'BlockStatement') {
      const block = source.slice(node.consequent.start, node.consequent.end)
      if (block.includes('sign:dsh-native') && block.includes('sign:primary-native')) matches.push(node)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  }
  visit(ast.program)
  if (matches.length !== 1) throw new Error('Unsigned Desktop preparation no longer matches the pinned upstream signing block')
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
