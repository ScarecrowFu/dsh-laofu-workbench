import manifest from './lwb-pack.json' with { type: 'json' }
import { registerLwbPack } from '@scitiger-ai/lwb-pack-sdk'
import ModelReviewGateway from './gateway.mjs'
import { ModelReviewStore } from './model-review-store.mjs'

export const inject = ['lwbPackRegistry', 'lwbPackServices', 'llm']

export async function apply(ctx, config = {}) {
  if (config.clientOnly) return
  if (!ctx.lwbPackRegistry || !ctx.lwbPackServices) throw new Error('模型博主测评必须加载于 LWB Profile。')
  const scope = ctx.lwbPackServices.forPack(manifest.id)
  const context = await scope.context()
  const store = await new ModelReviewStore(context.workspacePath).init()
  ctx.provide('modelReviewScope', scope)
  ctx.provide('modelReviewStore', store)
  ctx.plugin(ModelReviewGateway)
  ctx.effect(() => registerLwbPack(ctx, manifest), 'model-review: register capability pack')
}

export { manifest }
