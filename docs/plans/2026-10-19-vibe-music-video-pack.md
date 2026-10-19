# Vibe 知识大赏 · 音乐视频 场景能力包

实施方案 v1（只做设计，不落码）。日期：2026-10-19。

---

## 0. 一句话

新增独立能力包 `vibe-music-video`：用户填一张表单（主题 / 观众 / 音频 / 文字稿 / 风格参考 / 主角 / 规格 / 时长），
启动后由「导演 Agent + 节拍网格 + Remotion 渲染外壳」自动产出一条 1–3 分钟、**跟着音乐走**的知识类风格化短片。

它和口播包不是「同一个视频流水线换个模板」，而是**时间轴的主源换了**：口播包的主源是字幕（SRT 句子），
本包的主源是音乐的**节拍网格**（BPM / 小节 / 段落）。这一个改变会连锁改变输入、Agent 分工、校验口径和渲染外壳。

---

## 1. 结论总览

| 项 | 结论 |
|---|---|
| 包形态 | 独立包 `lwb/packs/vibe-music-video/`，与 `spoken-video`、`ai-arena` 同级，互不依赖 |
| 渲染底座 | 复用仓库已有的 Remotion 4.0.522 + 受保护外壳 + 预检 + 技术 QC + 独立审片这套骨架 |
| 新增底座 | **音频节拍分析**（BPM/拍点/小节/段落/能量）产出 `beats.json`，成为全流程唯一时间基准 |
| Agent 分工 | 结构化「导演」产出可校验的 `treatment.json`（含分镜与卡点表）+ 非结构化「创意实现」写 `CreativeVideo.tsx` |
| 校验增量 | 口播包没有的两道门：**卡点 QC**（计划层 + 成片层双向）、**风格一致性 QC** |
| 默认提示词 | 内置中文总提示词模板 v1（骨架来自 `haiy/opus55-video-guide-zh`），变量由表单填充，用户可改、可恢复默认、每次任务快照 |
| 视觉参考 | 三层：**风格库**（可执行令牌，取自 chenyuxiaojin + lemo）、**案例库**（awesome-claude-opus-5.5，只做观感索引）、**提示词库**（用户自己的） |
| 首个可用版本 | P0 = 单音频、无文字稿、单风格、横屏 30fps，端到端跑通并过全部 QC |

### 五条关键判断

1. **不能拿口播包的默认视觉语言来做这个包。** 口播包的 prompt 明确要求「明亮、通透、浅色背景、深色文字、拒绝暗色霓虹」，
   而 vibe 类内容的高辨识度恰恰来自强风格（暗场、锐利对比、材质、字效）。两者默认值必须相反，否则做出来就是「配了音乐的 PPT」。
2. **音乐必须是只读输入。** 不 remix、不换速、不裁剪重编，只在**段落结束点**做节选。这决定了「时长」是推导出来的，不是先定的。
3. **卡点必须能机器验，不能靠审片 Agent 眼判。** 靠「看着挺齐」永远会漏 3–5 帧的系统性偏移。
4. **风格必须落成可检查的令牌**（配色区间 / 材质 / 字体 / 运动规律 / 运镜词汇），而不是一句「高级、震撼、电影感」。三个参考仓库的方法论在这一点上完全一致。
5. **不做「一屏到底的大段落」。** 无旁白时屏幕字是唯一信息载体，必须用「≤20 汉字/屏 + 停留时长下限」把它约束住，否则信息密度直接崩。

---

## 2. 外部资料：三个仓库各取什么

| 来源 | 实际资产 | 在本包里的角色 | 授权注意 |
|---|---|---|---|
| `haiy/opus55-video-guide-zh` | 中文 MV **总提示词**、4 段分阶段提示词、七步流程、分镜表范式、常见故障表 | **默认提示词的骨架**（改写为产品模板，不是逐字复制） | 仓库自称「重新编排的实操说明和原创模板」，引用需在 THIRD_PARTY_NOTICES 注明来源与改编 |
| `chenyuxiaojin/opus55-video-style-prompts` | **15 种风格**，每种 260 字左右，统一「风格三段式（造型材质 / 配色背景 / 运动规律）+ 共用导演层 + 内容占位符」 | **风格库的第一批种子**（结构最干净、最容易结构化） | 提示词为作者观察后重写；截图版权属原视频作者，**不得直接搬运截图** |
| `lemomo-ai/lemo-opuscar` | **51 种风格**的 `STYLE.md`（外观 / 材质 / 配色逻辑 / 字体 / 运动 / 镜头词汇 / 声音调色板 / 原生动作）+ `DIRECTOR.md` + `TECHNIQUE.md` | **风格令牌的字段定义来源**；`DIRECTOR.md` 的节奏与镜头规则直接进本包的导演 SKILL | 代码与文档 MIT（署名 + 链接）；样片与截图 CC BY 4.0 |
| `xianyu110/awesome-claude-opus-5.5` | 317 个精选案例，10 大类（游戏 / 动效 / 3D / 讲解动画 / 可视化 / MV …），带原帖与点赞 | **案例库**：只做「点开看看长什么样」，不作为提示词来源 | 案例本身版权归原作者，只存链接与元数据，不存画面 |

