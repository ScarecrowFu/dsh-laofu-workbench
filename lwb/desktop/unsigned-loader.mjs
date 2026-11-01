import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { adaptUnsignedBuilder, adaptUnsignedPreparation } from './unsigned-policy.mjs'

const root = process.env.LWB_DESKTOP_UNSIGNED_DSH_ROOT
const enabled = process.env.LWB_DESKTOP_UNSIGNED === '1' && root
const builder = enabled && pathToFileURL(join(root, 'apps/desktop/scripts/electron-builder-config.mjs')).href
const preparation = enabled && pathToFileURL(join(root, 'apps/desktop/scripts/prepare-dsh.ts')).href

/**
 * Adapt the two upstream files as they load, and leave every other module alone.
 *
 * Asynchronous — registered with `module.register`, not `module.registerHooks`.
 * A synchronous hook is chained in-process and Node validates whatever it hands
 * back, including the `{format: 'commonjs', source: null}` a CommonJS module
 * resolves to; Node 22.22 rejects that shape as an invalid hook result
 * (ERR_INVALID_RETURN_PROPERTY_VALUE), so any synchronous hook breaks the load
 * of a CommonJS module reached from ESM. tsx answers exactly that way for
 * CommonJS, which is why this hook has to stay asynchronous: the packaging flow
 * runs `pnpm exec tsx` for the unsigned preparation, and a synchronous hook here
 * ended that step before it started.
 */
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context)
  const clean = new URL(url)
  clean.search = ''
  if (!enabled || (clean.href !== builder && clean.href !== preparation)) return loaded
  const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
  return { ...loaded, source: clean.href === builder ? adaptUnsignedBuilder(source) : adaptUnsignedPreparation(source) }
}
