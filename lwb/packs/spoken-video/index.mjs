import manifest from './lwb-pack.json' with { type: 'json' }
import z from '@deepseek-ai/schemastery'
import { assertDshExecution, createDshExecutor } from '@scitiger-ai/lwb-pack-sdk/execution'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import SpokenVideoGateway from './gateway.mjs'
import { SpokenVideoProjectStore } from './spoken-video-store.mjs'
import { SpokenVideoContentStore } from './spoken-video-content-store.mjs'
import { SpokenVideoMediaHost } from './spoken-video-media-host.mjs'
import { SpokenVideoPublishHost } from './spoken-video-publish-host.mjs'
import { SpokenVideoScheduleHost } from './spoken-video-schedule-host.mjs'
import { registerSpokenVideoMediaTools } from './spoken-video-media-tools.mjs'
import { buildVideoCreatorContinuationPrompt, VIDEO_REVIEW_SCHEMA } from './spoken-video-video-agent.mjs'

export const inject = ['lwbPackRegistry', 'lwbPackServices', 'subagents', 'tools']

const MediaConnectionSettings = z.object({
  provider: z.union(['lwb', 'bailian']).default('lwb'),
  bailianReferenceVoices: z.any().default({}),
})

const PublishConnectionSettings = z.object({
  provider: z.union(['lwb', 'bailian']).default('lwb'),
  model: z.string().default(''),
})

function createStructuredExecutor(ctx, subagents, label) {
  return createDshExecutor(ctx, subagents, manifest.id, label, true)
}

export function createAgentExecutor(ctx, subagents, label, options = {}) {
  return createDshExecutor(ctx, subagents, manifest.id, label, false, options)
}

/** Host entry for the standalone spoken-video capability pack. */
export async function apply(ctx, config = {}) {
  if (config.clientOnly) return
  if (!ctx.lwbPackRegistry || typeof ctx.lwbPackRegistry.register !== 'function') {
    throw new Error('The spoken-video pack must be loaded by an LWB Profile.')
  }
  assertObjectJsonSchema(VIDEO_REVIEW_SCHEMA)
  // Fail at pack load, with a version-specific message, instead of surfacing a
  // misleading "no subagent seam" error on the first generation request.
  assertDshExecution(ctx, ctx.subagents, manifest.id)
  const scope = ctx.lwbPackServices.forPack(manifest.id)
  const context = await scope.context()
  ctx.provide('spokenVideoScope', scope)
  const projects = new SpokenVideoProjectStore()
  const connectionSettings = await scope.settings('media', MediaConnectionSettings)
  const content = new SpokenVideoContentStore({
    workspacePath: context.workspacePath, background: scope.background, fetch: scope.fetch,
    topicExecutor: config.topicExecutor || createStructuredExecutor(ctx, ctx.subagents, 'spoken-video-topic'),
    scriptExecutor: config.scriptExecutor || createStructuredExecutor(ctx, ctx.subagents, 'spoken-video-script'),
    accountExecutor: config.accountExecutor || createStructuredExecutor(ctx, ctx.subagents, 'spoken-video-account'),
    projectsStore: projects,
  })
  const media = new SpokenVideoMediaHost({
    background: scope.background, fetch: scope.fetch, signal: scope.signal,
    projectsStore: projects,
    credentials: scope.credentials, account: scope.account,
    connectionSettings,
    videoCreator: config.videoCreator || createAgentExecutor(ctx, ctx.subagents, 'spoken-video-video-creator', {
      maxTokenContinuations: 2,
      continuationPrompt: buildVideoCreatorContinuationPrompt,
    }),
    videoReviewer: config.videoReviewer || createStructuredExecutor(ctx, ctx.subagents, 'spoken-video-video-reviewer'),
  })
  const publishConnectionSettings = await scope.settings('publish', PublishConnectionSettings)
  const publish = new SpokenVideoPublishHost({
    background: scope.background, fetch: scope.fetch,
    projectsStore: projects,
    credentials: scope.credentials, account: scope.account,
    connectionSettings: publishConnectionSettings,
    packageExecutor: config.publishExecutor || createStructuredExecutor(ctx, ctx.subagents, 'spoken-video-publish'),
  })
  // Scheduling uses the same owned data context and DSH defaults as manual jobs.
  const schedule = new SpokenVideoScheduleHost({
    context, background: scope.background, modelSelection: scope.modelSelection,
    executionStatus: () => ctx.lwbPackServices.executionStatus(manifest.id),
    // Separate from `executionStatus`: this one may read the effective route's
    // credential reference so a round can name an unusable route up front
    // instead of failing on the topic child's first model request.
    modelRoute: () => ctx.lwbPackServices.modelRoute(manifest.id),
    // An unattended round creates its own root Agent; the pack states that the
    // Session is its own so ordinary conversation history keeps it hidden.
    adoptSession: (agent) => scope.sessions.adopt(agent),
    ctx,
    content,
    projects,
    media,
    publish,
  })
  ctx.provide('spokenVideoProjects', projects)
  ctx.provide('spokenVideoContent', content)
  ctx.provide('spokenVideoMedia', media)
  ctx.provide('spokenVideoPublish', publish)
  ctx.provide('spokenVideoSchedule', schedule)
  ctx.plugin(SpokenVideoGateway)
  registerSpokenVideoMediaTools(ctx, media, scope)
  ctx.effect(() => { const stop = content.startScheduler(); scope.onStop(stop); return stop }, 'spoken-video: durable content scheduler')
  ctx.effect(() => { const stop = schedule.startScheduler(); scope.onStop(stop); return stop }, 'spoken-video: durable content schedule orchestrator')
  ctx.effect(() => ctx.lwbPackRegistry.register(manifest), 'spoken-video: register LWB capability pack')
}
