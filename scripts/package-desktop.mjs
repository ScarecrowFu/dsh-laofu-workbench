#!/usr/bin/env node
/**
 * One-click Desktop packaging for the build host.
 *
 * Resolves the inputs the raw packaging commands need by hand — the private
 * commercial pack checkout, the test build number, and the Electron download
 * source — then runs the official packaging flow and reports what it produced,
 * with checksums.
 *
 *   npm run package:oneclick                  # this host's target, commercial, unsigned portable
 *   npm run package:mac                       # same, but refuses a non-macOS host
 *   npm run package:win                       # same, but refuses a non-Windows host
 *   npm run package:oneclick -- --dry-run     # print the resolved inputs and command only
 *   npm run package:oneclick -- --plan        # resolve the edition and shipped packs only
 *   npm run package:oneclick -- --community --release
 *
 * The official preparation binds the target platform to the build host, so a
 * Windows package is built on Windows: locally, or on the release runner.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  artifactDirectory, probeDownload, resolveBuildNumber, resolveCommercialPackDir,
  resolveEditionName, resolveElectronMirror, resolveHostTarget,
} from '../lwb/desktop/package-inputs.mjs'
import { artifactSnapshot, reportArtifacts } from '../lwb/desktop/package-report.mjs'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_MARKER = join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'package.json')

const HELP = `Usage: npm run package:oneclick -- [options]

Packages the Laofu Workbench Desktop build for this host and reports the
artifacts with checksums.

Options:
  --edition <name>       capability-pack set to ship: commercial (default) or community
  --community            shorthand for --edition community
  --host <mac|win>       refuse to run unless the build host matches
                         (--dry-run still prints that platform's command)
  --build-number <n>     test build number; default is the local date (YYYYMMDD)
  --signed               use the official signing environment instead of an unsigned test build
  --release              name the artifact as a release build (no -test.<n> suffix)
  --dir                  produce the unpacked app only
  --plan                 resolve the edition and shipped packs, then stop
  --npm-registry <url>   npm registry for the runtime dependencies; default is the
                         release registry (registry.npmjs.org). Point it at a mirror
                         when that host is unreachable from this network.
  --dry-run              print the resolved inputs and the command, then stop
  --no-mirror-fallback   never substitute an Electron mirror when the release host is unreachable
  -h, --help             show this message

Environment:
  LWB_COMMERCIAL_PACK_DIR   commercial pack checkout; discovered beside this repository when unset
  LWB_DESKTOP_BUILD_NUMBER  test build number; the local date is used when unset
  ELECTRON_MIRROR           Electron download source; only probed when unset
  LWB_ELECTRON_MIRROR=off   keep the default release host without probing it
  DSH_DESKTOP_NPM_REGISTRY  same as --npm-registry, and what the option sets
`

/** Fail loudly with a message a human can act on. */
function fail(message) {
  throw new Error(message)
}

/**
 * Validate `--npm-registry` the way the pinned preparation validates the same
 * setting: an HTTPS origin, no credentials, no path, query or fragment. The
 * preparation repeats this check; doing it here too keeps `--dry-run` from
 * printing a command whose only possible outcome is a failure.
 */
function resolveNpmRegistryOption(value) {
  const configured = (value ?? '').trim()
  if (configured === '') return undefined
  let url = null
  try { url = new URL(configured) } catch { url = null }
  const valid = url !== null && url.protocol === 'https:' && url.username === '' && url.password === ''
    && url.search === '' && url.hash === '' && (url.pathname === '/' || url.pathname === '')
  if (!valid) fail(`--npm-registry must be an HTTPS origin without credentials, path, query or fragment, not "${configured}".`)
  return url.origin
}

/** Resolve every packaging input, failing before any expensive work starts. */
async function resolveInputs(values, manifest) {
  assertNodeEngine(manifest)
  if (!existsSync(UPSTREAM_MARKER)) fail('The pinned DSH checkout is missing; run npm run setup before packaging.')
  const edition = resolveEditionName(values.community ? 'community' : values.edition)
  const expected = values.host === undefined ? undefined : values.host === 'mac' ? 'darwin' : 'win32'
  // A named host also names the target, so --dry-run can print another
  // platform's command from any build machine.
  const target = resolveHostTarget(expected ?? process.platform, process.arch)
  if (expected !== undefined && expected !== process.platform) {
    const message = `--host ${values.host} needs a ${expected} build host, but this host is ${process.platform}. `
      + 'Windows packages are built on Windows, locally or on the release runner.'
    if (values['dry-run'] !== true) fail(message)
    console.log(`Note: ${message}`)
    console.log('      Printing the command this host would refuse to run.\n')
  }
  const pack = edition === 'commercial'
    ? resolveCommercialPackDir({
      env: process.env,
      projectRoot: PROJECT_ROOT,
      exists: existsSync,
      readJson: path => JSON.parse(readFileSync(path, 'utf8')),
    })
    : undefined
  const buildNumber = resolveBuildNumber(values['build-number'], process.env)
  /* The flag wins, but the documented environment variable is the same setting and
     has to survive this script: it is what the preparation itself reads, and it is
     inherited by the packaging chain either way. */
  const npmRegistry = resolveNpmRegistryOption(values['npm-registry'] ?? process.env.DSH_DESKTOP_NPM_REGISTRY)
  const electron = await electronVersion()
  const mirror = values['no-mirror-fallback']
    ? { mirror: process.env.ELECTRON_MIRROR?.trim() || undefined, source: 'no probe requested' }
    : await resolveElectronMirror({ env: process.env, version: electron, probe: url => probeDownload(url) })
  return { edition, target, pack, buildNumber, electron, mirror, npmRegistry }
}