补充第四份（内容侧，非风格侧）：`DeanWei/cs-skills` 的 `vibe-knowledge.md`，把「vibe 知识大赏」拆成了
**搜集（来源可核查）→ 编排（为观看写文案）→ 找图 → 定样式与分镜 → 逐镜检查** 五步，可直接作为知识类题材的「事实卡」子流程参考。

### 三者不重复，是三层

```
风格层（怎么做出来）  ← chenyuxiaojin 15 种（执行细则）+ lemo 51 种（字段更全）
方法层（怎么导）      ← haiy 总提示词 + lemo DIRECTOR
观感层（做成什么样）  ← awesome 317 案例（只给链接与一句特征）
```

---

## 3. 与口播包的七个分水岭

| 维度 | 口播包 `spoken-video` | 本包 `vibe-music-video` | 连锁后果 |
|---|---|---|---|
| **时间轴主源** | SRT 句子（TTS 产物） | **节拍网格** beats/bars/sections | 所有阶段都以 `beats.json` 对齐，不生成字幕时间轴 |
| **音频** | 生成（TTS），时长可变 | **固定输入，只读**；只分析不合成 | 音频先落地并分析，`durationSeconds` 由音频推导 |
| **文字** | 字幕是必读信息，独立受保护层 | 屏幕字是**构图元素**；无旁白时是唯一信息载体 | 新增可读性 QC（≤20 汉字/屏、停留下限）；歌词可按拍吸附 |
| **视觉默认** | 明亮通透、白底深字、图解化 | **风格驱动**，允许暗场/强对比/材质/字效 | 默认 prompt 必须反向；新增「风格令牌」而非「视觉简报」 |
| **镜头逻辑** | 随语义段落切 | 随**乐句/小节**切，禁止等间隔硬切，≥4 种运镜，至少一次「呼吸」 | 新增分镜表 + 卡点表，且必须机器校验 |
| **节奏** | 跟随讲解语速 | 跟随鼓点，要有快慢对比与一次加速/减速 | 新增「节奏密度」约束（不要每拍都切） |
| **校验** | 技术 QC + 独立审片 | 技术 QC + **卡点 QC** + **可读性 QC** + **风格 QC** + 独立审片 | 失败修复提示词要按类别定向 |

### 三条推论（会直接影响代码）

1. **受保护外壳要换一套。** 口播外壳保护的是「配音轨 + 确定性字幕组件」；本包要保护的是「音乐轨 + 节拍网格注入 + 歌词/文字渲染器 + 安全区」。
2. **创作 Agent 的提示词不能复用 `buildVideoCreatorPrompt`。** 口播那版通篇在讲「与口播语义对应、避免暗色仪表盘」；本包要讲「风格令牌、连续长镜头、卡点、每帧可截图」。
3. **渲染必须支持任意 fps 与分辨率。** 口播外壳把 30fps 和 1920×1080/1080×1920 写死了，本包从 `task.json` 读 `fps/width/height`。

---

## 4. 内容形态：vibe 知识大赏 的解剖

从公开案例与参考仓库归纳出的稳定结构（写进导演 SKILL 作为默认叙事模板，不是硬约束）：

| 段 | 占比 | 作用 | 硬要求 |
|---|---|---|---|
| 钩子 | 0–8% | 第一秒亮出**具体问题或冲突** | 不用「考你一个问题」这类铺垫；3 秒内让人知道在看什么 |
| 建立 | 8–25% | 给出一个贯穿全片的视觉主线（一个主角/一个图形/一个物件） | 主线必须能被 reuse 到结尾 |
| 展开 | 25–65% | 3–5 个关键点，每点配一个生活比方 | 认知反转必须有事实支撑，不能靠修辞 |
| 转折 | 65–85% | 情绪峰值；「原生动作」放在这里（只有这个媒介能做的那一下） | 至少 2 处真静音或近静音，静音后的第一个声音要重要 |
| 落点 | 85–100% | 回到开头的主线，回答「这和你有什么关系」 | 结尾定格 ≥0.5s，不提前黑屏 |

