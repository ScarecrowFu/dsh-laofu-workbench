/**
 * Fixtures for the render harness and the preview page.
 *
 * They mirror the shapes the host actually returns (question bank rows, task
 * snapshots with per-run answers/artifacts, and a model catalog grouped by
 * route) at a scale that exercises the new layout: fifteen models across four
 * routes, one route without an API Key, a four-model task, a live task and a
 * task that predates per-run directories.
 */
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString()

export const questions = [
  { id: 'q-pelican', title: '鹈鹕骑自行车 ★', category: '招牌题候选', tags: ['系统预置', '招牌题候选'], status: 'active', version: 3, createdAt: iso(6000), updatedAt: iso(120),
    description: '单文件 HTML，一只骑自行车的鹈鹕，看模型能不能把机械结构画对。',
    prompt: '用单个 HTML 文件画一只骑自行车的鹈鹕，要有踩踏动画、会转的车轮和随动的链条。只用 HTML/CSS/JS，不要外部资源。完成后说明你的实现方式。' },
  { id: 'q-egg', title: '长链推理 · 鸡蛋', category: '文本题', tags: ['系统预置', '文本题'], status: 'active', version: 1, createdAt: iso(5000), updatedAt: iso(200),
    description: '多步约束推理，看模型会不会在中途丢掉约束。',
    prompt: '一个农夫有一篮鸡蛋，两个两个数多一个，三个三个数多一个，四个四个数多一个，五个五个数正好数完。这篮鸡蛋最少有多少个？请给出完整推理过程，并说明每一步为什么成立。' },
  { id: 'q-wechat', title: '微信吵架截图 ★（可判性最强）', category: '招牌题候选', tags: ['系统预置', '招牌题候选'], status: 'active', version: 1, createdAt: iso(5000), updatedAt: iso(300),
    description: '用 HTML 复刻微信聊天界面，判断排版细节还原度。',
    prompt: '用单个 HTML 文件复刻一张微信聊天截图：左侧是头像和对方消息气泡，右侧是我的消息气泡，气泡要有小尖角、时间戳和输入框。风格接近真实微信。' },
  { id: 'q-metro', title: '地铁熊猫 ★', category: '招牌题候选', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(5000), updatedAt: iso(400),
    description: '在拥挤地铁里的熊猫，看构图与遮挡。',
    prompt: '用单个 HTML 文件画一只挤早高峰地铁的熊猫，要有扶手、乘客剪影和车窗外的隧道灯光。' },
  { id: 'q-clock', title: '图形动画题 | 时钟走时（可判性最高）', category: '图形动画题', tags: ['系统预置', '图形动画题'], status: 'active', version: 2, createdAt: iso(4000), updatedAt: iso(500),
    description: '指针角度必须严格等于真实时间。',
    prompt: '用单个 HTML 文件做一个模拟时钟，时针、分针、秒针的角度必须与真实时间严格一致（含秒针的连续走动），带刻度与数字。' },
  { id: 'q-ball', title: '图形动画题 | 弹跳球（测缓动曲线）', category: '图形动画题', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(4000), updatedAt: iso(600),
    description: '看重力与缓动是否自然。',
    prompt: '用单个 HTML 文件做一个弹跳球动画：球落到地面要压扁、弹起要还原，运动要有重力加速度的感觉。' },
  { id: 'q-cube', title: '图形动画题 | 正方体旋转（测 3D 投影）', category: '图形动画题', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(4000), updatedAt: iso(700),
    description: '不用三方库，自己算透视投影。',
    prompt: '用单个 HTML 文件渲染一个旋转的正方体，不要用 Three.js 等三方库，自己实现透视投影与背面剔除。' },
  { id: 'q-snake', title: '工程题 | 贪吃蛇自动寻路（唯一有机器客观分）', category: '工程题', tags: ['系统预置', '工程题'], status: 'active', version: 1, createdAt: iso(3000), updatedAt: iso(800),
    description: '寻路算法能不能真的吃到食物。',
    prompt: '用单个 HTML 文件实现贪吃蛇，并且让蛇自动寻路吃到食物、避开自己的身体与墙。要求可以连续吃到 30 个食物不失败。' },
  { id: 'q-gomoku', title: '工程题 | 五子棋人机对战（测「有没有真逻辑」）', category: '工程题', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(3000), updatedAt: iso(900),
    description: 'AI 走子是否能封堵与成五。',
    prompt: '用单个 HTML 文件实现五子棋人机对战，AI 要能识别活三、冲四并封堵，不能随机走子。' },
  { id: 'q-dashboard', title: '工程题 | 数据看板（测产品化交付）', category: '工程题', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(3000), updatedAt: iso(1000),
    description: '看信息层级与交互细节。',
    prompt: '用单个 HTML 文件做一个数据看板：顶部四个指标卡，下面是折线图与表格，支持按时间范围切换。数据用内置的假数据。' },
  { id: 'q-tea', title: '文本题 | 约束题 · 泡茶', category: '文本题', tags: ['系统预置'], status: 'active', version: 1, createdAt: iso(2000), updatedAt: iso(1500),
    description: '多重约束下不许丢条件。',
    prompt: '写一份泡茶步骤，要求：不超过 8 步、每步不超过 15 个字、必须包含水温、必须提到两次等待、不能出现「然后」这个词。' },
  { id: 'q-world', title: '长程题 | 一个能跑的世界', category: '长程题', tags: ['系统预置', '长程题'], status: 'archived', version: 1, createdAt: iso(2000), updatedAt: iso(1800),
    description: '已归档：耗时过长，留作长程参考。',
    prompt: '用单个 HTML 文件做一个「能跑的小世界」：有地形、天气、若干自动移动的生物，运行 5 分钟不会退化。' },
]

