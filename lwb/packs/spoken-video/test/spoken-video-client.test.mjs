import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const clientPath = new URL('../client.js', import.meta.url)

async function connectionHelpers() {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function availableMediaProvider(')
  const end = source.indexOf('function ServiceConnectionDrawer(', start)
  assert.ok(start >= 0 && end > start)
  return vm.runInNewContext(`${source.slice(start, end)}; ({ availableMediaProvider, lwbServiceUnavailableText })`)
}

test('logged-in users see service failures instead of an instruction to log in again', async () => {
  const { lwbServiceUnavailableText: message } = await connectionHelpers()
  const signedIn = { phase: 'authenticated', user: { id: '7' }, serviceError: '请先更新 ATS 服务以启用 LWB 模型与场景服务。' }
  for (const service of ['tts', 'cover-image']) {
    const result = message(signedIn, { authenticated: true, configured: false }, service)
    assert.match(result, /已登录 LWB 账号/u)
    assert.match(result, /请先更新 ATS 服务/u)
    assert.doesNotMatch(result, /前往设置登录|请先登录/u)
  }
  assert.match(message({ ...signedIn, serviceError: null, error: '服务连接超时' }, {}, 'tts'), /服务连接超时/u)
  assert.match(message({ ...signedIn, serviceError: null }, { authenticated: true, reason: '配音服务维护中' }, 'tts'), /配音服务维护中/u)
})

test('login, loading, and service synchronization have distinct connection messages', async () => {
  const { lwbServiceUnavailableText: message } = await connectionHelpers()
  assert.match(message({ user: null }, null, 'tts'), /尚未登录 LWB 账号/u)
  assert.match(message({ phase: 'loading' }, null, 'tts'), /正在读取/u)
  const signedIn = { phase: 'authenticated', user: { id: '7' } }
  assert.match(message(signedIn, { authenticated: false, reason: '请先登录 LWB 账号。' }, 'tts'), /正在同步/u)
  assert.doesNotMatch(message(signedIn, { authenticated: false, reason: '请先登录 LWB 账号。' }, 'tts'), /请先登录/u)
  assert.match(message(signedIn, { authenticated: true, configured: false }, 'cover-image'), /封面生图服务暂未开放/u)
})

test('audio service selection stays within the available providers without changing the saved preference', async () => {
  const { availableMediaProvider: select } = await connectionHelpers()
  assert.equal(select(null, ['bailian'], 'lwb'), 'bailian')
  assert.equal(select(null, ['lwb'], 'bailian'), 'lwb')
  assert.equal(select('bailian', ['lwb', 'bailian'], 'lwb'), 'bailian')
  assert.equal(select(null, ['lwb', 'bailian'], 'bailian'), 'bailian')
  assert.equal(select('lwb', [], 'lwb'), null)
})

test('account completion uses the LAN-safe action key and keeps ID creation inside error handling', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function actionKey(')
  const end = source.indexOf('\n    function sourceName(', start)
  assert.ok(start >= 0 && end > start, 'account client must define the shared action key helper')
  const actionKey = vm.runInNewContext(`${source.slice(start, end)}; actionKey`, {
    globalThis: { crypto: {} },
  })
  assert.match(actionKey('account-completion'), /^account-completion-\d+-[a-z0-9]+$/u)
  assert.doesNotMatch(source, /const executionId = crypto\.randomUUID\(\)/u)
  assert.match(source, /try \{\s*const executionId = actionKey\('account-completion'\); setAccountExecutionId\(executionId\);/u)
})

test('topic task panel pins active work and paginates filtered terminal history', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function TopicsPage(')
  const end = source.indexOf('\n    function ScriptPage(', start)
  assert.ok(start >= 0 && end > start, 'TopicsPage must remain a standalone component')
  const page = source.slice(start, end)

  assert.match(source, /const TOPIC_HISTORY_PAGE_SIZE = 6;/u)
  assert.match(page, /const terminalTasks = history\.filter\(\(item\) => item\.status !== 'queued' && item\.status !== 'running'\);/u)
  assert.match(page, /const filteredTerminalTasks = terminalTasks\.filter\(\(item\) => historyFilter === 'all' \|\| item\.status === historyFilter\);/u)
  assert.match(page, /activeTasks\.map\(taskCard\)/u)
  assert.match(page, /pagedTerminalTasks\.map\(taskCard\)/u)
  assert.match(page, /\{ id: 'completed', label: '已完成'/u)
  assert.match(page, /\{ id: 'failed', label: '失败'/u)
  assert.match(page, /aria-label': '上一页'/u)
  assert.match(page, /aria-label': '下一页'/u)
  assert.doesNotMatch(page, /history\.slice\(0, 12\)/u)
})

test('script page waits for both a completed draft and its loaded project revision', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function ScriptPage(')
  const end = source.indexOf('\n    function AudioCaptionsPage', start)
  assert.ok(start >= 0 && end > start, 'ScriptPage must remain a standalone component')
  const page = source.slice(start, end)

  assert.match(page, /const latestDraftMatchesDetail = Boolean\(latestDraft[\s\S]*?detail\?\.artifacts\?\.script\?\.revision != null[\s\S]*?latestDraft\.scriptRevision === detail\.artifacts\.script\.revision\);/u)
  assert.match(page, /latestDraftMatchesDetail \? h\('section'/u)
  assert.doesNotMatch(page, /latestDraft\?\.scriptRevision === detail\?\.artifacts\?\.script\?\.revision/u)
})

test('audio workbench selects saved scripts by account, preserves standalone tasks, and binds subtitles to audio tasks', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function AudioCaptionsPageV2(')
  const end = source.indexOf('\n    function VideoPreviewPageV2(', start)
  assert.ok(start >= 0 && end > start, 'AudioCaptionsPageV2 must remain a standalone component')
  const page = source.slice(start, end)

  assert.match(source, /async function remoteStatic\(method, request\) \{[\s\S]*?args: request === undefined \? \{\} : \{ request \}/u)
  assert.match(page, /remote\(packId, 'listScripts', \{ query: pickerQuery, offset: pickerPage \* 8, limit: 8,/u)
  assert.match(page, /activeTab === GENERAL_TAB \? \{ general: true \} : \{ accountId: activeTab \}/u)
  assert.match(page, /按账号筛选稿件/u)
  assert.match(page, /选择稿件/u)
  assert.match(page, /remote\(packId, 'startAudioTask', \{ text,/u)
  assert.match(page, /remote\(packId, 'uploadVoiceReference', \{ name: file\.name, mediaType: file\.type, data \}\)/u)
  assert.match(page, /上传自己的参考音频/u)
  // 参考音频只吃 3–29 秒：选文件时先在浏览器侧量时长，挡住不合规的再上传。
  assert.match(source, /async function audioDurationSeconds\(file\)/u)
  assert.match(page, /const seconds = await audioDurationSeconds\(file\);/u)
  assert.ok(page.includes('参考音频至少要 ${minSeconds} 秒'))
  assert.ok(page.includes('超过 ${maxSeconds} 秒的部分会被直接截掉'))
  assert.ok(page.includes('时长需 ${service?.voiceReferenceMinSeconds || 3}–${service?.voiceReferenceMaxSeconds || 29} 秒'))
  assert.match(page, /accept: 'audio\/mpeg,audio\/wav/u)
  assert.doesNotMatch(page, /预置音色 ID|指定预置音色/u)
  assert.match(page, /remote\(packId, 'startAudioTaskSubtitles', \{ taskId: task\.id, provider: providerId, language: 'zh', aiOptimize: true \}\)/u)
  assert.match(page, /setSubtitleDrawer\(\{ task, cues: subtitleCues\(task\.subtitle\?\.srt\), saving: false \}\)/u)
  assert.match(page, /const srt = srtFromSubtitleCues\(subtitleDrawer\.cues\);/u)
  assert.match(page, /remote\(packId, 'saveAudioTaskSubtitles', \{ taskId: subtitleDrawer\.task\.id, srt \}\)/u)
  assert.match(page, /className: 'sv-textarea sv-subtitle-text'/u)
  assert.match(page, /title: '生成配音'/u)
  assert.match(page, /onConfirm: \(\) => \{ void createAudioTask\(\); \}/u)
  assert.match(page, /title: '保存字幕'/u)
  assert.match(page, /onConfirm: \(\) => \{ void saveSubtitles\(\); \}/u)
  assert.doesNotMatch(page, /subtitleDrawer\.draft|sv-warn-list/u)
  assert.match(source, /readAudioTaskMedia/u)
  assert.match(page, /AudioTaskPreview/u)
  assert.match(page, /remoteStatic\('configureMediaConnection', \{ provider: connectionProvider,/u)
  assert.match(page, /remoteStatic\('clearMediaConnectionCredential', \{ provider: connectionProvider \}\)/u)
  assert.doesNotMatch(page, /remote\(packId, '(?:configureMediaConnection|clearMediaConnectionCredential)'/u)
  assert.match(page, /source\?\.projectId \? \{ sourceProjectId: source\.projectId \}/u)
  assert.doesNotMatch(page, /provider: providerId, apiKey,/u)
  assert.match(page, /h\(ServiceConnectionDrawer, \{ open: connectionOpen/u)
  assert.match(source, /密钥保存到私有凭据库，不会写入浏览器存储/u)
  assert.match(source, /function mediaErrorText\(error\)[\s\S]*?LWB 账户积分不足，请充值后重试，或切换到百炼 BYOK/u)
  assert.match(source, /function subtitleTaskProgress\(task, now = Date\.now\(\)\)[\s\S]*?实时识别/u)
  assert.match(page, /subtitleProgress = subtitleTaskProgress\(task\)/u)
  assert.match(page, /className: 'sv-audio-subtitle-progress'/u)
  assert.match(page, /'aria-label': '字幕识别进度'/u)
  assert.match(page, /mediaErrorText\(task\.error\)/u)
  assert.match(page, /mediaErrorText\(subtitle\.error\)/u)
  assert.doesNotMatch(page, /sv-list sv-run-list/u)
})

test('script drawer opens directly in edit mode and paginates completed history', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function ScriptPage(')
  const end = source.indexOf('\n    function AudioCaptionsPage', start)
  const page = source.slice(start, end)

  assert.match(page, /setDrawerMode\('edit'\)/u)
  assert.match(page, /const activeHistoryTasks = history\.filter\(\(item\) => item\.status === 'queued' \|\| item\.status === 'running'\);/u)
  assert.match(page, /const pagedHistoryTasks = filteredHistoryTasks\.slice\(historyPage \* 6, historyPage \* 6 \+ 6\);/u)
  assert.match(page, /pagedHistoryTasks\.map\(taskCard\)/u)
  assert.doesNotMatch(page, /history\.slice\(0, 12\)/u)
})

test('video workbench separates source selection from durable, filterable video tasks', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function VideoPreviewPageV2(')
  const end = source.indexOf('\n    const PUBLISH_STATE_LABEL', start)
  assert.ok(start >= 0 && end > start, 'VideoPreviewPageV2 must remain a standalone component')
  const page = source.slice(start, end)

  assert.match(page, /按账号筛选视频稿件与任务/u)
  assert.match(page, /project\.completedStages\.includes\('script'\) && project\.completedStages\.includes\('voiceover'\)/u)
  assert.match(page, /useVideoTasks\(packId, taskQuery, taskFilter, taskPage/u)
  assert.match(page, /remote\(packId, 'startVideoRender'/u)
  assert.match(page, /React\.useState\('landscape'\)/u)
  assert.match(page, /setSubtitleEnabled\(savedVideo \? savedVideo\.subtitleEnabled !== false : done\(detail, 'subtitles'\)\)/u)
  assert.match(page, /disabled: !done\(detail, 'subtitles'\)/u)
  assert.match(page, /竖屏 9:16/u)
  assert.match(page, /横屏 16:9/u)
  assert.match(page, /orientation: settings\.orientation === 'portrait' \? 'portrait' : 'landscape'/u)
  assert.match(page, /remote\(packId, 'uploadVideoBgm', \{ projectId: detail\.id, name: file\.name, mediaType: file\.type, data \}\)/u)
  assert.match(page, /背景音乐（可选）/u)
  assert.match(page, /BGM 音量/u)
  assert.match(page, /stage: 'bgm'/u)
  assert.match(page, /留空由 AI 视觉导演自主决定/u)
  assert.match(page, /visualBrief: settings\.visualBrief\.trim\(\) \|\| DEFAULT_VIDEO_VISUAL_BRIEF/u)
  assert.doesNotMatch(page, /!visualBrief\.trim\(\) \|\| !hasRequiredSource/u)
  assert.match(page, /选择已完成配音的稿件/u)
  assert.match(page, /还有 \$\{candidates\.length - 6\} 篇 · 查看更多/u)
  assert.match(page, /查看稿件/u)
  assert.match(page, /查看配音\/字幕/u)
  assert.match(page, /执行详情/u)
  assert.match(page, /VideoTaskMediaPreview/u)
  assert.match(page, /任务创建时冻结的稿件快照/u)
  assert.match(page, /展示任务创建时冻结的声音与字幕版本/u)
  assert.match(page, /DSH \+ Remotion/u)
  assert.match(page, /技术质检与独立审片通过/u)
  assert.doesNotMatch(page, /运行技术质检/u)
  assert.match(page, /sv-layout sv-video-workbench/u)
  assert.match(page, /sv-section sv-video-task-list/u)
  assert.doesNotMatch(page, /人工视频制作兜底/u)
  assert.doesNotMatch(page, /人工质检兜底/u)
  assert.doesNotMatch(page, /MediaRunList\(/u)
  assert.doesNotMatch(page, /commit\(detail, 'video'/u)
  assert.match(source, /\.sv-video-workbench \{ grid-template-columns:minmax\(300px,\.82fr\) minmax\(0,1\.18fr\); grid-template-areas:'sources tasks'; \}/u)
})

test('content schedule keeps run history scoped to each schedule drawer', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function ContentSchedulePage(')
  const end = source.indexOf('\n    function mediaRunLabel(', start)
  assert.ok(start >= 0 && end > start, 'ContentSchedulePage must remain a standalone component')
  const page = source.slice(start, end)

  assert.match(page, /onClick: \(\) => setHistorySchedule\(schedule\) \}, '运行记录'/u)
  assert.match(page, /h\(ScheduleRunHistory, \{ key: historySchedule\.id, packId, scheduleId: historySchedule\.id/u)
  assert.doesNotMatch(page, /h\('h3', null, '运行历史'\)/u)
  assert.doesNotMatch(page, /h\(ScheduleRunHistory, \{ key: activeTab/u)
  assert.match(source, /function ScheduleRunHistory\(\{ packId, scheduleId, refreshKey, onPublish, onContinue \}\)/u)
  assert.match(source, /function emptyScheduleForm\(\) \{[\s\S]*?orientation: 'landscape'/u)
  assert.match(page, /className: 'sv-as-adv-title' \}, '每轮产量与成片规格'/u)
  assert.doesNotMatch(page, /h\('details'|h\('summary'|高级：每轮产量与成片规格/u)
})

test('publish page is a flat video shelf with one lifecycle drawer and no release gates', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function PublishPageV4(')
  const end = source.indexOf('\n    async function apply(ctx)', start)
  assert.ok(start >= 0 && end > start, 'PublishPageV4 must remain a standalone component')
  const page = source.slice(start, end)

  // The shelf is a single column of video cards: no task panel, no second drawer.
  assert.match(page, /className: 'sv-pb-shelf'/u)
  assert.doesNotMatch(page, /sv-split/u)
  assert.doesNotMatch(page, /moreDrawer|summaryDrawer|openMore|openSummary/u)
  assert.match(source, /const PUBLISH_PAGE_SIZE = 8;/u)
  assert.match(page, /PUBLISH_PAGE_SIZE/u)
  assert.match(page, /aria-label': '上一页'/u)
  assert.match(page, /aria-label': '下一页'/u)

  // Videos play in a modal; bytes are pulled lazily through readPublishAsset.
  assert.match(page, /PublishVideoThumb/u)
  assert.match(source, /remote\(packId, 'readPublishAsset', \{ projectId: item\.id, kind: 'video' \}\)/u)

  // Opening a video without publish info triggers exactly one generation.
  assert.match(page, /autoTriggered\.current/u)
  assert.match(page, /void startPackaging\(detail\.id, detail\.revision\)/u)

  // Covers: prompt is visible and editable, regenerable per direction, uploadable.
  assert.match(page, /remote\(packId, 'regeneratePublishCover', \{ projectId: detail\.id, expectedRevision: revision, kind, prompt: prompts\[kind\], negativePrompt: prompts\.negative \}\)/u)
  assert.match(page, /setPrompts\(\(prev\) => \(\{ \.\.\.prev, \[kind\]: event\.target\.value \}\)\)/u)
  assert.match(page, /按此提示词生图/u)
  assert.match(page, /uploadPublishCover/u)
  assert.doesNotMatch(page, /connectionEnabled|启用 AI 封面生成/u)
  assert.match(page, /service\?\.configured/u)
  assert.match(page, /lwbServiceUnavailableText\(account, service\.providers\?\.lwb\?\.credential, 'cover-image'\)/u)
  assert.doesNotMatch(page, /当前生图渠道尚未配置 API Key/u)
  // Regenerating a cover commits unsaved edits first, like the script page.
  assert.match(page, /if \(dirty\) \{[\s\S]*?updatePackaging[\s\S]*?revision = saved\.project\.revision/u)

  // Readiness is the whole contract: title/copy/description/tags.
  assert.match(page, /资料齐备即视为可发布/u)
  assert.match(page, /重新生成发布信息/u)

  // No approval, queue or export surface survives.
  assert.doesNotMatch(page, /人工批准|加入发布队列|生成发布包|下载发布包/u)
  assert.doesNotMatch(page, /stage: 'approval'|stage: 'queue'/u)
  assert.doesNotMatch(page, /exportPublishPackage|readExport|queuePackage|listPublishTasks/u)
  assert.doesNotMatch(page, /destination/u)
  assert.match(page, /title: '发布'/u)
  assert.doesNotMatch(page, /发布 \/ 入队/u)
})