信息密度（无旁白时）：

- 每屏 ≤ 20 个汉字，专业词首次出现必须白话解释；
- 单屏停留 ≥ `字数 ÷ 4.5 + 1.5` 秒（中文口径，来自 lemo 的 readcheck）；
- 标题卡 ≥ 4 秒；字幕/关键词不与主体抢焦点。

时长默认规则：

- **有音频**：默认取整段；超过 3 分钟则提示「建议节选」，节选点必须落在**完整乐句/小节线**，保留尾音 0.6–1.0s；
- **指定了目标时长**：在目标值附近找最近的**小节线**收尾，不按整数秒硬切；
- **无音频**（P2 才支持）：由内容决定，30–180 秒。

---

## 5. 输入契约

### 表单字段

| 字段 | 必填 | 默认 | 控件 | 备注 |
|---|---|---|---|---|
| 作品主题 | 是 | — | 单行标题 + 一句话结论（两个输入框） | 结论用于收尾呼应，强制填能显著提升成片 |
| 观众 | 否 | 「泛知识短视频观众」 | 输入 + 3 个预设（学生 / 职场 / 爱好者） | 影响词汇层级，不影响画面 |
| 音频 | 是 | 内置 `claude 小曲.m4a` | 上传 / 从素材库选 | 选中后立即探测并显示：时长、BPM、拍点数量、段落数 |
| 歌词或文字稿 | 否 | 无 | 粘贴，或上传 `.txt/.lrc/.srt` | `.lrc/[mm:ss.xx]` 与 `.srt` 直接给时间；纯 txt 按拍吸附 |
| 视觉参考 | 否 | 无 | 风格库多选（≤2）+ 案例库链接 | 选 2 个时要求各自说明「参考它的什么」 |
| 主角与固定特征 | 否 | 无 | 文本 + 可选参考图 | 有主角时强制生成「角色设定卡」（脸型/发型/服装/配色）并复用 |
| 画幅 | 是 | 横屏 | 横屏 / 竖屏 | 竖屏对应抖音主场景，取 1080×1920 |
| 分辨率 | 是 | 1920×1080 | 预设 + 自定义 | 竖屏预设 1080×1920 |
| 帧率 | 是 | 30fps | 24 / 25 / 30 / 60 | 24 偏电影感，60 只建议强运动风格 |
| 目标时长 | 否 | 自动 | 自动 / 整段 / 秒数 | 自动 = 按第 4 节规则推导 |
| 高级：导演提示词 | 否 | 模板 v1 | 展开编辑 + 恢复默认 | 见第 6 节 |
| 高级：停靠点 | 否 | 样片确认 = 开 | 分镜确认 / 样片确认 / 全程自动 | 见第 13 节分期 |

### 冻结规则

点「启动任务」后写 `brief.json`（含提示词快照、风格令牌快照、beats 指纹），**后续修改默认值或模板都不影响已启动的任务**。
重跑用 `revision` + 幂等键，不覆盖历史产物（沿用口播包 `spoken-video-store` 的 artifact 语义）。

---

## 6. 默认提示词

### 设计原则

- **骨架照 haiy 的分节结构**（我的输入 / 计划与样片 / 素材与场景 / 镜头与时间线 / 文字与动画 / 音频 / 检查与迭代 / 最终交付）——这套结构好用的原因是它把「先计划、再样片、后全片」写成了流程，而不只是风格描述。
- **增加两段口播包没有的**：`【节拍表】`（把 beats.json 压成人类可读的时间码表塞进 prompt）和 `【风格令牌】`（可检查的颜色/材质/运动规则 + 反例）。
- **删掉一段**：`【音频】`里口播包那套「先保证音画同步再处理音量」要改成「音乐只读 + 卡点以节拍表为准 + 节选只在乐句边界」。
- **反空泛词**：模板里显式禁用「高级 / 震撼 / 电影感 / 大片感 / 氛围拉满」这类不可执行的形容词。

### 模板骨架（v1，占位符用 `{花括号}`）

