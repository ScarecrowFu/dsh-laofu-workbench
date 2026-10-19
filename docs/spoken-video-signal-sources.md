# 口播信号模块 · 平台与来源获取手册

本手册说明「口播视频内容创作」能力包（`lwb/packs/spoken-video`）**信号模块**里每个平台/来源的**获取方法**（地址、请求要求、读取位置、刷新节奏）。
用途：可直接把本文件交给其他 Agent 当数据源说明书用，**不需要写适配代码**——文中的取数方式用普通网页请求即可完成。

代码事实源：`lwb/packs/spoken-video/spoken-video-signal-adapters.mjs`（类型目录、内置来源清单、解析与评分口径）。
模块行为说明见 [`spoken-video.md`](spoken-video.md)。

---

## 0. 两条获取路径（先看这里）

信号模块里有**两类**东西，获取方式完全不同，别混：

| 路径 | 覆盖什么 | 怎么拿 |
|---|---|---|
| **A · 平台内容** | 抖音、B站、公众号、小红书、视频号 五个**内容平台**的真实内容（标题/作者/链接/互动量） | **一个接口全拿**：`https://scitiger.cn/reports/daily.json` |
| **B · 公开来源直采** | 百度热榜、今日头条、抖音热榜、B站热门、知乎、微博、GitHub、HF 论文、36氪/InfoQ/IT之家/极客公园/爱范儿/少数派/掘金/HN 等 | 逐条公开地址直取（JSON / RSS / HTML 三种形态） |

**关键区别**：路径 B 里的「抖音热榜」「B站热门」拿的是**热榜/热门**，不是这个平台上的 AI 内容；只有路径 A 才是「某平台在讲什么 AI 话题」。

---

## 1. 平台维度（五个平台）

### 获取方法

```
GET https://scitiger.cn/reports/daily.json
```

- 公开地址，**无鉴权、无需 Cookie**，带任意 User-Agent 即可，返回 `application/json`（实测约 80 KB）。
- 由 SciTiger 的 AI 内容日报流程产出，**每天 08:00 前后更新一次**（实测 `report_meta.generated_at = 2026-10-16T08:01:57+08:00`）。能力包内每 60 分钟拉一次。
- ⚠️ **报告里的「最新可用数据日」通常滞后 1–2 天**（实测 2026-10-16 的报告，`summary.data_date_label` 是 `2026-10-14`）。
  判断新鲜度只认 `report_meta.date`、`summary.data_dates` / `data_date_label`，**不要假设是当天**。

### 平台清单与 key 对照

`items_by_platform` 的键名与平台名的对应关系：

| 平台 | `items_by_platform` 键 | `platforms[].name` |
|---|---|---|
| 抖音 | `douyin` | 抖音AI信息源 |
| B站 | `bilibili` | B站AI信息源 |
| 公众号 | `gzh` | 公众号AI信息源 |
| 小红书 | `xiaohongshu` | 小红书AI信息源 |
| 视频号 | `video_channel` | 视频号AI信息源 |

（解析器另外还能识别 `zhihu` / `知乎` 键，出现时会归入「知乎」。）

### 能不能直采

| 平台 | 是否有直采接口 | 说明 |
|---|---|---|
| 抖音 | 有，但只是**热榜** | 见 §2「抖音热榜」，不含平台内容 |
| B站 | 有，但只是**热门视频** | 见 §2「B站热门内容」，非 AI 专题 |
| 公众号 | **无** | 只能通过路径 A 获取 |
| 小红书 | **无** | 只能通过路径 A 获取 |
| 视频号 | **无** | 只能通过路径 A 获取 |

### 字段说明

| 需要什么 | 读取位置 | 字段 |
|---|---|---|
| 某个平台的内容清单 | `items_by_platform.<平台键>[]` | `title`、`author`、`url`、`published_at`（日期字符串）、`metrics` |
| 各平台体量与活跃度 | `platforms[]` | `key`、`name`、`status`、`item_count`、`source_item_count`、`selected_item_count`、`data_date`、`top_category`、`categories[]`（`name`/`count`/`ratio`/`highlight`） |
| 跨平台共识（**选题价值最高**） | `cross_platform_opportunities[]` | 字符串数组，已写明「哪些平台同时出现 + 可用什么角度做对照 + 样本标题」 |
| 全平台热度排行 | `trending_topics[]` | `rank`、`title`、`author`、`metrics`、`url`、`category`、`editorial_score`（编辑评分）、`platform`、`platform_key` |
| 编辑推荐选题 | `agent_recommendations[]` | 字符串数组（通用编辑视角，需结合账号数据再筛） |
| 情绪风向/口径说明 | `agent_insight[]` | `title`、`text`（首条固定是「数据口径」，说明覆盖情况） |
| 话题分类分布 | `top_categories[]` | `name`、`count` |
| 报告元信息 | `report_meta` / `summary` | `date`、`generated_at`、`data_window_days`、`report_version` / `total_sources`、`success_count`、`zero_data_count`、`total_items`、`selected_items`、`data_dates`、`filtered_stale` |