const longAnswer = `做好了：**\`pelican-bicycle.html\`**（单文件，19 KB，双击即可在浏览器打开）。

## 实现方式

**画面**：一只白身橙喙的鹈鹕坐在红色公路车上——翅膀搭在车把，长长的喙含喉囊朝向车头前方，两条腿踩着脚踏。

**动画机制**（全部由同一个相位 \`u∈[0,1)\` 驱动，因此天然无缝）：

| 部件 | 运动 |
|---|---|
| 前后轮 | 每圈踩踏转 3 圈（含轮辐、胎纹、反光片） |
| 牙盘 / 飞轮 / 链条 | 牙盘每圈 1 转，飞轮随车轮 3 转 |
| 双腿 | 两段式反向运动学求解膝盖位置，脚踝锁定在踏板点 |

**无缝验证**：把相位 0 和相位 1 分别渲染成图，两张 PNG 的 MD5 完全相同。`

const shortAnswer = `最少 25 个。

推理：条件等价于「减去 1 之后能被 2、3、4 整除」，且能被 5 整除。
- 2、3、4 的最小公倍数是 12，所以个数形如 12k + 1。
- 还要能被 5 整除：12k + 1 ≡ 2k + 1 (mod 5)，要求 2k ≡ 4，即 k ≡ 2 (mod 5)。
- 最小 k = 2，得 25。

验证：25 = 2×12+1 = 3×8+1 = 4×6+1，且 25 = 5×5。`

const answer = text => ({ turn: 1, step: 28, message: { role: 'assistant', content: [{ type: 'text', text }] } })