```
你是这支片子的导演、动画设计师和制作工程师，要交付可以实际导出的完整工程，而不是方案或建议。

【我的输入】
作品主题：{theme}
一句话结论：{thesis}
观众：{audience}
音频：{audioFile}（{duration}，{bpm} BPM，{bars} 小节）
歌词或文字稿：{lyricsOrNone}
视觉参考：{styleRefs}（每个写明参考它的哪一部分）
主角与固定特征：{protagonistOrNone}
画幅 / 分辨率 / 帧率：{width}×{height} / {fps}fps
目标时长：{targetDuration}
音乐节选：{trimRule}

【节拍表】（唯一时间基准，不得自行猜测节拍）
BPM {bpm}，{timeSignature}/4，首拍 {offsetMs}ms。
小节：{barTable}
段落：{sectionTable}
能量曲线：{energyTable}

【风格令牌】（必须逐条落到代码，不得用"高级/震撼/电影感"代替）
{styleTokens}

【先做计划与样片】
先读全部输入，给出能够实际跑的路线；提出一条贯穿全片的视觉主线，用具体的颜色、构图、角色、文字和运动规则描述它；
列出需要确认的歧义（集中一次问，不要边做边问）。先做 {sampleSeconds} 秒完整样片，覆盖主体、文字、动作和一次真实导出。

【素材与场景】
有主角就先定角色设定（脸型/发型/服装/关键配色），全片复用同一份；素材一旦选定就固定在工程里，不允许每次渲染随机替换；
同一段落的人物、环境、光线与图形语言保持一致。

【镜头与时间线】
按小节和小节内的拍点安排镜头，不做等间隔机械切镜；切点必须落在拍点或小节线上，允许不超过 10% 的刻意错拍且不得连续错拍。
全片至少 4 种不同运镜/景别变化；必须有一次明确的加速或减速，和一次"呼吸"（长镜头或静止停留）。
开头 3 秒内让人看懂主体；结尾兑现开头展示的主题，并定格不少于 0.5 秒。

【文字与动画】
区分信息文字与歌词动效。无旁白时每屏不超过 20 个汉字，专业词首次出现用白话解释。
文字停留时间不少于「汉字数 ÷ 4.5 + 1.5」秒；标题卡不少于 4 秒。文字留在安全区内，不压主体。
用帧驱动动画（useCurrentFrame / interpolate / spring / Sequence），同一时间点必须稳定复现同一画面；随机效果固定种子。

【音频】
音乐是只读输入：不改旋律、唱词、音高、速度。只做节选，且节选落在完整乐句或小节线，保留尾音。
画面变化以节拍表为准，不以"感觉"为准。

【检查与迭代】
先出低分辨率检查版，检查结构、卡点、文字可读性和素材连续性，再导出正式版。
按时间码列问题、原因和修改方案；每轮优先修最影响观看的几项。检查真实导出文件，不只检查预览。

【最终交付】
1. 可播放 MP4；2. 可编辑源工程；3. 素材与风格令牌清单；4. 实际检查结果与未完成项。
先输出你对任务的理解、素材缺口、分镜与卡点计划，再开始实现。
```

### 变量与版本

| 项 | 设计 |
|---|---|
| 模板存储 | `lwb/packs/vibe-music-video/prompts/director.v1.md`（包内默认） |
| 用户覆盖 | 包设置 `promptOverride`（全局默认）+ 每个作品 `promptOverride`（单次） |
| 快照 | 每次任务把**渲染后的最终文本**写进 `runs/<runId>/prompt.md`，附 `promptVersion` 与模板 hash |
| 恢复默认 | UI 一键把 override 清空；不删历史快照 |
| 变量校验 | 模板里出现未知占位符 → 建任务时预检失败并列出，不静默留空 |

---

## 7. 音频与节拍（本包的新底座）

### 流程（纯本地、确定性，不引入新依赖）

```
ffprobe 探测 → ffmpeg 解码为 22050Hz 单声道 f32 → Node 内分析 → beats.json → 页面可校正
```

1. **探测**：时长、采样率、声道、编码、平均响度。
2. **解码**：`ffmpeg -ac 1 -ar 22050 -f f32le -`，PCM 在内存里流式处理。
3. **分析**（约 200 行，可单测）：
   - 短时傅里叶（窗 512 / 跳 256）→ 频谱通量（spectral flux）得 onset 包络；
   - 包络自相关 + 抛物线插值 → BPM（60–180 区间取峰，记录置信度）；
   - 动态规划节拍跟踪（Ellis 简化版）→ 拍点时间序列；
   - 低频谱能量在 `拍点 mod 4` 上的偏重 → 估计强拍相位（默认 4/4）；
   - 能量曲线（每 100ms RMS）+ 音色新颖度 → 段落边界。