⚠️ `metrics` 是**预格式化的展示字符串**（形如 `📅 2026-10-14 👍 4.4w 🔁 42.6w 💬 3.0k`），各平台用到的表情不同（抖音有🔁转发、B站有🔗、公众号有👁阅读）。要结构化数字需自行按表情前缀拆。

---

## 2. 公开来源直采（16 个内置公开来源）

内置来源共 17 个 = 16 个公开来源 + 1 个「AI 内容日报」（即路径 A）。
下表按能力包内的**来源分组（family）**排列。所有地址均为公开 HTTPS，普通 GET 即可。

### 2.1 公共热点

| 来源 | 类型 | 地址 | 请求头要求 | 刷新 |
|---|---|---|---|---|
| 百度热榜 | `baidu-hot` | `https://top.baidu.com/board?tab=realtime` | 无 | 30 分钟 |
| 今日头条 | `toutiao-hot` | `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 无 | 30 分钟 |

### 2.2 内容平台（这里的「平台」是热榜，不是平台内容）

| 来源 | 类型 | 地址 | 请求头要求 | 刷新 |
|---|---|---|---|---|
| 抖音热榜 | `douyin-hot` | `https://www.douyin.com/aweme/v1/web/hot/search/list/` | **必须** `Referer: https://www.douyin.com/hot` + 桌面 Chrome UA | 30 分钟 |
| B站热门内容 | `bilibili-popular` | `https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1` | **必须** `Referer: https://www.bilibili.com/` + `Origin: https://www.bilibili.com` | 60 分钟 |
| 知乎热榜 | `public-hot-list` | `https://api.zxz.ee/api/hot/?type=zhihu` | 无 | 60 分钟 |
| 微博热搜 | `weibo-hot` | `https://weibo.com/ajax/side/hotSearch` | **必须** `Referer: https://weibo.com/` + 桌面 Chrome UA | 30 分钟 |

桌面 Chrome UA 统一用：
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`

### 2.3 AI / 开源

| 来源 | 类型 | 地址 | 请求头要求 | 刷新 |
|---|---|---|---|---|
| AI 论文日报 · Hugging Face | `huggingface-papers` | `https://huggingface.co/api/daily_papers?limit=20` | 无 | 360 分钟 |
| GitHub Trending | `github-trending` | `https://github.com/trending?since=daily` | 无 | 360 分钟 |

### 2.4 科技与商业

| 来源 | 类型 | 地址 | 刷新 |
|---|---|---|---|
| 36氪 | `rss` | `https://www.36kr.com/feed` | 180 分钟 |
| InfoQ | `rss` | `https://www.infoq.cn/feed` | 180 分钟 |
| IT之家 | `rss` | `https://www.ithome.com/rss/` | 120 分钟 |
| 极客公园 | `rss` | `https://www.geekpark.net/rss` | 180 分钟 |
| 爱范儿 | `rss` | `https://www.ifanr.com/feed` | 180 分钟 |
| 少数派 | `rss` | `https://sspai.com/feed` | 240 分钟 |

### 2.5 开发者社区

| 来源 | 类型 | 地址 | 刷新 |
|---|---|---|---|
| 掘金 | `rss` | `https://juejin.cn/rss` | 180 分钟 |
| Hacker News | `rss` | `https://hnrss.org/frontpage` | 180 分钟 |

### 2.6 每个来源「读到哪儿」

单条统一字段：`title`、`summary`、`url`、`publishedAt`、`rank`、`hotValue`、`tags`、`platform`。

| 类型 | 形态 | 读取位置 |
|---|---|---|
| `baidu-hot` | HTML | 页面内 `<!--s-data:{...}-->` 注释块里的 JSON → `data.cards[].content[]`；标题取 `query`/`word`/`title`，摘要 `desc`，链接 `rawUrl`，热度 `hotScore`，排名 `index + 1`，标签 `hotTag`（纯数字的丢弃） |
| `toutiao-hot` | JSON | `data[]` → `Title`/`QueryWord`、`Label`、`Url`、`HotValue`、`InterestCategory`（作标签） |
| `douyin-hot` | JSON | `data.word_list[]` → `word`、`hot_value`、`position`、`video_count`、`event_time`（秒级时间戳）；链接需自行拼 `https://www.douyin.com/search/<关键词>` |
| `bilibili-popular` | JSON | `data.list[]` → `title`、`bvid`（拼 `https://www.bilibili.com/video/<bvid>`）、`desc`、`owner.name`、`stat.view`/`stat.like`、`pubdate`（秒级）、`tnamev2`/`tname` |
| `public-hot-list` | JSON | 兼容 `{ code, data[] }`；`code` 非 200 视为来源异常；条目取 `title`/`name`/`word`/`query`、`desc`、`link`/`url`、`rank`/`index`、`hot`/`hot_value`/`score` |
| `weibo-hot` | JSON | `data.realtime[]` → `word`、`num`（热度）、`realpos`/`rank`、`label_name`；链接拼 `https://s.weibo.com/weibo?q=%23<词>%23` |
| `github-trending` | HTML | 逐 `<article>` 块：`<h2>` 里的 `href="/owner/repo"` 作标题与链接、`<p>` 作描述、`itemprop="programmingLanguage"`、文本中的 `N stars today` 作热度 |
| `huggingface-papers` | JSON | 顶层数组 → `paper.id`/`title`/`summary`/`authors[].name`/`publishedAt`、`upvotes`；链接拼 `https://huggingface.co/papers/<id>` |
| `rss` | XML | `<item>` 或 `<entry>` 块 → `title`、`description`/`summary`/`content:encoded`、`link` 或 `<link href>`、`pubDate`/`published`/`updated`/`dc:date`、`category`。HN 风格的 `Points: N` 会转成 `hotValue` |
| `github-releases` | XML | 固定形如 `https://github.com/<owner>/<repo>/releases.atom`（内置未启用，需配 `repository`） |
| `ai-daily-json` | JSON | 即 §1 的日报格式 |