export const models = [
  { id: 'deepseek', name: 'DeepSeek', selectable: false,
    unavailableReason: '未配置 API Key（DEEPSEEK_API_KEY），请先在「设置 → 模型」中完成该模型服务的配置。',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-Reasoner' },
    ] },
  { id: 'deepseek-account', name: 'DeepSeek Account', selectable: true, models: [
    { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ] },
  { id: 'bailian', name: 'bailian', selectable: true, models: [
    { id: 'qwen3-max', name: 'qwen3-max' },
    { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
    { id: 'qwen3.5-turbo', name: 'qwen3.5-turbo' },
    { id: 'qwen3-coder', name: 'qwen3-coder' },
    { id: 'glm-5.3', name: 'glm-5.3' },
  ] },
  { id: 'lwb-models', name: 'LWB 模型服务', selectable: true, models: [
    { id: 'lwb-fast', name: '快速' },
    { id: 'lwb-balanced', name: '均衡' },
    { id: 'lwb-extreme', name: '极致' },
  ] },
]

const run = (id, provider, model, status, options = {}) => ({
  id, status,
  model: { provider, model, displayName: options.displayName || model },
  sessionId: options.sessionId === undefined ? `session-${id}` : options.sessionId,
  cwd: `runs/task/${id}`,
  answer: options.answer || null,
  error: options.error || null,
  artifacts: options.artifacts || [],
  // A run the pack settled on a failure, then continued from its card. Present only
  // when the host recorded it, so the report marks the continuation.
  ...(options.continued ? { continued: true } : {}),
  createdAt: options.createdAt || iso(200),
  updatedAt: options.updatedAt || iso(190),
  completedAt: options.completedAt === undefined ? iso(186) : options.completedAt,
})

export const tasks = [
  {
    id: 'task-four', status: 'failed', createdAt: iso(200), updatedAt: iso(180), artifactsUnavailable: false,
    question: questions[0],
    runs: [
      run('run-a', 'deepseek-account', 'deepseek-flash', 'succeeded', { answer: answer(longAnswer), artifacts: [{ path: 'pelican-bicycle.html', bytes: 19075, updatedAt: iso(186) }], createdAt: iso(200), completedAt: iso(185) }),
      run('run-b', 'bailian', 'qwen3-max', 'succeeded', { answer: answer(longAnswer.slice(0, 420)), createdAt: iso(200), completedAt: iso(170) }),
      run('run-c', 'lwb-models', 'lwb-balanced', 'succeeded', { answer: answer(shortAnswer), createdAt: iso(200), completedAt: iso(189) }),
      run('run-d', 'deepseek-account', 'deepseek-v4-pro', 'failed', { error: '本次会话未生成模型回答，请查看执行过程。', createdAt: iso(200), completedAt: iso(196) }),
    ],
  },
  {
    id: 'task-two', status: 'succeeded', createdAt: iso(1400), updatedAt: iso(1380), artifactsUnavailable: false,
    question: questions[1],
    runs: [
      run('run-e', 'deepseek-account', 'deepseek-flash', 'succeeded', { answer: answer(shortAnswer), createdAt: iso(1400), completedAt: iso(1397) }),
      run('run-f', 'bailian', 'qwen3.5-plus', 'succeeded', { answer: answer(shortAnswer), createdAt: iso(1400), completedAt: iso(1391) }),
    ],
  },
  {
    id: 'task-live', status: 'running', createdAt: iso(3), updatedAt: iso(0), artifactsUnavailable: false,
    question: questions[5],
    runs: [
      run('run-g', 'deepseek-account', 'deepseek-flash', 'succeeded', { answer: answer(shortAnswer), createdAt: iso(3), completedAt: iso(2) }),
      run('run-h', 'bailian', 'glm-5.3', 'running', { createdAt: iso(3), completedAt: null }),
    ],
  },
  {
    id: 'task-legacy', status: 'succeeded', createdAt: iso(9000), updatedAt: iso(8900), artifactsUnavailable: true,
    question: questions[3],
    runs: [
      run('run-i', 'deepseek-account', 'deepseek-flash', 'succeeded', { sessionId: null, answer: null, createdAt: iso(9000), completedAt: iso(8730), artifacts: [{ path: 'metro-panda.html', bytes: 24812, updatedAt: iso(8730) }] }),
      run('run-j', 'bailian', 'qwen3-max', 'succeeded', { sessionId: null, answer: null, createdAt: iso(9000), completedAt: iso(8940) }),
    ],
  },
]

/** The RPC surface this pack uses, backed by the fixtures. */
export function apiFor(fixtures = {}) {
  const bank = fixtures.questions || questions
  const list = fixtures.tasks || tasks
  const catalog = fixtures.models || models
  return async (method, request) => {
    if (method === 'questions') return bank
    if (method === 'models') return catalog
    if (method === 'tasks') return list
    if (method === 'task') return list.find(task => task.id === (request?.id)) || list[0]
    throw new Error(`preview fixtures have no answer for ${method}`)
  }
}