4. **校正**：页面显示波形 + 拍点竖线，可整体平移相位、改 BPM、改拍号、手动加/删拍点。
   **人工校正过的结果打 `manualOverride: true`，后续不再自动重算。**

### `beats.json`

```json
{
  "schemaVersion": 1,
  "source": { "file": "audio.m4a", "durationMs": 192340, "sampleRate": 22050 },
  "tempo": { "bpm": 96.4, "confidence": 0.82, "timeSignature": 4, "offsetMs": 217 },
  "beats": [217, 840, 1462, 2085],
  "bars":  [{ "index": 0, "startMs": 217, "endMs": 2718 }],
  "sections": [{ "id": "intro", "startMs": 0, "endMs": 18400, "energy": 0.22 }],
  "energy": [{ "t": 0, "rms": 0.11 }],
  "manualOverride": false
}
```

同一个文件同时喂给**导演 Agent**（转成人类可读表）和**渲染外壳**（转成 props），保证两边看到的是同一组数字。

### 失败与降级

| 情况 | 处理 |
|---|---|
| 检测置信度 < 0.4 | 标记「节拍不确定」，要求用户确认 BPM 或改用「段落对齐」模式（只在段落边界切） |
| 无节拍的音频（纯氛围/长音） | 自动降级为「段落对齐」：按能量与新颖度切，不承诺拍点精确 |
| 音频 > 5 分钟 | 提示建议节选，不自动截 |

---

## 8. 风格库

### 目录结构

```
lwb/packs/vibe-music-video/styles/
  catalog.json              # 索引（页面列表用，小，启动即读）
  <style-id>/style.json     # 单风格完整令牌
  <style-id>/preview.mp4    # 2.5 秒自生成预览（非第三方截图）
  <style-id>/preview.jpg    # 首图
  cases.json                # 案例索引（awesome 仓库的元数据 + 外链）
```

### `style.json` 字段

```json
{
  "schemaVersion": 1,
  "id": "sticker-explainer",
  "name": { "zh": "贴纸风科普", "en": "Sticker Explainer" },
  "source": { "repo": "chenyuxiaojin/opus55-video-style-prompts", "path": "prompts/07-sticker-explainer.md", "adaptation": "adapted" },
  "signature": "实物抠成照片贴纸，抽象信息拆成可飞起重排的深色方块",
  "tokens": {
    "palette": { "ground": "#EDEFF2", "ink": "#141414", "accent": ["#FF5A3C"], "forbidden": [] },
    "material": "photo cut-out + soft shadow",
    "type": { "family": "Noto Sans SC", "weightRange": [700, 900], "treatment": "thick white keyline" },
    "motion": ["pop with overshoot", "stagger fly-in", "whole-frame whip with directional blur"],
    "camera": ["push", "pull", "parallax"],
    "nativeMove": "方块重排成新结构",
    "avoid": ["平滑矢量线条", "大面积渐变", "多强调色"]
  },
  "fit": { "genres": ["科普", "解释"], "aspects": ["16:9", "9:16"], "fpsHint": 30 },
  "credit": "风格观察自 VincentWei93 展示片，提示词为本包改编"
}
```

`tokens` 是**可检查**的：调色区间、禁用色、字体族与字重区间、允许的运动词汇、禁止项——这些就是风格 QC 的判据。

### 三个来源的分层用法

| 层 | 数量 | 进入方式 | 用途 |
|---|---|---|---|
| 风格（可执行） | v1 精选 **15 个**（chenyuxiaojin 全部）+ **12 个**（lemo 中与知识科普契合的：Data Storytelling / Isometric Infographic / Dark Tech Keynote / Swiss Motion / Pictogram Motion / Blueprint / Stained Glass / Halftone Dossier / Risograph / Woodcut / One-line / Watercolor） | 手工结构化进 `style.json` | 用户选参考 / 导演提案 |
| 案例（观感） | awesome 仓库 10 大类、约 40 条与「知识/动效/MV」相关的 | 只存 `{title, category, author, likes, url, oneLiner}` | 用户浏览找感觉，点出去看原帖 |
| 提示词（用户自有） | 不限 | 用户粘贴保存 | 私有风格，不进包 |

### 预览图怎么办（重要）