用命令行取数的最小示例（Agent 可直接照抄）：

```bash
curl -sL "https://scitiger.cn/reports/daily.json" -o /tmp/daily.json      # 路径 A：五个平台内容
curl -s  "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1" \
  -H "Referer: https://www.bilibili.com/" -H "Origin: https://www.bilibili.com" \
  -o /tmp/bili.json                                                      # 路径 B：B站热门
curl -sL "https://www.36kr.com/feed" -o /tmp/36kr.xml                    # 路径 B：RSS
```

---

## 3. 通用采集约束（交给 Agent 时要一并说明）

1. **地址安全**：只允许**公开 HTTPS**；不能带用户名/密码，端口只能是 443；域名必须能解析到**公网地址**（本机、私网、链路本地、ULA 地址一律拒绝）；最多跟 3 次重定向，且每次重定向目标都要重新校验；单次响应上限 1.5 MB；超时 3–60 秒（默认 20 秒）。
2. **条件请求**：支持 `ETag` / `If-Modified-Since`。返回 **304 表示内容未变**，应沿用上一次的采集结果，**不是失败**。
3. **默认 User-Agent**：`LWB-Spoken-Video-Signal/1.0 (+public-source-collector)`（抖音、微博、B站三个来源需按上表覆盖 UA/Referer）。
4. **去重口径**：按**规范 URL 指纹**去重——先删掉 `utm_*`、`spm`、`from`、`source`、`share_*` 这类跟踪参数与锚点，再取哈希；没有 URL 时按标题指纹。
5. **评分口径**（排序用）：基础 40 分 + 排名加成（越高位越多，上限 30）+ 热度加成（`log10(热度)`，上限 15）+ 新鲜度加成（≤6h +15 / ≤24h +10 / ≤72h +5），封顶 100。
6. **采集节奏**：能力包内按各来源的刷新间隔到期才采；手动采集只采勾选的来源。每条来源每轮最多取 20 条（AI 日报除外，上限 200）。
7. **只读公开页面**：不涉及登录态抓取。公众号、小红书、视频号**没有直采接口**，必须走 §1 的日报。
8. **来源可扩展**：除内置 17 个，还可按上表的类型（`rss` / `public-hot-list` / `github-releases` 等）自行添加公开源，只需给「公开 HTTPS 地址 + 类型」；本地化能力包不提供来源增删 UI，直接改 `data/signals.json` 的 `sources` 数组。

---

## 4. 一手核验记录（2026-10-16 实测，仅本机网络）

| 地址 | 结果 | 备注 |
|---|---|---|
| 百度热榜 / 今日头条 | 200 | 219 KB / 128 KB |
| 抖音热榜 | 200（**0 字节**） | 不带 `Referer` 时是 200 但空响应，必须带 |
| B站热门 | 200 | 33 KB |
| 知乎热榜（api.zxz.ee） | 200 | 6 KB；**第三方聚合站点**，非知乎官方，稳定性不受知乎保证 |
| 微博热搜 | **403** | 裸 UA 被拒，带 `Referer: https://weibo.com/` + 桌面 UA 后 200 / 20 KB |
| Hugging Face 每日论文 | **连接失败** | 本机网络探不通（非接口问题），需在能访问 huggingface.co 的网络环境复测 |
| GitHub Trending | 200 | 613 KB HTML |
| 36氪 / InfoQ / IT之家 / 极客公园 / 爱范儿 / 少数派 / 掘金 / HN | 200 | RSS/Atom，5 KB–511 KB |
| AI 内容日报 `daily.json` | 200 | 79 KB；`douyin` 200 条、`bilibili` 51、`gzh` 166、`xiaohongshu` 50、`video_channel` 24；精选 156 条 |
