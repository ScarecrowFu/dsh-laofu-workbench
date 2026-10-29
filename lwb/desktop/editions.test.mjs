import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { LwbEditionError, loadEditionManifest, resolveEdition } from './editions.mjs'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-edition-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Write a pack directory that satisfies the same rules the host applies. */
async function writePack(root, { id, packageName, version = '1.0.0', directory = id }) {
  const dir = join(root, directory)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'lwb-pack.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    packageName,
    name: id,
    version,
    description: `${id} fixture`,
    menus: [{ id: 'main', label: id }],
  }))
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: packageName,
    version,
    type: 'module',
    main: 'index.mjs',
    exports: { '.': './index.mjs', './client': './client.js' },
    dsh: { client: { platform: 'web', inject: ['@scitiger-ai/lwb-dsh-bundle'] } },
  }))
  await writeFile(join(dir, 'index.mjs'), 'export const manifest = {}\n')
  await writeFile(join(dir, 'client.js'), 'export default {}\n')
  return dir
}

/** Write a project whose lwb/desktop/editions.json holds the given manifest. */
async function writeProjectManifest(root, manifest) {
  await mkdir(join(root, 'lwb', 'desktop'), { recursive: true })
  await writeFile(join(root, 'lwb', 'desktop', 'editions.json'), JSON.stringify(manifest, null, 2))
}

function editionFixture(overrides = {}) {
  return {
    productName: 'Fixture',
    artifactName: 'fixture-${version}-${os}-${arch}.${ext}',
    productHome: 'FixtureHome',
    protocolScheme: 'fixture',
    packs: [{ id: 'pack-one' }],
    ...overrides,
  }
}

test('the shipped manifest declares community as the default', async () => {
  const manifest = await loadEditionManifest(PROJECT_ROOT)
  assert.deepEqual(manifest.names, ['commercial', 'community'])
  assert.equal(manifest.default, 'community')
})

test('the community edition resolves only repository-owned packs', async () => {
  const manifest = await loadEditionManifest(PROJECT_ROOT)
  const edition = await resolveEdition(manifest, 'community', {
    projectRoot: PROJECT_ROOT,
    ownedPacks: new Set(['spoken-video', 'ai-arena']),
  })
  assert.deepEqual(edition.packs.map(pack => pack.id), ['spoken-video', 'ai-arena'])
  assert.equal(edition.packs[0].packageName, '@scitiger-ai/lwb-spoken-video')
  assert.equal(edition.productHome, 'LaofuWorkbench')
  assert.equal(edition.protocolScheme, 'lwb')
})

test('the commercial edition does not resolve without its pack source', async () => {
  const manifest = await loadEditionManifest(PROJECT_ROOT)
  await assert.rejects(
    resolveEdition(manifest, 'commercial', {
      projectRoot: PROJECT_ROOT,
      ownedPacks: new Set(['spoken-video', 'ai-arena']),
      env: {},
    }),
    (error) => error instanceof LwbEditionError && /LWB_COMMERCIAL_PACK_DIR/u.test(error.message),
  )
})

test('the commercial edition resolves a private pack from its pinned source', async (t) => {
  const root = await temporaryRoot(t)
  const commercial = await writePack(root, { id: 'model-review', packageName: '@acme/model-review', directory: 'commercial-checkout' })
  await writePack(root, { id: 'yuchi', packageName: '@acme/yuchi', directory: 'commercial-checkout/packs/yuchi' })
  const manifest = await loadEditionManifest(PROJECT_ROOT)
  const edition = await resolveEdition(manifest, 'commercial', {
    projectRoot: PROJECT_ROOT,
    ownedPacks: new Set(['spoken-video', 'ai-arena']),
    env: { LWB_COMMERCIAL_PACK_DIR: commercial },
  })
  assert.deepEqual(edition.packs.map(pack => pack.id), ['spoken-video', 'ai-arena', 'model-review', 'yuchi'])
  assert.equal(edition.packs[2].source, await realpath(commercial))
  assert.equal(edition.productHome, 'LaofuWorkbench')
  assert.equal(edition.protocolScheme, 'lwb')
})

test('a source-less pack must be owned by this repository', async (t) => {
  const root = await temporaryRoot(t)
  await writePack(root, { id: 'pack-one', packageName: '@acme/pack-one' })
  await writeProjectManifest(root, { schemaVersion: 1, default: 'community', editions: { community: editionFixture() } })
  const manifest = await loadEditionManifest(root)
  await assert.rejects(
    resolveEdition(manifest, 'community', { projectRoot: root, ownedPacks: new Set() }),
    (error) => error instanceof LwbEditionError && /not owned by this repository/u.test(error.message),
  )
})