第三方截图**版权归原视频作者**（chenyuxiaojin 仓库自己也这么声明），不能直接打进产品。
**方案：用本包自己的渲染器为每个风格生成 2.5 秒预览**（同一段中性内容，如「光 / 水 / 数字」三个词的 8 拍小样），
一条命令批量产出 `preview.mp4` + `preview.jpg`。好处：授权干净、风格令牌真的能跑、用户看到的就是能交付的效果。
代价：一次性要写 27 个 style.json 的示例实现（可分批，P0 只做 8 个）。

---

## 9. 时间轴与卡点契约

### `timeline.json`（分镜与卡点的机器可读版）

```json
{
  "schemaVersion": 1,
  "durationMs": 118000,
  "beatGrid": "inputs/beats.json",
  "shots": [
    { "id": "s01", "inMs": 217, "outMs": 5964, "beatIn": 0, "beatOut": 12,
      "section": "intro", "intent": "亮出问题", "framing": "wide",
      "camera": "push", "nativeMove": null, "texts": ["t1","t2"] }
  ],
  "cues": [
    { "t": 217,  "type": "cut" },
    { "t": 1462, "type": "textIn", "id": "t1" },
    { "t": 5964, "type": "cut", "offGrid": false }
  ],
  "texts": [
    { "id": "t1", "text": "为什么你记得住旋律，记不住公式", "inMs": 1462, "outMs": 5400 }
  ]
}
```

### 规则

| 规则 | 口径 |
|---|---|
| 切点落位 | `cut` 的 `t` 必须等于某个拍点（±1 帧）或小节线（±1 帧） |
| 刻意错拍 | `offGrid: true` 且写明 `reason`；占比 ≤10%，不得连续两个 |
| 镜头最短 | ≥ 2 拍（避免每拍都切的碎剪） |
| 运镜多样性 | `shots[].camera` 去重后 ≥ 4 种 |
| 呼吸点 | 至少 1 个 `shot` 时长 ≥ 8 拍 |
| 结束 | 最后一个镜头 `outMs` 落在小节线，且 `durationMs - outMs ≥ 500ms`（定格） |
| 文字 | 每屏 ≤ 20 汉字；`outMs - inMs ≥ 字数/4.5 + 1500` |

### 双向校验（这是本包最关键的一道门）

1. **计划层**：`timeline.json` 的每条 cue 对 `beats.json`，容差 ±1 帧，逐条列偏差（毫秒）。
2. **成片层**：`ffmpeg -vf scdet` 检测实际场景切点，与 `timeline.json` 的 `cut` 数量/位置比对（±3 帧）。
   目的：防止 Agent「写了很漂亮的卡点表但代码里没照做」。口播包只有技术 QC，这一层是新增的。

---

## 10. 渲染工程

### 外壳差异（相对口播包）

| 项 | 口播 `agentRootSource` | 本包 `musicRootSource` |
|---|---|---|
| 音频 | `<Audio src={narration}>` + 可选 BGM 循环 | `<Audio src={music}>`（唯一音轨，不循环、不变速） |
| 时长 | `durationSeconds + 0.1`，30fps 写死 | `durationMs → frames`，`fps` 来自 props |
| 尺寸 | 二选一 1920×1080 / 1080×1920 | `width/height` 来自 props |
| 受保护层 | 确定性 SRT 字幕组件 | ① 音乐轨 ② 节拍网格 Provider（`useBeat()`：当前拍号/小节/是否在拍点）③ 歌词/文字渲染器（有 `.lrc/.srt` 时）④ 安全区参考线（调试用，可关） |
| props | title/script/subtitles/bgm | `theme, thesis, width, height, fps, durationFrames, musicFile, beatGrid, lyrics[], texts[], styleTokens, protagonist` |
| 占位 | `data-agent-placeholder` | 同，且 preflight 复用同一条规则 |

### 可编辑 vs 受保护

- **可编辑**：`src/CreativeVideo.tsx` + `src/scenes/**` + `src/style.ts`。
  1–3 分钟的片子写在单个文件里会撞输出上限（口播包已有 `maxTokenContinuations` 兜底，但拆文件更稳）。
- **受保护（hash 校验）**：`src/index.ts`、`src/Root.tsx`、`src/MusicTrack.tsx`、`src/BeatGrid.tsx`、`src/LyricLayer.tsx`、
  `public/task-props.json`、`scripts/preflight.mjs`、`preflight-manifest.json`。

### preflight 增项

在口播版检查（禁浏览器计时动画 / 必须有帧驱动 / 不能留占位 / 受保护文件 hash / 最小体积）之上加：

