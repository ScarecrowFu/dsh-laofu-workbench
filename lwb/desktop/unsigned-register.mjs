import { register } from 'node:module'

/**
 * The two processes that load the files the hook adapts: electron-builder, and
 * the `prepare:dsh` script it runs. Every other process has to stay untouched
 * because the hook cannot be registered next to the build's own loader hook.
 *
 * `import-without-cache`, which the TypeScript build's native config loader
 * registers, adds a synchronous `load` hook of its own. Node validates whatever
 * a hook in a chain hands back, and the default loader answers a CommonJS module
 * reached from ESM with `{format: 'commonjs', source: null}` — a shape Node
 * rejects as an invalid hook result (ERR_INVALID_RETURN_PROPERTY_VALUE). One
 * hook is fine; two break every CommonJS module in the build. Observed on
 * 22.19, 22.20 and 22.22, so it is not one release's regression, and the gates
 * that fail first are the ones that would have compiled the product.
 *
 * Matched on the command line rather than on an environment variable because
 * NODE_OPTIONS reaches the whole process tree while argv belongs to the one
 * process that runs the script.
 */
export function registers(argv = process.argv, env = process.env) {
  if (env.LWB_DESKTOP_UNSIGNED !== '1') return false
  // The tests drive the hook directly instead of through a packaging run.
  if (env.LWB_DESKTOP_UNSIGNED_HOOK === 'always') return true
  return argv.some(argument => /electron-builder|prepare-dsh/u.test(argument))
}

if (registers()) register(new URL('./unsigned-loader.mjs', import.meta.url).href)