/**
 * Electron version the prepared runtime will download. The installed package
 * answers exactly; before the first install the declared range does.
 * @returns the version, or undefined when neither is readable.
 */
async function electronVersion() {
  const installed = join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'node_modules', 'electron', 'package.json')
  if (existsSync(installed)) return JSON.parse(readFileSync(installed, 'utf8')).version
  const declared = JSON.parse(await readFile(join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'package.json'), 'utf8'))
  return declared.devDependencies?.electron?.replace(/^[^\d]*/u, '') || undefined
}

/** Compare the running Node version against the repository's engine floor. */
function assertNodeEngine(manifest) {
  const floor = />=(\d+)\.(\d+)\.(\d+)/u.exec(manifest.engines?.node ?? '')
  if (floor === null) return
  const current = process.versions.node.split('.').map(Number)
  const required = floor.slice(1).map(Number)
  const rank = parts => parts[0] * 1e6 + parts[1] * 1e3 + parts[2]
  if (rank(current) < rank(required)) {
    fail(`Node ${manifest.engines.node} is required; this host runs ${process.versions.node}.`)
  }
}

/** Build the official packaging command and the environment overrides it needs. */
function packagingCommand(values, inputs) {
  const forward = ['--edition', inputs.edition]
  if (!values.signed) forward.push('--unsigned')
  forward.push('--portable')
  if (values.release) forward.push('--release')
  if (values.dir) forward.push('--dir')
  if (values.plan) forward.push('--plan')
  const env = {
    ...process.env,
    LWB_DESKTOP_BUILD_NUMBER: inputs.buildNumber,
    ...(inputs.pack === undefined ? {} : { LWB_COMMERCIAL_PACK_DIR: inputs.pack.directory }),
    ...(inputs.mirror.mirror === undefined ? {} : { ELECTRON_MIRROR: inputs.mirror.mirror }),
    ...(inputs.npmRegistry === undefined ? {} : { DSH_DESKTOP_NPM_REGISTRY: inputs.npmRegistry }),
  }
  return { args: ['run', 'package:desktop', '--', ...forward], env, forward }
}

/** Human-readable environment prefix that reproduces the run by hand. */
function reproduction(env, forward) {
  const names = ['ELECTRON_MIRROR', 'DSH_DESKTOP_NPM_REGISTRY', 'LWB_COMMERCIAL_PACK_DIR', 'LWB_DESKTOP_BUILD_NUMBER']
  const prefix = names.filter(name => env[name] !== undefined).map(name => `${name}=${env[name]}`)
  const command = `npm run package:desktop -- ${forward.join(' ')}`
  return prefix.length === 0 ? command : `${prefix.join(' \\\n  ')} \\\n${command}`
}

/** Resolve the inputs, run the official packaging flow, and report the artifacts. */
async function main() {
  const { values } = parseArgs({
    options: {
      edition: { type: 'string' },
      community: { type: 'boolean' },
      host: { type: 'string' },
      'build-number': { type: 'string' },
      signed: { type: 'boolean' },
      release: { type: 'boolean' },
      dir: { type: 'boolean' },
      plan: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-mirror-fallback': { type: 'boolean' },
      'npm-registry': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const inputs = await resolveInputs(values, manifest)
  const command = packagingCommand(values, inputs)

  console.log(`Packaging ${manifest.name} ${manifest.version} — ${inputs.edition} for ${inputs.target}`)
  console.log(`  build number    ${inputs.buildNumber}${values.release ? ' (release naming)' : ''}`)
  console.log(`  signing         ${values.signed ? 'official environment' : 'unsigned test build'}`)
  if (inputs.pack !== undefined) console.log(`  commercial pack ${inputs.pack.directory} (${inputs.pack.source})`)
  console.log(`  electron        ${inputs.electron === undefined ? 'unknown version' : `v${inputs.electron}`} from ${inputs.mirror.mirror ?? 'the default release host'} (${inputs.mirror.source})`)
  console.log(`  npm registry    ${inputs.npmRegistry ?? 'the release registry (registry.npmjs.org)'}`)
  if (inputs.mirror.source === 'no reachable download source') {
    console.log('  hint            neither the release host nor the mirror served the checksum; set ELECTRON_MIRROR to a reachable copy')
  }
  console.log(`  artifacts       ${artifactDirectory(PROJECT_ROOT, inputs.edition, inputs.target)}`)

  if (values['dry-run']) {
    console.log('\nEnvironment overrides:')
    for (const name of ['LWB_DESKTOP_BUILD_NUMBER', 'LWB_COMMERCIAL_PACK_DIR', 'ELECTRON_MIRROR', 'DSH_DESKTOP_NPM_REGISTRY']) {
      console.log(`  ${name}=${command.env[name] ?? '(unset)'}`)
    }
    console.log(`\nCommand:\n  npm ${command.args.join(' ')}`)
    return
  }

  const directory = artifactDirectory(PROJECT_ROOT, inputs.edition, inputs.target)
  const before = await artifactSnapshot(directory)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, command.args, {
    cwd: PROJECT_ROOT,
    env: command.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) fail(result.error.message)
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    return
  }
  if (values.plan) return
  const editions = JSON.parse(await readFile(join(PROJECT_ROOT, 'lwb', 'desktop', 'editions.json'), 'utf8'))
  const productName = editions.editions[inputs.edition]?.productName ?? manifest.name
  await reportArtifacts({ directory, target: inputs.target, productName, before })
  console.log('\nReproduce this build with:')
  console.log(`  ${reproduction(command.env, command.forward)}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}