| 新规则 | 说明 |
|---|---|
| 禁止外部 URL | `http(s)://` 出现在 CreativeVideo/scenes 里直接失败（音乐与字体走 `staticFile`） |
| 禁止裸 `Math.random()` | 必须用注入的 `seededRandom(seed)`；否则每帧不一致 |
| 禁止 `Date.now()` / `performance.now()` | 画面必须是 t 的函数 |
| 必须引用节拍网格 | 创意代码里至少出现一次 `useBeat()` 或从 props 读 `beatGrid`，否则视为没卡点 |
| 场景数下限 | 按 `durationMs / 期望镜头时长` 推算最少 `<Sequence>` 数，防止「一个长镜头糊完全片」 |

---

## 11. QC

| 检查 | 工具 | 阈值 | 失败后 |
|---|---|---|---|
| 尺寸 / 帧率 | `ffprobe` | 与 task 完全一致 | 重建工程（不可修） |
| 时长 | `ffprobe` vs `timeline.durationMs` | 差 ≤ 100ms | 定向修 |
| 音轨存在 | `ffprobe` | 必须有，AAC ≥192k | 重建 |
| 响度 | `ebur128` | −14 LUFS ±1，true peak ≤ −1 dBTP | 调混音（外壳负责） |
| 黑帧 | `blackdetect` | 0 处（≤0.1s 的转场黑允许 1 处） | 定向修 |
| **卡点（计划）** | cue vs beats | ±1 帧 | 改 timeline 或改代码 |
| **卡点（成片）** | scdet vs shotlist | 切点数一致，时间 ±3 帧 | 定向修 |
| **可读性** | timeline.texts | ≤20 汉字/屏；停留 ≥ 公式 | 定向修 |
| **风格** | 抽帧 `signalstats` + 主色直方图 | 亮度/饱和度落令牌区间；禁用色不出现 | 定向修 |
| 独立审片 | 结构化 reviewer | score ≥ 70，无 blocker/major，≥2 条抽帧证据 | 有界修复 2 轮 |

审片 schema 增量：`category` 增加 `beatSync`、`styleConsistency`、`nativeMove`；`findings` 允许带 `beatIndex`。

---

## 12. 数据目录

```
lwb/local/current/pack-state/workspaces/vibe-music-video/
├── settings/          # prompt-override.json、defaults.json（不含密钥）
└── data/
    ├── works.json                                  # 作品索引（标题/主题/状态/封面/更新时间）
    └── works/<workId>/
        ├── brief.json                              # 冻结输入（含提示词快照版本、style 快照、beats 指纹）
        ├── media/
        │   ├── audio.m4a
        │   ├── beats.json                          # 节拍网格（唯一时间基准）
        │   ├── lyrics.json                         # 解析后的歌词/文字轴（可空）
        │   └── frames/                             # 抽帧
        └── runs/<runId>/
            ├── prompt.md                           # 本次用的导演提示词（快照）
            ├── treatment.json                      # 视觉主线 / 结构三选一 / 参考 / 分镜 / 卡点表
            ├── timeline.json                       # 分镜与 cue（机器校验用）
            ├── project/                            # Remotion 工程（受保护外壳 + 可编辑创意）
            ├── outputs/{sample.mp4, final.mp4, cover.jpg}
            └── qc/{technical,beatsync,readability,style,review}.json
```

清空业务数据 / 解除工作区注册语义与其它包一致（可恢复副本，不是安全擦除）。

---

## 13. 代码落点

```
lwb/packs/vibe-music-video/
  lwb-pack.json                        # id: vibe-music-video；4 个菜单
  package.json                         # @scitiger-ai/lwb-vibe-music-video
  index.mjs                            # host entry：注册 scope/provide/RPC/生命周期
  gateway.mjs                          # RPC 路由
  vibe-music-video-paths.mjs           # 工作区路径
  vibe-music-video-store.mjs           # 作品/任务持久化（revision + 幂等键）
  vibe-music-video-audio.mjs           # ffprobe/ffmpeg 解码 + 节拍分析 + beats.json
  vibe-music-video-lyrics.mjs          # lrc/srt/txt 解析 + 按拍吸附
  vibe-music-video-styles.mjs          # 风格目录加载/筛选/令牌校验
  vibe-music-video-prompt.mjs          # 模板渲染 + 变量校验 + 快照
  vibe-music-video-timeline.mjs        # timeline 生成 + cue 校验
  vibe-music-video-remotion.mjs        # 工程外壳（音乐轨/节拍 Provider/歌词层）+ 渲染
  vibe-music-video-preflight.mjs       # 增项检查器（外部 URL / 随机 / 节拍引用）
  vibe-music-video-qc.mjs              # 技术/卡点/可读性/风格
  vibe-music-video-agent.mjs           # 导演提示词、修复提示词、审片 schema
  client.js                            # 4 个页面
  skills/vibe-director/SKILL.md        # 导演方法（节奏/镜头/失败清单）
  skills/remotion-best-practices/*     # 复用口播包的规则文件
  styles/{catalog.json,cases.json,<id>/...}
  prompts/director.v1.md
  assets/default-audio/                # 默认音频（见风险 #1）
  test/*.test.mjs
```