test('a resolved pack must match the id the edition declares', async (t) => {
  const root = await temporaryRoot(t)
  const other = await writePack(root, { id: 'something-else', packageName: '@acme/something-else' })
  await writeProjectManifest(root, {
    schemaVersion: 1,
    default: 'private',
    editions: { private: editionFixture({ packs: [{ id: 'pack-one', source: '${FIXTURE_PACK}' }] }) },
  })
  const manifest = await loadEditionManifest(root)
  await assert.rejects(
    resolveEdition(manifest, 'private', { projectRoot: root, env: { FIXTURE_PACK: other } }),
    (error) => error instanceof LwbEditionError && /resolves to capability pack something-else/u.test(error.message),
  )
})

test('a pack source must expand to an absolute directory', async (t) => {
  const root = await temporaryRoot(t)
  await writeProjectManifest(root, {
    schemaVersion: 1,
    default: 'private',
    editions: { private: editionFixture({ packs: [{ id: 'pack-one', source: '${FIXTURE_PACK}' }] }) },
  })
  const manifest = await loadEditionManifest(root)
  await assert.rejects(
    resolveEdition(manifest, 'private', { projectRoot: root, env: { FIXTURE_PACK: 'relative/dir' } }),
    (error) => error instanceof LwbEditionError && /must be absolute/u.test(error.message),
  )
})

test('an unresolvable pack directory is reported, not ignored', async (t) => {
  const root = await temporaryRoot(t)
  await writeProjectManifest(root, {
    schemaVersion: 1,
    default: 'private',
    editions: { private: editionFixture({ packs: [{ id: 'pack-one', source: '${FIXTURE_PACK}' }] }) },
  })
  const manifest = await loadEditionManifest(root)
  await assert.rejects(
    resolveEdition(manifest, 'private', { projectRoot: root, env: { FIXTURE_PACK: join(root, 'absent') } }),
    (error) => error instanceof LwbEditionError && /cannot be packaged/u.test(error.message),
  )
})

test('an unknown edition lists the declared ones', async () => {
  const manifest = await loadEditionManifest(PROJECT_ROOT)
  await assert.rejects(
    resolveEdition(manifest, 'enterprise', { projectRoot: PROJECT_ROOT, ownedPacks: new Set() }),
    (error) => error instanceof LwbEditionError && /declared editions: commercial, community/u.test(error.message),
  )
})

test('a malformed edition manifest is rejected', async (t) => {
  const cases = [
    ['wrong schemaVersion', { schemaVersion: 2, default: 'community', editions: { community: editionFixture() } }],
    ['no editions', { schemaVersion: 1, default: 'community', editions: {} }],
    ['missing default', { schemaVersion: 1, editions: { community: editionFixture() } }],
    ['undeclared default', { schemaVersion: 1, default: 'other', editions: { community: editionFixture() } }],
    ['bad edition name', { schemaVersion: 1, default: 'Community', editions: { Community: editionFixture() } }],
    ['artifactName without a version', { schemaVersion: 1, default: 'community', editions: { community: editionFixture({ artifactName: 'fixed.${ext}' }) } }],
    ['no packs', { schemaVersion: 1, default: 'community', editions: { community: editionFixture({ packs: [] }) } }],
    ['duplicate pack ids', { schemaVersion: 1, default: 'community', editions: { community: editionFixture({ packs: [{ id: 'pack-one' }, { id: 'pack-one' }] }) } }],
    ['bad pack id', { schemaVersion: 1, default: 'community', editions: { community: editionFixture({ packs: [{ id: 'Pack_One' }] }) } }],
    ['bad protocol scheme', { schemaVersion: 1, default: 'community', editions: { community: editionFixture({ protocolScheme: '1bad' }) } }],
  ]
  for (const [label, manifest] of cases) {
    const root = await temporaryRoot(t)
    await writeProjectManifest(root, manifest)
    await assert.rejects(loadEditionManifest(root), LwbEditionError, `expected rejection for ${label}`)
  }
})

test('a missing edition manifest is reported with its path', async (t) => {
  const root = await temporaryRoot(t)
  await assert.rejects(
    loadEditionManifest(root),
    (error) => error instanceof LwbEditionError && /Edition manifest is missing/u.test(error.message),
  )
})