测试接入：`package.json` 的 `unit:test` 追加 `lwb/packs/vibe-music-video/test/*.test.mjs`；
新增 `vibe:test` 与 `vibe:styles:build`（批量生成风格预览）两个 script。

### 测试清单（先写测试再写实现）

| 测试 | 断言 |
|---|---|
| 节拍检测 | 合成 90/120/140 BPM 的咔哒轨 → BPM 误差 <1%，拍点对齐 <20ms |
| 无节拍降级 | 纯长音 → 置信度低 → 自动切「段落对齐」模式 |
| 歌词解析 | `.lrc` / `.srt` / 纯文本三种输入 → 时间轴正确；纯文本按拍吸附 |
| cue 校验 | 构造 3 个偏离的 cue → 报出准确毫秒偏差；offGrid 占比超限 → 失败 |
| 风格令牌 | 合法/非法令牌各一例；禁用色出现在抽帧统计里 → 失败 |
| prompt 渲染 | 未知占位符 → 预检失败并列名；快照 hash 稳定 |
| 端到端 | 生成 6 秒合成音频 + 极简风格 → 建工程 → 渲染 → 四类 QC 全过（离线、确定性） |

---

## 14. 分期

| 期 | 范围 | 验收 |
|---|---|---|
| **P0** 打通 | 单音频、无文字稿、8 个风格、横屏 30fps、无样片停靠点、全程自动；技术 QC + 卡点 QC + 审片 | 用「claude 小曲」跑出 1 条 60–90s 成片，卡点偏差全 ≤1 帧，审片 score ≥70 |
| **P1** 可用 | 文字稿/歌词、竖屏、样片停靠点、风格库 27 个、可读性 + 风格 QC、节拍人工校正 UI | 3 个不同题材各出 1 条；用户能改默认提示词并生效 |
| **P2** 顺手 | 主角参考图、（可选）TTS 旁白轨、封面与文案导出、案例库在线刷新 | 有主角的连续两条片子角色一致；导出包可直接上传抖音 |

> 建议 P0 阶段**先不做**旁白 TTS：vibe 类内容的主轴是音乐 + 画面 + 屏幕字，加旁白会立刻把重心拉回口播包的逻辑。要加也放到 P2，作为可选开关。

---

## 15. 风险与待决（需要拍板）

1. **默认音频 `claude 小曲.m4a` 的版权。** 仓库里目前没有这个文件。内置进产品意味着再分发一首你大概率没有授权的曲子。
   三个选项：① 只在本地放置（不进 Git，首次使用提示上传）；② 换成 CC0 的等价示例曲；③ 确认有权再内置。
   **建议 ①**：`assets/default-audio/` 进 `.gitignore`，打包时由发行方决定是否带入。
2. **渲染时长。** 2–3 分钟 1080p30 的 Remotion 渲染预计 5–15 分钟（口播包同类量级）；3 分钟以上建议显式提示用户。
   P0 先测一条真实耗时分档，写进「启动任务」的预期提示。
3. **风格库的工作量在 style.json，不在代码。** 27 个风格各自要有能跑的示例实现，这是 P1 的主要成本。
   可以先只做 8 个高相关的（贴纸风科普 / 扁平矢量 / 等轴 2.5D / 弥散渐变 / 几何包豪斯 / 数据叙事 / 单线 / 像素），其余显示「即将支持」。
4. **画幅默认值。** 你说默认横屏，我按横屏设计；但这类内容在抖音的实际主力是竖屏。
   表单默认横屏、同时把「竖屏 1080×1920」放成首选预设，是否更合适，需要你定。
5. **事实核查要不要进主流程。** 知识类题材一旦讲错会被抓。参考 `vibe-knowledge.md` 的做法是加一份 `sources.md`。
   P0 不做（会显著拉长流程），P2 可作为题材开关（历史/科学题默认开）。
