window.__ModuleLoader__.load({
  id: '@scitiger-ai/lwb-spoken-video',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const { IconSettingsOutlineRegular, MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    let connection; let executionRemote; let executionStreams;
    let audioCaptionsHandoff = null;
    let publishHandoff = null;
    const STAGES = ['signals', 'topic', 'script', 'voiceover', 'subtitles', 'video', 'qc', 'packaging'];
    const LABEL = { signals: '信号', topic: '选题', script: '写稿', voiceover: '配音', subtitles: '字幕', video: '视频制作', qc: '质检', packaging: '发布资料' };
    const DEFAULT_VIDEO_VISUAL_BRIEF = '由 AI 视觉导演根据稿件语义完成主题化 Remotion 画面。';
    // Bailian system voices usable as a preset choice. Names are the official
    // voice IDs from the Qwen-Audio-TTS voice list, which is what the
    // synthesis request sends as `voice`.
    const BAILIAN_PRESET_VOICES = [
      { id: 'longanhuan_v3.1', label: '龙安欢（女 · 自然亲切）' },
      { id: 'longanlingxin_v3.1', label: '龙安灵心（女 · 温柔守候）' },
      { id: 'longanfengyue_v3.1', label: '龙安风悦（女 · 播报口播）' },
      { id: 'xunanchuan_v3.1', label: '许南川（男 · 磁性叙事）' },
      { id: 'anmingyuan_v3.1', label: '安明远（男 · 清亮自然）' },
      { id: 'yuxiaoyun_v3.1', label: '于小云（女 · 元气亲切）' },
    ];
    const SOURCES = { baidu: '百度热榜', toutiao: '今日头条', 'douyin-hot': '抖音热榜', 'bilibili-popular': 'B站热门内容', 'zhihu-hot': '知乎热榜', 'weibo-hot': '微博热搜', 'huggingface-papers': 'AI 论文日报 · Hugging Face', '36kr': '36氪', infoq: 'InfoQ', ithome: 'IT之家', geekpark: '极客公园', ifanr: '爱范儿', sspai: '少数派', juejin: '掘金', 'github-trending': 'GitHub Trending', 'hacker-news': 'Hacker News', 'ai-daily-import': 'AI 内容日报' };
    const css = `
      .sv-page { display:grid; gap:18px; max-width:1420px; margin:0 auto; } .sv-page * { box-sizing:border-box; } .sv-top { display:flex; flex-wrap:wrap; justify-content:space-between; gap:14px; padding-bottom:14px; border-bottom:1px solid var(--lwb-line); } .sv-top h1,.sv-section h3,.sv-form h3 { margin:0; font-size:var(--lwb-text-section,18px); } .sv-top p,.sv-meta,.sv-item p { margin:5px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.6; } .sv-section { display:grid; gap:11px; } .sv-section-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:9px; } .sv-section-head span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .sv-layout { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(270px,.85fr); gap:20px; align-items:start; } .sv-list { display:grid; gap:8px; } .sv-item,.sv-form,.sv-source { display:grid; gap:9px; padding:14px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); } .sv-item[data-active="true"] { border-color:#9fc2ec; background:var(--lwb-blue-soft); } .sv-item-head { display:flex; min-width:0; align-items:flex-start; justify-content:space-between; gap:9px; } .sv-item-title { overflow:hidden; font-size:var(--lwb-text-md,15px); font-weight:700; text-overflow:ellipsis; white-space:nowrap; } .sv-tag,.sv-stage { display:inline-flex; min-height:21px; flex:none; align-items:center; padding:0 7px; border-radius:5px; color:var(--lwb-blue); background:var(--lwb-blue-soft); font-size:var(--lwb-text-xs,12px); font-weight:700; white-space:nowrap; } .sv-stage { color:var(--lwb-green); background:var(--lwb-green-soft); } .sv-input,.sv-textarea,.sv-select { width:100%; border:1px solid var(--lwb-line); border-radius:6px; color:var(--lwb-ink); background:var(--lwb-surface); font:inherit; font-size:var(--lwb-text-base,14px); } .sv-input,.sv-select { height:36px; padding:0 10px; } .sv-textarea { min-height:114px; padding:9px; resize:vertical; line-height:1.6; } .sv-input:focus,.sv-textarea:focus,.sv-select:focus { border-color:var(--lwb-blue); outline:0; box-shadow:0 0 0 2px var(--lwb-blue-soft); } .sv-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } .sv-error,.sv-note { margin:0; padding:10px 11px; border:1px solid #e6b5b5; border-radius:7px; color:#994646; background:#fff7f7; font-size:var(--lwb-text-sm,13px); line-height:1.55; } .sv-note { border-color:#bad5ed; color:#486277; background:#f7fbff; } .sv-empty { padding:34px 12px; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); text-align:center; } .sv-source-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:10px; } .sv-source { min-height:155px; } .sv-source a,.sv-url { overflow:hidden; color:var(--lwb-blue); font-size:var(--lwb-text-sm,13px); text-overflow:ellipsis; white-space:nowrap; } .sv-checks { display:grid; gap:7px; } .sv-basis { display:grid; gap:7px; padding:11px; border:1px dashed var(--lwb-line); border-radius:8px; background:var(--lwb-surface); } .sv-basis .sv-item { padding:9px 11px; } .sv-basis-text { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); line-height:1.55; white-space:pre-wrap; word-break:break-word; } .sv-warn-list { display:grid; gap:4px; margin:0; padding:9px 11px 9px 24px; border:1px solid #ecd39b; border-radius:7px; color:#7a5b17; background:#fffaf0; font-size:var(--lwb-text-sm,13px); line-height:1.5; } .sv-form summary { cursor:pointer; color:var(--lwb-blue); font-size:var(--lwb-text-base,14px); } .sv-checks label,.sv-signal { display:flex; align-items:flex-start; gap:7px; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); line-height:1.5; } .sv-signal { padding:9px; border-bottom:1px solid var(--lwb-line); cursor:pointer; } .sv-signal:last-child { border-bottom:0; } .sv-signal input { margin-top:3px; } .sv-signal small { display:block; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .sv-toolbar,.sv-stat-grid,.sv-filter-grid { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } .sv-stat { min-width:112px; padding:10px 12px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-surface); } .sv-stat strong { display:block; color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); } .sv-stat span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .sv-filter-grid > * { flex:1 1 145px; } .sv-source-detail { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); line-height:1.5; } .sv-status-error { color:#a94343; background:#fff1f1; } .sv-status-disabled { color:#6d7280; background:#f2f3f5; } .sv-status-manual { color:#8059aa; background:#f5effb; } .sv-status-ready { color:#1f7354; background:#eaf8f1; } .sv-inline-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; } .sv-inline-form .sv-wide { grid-column:1/-1; } .sv-run-list { max-height:360px; overflow:auto; } .sv-signal-shell { display:grid; gap:16px; } .sv-live-pill { display:inline-flex; flex:none; align-items:center; gap:8px; padding:6px 13px; border:1px solid rgba(62,207,142,.35); border-radius:999px; color:#8fe6bd; background:rgba(62,207,142,.12); font-size:var(--lwb-text-base,14px); } .sv-live-dot { width:8px; height:8px; border-radius:50%; background:#3ecf8e; animation:sv-pulse 1.8s ease-in-out infinite; } @keyframes sv-pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } } body[data-ds-dark-theme] .sv-note { border-color:#2c5578; color:#a9c9e6; background:#16324a; } body[data-ds-dark-theme] .sv-error { border-color:#7a4444; color:#e8b9b9; background:#3a2323; } body[data-ds-dark-theme] .sv-warn-list { border-color:#7a6534; color:#e8d9a9; background:#332b1b; } .sv-pipeline { display:grid; gap:13px; padding:16px 20px 18px; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); } .sv-pipeline-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; } .sv-pipeline-head h3 { margin:0; font-size:var(--lwb-text-md,15px); } .sv-pipeline-track { display:flex; align-items:flex-start; overflow-x:auto; padding-bottom:2px; } .sv-pipeline-node { display:flex; flex:none; flex-direction:column; align-items:center; gap:6px; } .sv-pipeline-dot { display:flex; width:26px; height:26px; align-items:center; justify-content:center; border-radius:50%; font-size:var(--lwb-text-base,14px); font-weight:700; } .sv-pipeline-dot[data-state="done"] { background:var(--lwb-blue); color:#fff; } .sv-pipeline-dot[data-state="current"] { background:var(--lwb-green); color:#fff; box-shadow:0 0 0 4px var(--lwb-green-soft); } .sv-pipeline-dot[data-state="todo"] { border:1px solid var(--lwb-line); background:var(--lwb-surface); color:var(--lwb-muted); } .sv-pipeline-bar { flex:1 0 14px; height:2px; margin-top:12px; background:var(--lwb-line); } .sv-pipeline-bar[data-done="true"] { background:var(--lwb-blue); } .sv-pipeline-label { color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); white-space:nowrap; } .sv-pipeline-node[data-state="done"] .sv-pipeline-label { color:var(--lwb-ink); } .sv-pipeline-node[data-state="current"] .sv-pipeline-label { color:var(--lwb-green); font-weight:700; } .sv-eyebrow { margin:0 0 7px; color:#477194; font-size:var(--lwb-text-xs,12px); font-weight:800; letter-spacing:.12em; } .sv-tabs { display:flex; gap:4px; border-bottom:1px solid var(--lwb-line); } .sv-tab { padding:9px 12px; border:0; border-bottom:2px solid transparent; color:var(--lwb-muted); background:transparent; cursor:pointer; font:inherit; font-size:var(--lwb-text-base,14px); font-weight:700; } .sv-tab[data-active="true"] { border-color:var(--lwb-blue); color:var(--lwb-blue); } .sv-dashboard { display:grid; grid-template-columns:minmax(0,1fr) 288px; gap:16px; align-items:start; } .sv-feed { display:grid; gap:10px; } .sv-feed-toolbar { display:grid; grid-template-columns:minmax(220px,1fr) 156px 135px; gap:8px; padding:12px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); } .sv-signal-card { display:grid; gap:8px; padding:15px 16px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); transition:border-color .15s ease,box-shadow .15s ease; } .sv-signal-card:hover { border-color:#a8c8e4; box-shadow:0 5px 18px rgba(36,87,127,.07); } .sv-signal-title { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); line-height:1.45; } .sv-signal-summary { display:-webkit-box; overflow:hidden; margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.65; -webkit-box-orient:vertical; -webkit-line-clamp:2; } .sv-signal-foot { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; align-items:center; } .sv-kpi { display:flex; flex-wrap:wrap; gap:5px; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .sv-score { color:#3571a4; font-weight:800; } .sv-insight-panel { position:sticky; top:16px; display:grid; gap:12px; padding:15px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); } .sv-insight-panel h3 { margin:0; font-size:var(--lwb-text-md,15px); } .sv-family-list { display:grid; gap:5px; } .sv-family-row { display:flex; align-items:center; justify-content:space-between; width:100%; padding:7px 0; border:0; color:var(--lwb-ink); background:transparent; cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); text-align:left; } .sv-family-row[data-active="true"] { color:var(--lwb-blue); font-weight:800; } .sv-family-row small { color:var(--lwb-muted); } .sv-source-table { display:grid; gap:12px; } .sv-family-section { display:grid; gap:10px; padding:15px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); } .sv-source-compact-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(245px,1fr)); gap:8px; } .sv-source-compact { display:grid; gap:7px; padding:13px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-surface); }  .sv-source-health { display:flex; flex-wrap:wrap; gap:5px; } .sv-drawer-backdrop { position:fixed; z-index:40; inset:0; border:0; background:rgba(24,39,52,.35); } .sv-drawer { position:fixed; z-index:41; top:0; right:0; bottom:0; width:min(560px,100vw); overflow:auto; padding:22px; border-left:1px solid var(--lwb-line); background:var(--lwb-surface); box-shadow:-16px 0 40px rgba(23,47,70,.18); } .sv-drawer-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:16px; } @media (max-width:900px) { .sv-dashboard { grid-template-columns:1fr; } .sv-insight-panel { position:static; } } @media (max-width:780px) {  } .sv-board { display:grid; gap:16px; } .sv-board-group { display:grid; gap:9px; } .sv-board-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:10px; } .sv-board-card { position:relative; display:grid; overflow:hidden; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; } .sv-board-card:hover { transform:translateY(-3px); border-color:#9fc2ec; box-shadow:0 8px 22px rgba(24,60,104,.1); } .sv-board-card::before { content:''; height:3px; background:linear-gradient(90deg,var(--lwb-blue),var(--lwb-green)); opacity:.55; transition:opacity .18s ease; } .sv-board-card:hover::before { opacity:1; } .sv-board-card[data-health="error"]::before { background:#e2574d; opacity:1; } .sv-board-card[data-health="manual"]::before { background:linear-gradient(90deg,#8059aa,#b98ae0); } .sv-board-card-main { display:grid; gap:7px; width:100%; padding:14px; border:0; background:transparent; cursor:pointer; font:inherit; text-align:left; } .sv-board-card-main:hover { background:var(--lwb-blue-soft); } .sv-board-card-main strong { font-size:var(--lwb-text-md,15px); } .sv-board-today { margin:0; color:var(--lwb-blue); font-size:var(--lwb-text-sm,13px); font-weight:700; } .sv-board-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .sv-board-preview { display:grid; gap:4px; margin:2px 0 0; padding:0; list-style:none; } .sv-board-preview li { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-sm,13px); line-height:1.5; text-overflow:ellipsis; white-space:nowrap; } .sv-board-preview li small { color:var(--lwb-muted); } .sv-board-card-foot { display:flex; justify-content:flex-end; padding:0 10px 10px; } .sv-drawer-section { margin:14px 0 8px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; } .sv-drawer-list { display:grid; gap:8px; } .sv-split { display:grid; grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr); gap:20px; align-items:start; } .sv-badge { display:inline-flex; min-height:22px; align-items:center; padding:0 8px; border-radius:99px; border:1px solid var(--lwb-line); background:var(--lwb-surface); color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); cursor:pointer; } .sv-badge[data-on="true"] { border-color:#9fc2ec; background:var(--lwb-blue-soft); color:var(--lwb-blue); } .sv-badge-row { display:flex; flex-wrap:wrap; gap:6px; } .sv-step { display:flex; gap:10px; align-items:flex-start; padding:7px 0; border-bottom:1px dashed var(--lwb-line); } .sv-step:last-child { border-bottom:0; } .sv-dot { width:10px; height:10px; border-radius:50%; flex:none; margin-top:5px; background:var(--lwb-line); } .sv-dot[data-state="running"] { background:#f5a623; } .sv-dot[data-state="done"] { background:#4caf50; } .sv-dot[data-state="error"] { background:#e5484d; } .sv-cand { border:1px solid var(--lwb-line); border-radius:8px; padding:11px 13px; cursor:pointer; background:var(--lwb-surface); } .sv-cand[data-sel="true"] { border:2px solid #9fc2ec; background:var(--lwb-blue-soft); } .sv-cand h4 { margin:0 0 4px; font-size:var(--lwb-text-md,15px); } .sv-cand p { margin:3px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.5; } .sv-genhead { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; } .sv-chips { display:flex; flex-wrap:wrap; gap:6px; }
    `;
    const productCss = `${css}
      /* Task execution inspector: quiet chrome, readable documents, bounded tools. */
      .sv-ex-layer { position:fixed; inset:0; z-index:1400; width:100vw; height:100dvh; max-width:none; max-height:none; margin:0; padding:0; border:0; background:transparent; color:var(--lwb-ink); }
      .sv-ex-layer::backdrop { background:transparent; }
      .sv-ex-backdrop { position:absolute; inset:0; border:0; background:rgba(20,28,44,.36); backdrop-filter:blur(3px); cursor:default; }
      .sv-ex-drawer { position:absolute; top:16px; bottom:16px; right:16px; display:flex; flex-direction:column; width:min(900px,calc(100vw - 32px)); min-width:0; border:1px solid var(--lwb-line); border-radius:20px; background:var(--lwb-surface); box-shadow:0 24px 90px #101b3440; overflow:hidden; outline:none; }
      .sv-ex-drawer[data-wide="true"] { width:calc(100vw - 64px); max-width:1400px; }
      .sv-ex-header { display:flex; justify-content:space-between; gap:24px; padding:26px 30px 22px; border-bottom:1px solid var(--lwb-line); background:linear-gradient(120deg,var(--sv-accent-soft,var(--lwb-blue-soft)),var(--lwb-surface) 65%); }
      .sv-ex-header > div:first-child { min-width:0; }
      .sv-ex-kicker { margin:0 0 9px; color:var(--sv-accent,var(--lwb-blue)); font-size:12px; font-weight:700; letter-spacing:.07em; }
      .sv-ex-header h2 { margin:0; font-size:22px; line-height:1.45; letter-spacing:-.02em; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .sv-ex-subtitle { color:var(--lwb-muted); margin:9px 0 0; font-size:12px; line-height:1.6; }
      .sv-ex-header-actions { display:flex; gap:6px; align-items:flex-start; flex-shrink:0; }
      .sv-ex-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 30px; border-bottom:1px solid var(--lwb-line); }
      .sv-ex-tabs { display:flex; gap:22px; }
      .sv-ex-tabs button { position:relative; min-height:54px; padding:0 2px; border:0; background:none; color:var(--lwb-muted); font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
      .sv-ex-tabs button[aria-selected="true"] { color:var(--sv-accent,var(--lwb-blue)); }
      .sv-ex-tabs button[aria-selected="true"]::after { content:''; height:3px; position:absolute; bottom:0; left:0; right:0; background:currentColor; border-radius:3px 3px 0 0; }
      .sv-ex-state { padding:5px 10px; border-radius:20px; font-size:12px; color:var(--lwb-muted); background:var(--lwb-page); white-space:nowrap; }
      .sv-ex-state[data-status="running"],.sv-ex-state[data-status="queued"] { color:#b77912; background:#fff4da; }
      .sv-ex-state[data-status="completed"],.sv-ex-state[data-status="succeeded"] { color:#20825c; background:#e9f6ef; }
      .sv-ex-state[data-status="failed"] { color:#ba3a48; background:#fcecef; }
      .sv-ex-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:26px 30px 36px; scrollbar-gutter:stable; }
      .sv-ex-footer { display:flex; justify-content:space-between; gap:16px; border-top:1px solid var(--lwb-line); padding:13px 30px; color:var(--lwb-muted); font-size:12px; }
      .sv-ex-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); padding:18px 0; margin-bottom:24px; border:1px solid var(--lwb-line); border-radius:14px; background:var(--lwb-page); }
      .sv-ex-metrics > div { padding:0 20px; display:grid; gap:7px; border-right:1px solid var(--lwb-line); }
      .sv-ex-metrics > div:last-child { border:0; }
      .sv-ex-metrics span { color:var(--lwb-muted); font-size:12px; }
      .sv-ex-metrics strong { font-size:20px; font-weight:650; }
      .sv-ex-disclosure { margin:10px 0; border:1px solid var(--lwb-line); border-radius:10px; overflow:hidden; background:var(--lwb-surface); }
      .sv-ex-disclosure > summary,.sv-ex-input > summary { cursor:pointer; padding:12px 15px; color:var(--lwb-muted); font-size:13px; line-height:1.6; font-weight:600; }
      .sv-ex-disclosure[open] > summary { border-bottom:1px solid var(--lwb-line); }
      .sv-ex-disclosure > .sv-ex-prose { padding:12px 16px; }
      .sv-ex-code { display:block; margin:0; padding:15px 17px; max-height:440px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace; background:var(--lwb-page); color:var(--lwb-ink); tab-size:2; }
      .sv-ex-prose { min-width:0; overflow-wrap:anywhere; line-height:1.85; font-size:14px; }
      .sv-ex-prose pre { max-width:100%; overflow:auto; }
      .sv-ex-prose img { max-width:100%; }
      .sv-ex-prose table { display:block; max-width:100%; overflow:auto; }
      .sv-ex-section-head { display:flex; align-items:center; gap:12px; margin:26px 0 18px; }
      .sv-ex-section-head strong { font-size:16px; }
      .sv-ex-section-head p { margin:5px 0 0; color:var(--lwb-muted); font-size:12px; }
      .sv-ex-avatar { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:var(--lwb-blue-soft); color:var(--lwb-blue); font-weight:800; }
      .sv-ex-message { margin:15px 0; border:1px solid var(--lwb-line); border-radius:13px; padding:18px 20px; background:var(--lwb-surface); }
      .sv-ex-message-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; font-size:13px; }
      .sv-ex-message-head time,.sv-ex-marker time,.sv-ex-input time { color:var(--lwb-muted); font-size:11px; font-weight:400; }
      .sv-ex-input { padding:0; background:var(--lwb-page); }
      .sv-ex-input > .sv-ex-prose { padding:0 18px 14px; max-height:380px; overflow:auto; }
      .sv-ex-input time { float:right; }
      .sv-ex-tool { border-left:3px solid var(--sv-accent-line,var(--lwb-blue)); background:var(--lwb-page); padding:15px 17px; margin:14px 0; border-radius:0 12px 12px 0; }
      .sv-ex-tool .sv-ex-disclosure { margin-bottom:0; }
      .sv-ex-marker { display:flex; align-items:center; gap:9px; padding:9px 0; color:var(--lwb-muted); font-size:12px; }
      .sv-ex-marker time { margin-left:auto; }
      .sv-ex-marker i { width:5px; height:5px; border-radius:50%; background:var(--lwb-muted); }
      .sv-ex-reasoning { border-left:2px solid var(--sv-accent-line,var(--lwb-line)); padding:0 0 0 13px; margin:12px 0; color:var(--lwb-muted); }
      .sv-ex-reasoning summary { cursor:pointer; font-size:13px; padding:6px 0; }
      .sv-ex-process { margin:12px 0 20px; min-width:0; }
      .sv-ex-process > summary { display:flex; align-items:center; gap:12px; list-style:none; padding:12px 0; color:var(--lwb-ink); cursor:pointer; font-size:13px; font-weight:600; border-bottom:1px solid var(--lwb-line); }
      .sv-ex-process > summary::-webkit-details-marker,.sv-ex-process-row > summary::-webkit-details-marker { display:none; }
      .sv-ex-process > summary::after,.sv-ex-process-row > summary::after { content:''; width:6px; height:6px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); flex-shrink:0; margin-left:auto; }
      .sv-ex-process[open] > summary::after,.sv-ex-process-row[open] > summary::after { transform:rotate(45deg); }
      .sv-ex-process-counts { color:var(--lwb-muted); font-size:11px; font-weight:400; }
      .sv-ex-process-body { padding:10px 0 0; }
      .sv-ex-process-row { min-width:0; margin:3px 0; border-radius:9px; }
      .sv-ex-process-row > summary { display:flex; align-items:center; gap:10px; min-width:0; list-style:none; padding:12px 10px; cursor:pointer; color:var(--lwb-muted); font-size:13px; line-height:1.6; border-radius:9px; }
      .sv-ex-process-row > summary:hover { background:var(--lwb-page); }
      .sv-ex-process-row > summary:focus-visible,.sv-ex-process > summary:focus-visible { outline:2px solid var(--lwb-blue); outline-offset:2px; }
      .sv-ex-process-row > summary svg { width:17px; height:17px; flex-shrink:0; }
      .sv-ex-row-title { flex-shrink:0; font-weight:500; }
      .sv-ex-row-preview { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
      .sv-ex-row-preview::before { content:'·'; margin-right:10px; opacity:.6; }
      .sv-ex-row-status { flex-shrink:0; font-size:11px; color:var(--sv-accent,var(--lwb-blue)); }
      .sv-ex-row-status[data-error] { color:#cc5263; }
      .sv-ex-row-body { margin:0 10px 14px 18px; padding:4px 0 4px 18px; border-left:1px solid var(--lwb-line); max-height:520px; overflow:auto; }
      .sv-ex-row-body > .sv-ex-prose { padding:0 4px; }
      .sv-ex-assistant > .sv-ex-prose { padding:10px 12px; }
      .sv-ex-tool-output > strong { display:block; margin:16px 0 8px; color:var(--lwb-muted); font-size:12px; }
      @media (max-width:600px) { .sv-ex-process-row > summary { gap:7px; padding:11px 3px; } .sv-ex-row-body { margin-left:11px; padding-left:12px; } .sv-ex-process > summary { flex-wrap:wrap; gap:6px 12px; } .sv-ex-process-counts { font-size:10px; } }
      .sv-ex-live { color:var(--sv-accent,var(--lwb-blue)); font-size:12px; }
      .sv-ex-steps { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:20px; }
      .sv-ex-steps > div { display:grid; grid-template-columns:8px minmax(0,1fr); gap:5px 9px; border:1px solid var(--lwb-line); border-radius:10px; padding:13px; }
      .sv-ex-steps strong { font-size:13px; }
      .sv-ex-steps span { grid-column:2; font-size:12px; color:var(--lwb-muted); line-height:1.65; }
      .sv-ex-steps i,.sv-ex-timeline-row > i { width:7px; height:7px; margin-top:5px; border-radius:50%; background:#b0b9c5; }
      .sv-ex-steps [data-status="done"] i,.sv-ex-steps [data-status="succeeded"] i,.sv-ex-timeline-row[data-status="done"] > i { background:#35a575; }
      .sv-ex-steps [data-status="running"] i,.sv-ex-timeline-row[data-status="running"] > i { background:#e3a432; }
      .sv-ex-steps [data-status="failed"] i,.sv-ex-steps [data-status="error"] i,.sv-ex-timeline-row[data-status="error"] > i { background:#d85f6d; }
      .sv-ex-timeline h4 { font-size:14px; margin:20px 0; }
      .sv-ex-timeline-row { display:grid; grid-template-columns:12px minmax(0,1fr); gap:10px; padding:9px 0 16px; }
      .sv-ex-timeline-row > div { border-bottom:1px solid var(--lwb-line); padding-bottom:12px; }
      .sv-ex-actor { font-size:11px; color:var(--lwb-muted); }
      .sv-ex-paper,.sv-ex-candidate { padding:23px 25px; margin:0 0 18px; border:1px solid var(--lwb-line); border-radius:14px; background:var(--lwb-surface); }
      .sv-ex-paper h3,.sv-ex-candidate h3 { font-size:19px; line-height:1.55; margin:5px 0 16px; }
      .sv-ex-number { color:var(--sv-accent,var(--lwb-blue)); font:600 20px/1.2 ui-monospace,monospace; }
      .sv-ex-why { margin:15px 0 0; padding:12px 14px; border-radius:9px; background:var(--sv-accent-soft,var(--lwb-blue-soft)); font-size:13px; line-height:1.8; }
      .sv-ex-fields { margin:0 0 22px; }
      .sv-ex-fields h4 { margin:0 0 15px; font-size:14px; }
      .sv-ex-fields dl { margin:0; border:1px solid var(--lwb-line); border-radius:12px; overflow:hidden; }
      .sv-ex-fields dl > div { display:grid; grid-template-columns:100px minmax(0,1fr); gap:16px; padding:13px 17px; border-bottom:1px solid var(--lwb-line); font-size:13px; line-height:1.8; }
      .sv-ex-fields dl > div:last-child { border:0; }
      .sv-ex-fields dt { color:var(--lwb-muted); }
      .sv-ex-fields dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
      .sv-ex-issues { padding-left:20px; font-size:13px; line-height:1.8; }
      .sv-ex-assets { display:grid; gap:14px; }
      .sv-ex-asset { padding:17px; border:1px solid var(--lwb-line); border-radius:12px; }
      .sv-ex-asset audio,.sv-ex-asset video { width:100%; max-height:65vh; }
      .sv-ex-asset img { display:block; max-width:100%; max-height:65vh; margin:auto; border-radius:8px; object-fit:contain; }
      .sv-ex-empty { padding:22px; border:1px dashed var(--lwb-line); border-radius:12px; color:var(--lwb-muted); line-height:1.8; font-size:13px; }
      .sv-ex-alert { padding:15px 17px; border:1px solid #eac1c8; background:#fff3f4; color:#a83d4b; border-radius:10px; margin-bottom:18px; line-height:1.8; overflow-wrap:anywhere; font-size:13px; }
      .sv-ex-alert p { margin:4px 0; }
      .sv-ex-footnote { color:var(--lwb-muted); font-size:12px; line-height:1.7; margin-top:22px; }
      .sv-ex-history { display:grid; padding:6px 12px; max-height:270px; overflow:auto; }
      .sv-ex-history button { display:flex; gap:12px; justify-content:space-between; align-items:center; border:0; border-bottom:1px solid var(--lwb-line); padding:13px 3px; color:var(--lwb-muted); background:none; cursor:pointer; font-size:12px; }
      .sv-ex-history strong { color:var(--lwb-ink); }
      body[data-ds-dark-theme] .sv-ex-layer { --sv-accent:var(--lwb-blue); }
      body[data-ds-dark-theme] .sv-ex-alert { background:#3b242a; color:#f7b5bd; border-color:#633b44; }
      body[data-ds-dark-theme] .sv-ex-state[data-status="running"] { background:#493819; color:#ffd383; }
      body[data-ds-dark-theme] .sv-ex-state[data-status="completed"],body[data-ds-dark-theme] .sv-ex-state[data-status="succeeded"] { background:#1d3b30; color:#8fdfb7; }
      body[data-ds-dark-theme] .sv-ex-state[data-status="failed"] { background:#43272d; color:#ffb1be; }
      .sv-ex-layer button:focus-visible,.sv-ex-layer summary:focus-visible { outline:2px solid var(--sv-accent,var(--lwb-blue)); outline-offset:3px; }
      @media(max-width:640px) { .sv-ex-drawer,.sv-ex-drawer[data-wide="true"] { inset:0; width:100%; border-radius:0; } .sv-ex-header { padding:19px 18px; gap:12px; } .sv-ex-header h2 { font-size:18px; } .sv-ex-header-actions > button:first-child { display:none; } .sv-ex-body { padding:18px 16px 28px; } .sv-ex-toolbar { padding:0 18px; } .sv-ex-tabs { gap:16px; } .sv-ex-tabs button { font-size:13px; } .sv-ex-steps { grid-template-columns:1fr; } .sv-ex-footer { padding:12px 18px; } .sv-ex-paper,.sv-ex-candidate { padding:18px; } .sv-ex-message-head { flex-wrap:wrap; } }
      @media(prefers-reduced-motion:reduce) { .sv-ex-layer * { scroll-behavior:auto!important; animation:none!important; } }
      /* Shared module canvas: each workflow page uses the same compact hierarchy. */
      .sv-page { width:100%; max-width:none; margin:0; gap:16px; }
      .sv-page > * { min-width:0; }
      .sv-top { align-items:flex-start; min-height:72px; padding:0 0 15px; border-bottom:1px solid var(--lwb-line); }
      .sv-top-actions { display:flex; flex:none; align-items:center; gap:8px; }
      .sv-top h1 { font-size:var(--lwb-text-heading,20px); line-height:1.35; }
      .sv-top p { max-width:820px; }
      .sv-module-kicker { margin:0 0 5px !important; color:var(--lwb-blue) !important; font-size:var(--lwb-text-xs,12px) !important; font-weight:800; letter-spacing:.08em; }
      .sv-layout { grid-template-columns:minmax(320px,1.15fr) minmax(0,.85fr); gap:16px; }
      .sv-split { gap:16px; }
      .sv-item,.sv-form,.sv-source,.sv-source-compact,.sv-signal-card,.sv-family-section,.sv-feed-toolbar,.sv-insight-panel,.sv-board-card,.sv-pipeline { border-radius:8px; }
      .sv-item,.sv-form,.sv-source { padding:15px; }
      .sv-section { gap:10px; }
      .sv-section-head { min-height:28px; }
      .sv-source-compact-grid { grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
      .sv-board-grid { grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); }
      .sv-badge { border-radius:6px; }

      /* Signal is a data workspace, not a decorative dashboard. */
      .sv-signal-shell { gap:14px; }
      .sv-live-pill { width:max-content; padding:4px 8px; border:1px solid var(--lwb-line); border-radius:6px; color:var(--lwb-green); background:var(--lwb-green-soft); font-size:var(--lwb-text-sm,13px); }
      .sv-live-dot { width:6px; height:6px; animation:none; }
      .sv-pipeline { gap:10px; padding:13px 15px; }
      .sv-pipeline-label { font-size:var(--lwb-text-sm,13px); }
      .sv-board-card::before { background:var(--lwb-blue); }
      .sv-board-card[data-health="manual"]::before { background:#8059aa; }

      @media (max-width:780px) {
        .sv-layout,.sv-split { grid-template-columns:1fr; }
        .sv-board-grid,.sv-source-compact-grid { grid-template-columns:1fr; }
      }

      /* ── 视觉重构 v2（设计稿《口播视频能力包 · 视觉重构方案》）── */
      /* 品牌主色 + 8 模块色 + 双层轻阴影 + 12px 圆角 */
      .sv-page { --sv-brand:#4f46e5; --sv-brand-soft:#eef2ff; --sv-violet:#8b5cf6; --sv-blue:#3b82f6; --sv-orange:#f97316; --sv-purple:#7c3aed; --sv-pink:#ec4899; --sv-green:#10b981; --sv-red:#ef4444; --sv-sky:#0ea5e9; --sv-shadow-sm:0 1px 2px rgba(15,20,25,.04); --sv-shadow-md:0 4px 12px rgba(15,20,25,.06); }
      /* Per-page accent: the shared task kit (tabs / task cards / step pills / pick cards) reads these, so one kit serves every module color. Default = topic orange; script page opts into violet. */
      .sv-page { --sv-accent:#f97316; --sv-accent-soft:#fff7ed; --sv-accent-line:#f0c08a; --sv-accent-ink:#c2410c; --sv-accent-rgb:249,115,22; }
      .sv-page[data-accent="violet"] { --sv-accent:#7c3aed; --sv-accent-soft:#f5f3ff; --sv-accent-line:#c4b5fd; --sv-accent-ink:#6d28d9; --sv-accent-rgb:124,58,237; }
      .sv-page[data-accent="red"] { --sv-accent:#ef4444; --sv-accent-soft:#fef2f2; --sv-accent-line:#f5b5b5; --sv-accent-ink:#b91c1c; --sv-accent-rgb:239,68,68; }
      .sv-page[data-accent="sky"] { --sv-accent:#0ea5e9; --sv-accent-soft:#f0f9ff; --sv-accent-line:#7dd3fc; --sv-accent-ink:#0369a1; --sv-accent-rgb:14,165,233; }
      body[data-ds-dark-theme] .sv-page { --sv-accent-soft:rgba(var(--sv-accent-rgb),.16); --sv-accent-line:rgba(var(--sv-accent-rgb),.45); --sv-accent-ink:#fdba74; }
      body[data-ds-dark-theme] .sv-page[data-accent="violet"] { --sv-accent-ink:#c4b5fd; }
      body[data-ds-dark-theme] .sv-page[data-accent="red"] { --sv-accent-ink:#fca5a5; }
      body[data-ds-dark-theme] .sv-page[data-accent="sky"] { --sv-accent-ink:#7dd3fc; }
      .sv-item,.sv-form,.sv-source,.sv-source-compact,.sv-signal-card,.sv-board-card,.sv-cmdbar { border-color:#eceef3; border-radius:12px; box-shadow:var(--sv-shadow-sm); }
      .sv-board-card::before { background:linear-gradient(90deg,var(--sv-brand),var(--sv-blue)); opacity:.7; }
      .sv-item[data-active="true"] { border-color:#c7d2fe; background:var(--sv-brand-soft); }
      .sv-board-card:hover,.sv-signal-card:hover { box-shadow:var(--sv-shadow-md); }
      .sv-board-card[data-empty="true"]:hover { box-shadow:var(--sv-shadow-sm); }
      .sv-board-card[data-empty="true"] .sv-board-card-main { cursor:default; }
      .sv-board-card[data-empty="true"] .sv-board-card-main:hover { background:transparent; }
      /* 字阶层级：页标题放大、指标数字强调 */
      .sv-top h1 { font-size:24px; letter-spacing:-.01em; }
      .sv-section h3,.sv-form h3 { font-size:var(--lwb-text-section,18px); }
      /* 呼吸感运行指示器 */
      .sv-live-pill { display:inline-flex; align-items:center; gap:6px; border-radius:100px; border-color:transparent; }
      .sv-live-dot { border-radius:50%; animation:sv-breathe 2s ease-in-out infinite; }
      @keyframes sv-breathe { 0%,100% { opacity:1; } 50% { opacity:.35; } }
      /* 暗色主题覆盖 */
      body[data-ds-dark-theme] .sv-page { --sv-brand-soft:rgba(99,102,241,.18); --sv-shadow-sm:0 1px 2px rgba(0,0,0,.35); --sv-shadow-md:0 4px 12px rgba(0,0,0,.4); }
      body[data-ds-dark-theme] .sv-item,body[data-ds-dark-theme] .sv-form,body[data-ds-dark-theme] .sv-source,body[data-ds-dark-theme] .sv-source-compact,body[data-ds-dark-theme] .sv-signal-card,body[data-ds-dark-theme] .sv-board-card,body[data-ds-dark-theme] .sv-cmdbar,body[data-ds-dark-theme] .sv-heromini { border-color:var(--lwb-line); }
      /* 分页 hero mini：统一语法，内容按各页主导问题定制 */
      .sv-heromini { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:0; padding:6px 4px; border:1px solid #eceef3; border-radius:12px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      .sv-heromini-cell { display:grid; gap:3px; min-width:0; padding:10px 14px; }
      .sv-heromini-cell + .sv-heromini-cell { border-left:1px solid var(--lwb-line); }
      .sv-heromini-cell span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-heromini-cell strong { overflow:hidden; font-size:var(--lwb-text-title,24px); font-weight:800; line-height:1.2; letter-spacing:-.01em; color:var(--lwb-ink); text-overflow:ellipsis; white-space:nowrap; }
      .sv-heromini-cell strong[data-tone="green"] { color:var(--sv-green); } .sv-heromini-cell strong[data-tone="red"] { color:#dc2626; } .sv-heromini-cell strong[data-tone="brand"] { color:var(--sv-brand); } .sv-heromini-cell strong[data-tone="orange"] { color:#c2410c; }
      @media (max-width:780px) { .sv-heromini-cell:nth-child(even) { border-left:0; } }
      body[data-ds-dark-theme] .sv-item[data-active="true"] { border-color:#4f6cd8; background:var(--sv-brand-soft); }
      /* v2.1 模块页延展：色、进度、空态 */
      .sv-module-dot { display:inline-block; width:8px; height:8px; flex:none; border-radius:50%; background:var(--sv-blue); }
      .sv-module-kicker { display:inline-flex; align-items:center; gap:6px; }
      .sv-proj-dots { display:flex; align-items:center; gap:4px; }
      .sv-proj-dots i { width:7px; height:7px; border-radius:50%; background:#e2e8f0; transition:background .18s ease; }
      .sv-proj-dots i[data-on="true"] { background:var(--sv-blue); }
      .sv-proj-dots i[data-on="done"] { background:var(--sv-green); }
      .sv-qa-score { display:flex; align-items:baseline; gap:8px; }
      .sv-qa-score strong { font-size:30px; font-weight:800; line-height:1; color:var(--lwb-ink); }
      .sv-qa-score em { font-style:normal; font-size:var(--lwb-text-base,14px); color:var(--lwb-muted); }
      .sv-approval-ritual { border-color:#fecaca; background:#fffbfb; }
      body[data-ds-dark-theme] .sv-approval-ritual { border-color:#5b3434; background:#2b1e1e; }
      .sv-empty-cta { display:grid; gap:10px; padding:22px; border:1px dashed #c7d2fe; border-radius:12px; background:var(--sv-brand-soft); text-align:center; }
      .sv-empty-cta p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.6; }
      body[data-ds-dark-theme] .sv-empty-cta { border-color:#4f6cd8; }
      body[data-ds-dark-theme] .sv-proj-dots i { background:#33424f; } body[data-ds-dark-theme] .sv-proj-dots i[data-on="true"] { background:#78adff; } body[data-ds-dark-theme] .sv-proj-dots i[data-on="done"] { background:#5bd0a0; }
      /* v2.2 模块细节收尾：选题橙、配音粉、视频绿舞台、安排天青 */
      .sv-cand { border-radius:12px; box-shadow:var(--sv-shadow-sm); }
      .sv-cand[data-sel="true"] { border-color:var(--sv-orange); background:#fff7ed; }
      body[data-ds-dark-theme] .sv-cand[data-sel="true"] { border-color:#c2410c; background:rgba(249,115,22,.14); }
      .sv-media-panel { padding:10px; border-radius:10px; background:#fdf2f8; }
      body[data-ds-dark-theme] .sv-media-panel { background:rgba(236,72,153,.12); }
      .sv-media-panel audio { display:block; width:100%; }
      .sv-video-stage { padding:10px; border-radius:12px; background:#0e1a2b; }
      .sv-video-stage video { display:block; width:100%; max-height:560px; border-radius:8px; }
      /* Configuration is a prerequisite, so expose its state beside the action. */
      .sv-page .sv-media-config-trigger { min-height:42px; gap:9px; padding:0 14px; border:1px solid var(--sv-accent-line); border-radius:10px; color:var(--sv-accent-ink); background:var(--sv-accent-soft); box-shadow:0 2px 8px rgba(var(--sv-accent-rgb),.08); font-size:14px; }
      .sv-page .sv-media-config-trigger:hover { border-color:var(--sv-accent); filter:brightness(.98); }
      .sv-page .sv-media-config-trigger[data-attention="true"] { border-color:var(--sv-accent); box-shadow:0 0 0 3px var(--sv-accent-soft); }
      .sv-page .sv-config-state { padding:3px 7px; border-radius:5px; font-size:11px; line-height:1.4; background:var(--lwb-surface); color:var(--lwb-muted); }
      .sv-page .sv-media-config-trigger[data-attention="true"] .sv-config-state { background:var(--sv-accent); color:#fff; }
      .sv-audio-subtitle-option { display:flex; align-items:flex-start; gap:10px; padding:13px; background:var(--sv-accent-soft); border:1px solid var(--sv-accent-line); border-radius:10px; cursor:pointer; }
      .sv-audio-subtitle-option input { margin-top:4px; accent-color:var(--sv-accent); }
      .sv-audio-subtitle-option span { display:grid; gap:5px; }
      .sv-audio-subtitle-option strong { font-size:14px; }
      .sv-audio-subtitle-option small { color:var(--lwb-muted); line-height:1.7; }
      /* ---- 内容安排专属：执行日/整点 chip + 深度档 + 警示条 + 运行历史 + 视频条目 + 生命线（accent 由 data-accent=sky 驱动）---- */
      .sv-as-chips { display:flex; flex-wrap:wrap; gap:6px; }
      .sv-as-chip { display:inline-flex; align-items:center; min-height:30px; padding:0 11px; border:1px solid var(--lwb-line); border-radius:999px; color:var(--lwb-ink); background:var(--lwb-surface); font-size:var(--lwb-text-base,14px); cursor:pointer; transition:border-color .15s,background .15s,color .15s; }
      .sv-as-chip:hover:not(:disabled) { border-color:var(--sv-accent-line); color:var(--sv-accent-ink); }
      .sv-as-chip:disabled { opacity:.5; cursor:not-allowed; }
      .sv-as-chip[data-on="true"] { border-color:var(--sv-accent); color:var(--sv-accent-ink); background:var(--sv-accent-soft); font-weight:700; }
      .sv-as-chip[data-kind="quick"] { border-style:dashed; }
      .sv-as-field { display:grid; gap:6px; }
      .sv-as-label { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-as-depth { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
      .sv-as-depth-opt { display:grid; gap:3px; padding:10px 12px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
      .sv-as-depth-opt:hover:not(:disabled) { border-color:var(--sv-accent-line); }
      .sv-as-depth-opt:disabled { opacity:.55; cursor:not-allowed; }
      .sv-as-depth-opt[data-on="true"] { border-color:var(--sv-accent); background:var(--sv-accent-soft); }
      .sv-as-depth-opt strong { color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); }
      .sv-as-depth-opt[data-on="true"] strong { color:var(--sv-accent-ink); }
      .sv-as-depth-opt span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-as-warn { display:grid; gap:4px; padding:9px 11px; border:1px solid #ecd39b; border-radius:8px; color:#7a5b17; background:#fffaf0; font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      body[data-ds-dark-theme] .sv-as-warn { border-color:#665327; color:#e8d9a9; background:#332b1b; }
      .sv-as-blockers { display:grid; gap:4px; }
      .sv-as-adv { display:grid; gap:10px; padding:11px; border:1px dashed var(--lwb-line); border-radius:9px; }
      .sv-as-adv-title { margin:0; color:var(--sv-accent-ink); font-size:var(--lwb-text-base,14px); font-weight:700; }
      .sv-as-grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:9px; }
      .sv-as-task-note { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      .sv-as-task[data-disabled="true"] { opacity:.72; }
      .sv-as-disabled { display:inline-flex; align-items:center; gap:5px; padding:6px 9px; border:1px solid #ecd39b; border-radius:7px; color:#7a5b17; background:#fffaf0; font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      body[data-ds-dark-theme] .sv-as-disabled { border-color:#665327; color:#e8d9a9; background:#332b1b; }
      .sv-as-runs { display:flex; flex-wrap:wrap; gap:6px; }
      .sv-as-run { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-surface); font-size:var(--lwb-text-sm,13px); cursor:pointer; }
      .sv-as-run:hover { border-color:var(--sv-accent-line); }
      .sv-as-run[data-on="true"] { border-color:var(--sv-accent); background:var(--sv-accent-soft); color:var(--sv-accent-ink); font-weight:700; }
      .sv-as-run i { width:7px; height:7px; border-radius:50%; background:#cbd5e1; flex:none; }
      .sv-as-run[data-status="completed"] i { background:#16a34a; }
      .sv-as-run[data-status="partial"] i { background:#f59e0b; }
      .sv-as-run[data-status="running"] i { background:var(--sv-accent); animation:sv-tp-pulse 1.2s ease-in-out infinite; }
      .sv-as-run[data-status="failed"] i,.sv-as-run[data-status="cancelled"] i { background:var(--sv-red); }
      .sv-as-run[data-status="missed"] i { background:#94a3b8; }
      .sv-as-sumgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); gap:8px; }
      .sv-as-sumgrid > div { display:grid; gap:2px; justify-items:center; padding:9px 6px; border-radius:8px; background:var(--lwb-page); }
      .sv-as-sumgrid strong { color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); }
      .sv-as-sumgrid span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-as-item { display:grid; gap:7px; padding:11px 12px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); }
      .sv-as-item-head { display:flex; align-items:flex-start; justify-content:space-between; gap:9px; }
      .sv-as-item-title { margin:0; overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
      .sv-as-item-meta { margin:2px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      .sv-as-life { display:grid; gap:0; padding:9px 11px; border:1px dashed var(--lwb-line); border-radius:9px; background:var(--lwb-page); }
      .sv-as-life-stage { display:grid; grid-template-columns:86px 1fr auto; gap:9px; align-items:center; padding:6px 0; border-bottom:1px solid var(--lwb-line); }
      .sv-as-life-stage:last-child { border-bottom:0; }
      .sv-as-life-stage > strong { color:var(--lwb-ink); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-as-life-stage > p { margin:0; overflow:hidden; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; text-overflow:ellipsis; }
      .sv-as-life-stage[data-status="done"] > strong { color:#16865f; }
      .sv-as-life-stage[data-status="running"] > strong { color:var(--sv-accent-ink); }
      .sv-as-life-stage[data-status="failed"] > strong { color:var(--sv-red); }
      .sv-as-life-stage[data-status="skipped"] { opacity:.6; }
      .sv-as-life-dot { display:inline-flex; align-items:center; gap:5px; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); white-space:nowrap; }
      .sv-as-life-dot i { width:7px; height:7px; border-radius:50%; background:#cbd5e1; flex:none; }
      .sv-as-life-stage[data-status="done"] .sv-as-life-dot i { background:#16a34a; }
      .sv-as-life-stage[data-status="running"] .sv-as-life-dot i { background:var(--sv-accent); animation:sv-tp-pulse 1.2s ease-in-out infinite; }
      .sv-as-life-stage[data-status="failed"] .sv-as-life-dot i { background:var(--sv-red); }
      /* v2.5 账号卡重塑：头像 + 双徽章分离 + 完善度条 + 相对时间，版本号不再外露 */
      .sv-acc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
      .sv-acc-card { display:grid; gap:10px; align-content:start; padding:16px; border:1px solid #eceef3; border-radius:12px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); text-align:left; cursor:pointer; transition:box-shadow .18s ease,border-color .18s ease; }
      .sv-acc-card:hover { border-color:#c7d2fe; box-shadow:var(--sv-shadow-md); }
      .sv-acc-card[data-state="todo"] { border-color:#fed7aa; }
      .sv-acc-card[data-default="true"] { border-color:#c7d2fe; background:linear-gradient(180deg,var(--sv-brand-soft),var(--lwb-surface) 78%); }
      .sv-acc-card[data-default="true"]:hover { border-color:var(--sv-brand); }
      .sv-acc-head { display:flex; min-width:0; align-items:center; gap:10px; }
      .sv-acc-avatar { display:grid; place-items:center; flex:none; width:34px; height:34px; border-radius:9px; color:#fff; font-size:var(--lwb-text-section,18px); font-weight:700; }
      .sv-acc-id { display:grid; gap:3px; min-width:0; flex:1; }
      .sv-acc-name { overflow:hidden; font-size:var(--lwb-text-lg,16px); font-weight:700; text-overflow:ellipsis; white-space:nowrap; color:var(--lwb-ink); }
      .sv-acc-badges { display:flex; flex-wrap:wrap; gap:5px; }
      .sv-acc-pill { display:inline-flex; flex:none; align-items:center; min-height:19px; padding:0 7px; border-radius:999px; font-size:var(--lwb-text-xs,12px); font-weight:700; white-space:nowrap; background:#f3f4f6; color:#6b7280; }
      .sv-acc-pill[data-tone="default"] { background:var(--sv-brand-soft); color:var(--sv-brand); }
      .sv-acc-pill[data-tone="done"] { background:#ecfdf5; color:#047857; }
      .sv-acc-pill[data-tone="todo"] { background:#fff7ed; color:#c2410c; }
      .sv-acc-summary { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.6; }
      .sv-acc-summary[data-empty="true"] { color:#9ca3af; }
      .sv-acc-chips { display:flex; flex-wrap:wrap; gap:6px; }
      .sv-acc-chip { padding:2px 8px; border-radius:6px; background:#f3f4f6; color:#4b5563; font-size:var(--lwb-text-sm,13px); }
      .sv-acc-meter { display:flex; align-items:center; gap:4px; }
      .sv-acc-meter i { width:22px; height:4px; border-radius:2px; background:#e5e7eb; }
      .sv-acc-meter i[data-on="true"] { background:var(--sv-brand); }
      .sv-acc-meter[data-full="false"] i[data-on="true"] { background:var(--sv-orange); }
      .sv-acc-meter-text { margin-left:4px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-acc-foot { display:flex; justify-content:space-between; gap:8px; padding-top:10px; border-top:1px solid var(--lwb-line); color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-acc-new { display:grid; place-items:center; gap:6px; min-height:150px; border:1px dashed #c7d2fe; border-radius:12px; background:#f8f9fe; color:var(--sv-brand); font-size:var(--lwb-text-md,15px); font-weight:700; cursor:pointer; }
      .sv-acc-new-sub { color:#9ca3af; font-size:var(--lwb-text-sm,13px); font-weight:400; }
      .sv-acc-arch { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:12px 16px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); }
      .sv-acc-arch-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
      .sv-acc-arch-info { display:grid; gap:2px; min-width:0; }
      .sv-acc-arch-info strong { font-size:var(--lwb-text-md,15px); color:var(--lwb-muted); }
      .sv-acc-arch-info span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-acc-danger { color:#b91c1c; }
      .sv-acc-danger:hover { background:#fee2e2; }
      .sv-acc-complete { display:grid; gap:6px; padding:10px 12px; margin-bottom:4px; border:1px dashed #c7d2fe; border-radius:10px; background:#f8f9fe; }
      .sv-acc-complete .lwb-primary-button { justify-self:start; }
      body[data-ds-dark-theme] .sv-acc-card { border-color:var(--lwb-line); }
      body[data-ds-dark-theme] .sv-acc-card:hover { border-color:#4f6cd8; }
      body[data-ds-dark-theme] .sv-acc-card[data-state="todo"] { border-color:#8a5a2b; }
      body[data-ds-dark-theme] .sv-acc-card[data-default="true"] { border-color:#4f6cd8; background:linear-gradient(180deg,rgba(99,102,241,.14),var(--lwb-surface) 78%); }
      body[data-ds-dark-theme] .sv-acc-pill[data-tone="todo"] { background:rgba(249,115,22,.16); color:#fdba74; }
      body[data-ds-dark-theme] .sv-acc-pill[data-tone="done"] { background:rgba(16,185,129,.16); color:#6ee7b7; }
      body[data-ds-dark-theme] .sv-acc-chip { background:#22313f; color:#c3ccd6; }
      body[data-ds-dark-theme] .sv-acc-meter i[data-on="false"] { background:#22313f; }
      body[data-ds-dark-theme] .sv-acc-new { border-color:#4f6cd8; background:rgba(99,102,241,.1); }
      body[data-ds-dark-theme] .sv-acc-danger:hover { background:rgba(239,68,68,.16); }
      body[data-ds-dark-theme] .sv-acc-complete { border-color:#4f6cd8; background:rgba(99,102,241,.08); }
      /* ── v2.5 信号页美化：命令条 + 信号卡片五要素 + 抽屉重塑 ── */
      /* 命令条：左标题 / 中内联统计 / 右动作，单行 64px */
      .sv-cmdbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; min-height:64px; padding:10px 16px; border:1px solid #eceef3; border-radius:12px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-md); }
      .sv-cmd-title { display:grid; gap:2px; }
      .sv-cmd-kicker { display:inline-flex; align-items:center; gap:5px; margin:0; color:var(--sv-blue); font-size:var(--lwb-text-xs,12px); font-weight:800; letter-spacing:.08em; }
      .sv-cmd-title h2 { margin:0; font-size:var(--lwb-text-heading,20px); line-height:1.25; color:var(--lwb-ink); }
      .sv-cmd-sep { width:1px; height:32px; flex:none; background:var(--lwb-line); }
      .sv-cmd-stats { display:flex; align-items:center; flex:1; min-width:0; }
      .sv-cmd-stat { display:grid; gap:1px; padding:0 14px; }
      .sv-cmd-stat + .sv-cmd-stat { border-left:1px solid var(--lwb-line); }
      .sv-cmd-stat span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-cmd-stat strong { color:var(--lwb-ink); font-size:19px; font-weight:800; line-height:1.2; letter-spacing:-.01em; }
      .sv-cmd-stat strong[data-tone="brand"] { color:var(--sv-brand); }
      .sv-cmd-stat strong[data-tone="ok"] { color:var(--sv-green); }
      .sv-cmd-stat strong[data-tone="alert"] { color:#dc2626; }
      .sv-cmd-stat strong[data-tone="time"] { font-size:var(--lwb-text-lg,16px); line-height:23px; }
      .sv-cmd-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
      @media (max-width:980px) { .sv-cmd-stats { flex-basis:100%; order:3; border-top:1px solid var(--lwb-line); padding-top:8px; } .sv-cmd-actions { margin-left:0; } }
      /* 信号卡五要素：来源 glyph / 评分条 / 排名徽标 / 热度 / 相对时间 */
      .sv-sig-head { display:flex; gap:10px; align-items:flex-start; }
      .sv-glyph { display:grid; place-items:center; flex:none; width:30px; height:30px; border-radius:8px; color:#fff; font-size:var(--lwb-text-lg,16px); font-weight:700; }
      .sv-sig-titlebox { min-width:0; flex:1; }
      .sv-sig-src { margin:0 0 2px; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-signal-title { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; white-space:normal; font-size:var(--lwb-text-lg,16px); line-height:1.5; }
      .sv-rank { display:inline-flex; flex:none; align-items:center; padding:4px 8px; border-radius:6px; background:#f2f3f5; color:#5b6472; font-size:var(--lwb-text-sm,13px); font-weight:800; font-variant-numeric:tabular-nums; }
      .sv-rank[data-tier="top"] { background:var(--lwb-ink); color:#fff; }
      .sv-rank[data-tier="hot"] { background:var(--sv-brand-soft); color:var(--sv-brand); }
      .sv-sig-metrics { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; }
      .sv-sig-metrics .sv-scorebar strong,.sv-sig-metrics .sv-hot,.sv-sig-metrics .sv-new,.sv-sig-metrics .sv-meta { line-height:16px; }
      .sv-sig-metrics .sv-meta { margin:0; font-size:var(--lwb-text-sm,13px); }
      .sv-scorebar { display:inline-flex; align-items:center; gap:6px; }
      .sv-scorebar i { position:relative; display:inline-block; width:64px; height:4px; border-radius:2px; background:#e5e7ed; }
      .sv-scorebar i::after { content:''; position:absolute; left:0; top:0; bottom:0; width:var(--sv-fill,50%); border-radius:2px; background:var(--sv-brand); }
      .sv-scorebar strong { color:var(--sv-brand); font-size:var(--lwb-text-base,14px); font-weight:800; }
      body[data-ds-dark-theme] .sv-scorebar i { background:#33424f; }
      .sv-hot { display:inline-flex; align-items:center; gap:5px; color:#c2410c; font-size:var(--lwb-text-sm,13px); font-weight:600; }
      .sv-hot i { display:inline-block; width:8px; height:10px; border-radius:50% 50% 50% 0; background:var(--sv-orange); transform:rotate(-45deg); }
      .sv-new { display:inline-flex; align-items:center; gap:5px; color:#047857; font-size:var(--lwb-text-sm,13px); }
      .sv-new i { width:6px; height:6px; border-radius:50%; background:var(--sv-green); animation:sv-breathe 2s ease-in-out infinite; }
      /* 动作区：全部评估动作为可读文字按钮，平级排列 */
      .sv-sig-acts { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
      .sv-sig-tools { display:flex; flex:none; align-items:center; gap:8px; }
      .sv-sig-acts a.sv-outline-mini { text-decoration:none; }
      .sv-primary-mini { border:0; border-radius:7px; padding:7px 12px; background:var(--sv-brand); color:#fff; font:inherit; font-size:var(--lwb-text-base,14px); font-weight:600; cursor:pointer; transition:opacity .15s ease; }
      .sv-primary-mini:hover { opacity:.9; }
      .sv-primary-mini:disabled { opacity:.55; cursor:default; }
      .sv-outline-mini { border:1px solid var(--sv-brand); border-radius:7px; padding:6px 11px; background:transparent; color:var(--sv-brand); font:inherit; font-size:var(--lwb-text-base,14px); font-weight:600; cursor:pointer; }
      .sv-outline-mini:hover { background:var(--sv-brand-soft); }
      .sv-ghost-btn { display:grid; place-items:center; width:28px; height:28px; border:1px solid #d7e0e9; border-radius:7px; background:var(--lwb-surface); color:#8a94a6; font:inherit; font-size:var(--lwb-text-sm,13px); cursor:pointer; transition:color .15s ease,border-color .15s ease; }
      .sv-ghost-btn:hover { color:var(--sv-brand); border-color:var(--sv-brand); }
      body[data-ds-dark-theme] .sv-ghost-btn { border-color:var(--lwb-line); }
      body[data-ds-dark-theme] .sv-rank { background:#22313f; color:#9aa7b5; }
      body[data-ds-dark-theme] .sv-rank[data-tier="top"] { background:#e2e8f0; color:#0f172a; }
      body[data-ds-dark-theme] .sv-rank[data-tier="hot"] { background:rgba(99,102,241,.2); color:#a5b4fc; }
      body[data-ds-dark-theme] .sv-drawer-search { border-color:var(--lwb-line); }
      body[data-ds-dark-theme] .sv-filter-chip { background:#22313f; color:#9aa7b5; }
      body[data-ds-dark-theme] .sv-hot { color:#fdba74; }
      body[data-ds-dark-theme] .sv-new { color:#6ee7b7; }
      /* 抽屉重塑：固定来源头 + 工具行 + 独立滚动区（分组标题区内粘性） */
      .sv-drawer { display:flex; flex-direction:column; width:min(640px,100vw); overflow:hidden; }
      .sv-drawer-head { flex:none; margin-bottom:0; padding-bottom:12px; border-bottom:1px solid var(--lwb-line); }
      .sv-drawer-src { display:flex; align-items:center; gap:10px; }
      .sv-drawer-src .sv-glyph { width:34px; height:34px; border-radius:9px; font-size:var(--lwb-text-section,18px); }
      .sv-drawer-srcbox { min-width:0; flex:1; }
      .sv-drawer-srcbox .sv-item-title { font-size:var(--lwb-text-section,18px); }
      .sv-drawer-stats { display:grid; grid-template-columns:repeat(3,1fr); margin-top:10px; padding:8px 10px; border-radius:8px; background:var(--lwb-page); }
      .sv-drawer-stat { display:grid; gap:1px; justify-items:center; }
      .sv-drawer-stat + .sv-drawer-stat { border-left:1px solid var(--lwb-line); }
      .sv-drawer-stat strong { color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); font-weight:800; }
      .sv-drawer-stat strong[data-tone="brand"] { color:var(--sv-brand); }
      .sv-drawer-stat span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-drawer-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; flex:none; padding:10px 0; }
      .sv-filter-chip { border:0; border-radius:100px; padding:4px 10px; background:var(--lwb-page); color:var(--lwb-muted); font:inherit; font-size:var(--lwb-text-xs,12px); font-weight:600; cursor:pointer; }
      .sv-filter-chip[data-on="true"] { background:var(--sv-brand); color:#fff; }
      .sv-drawer-search { min-width:150px; flex:1; height:28px; border:1px solid #d7e0e9; border-radius:7px; padding:0 10px; color:var(--lwb-ink); background:var(--lwb-surface); font:inherit; font-size:var(--lwb-text-sm,13px); }
      .sv-drawer-search:focus { border-color:var(--sv-brand); outline:0; }
      .sv-drawer-scroll { min-height:0; flex:1; overflow:auto; }
      /* 直挂修复：候选/账号抽屉把 sv-drawer-list 直接放在 sv-drawer（flex 列 + overflow:hidden）下，
         无滚动容器会被裁切。子选择器只命中直接子级——信号/写稿抽屉的 list 在 sv-drawer-scroll 内（孙级），不受影响。 */
      .sv-drawer > .sv-drawer-list { min-height:0; flex:1; overflow:auto; }
      .sv-group-title { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px; margin:0; padding:8px 0 6px; background:var(--lwb-surface); color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-group-title::before { content:''; width:3px; height:10px; border-radius:1.5px; background:var(--sv-brand); }
      .sv-group-title[data-tone="muted"]::before { background:var(--lwb-muted); }
      /* 配音工作台：运行参数在主页面，连接凭据收在紧凑抽屉。 */
      .sv-page[data-accent="pink"] { --sv-accent:#db2777; --sv-accent-soft:#fdf2f8; --sv-accent-line:#f5b5d0; --sv-accent-ink:#be185d; --sv-accent-rgb:219,39,119; }
      body[data-ds-dark-theme] .sv-page[data-accent="pink"] { --sv-accent-ink:#f9a8d4; }
      .sv-media-config-strip { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:11px 14px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      .sv-media-config-summary { display:flex; min-width:0; align-items:center; gap:11px; }
      .sv-media-config-mark { display:grid; flex:none; width:31px; height:31px; place-items:center; border-radius:8px; color:#c026d3; background:#fdf4ff; font-size:var(--lwb-text-section,18px); }
      .sv-media-config-copy { display:grid; min-width:0; gap:2px; }
      .sv-media-config-copy strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); text-overflow:ellipsis; white-space:nowrap; }
      .sv-media-config-copy span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-media-config-meta { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; }
      .sv-media-config-trigger { display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:0 10px; border:1px solid #d7e0e9; border-radius:7px; color:#4b647a; background:var(--lwb-surface); font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; cursor:pointer; }
      .sv-media-config-trigger:hover { border-color:#b8a0d4; color:#8b3bb2; background:#fdf8ff; }
      .sv-media-config-trigger > span:first-child { font-size:var(--lwb-text-lg,16px); line-height:1; }
      .sv-media-config-drawer { width:min(484px,100vw); }
      .sv-media-drawer-title { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); }
      .sv-media-drawer-copy { margin:5px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-media-drawer-body { display:grid; grid-auto-rows:max-content; min-height:0; flex:1; align-content:start; gap:18px; overflow:auto; padding:17px 2px 2px; }
      .sv-media-provider-picker { display:inline-flex; width:max-content; max-width:100%; align-self:start; padding:3px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-media-provider-choice { min-height:30px; padding:0 10px; border:1px solid transparent; border-radius:6px; color:var(--lwb-muted); background:transparent; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; cursor:pointer; }
      .sv-media-provider-choice[data-active="true"] { border-color:var(--sv-accent-line); color:var(--sv-accent-ink); background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      .sv-media-settings-section { display:grid; grid-auto-rows:max-content; align-content:start; gap:12px; padding-top:16px; border-top:1px solid var(--lwb-line); }
      .sv-media-settings-section h4 { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:800; }
      .sv-media-config-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .sv-media-field { display:grid; min-width:0; gap:6px; }
      .sv-media-field > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-media-field-wide { grid-column:1/-1; }
      .sv-media-drawer-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:14px; border-top:1px solid var(--lwb-line); }
      body[data-ds-dark-theme] .sv-media-config-mark,body[data-ds-dark-theme] .sv-media-provider-choice[data-active="true"] { background:rgba(192,132,211,.14); }
      body[data-ds-dark-theme] .sv-media-config-trigger { border-color:var(--lwb-line); background:var(--lwb-surface); }
      .sv-audio-workbench { grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr); }
      .sv-video-workbench { grid-template-columns:minmax(300px,.82fr) minmax(0,1.18fr); grid-template-areas:'sources tasks'; }
      .sv-video-source { grid-area:sources; align-content:start; }
      .sv-video-task-list { grid-area:tasks; align-content:start; }
      .sv-video-source-item { display:grid; width:100%; gap:6px; padding:11px 12px; border:1px solid var(--lwb-line); border-left:3px solid var(--lwb-line); border-radius:8px; color:var(--lwb-ink); background:var(--lwb-surface); cursor:pointer; font:inherit; text-align:left; }
      .sv-video-source-item:hover,.sv-video-source-item[data-active="true"] { border-color:#8ccfb2; background:#f3fbf7; }
      .sv-video-source-item[data-active="true"] { border-left-color:#16865f; }
      .sv-video-create { margin-top:4px; border-color:#c7e5d5; }
      .sv-video-option { display:grid; gap:6px; }
      .sv-video-option > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-video-orientation { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px; width:100%; padding:3px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-video-orientation button { min-height:34px; border:1px solid transparent; border-radius:6px; color:var(--lwb-muted); background:transparent; cursor:pointer; font:inherit; font-size:var(--lwb-text-base,14px); font-weight:700; }
      .sv-video-orientation button[data-active="true"] { border-color:#a9d9c4; color:#126b4c; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      body[data-ds-dark-theme] .sv-video-orientation button[data-active="true"] { border-color:#2c8a61; color:#7bd9b2; background:rgba(22,134,95,.14); }
      .sv-video-task-tools { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; }
      .sv-video-task { display:grid; gap:10px; padding:14px; border:1px solid var(--lwb-line); border-left:3px solid var(--lwb-line); border-radius:8px; background:var(--lwb-surface); }
      .sv-video-task[data-status="queued"],.sv-video-task[data-status="running"] { border-left-color:#f59e0b; }
      .sv-video-task[data-status="succeeded"] { border-left-color:#16865f; }
      .sv-video-task[data-status="failed"] { border-left-color:#e5484d; }
      .sv-video-task-head { display:flex; min-width:0; align-items:flex-start; justify-content:space-between; gap:10px; }
      .sv-video-task-head > div { display:grid; min-width:0; gap:3px; }
      .sv-video-task-title { overflow:hidden; margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; text-overflow:ellipsis; white-space:nowrap; }
      .sv-video-task-meta,.sv-video-task-detail { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-video-task-detail { display:flex; flex-wrap:wrap; gap:5px 9px; }
      .sv-video-task-detail span { white-space:nowrap; }
      .sv-video-task .sv-video-stage { margin:0; padding:8px; border-radius:8px; }
      .sv-video-task .sv-video-stage video { max-height:360px; }
      .sv-video-media-drawer { display:grid; gap:12px; padding-top:14px; }
      body[data-ds-dark-theme] .sv-video-source-item:hover,body[data-ds-dark-theme] .sv-video-source-item[data-active="true"] { border-color:#2c8a61; background:rgba(22,134,95,.12); }
      @media (max-width:780px) { .sv-video-workbench { grid-template-columns:minmax(0,1fr); grid-template-areas:'sources' 'tasks'; } }
      .sv-audio-config { align-content:start; }
      .sv-audio-script { min-height:136px; overflow:hidden; resize:none; color:var(--lwb-ink); background:var(--lwb-page); }
      .sv-audio-project { display:grid; gap:5px; padding:10px 11px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-audio-project strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); text-overflow:ellipsis; white-space:nowrap; }
      .sv-audio-project span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-voice-upload,.sv-video-bgm-upload { display:grid; gap:8px; padding:10px 11px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-voice-upload-row,.sv-video-bgm-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .sv-voice-upload-file,.sv-video-bgm-file { min-width:0; flex:1; overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-sm,13px); text-overflow:ellipsis; white-space:nowrap; }
      .sv-voice-upload-file span,.sv-video-bgm-file span { color:var(--lwb-muted); }
      .sv-video-bgm-volume { display:grid; grid-template-columns:auto minmax(120px,1fr) 44px; align-items:center; gap:8px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-video-bgm-volume input { width:100%; accent-color:#16865f; }
      .sv-video-bgm-volume output { color:var(--lwb-ink); text-align:right; }
      .sv-audio-parameters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .sv-audio-connect-note { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding-top:2px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-audio-connect-note button { flex:none; }
      .sv-audio-source-row { display:grid; gap:8px; }
      .sv-audio-task-tools { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; }
      .sv-filter-chips { display:flex; flex-wrap:wrap; gap:5px; }
      .sv-audio-pagebar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding-top:2px; }
      .sv-audio-picker { width:min(620px,100vw); }
      .sv-audio-picker-body { display:flex; flex-direction:column; gap:12px; min-height:0; padding-top:14px; }
      .sv-audio-picker-body > .sv-list { display:grid; grid-auto-rows:max-content; align-content:start; gap:8px; min-height:0; }
      .sv-audio-picker-item { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-audio-picker-item > div { display:grid; min-width:0; gap:4px; }
      .sv-audio-picker-item strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); text-overflow:ellipsis; white-space:nowrap; }
      .sv-audio-picker-item p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-audio-subtitle-editor { display:grid; gap:0; padding-top:14px; }
      .sv-subtitle-text { min-height:72px; padding:8px 9px; resize:vertical; line-height:1.6; }
      .sv-audio-task { display:grid; gap:10px; padding:13px 14px; border:1px solid var(--lwb-line); border-left:3px solid var(--lwb-line); border-radius:8px; background:var(--lwb-surface); }
      .sv-audio-task[data-status="running"],.sv-audio-task[data-status="queued"] { border-left-color:#f59e0b; }
      .sv-audio-task[data-status="succeeded"] { border-left-color:#16865f; }
      .sv-audio-task[data-status="failed"] { border-left-color:#e5484d; }
      .sv-audio-task[data-active="true"] { border-color:var(--sv-accent-line); background:var(--sv-accent-soft); }
      .sv-audio-task-head { display:flex; min-width:0; align-items:flex-start; justify-content:space-between; gap:10px; }
      .sv-audio-task-head > div { display:grid; min-width:0; gap:3px; }
      .sv-audio-task-title { overflow:hidden; margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; text-overflow:ellipsis; white-space:nowrap; }
      .sv-audio-task-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-audio-task-detail { display:flex; flex-wrap:wrap; gap:5px 9px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-audio-task-detail span { white-space:nowrap; }
      .sv-audio-subtitle-progress { display:grid; gap:6px; padding:9px 10px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-audio-subtitle-progress-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.45; }
      .sv-audio-subtitle-progress-head strong { color:var(--lwb-ink); font-weight:600; }
      .sv-audio-subtitle-progress-head span { flex:none; font-variant-numeric:tabular-nums; }
      .sv-audio-subtitle-progress progress { display:block; width:100%; height:6px; accent-color:#16865f; }
      .sv-audio-player { display:grid; gap:7px; padding:10px; border:1px solid #f1d2df; border-radius:8px; background:#fff8fb; }
      .sv-audio-player audio { display:block; width:100%; }
      .sv-audio-player p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-subtitle-cues { display:grid; gap:0; }
      .sv-subtitle-cue { display:grid; grid-template-columns:62px minmax(0,1fr); gap:10px; padding:10px 0; border-bottom:1px solid var(--lwb-line); }
      .sv-subtitle-cue time { color:var(--sv-accent-ink); font-size:var(--lwb-text-xs,12px); font-variant-numeric:tabular-nums; }
      .sv-subtitle-cue p { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); line-height:1.6; white-space:pre-wrap; word-break:break-word; }
      .sv-subtitle-raw { margin:0; padding:12px; overflow:auto; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); color:var(--lwb-ink); font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; }
      body[data-ds-dark-theme] .sv-audio-player { border-color:rgba(236,72,153,.28); background:rgba(236,72,153,.08); }
      @media (max-width:780px) { .sv-audio-workbench { grid-template-columns:1fr; } }
      @media (max-width:560px) { .sv-media-config-grid,.sv-audio-parameters { grid-template-columns:1fr; } .sv-media-field-wide { grid-column:auto; } .sv-media-config-strip { align-items:flex-start; } .sv-media-config-meta { justify-content:flex-start; } .sv-media-provider-picker { width:100%; } .sv-media-provider-choice { flex:1; } .sv-subtitle-cue { grid-template-columns:1fr; gap:3px; } .sv-audio-task-tools,.sv-video-task-tools { grid-template-columns:1fr; } .sv-audio-picker-item { align-items:flex-start; flex-direction:column; } }
      @media (prefers-reduced-motion:reduce) { .sv-live-dot { animation:none; } }
      /* 应用内确认对话框：遮罩高于 sv-drawer(41)，卡片沿用宿主 lwb 卡片圆角与按钮体系。 */
      .sv-confirm-backdrop { position:fixed; z-index:45; inset:0; display:grid; place-items:center; padding:24px; background:rgba(27,39,53,.32); }
      .sv-confirm-card { width:min(430px,100%); max-height:min(720px,calc(100vh - 48px)); overflow:auto; padding:21px; box-shadow:0 18px 50px rgba(20,34,49,.22); }
      .sv-confirm-card .lwb-pack-detail-head { margin-bottom:14px; }
      /* ---- 共享任务套件：账号 Tab + 来源卡 + 任务卡 + 步骤胶囊 + 选取卡 + 抽屉（选题橙为默认 accent，写稿页经 data-accent=violet 复用同一套件）---- */
      .sv-tp-tabs { display:flex; flex-wrap:wrap; gap:7px; }
      .sv-tp-tab { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border:1px solid var(--lwb-line); border-radius:999px; color:var(--lwb-muted); background:var(--lwb-surface); cursor:pointer; font:inherit; font-size:var(--lwb-text-base,14px); font-weight:700; transition:border-color .15s ease,color .15s ease,background .15s ease; }
      .sv-tp-tab:hover:not(:disabled) { border-color:var(--sv-accent-line); color:var(--sv-accent-ink); }
      .sv-tp-tab:disabled { cursor:default; opacity:.6; }
      .sv-tp-tab[data-active="true"] { border-color:var(--sv-accent); color:var(--sv-accent-ink); background:var(--sv-accent-soft); }
      .sv-tp-tab-dot { width:6px; height:6px; border-radius:50%; background:var(--sv-accent); }
      .sv-tp-acct-note { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.6; }
      .sv-tp-acct-link { padding:0; border:0; color:var(--lwb-blue); background:none; cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); }
      .sv-tp-srcgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(170px,100%),1fr)); gap:8px; }
      .sv-tp-src { display:grid; gap:5px; padding:10px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); cursor:pointer; text-align:left; font:inherit; transition:border-color .15s ease,background .15s ease,box-shadow .15s ease; }
      .sv-tp-src:hover:not(:disabled) { border-color:#f0c08a; box-shadow:var(--sv-shadow-sm); }
      .sv-tp-src:disabled { cursor:default; opacity:.55; }
      .sv-tp-src[data-on="true"] { border-color:var(--sv-orange); background:#fff7ed; }
      .sv-tp-src-head { display:flex; align-items:flex-start; gap:6px; min-width:0; }
      .sv-tp-src-main { display:grid; flex:1 1 auto; gap:3px; min-width:0; padding:0; border:0; background:none; cursor:pointer; text-align:left; font:inherit; }
      .sv-tp-src-titlerow { display:flex; align-items:center; gap:6px; min-width:0; }
      .sv-tp-src-dot { flex:none; width:8px; height:8px; border-radius:3px; }
      .sv-tp-src-name { overflow:hidden; flex:1 1 auto; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
      .sv-tp-src-check { flex:none; display:grid; place-items:center; width:16px; height:16px; margin-top:1px; padding:0; border:1.5px solid var(--sv-orange); border-radius:5px; background:var(--sv-orange); color:#fff; cursor:pointer; font:inherit; }
      .sv-tp-src-check i { display:block; width:8px; height:4px; border:2px solid #fff; border-top:0; border-right:0; transform:rotate(-45deg) translate(1px,-1px); }
      .sv-tp-src[data-on="false"] .sv-tp-src-check { border-color:#c3ccd6; background:var(--lwb-surface); }
      .sv-tp-src[data-on="false"] .sv-tp-src-check i { display:none; }
      .sv-tp-src-open { padding:0; border:0; color:var(--lwb-blue); background:none; cursor:pointer; font:inherit; font-size:var(--lwb-text-xs,12px); }
      .sv-tp-src-open:hover { text-decoration:underline; }
      .sv-tp-src-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-tp-src[data-on="false"] .sv-tp-src-check { border-color:var(--lwb-line); background:var(--lwb-surface); }
      .sv-tp-exclbar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 11px; border:1px solid #f3d7b0; border-radius:8px; background:#fff9f0; color:#9a5a10; font-size:var(--lwb-text-sm,13px); }
      .sv-tp-exclbar button { padding:2px 8px; border:1px solid #e7c493; border-radius:6px; color:#9a5a10; background:var(--lwb-surface); cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); }
      .sv-tp-task { display:grid; gap:9px; padding:13px 14px; border:1px solid var(--lwb-line); border-radius:11px; background:var(--lwb-surface); transition:border-color .15s ease,box-shadow .15s ease; }
      .sv-tp-task[data-status="queued"] { border-color:#c9d8e8; background:#f7fbff; }
      .sv-tp-task[data-status="running"] { border-color:var(--sv-accent-line); background:var(--sv-accent-soft); }
      .sv-tp-task[data-status="failed"] { border-color:#eec9c9; background:#fffafa; }
      .sv-tp-task-head { display:flex; align-items:flex-start; justify-content:space-between; gap:9px; }
      .sv-tp-task-title { overflow:hidden; margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; }
      .sv-tp-task-meta { margin:3px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-tp-task-badges { display:flex; flex:none; flex-wrap:wrap; gap:5px; justify-content:flex-end; }
      .sv-tp-steps { display:flex; flex-wrap:wrap; gap:6px; }
      .sv-tp-step { display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:7px; background:#f2f3f5; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); font-weight:600; }
      .sv-tp-step i { width:5px; height:5px; border-radius:50%; background:#a7b2be; }
      .sv-tp-step[data-state="done"] { background:#eaf8f1; color:#1f7354; } .sv-tp-step[data-state="done"] i { background:#16865f; }
      .sv-tp-step[data-state="running"] { background:var(--sv-accent-soft); color:var(--sv-accent-ink); } .sv-tp-step[data-state="running"] i { background:var(--sv-accent); animation:sv-tp-pulse 1.2s ease-in-out infinite; }
      .sv-tp-step[data-state="error"] { background:#fdecec; color:#a94343; } .sv-tp-step[data-state="error"] i { background:#e5484d; }
      @keyframes sv-tp-pulse { 50% { opacity:.35; } }
      .sv-tp-task-acts { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .sv-tp-task-acts .sv-note { flex:1 1 180px; padding:0; border:0; background:none; }
      .sv-tp-task-group { display:grid; gap:8px; }
      .sv-tp-task-group-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:7px; }
      .sv-tp-task-group-title { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); font-weight:800; }
      .sv-tp-task-group-meta { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-tp-history-filters { display:flex; flex-wrap:wrap; gap:6px; }
      .sv-tp-history-filter { min-height:28px; padding:0 9px; border:1px solid var(--lwb-line); border-radius:6px; color:var(--lwb-muted); background:var(--lwb-surface); cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-tp-history-filter:hover:not(:disabled),.sv-tp-history-filter[aria-pressed="true"] { border-color:var(--sv-accent-line); color:var(--sv-accent-ink); background:var(--sv-accent-soft); }
      .sv-tp-history-filter:disabled { cursor:default; opacity:.6; }
      .sv-tp-pagination { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:2px; }
      .sv-tp-pagination-page { min-width:78px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); text-align:center; }
      .sv-tp-task[data-confirmed="true"] { border-color:#bfe3cf; background:#f6fcf8; }
      .sv-tp-confirmed { display:grid; gap:3px; padding:10px 12px; border:1px dashed #bfe3cf; border-radius:9px; background:var(--lwb-surface); }
      .sv-tp-confirmed-title { color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; }
      .sv-tp-confirmed-meta { color:#1f7354; font-size:var(--lwb-text-sm,13px); }
      .sv-tp-cand { display:grid; gap:5px; padding:12px 13px; border:1.5px solid var(--lwb-line); border-radius:11px; background:var(--lwb-surface); cursor:pointer; text-align:left; font:inherit; transition:border-color .15s ease,background .15s ease; }
      .sv-tp-cand:hover { border-color:var(--sv-accent-line); }
      .sv-tp-cand[data-sel="true"] { border-color:var(--sv-accent); background:var(--sv-accent-soft); }
      .sv-tp-cand-head { display:flex; flex-wrap:wrap; align-items:flex-start; gap:7px 9px; }
      .sv-tp-cand-radio { flex:none; display:grid; place-items:center; width:16px; height:16px; margin-top:2px; border:1.5px solid #c3ccd6; border-radius:4px; background:var(--lwb-surface); }
      .sv-tp-cand[data-sel="true"] .sv-tp-cand-radio { border-color:var(--sv-accent); }
      .sv-tp-cand-radio i { width:7px; height:4px; border:solid transparent; border-width:0 0 2px 2px; transform:translateY(-1px) rotate(-45deg); }
      .sv-tp-cand[data-sel="true"] .sv-tp-cand-radio i { border-color:var(--sv-accent); }
      .sv-tp-cand-title { flex:1 1 200px; min-width:0; margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; }
      .sv-tp-rec { flex:none; padding:2px 8px; border:1px solid var(--sv-accent-line); border-radius:5px; background:var(--sv-accent-soft); color:var(--sv-accent-ink); font-size:var(--lwb-text-xs,12px); font-weight:800; }
      .sv-tp-cand-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-tp-cand-core { margin:0; color:#5b6572; font-size:var(--lwb-text-sm,13px); line-height:1.6; }
      .sv-tp-cand-why { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      .sv-tp-sumrow { display:grid; grid-template-columns:64px minmax(0,1fr); gap:8px; }
      .sv-tp-sumrow > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-tp-sumrow > p { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-sm,13px); line-height:1.65; }
      .sv-tp-sumgrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .sv-tp-sumgrid > div { display:grid; gap:2px; padding:9px 12px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); }
      .sv-tp-sumgrid strong { color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); }
      .sv-tp-sumgrid strong[data-tone="brand"] { color:#c2410c; }
      .sv-tp-sumgrid span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-tp-drawer-foot { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between; gap:10px; margin:14px -22px -22px; padding:13px 22px; border-top:1px solid var(--lwb-line); background:var(--lwb-surface); }
      .sv-sig-check { flex:none; display:grid; place-items:center; width:17px; height:17px; margin-top:2px; padding:0; border:1.5px solid var(--sv-orange); border-radius:5px; background:var(--sv-orange); cursor:pointer; }
      .sv-sig-check[data-on="false"] { border-color:#c3ccd6; background:var(--lwb-surface); }
      .sv-sig-check-tick { display:block; width:8px; height:4px; border:2px solid #fff; border-top:0; border-right:0; transform:rotate(-45deg) translate(1px,-1px); }
      .sv-signal-card[data-excluded="true"] { opacity:.55; }
      .sv-sig-excluded-tag { color:#7a5b17; background:#fff3e2; }
      .sv-drawer-selhint { margin:0 0 10px; padding:8px 11px; border:1px solid #f3d7b0; border-radius:8px; background:#fff9f0; color:#9a5a10; font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      body[data-ds-dark-theme] .sv-tp-src[data-on="true"] { background:rgba(249,115,22,.14); }
      body[data-ds-dark-theme] .sv-tp-task[data-status="queued"] { border-color:rgba(96,165,250,.35); background:rgba(96,165,250,.08); }
      body[data-ds-dark-theme] .sv-tp-task[data-confirmed="true"] { border-color:rgba(16,185,129,.4); background:rgba(16,185,129,.08); }
      body[data-ds-dark-theme] .sv-tp-confirmed { border-color:rgba(16,185,129,.3); }
      body[data-ds-dark-theme] .sv-tp-confirmed-meta { color:#6ee7b7; }
      body[data-ds-dark-theme] .sv-tp-step[data-state="done"] { background:rgba(16,185,129,.14); color:#6ee7b7; }
      body[data-ds-dark-theme] .sv-tp-exclbar,body[data-ds-dark-theme] .sv-drawer-selhint { border-color:rgba(249,115,22,.3); background:rgba(249,115,22,.1); color:#fdba74; }
      /* ---- 写稿页专属：选题卡状态徽章/打开稿件 + 篇幅分段 + 稿件抽屉（编辑·润色·质检·确认仪式）---- */
      .sv-sc-state { flex:none; padding:1px 8px; border-radius:999px; border:1px solid var(--lwb-line); background:var(--lwb-page); color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); font-weight:700; white-space:nowrap; }
      .sv-sc-state[data-state="draft"] { border-color:#f3d7b0; background:#fff7ed; color:#c2410c; }
      .sv-sc-state[data-state="approved"] { border-color:#bfe3cf; background:#eaf8f1; color:#16865f; }
      .sv-sc-archived { flex:none; padding:1px 7px; border-radius:999px; background:#f3f4f6; color:#9ca3af; font-size:var(--lwb-text-xs,12px); font-weight:700; }
      .sv-sc-seg { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
      .sv-sc-seg button { display:grid; gap:1px; padding:7px 6px; border:1px solid var(--lwb-line); border-radius:9px; background:var(--lwb-surface); cursor:pointer; font:inherit; text-align:center; transition:border-color .15s ease,background .15s ease; }
      .sv-sc-seg button strong { color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); font-weight:700; }
      .sv-sc-seg button span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-sc-seg button:hover:not(:disabled) { border-color:var(--sv-accent-line); }
      .sv-sc-seg button:disabled { cursor:default; opacity:.55; }
      .sv-sc-seg button[data-on="true"] { border-color:var(--sv-accent); background:var(--sv-accent-soft); }
      .sv-sc-seg button[data-on="true"] strong { color:var(--sv-accent-ink); }
      .sv-sc-more { display:block; width:100%; padding:7px; border:1px dashed var(--sv-accent-line); border-radius:9px; background:none; color:var(--sv-accent-ink); cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-sc-more:hover { background:var(--sv-accent-soft); }
      .sv-sc-open { flex:none; padding:2px 9px; border:1px solid var(--sv-accent-line); border-radius:6px; background:var(--lwb-surface); color:var(--sv-accent-ink); cursor:pointer; font:inherit; font-size:var(--lwb-text-xs,12px); font-weight:700; }
      .sv-sc-open:hover { background:var(--sv-accent-soft); }
      /* 稿件抽屉：承载「AI 稿件 → 编辑 → 润色 → 质检 → 确认」整条生命线，故加宽 */
      .sv-drawer-wide { width:min(860px,100vw); }
      .sv-sc-drawer-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
      .sv-sc-drawer-title { display:grid; min-width:0; gap:5px; }
      .sv-sc-drawer-titleline { display:flex; flex-wrap:wrap; width:100%; min-width:0; align-items:center; gap:8px; }
      .sv-sc-drawer-titleline h3 { min-width:0; flex:1 1 auto; overflow:hidden; margin:0; font-size:var(--lwb-text-section,18px); text-overflow:ellipsis; white-space:nowrap; }
      .sv-sc-drawer-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-sc-drawer-tools { display:flex; flex:none; flex-wrap:wrap; justify-content:flex-end; gap:5px; }
      .sv-sc-drawer-tool { min-height:28px; padding:0 8px; border:1px solid var(--lwb-line); border-radius:6px; background:var(--lwb-surface); color:var(--lwb-muted); cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-sc-drawer-tool[data-tone="context"] { border-color:#bfdbfe; color:#1d4ed8; background:#eff6ff; }
      .sv-sc-drawer-tool[data-tone="ai"] { border-color:#ddd6fe; color:#6d28d9; background:#f5f3ff; }
      .sv-sc-drawer-tool[data-tone="quality"] { border-color:#fde68a; color:#a16207; background:#fffbeb; }
      .sv-sc-drawer-tool:hover:not(:disabled),.sv-sc-drawer-tool[data-active="true"] { filter:brightness(.97); box-shadow:0 1px 2px rgba(15,23,42,.08); }
      .sv-sc-drawer-tool:disabled { cursor:default; opacity:.55; }
      .sv-sc-drawer-body { display:grid; gap:18px; padding:18px 1px 28px; }
      .sv-sc-manuscript { max-width:720px; margin:0 auto; color:var(--lwb-ink); font-size:var(--lwb-text-lg,16px); line-height:1.9; white-space:pre-wrap; word-break:break-word; }
      .sv-sc-manuscript[data-candidate="true"] { color:#354254; }
      .sv-sc-empty-manuscript { display:grid; justify-items:center; gap:8px; max-width:560px; margin:54px auto; color:var(--lwb-muted); text-align:center; }
      .sv-sc-view-head { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:8px; padding-bottom:10px; border-bottom:1px solid var(--lwb-line); }
      .sv-sc-view-head h4 { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); }
      .sv-sc-view-head p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-sc-context-list { display:grid; gap:8px; }
      .sv-sc-context-item { display:grid; gap:4px; padding:12px 0; border-bottom:1px solid var(--lwb-line); }
      .sv-sc-context-item:last-child { border-bottom:0; }
      .sv-sc-context-item p { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); line-height:1.7; white-space:pre-wrap; word-break:break-word; }
      .sv-sc-context-item span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-brief { display:grid; gap:12px; max-width:720px; }
      .sv-sc-brief-row { display:grid; grid-template-columns:96px minmax(0,1fr); gap:14px; padding:11px 0; border-bottom:1px solid var(--lwb-line); }
      .sv-sc-brief-row span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-brief-row p { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); line-height:1.7; white-space:pre-wrap; word-break:break-word; }
      .sv-sc-candidate-meta { display:flex; flex-wrap:wrap; gap:6px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-fact-check { display:grid; gap:7px; max-width:720px; padding:12px 14px; border:1px solid #ecd39b; border-radius:8px; background:#fffaf0; }
      .sv-sc-fact-check strong { color:#9a6700; font-size:var(--lwb-text-base,14px); }
      .sv-sc-fact-check ul { display:grid; gap:4px; margin:0; padding-left:18px; color:#7a5b17; font-size:var(--lwb-text-base,14px); line-height:1.55; }
      .sv-sc-editor-label { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:8px; }
      .sv-sc-editor-label strong { color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); }
      .sv-sc-editor-label span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-editor { display:grid; gap:10px; min-width:0; }
      .sv-sc-editor .sv-textarea { min-height:420px; overflow:hidden; resize:none; font-size:var(--lwb-text-lg,16px); line-height:1.9; }
      .sv-sc-ai-actions { display:grid; gap:14px; max-width:720px; }
      .sv-sc-ai-action { display:grid; gap:9px; padding:0 0 14px; border-bottom:1px solid var(--lwb-line); }
      .sv-sc-ai-action:last-child { padding-bottom:0; border-bottom:0; }
      .sv-sc-ai-action-head { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:8px; }
      .sv-sc-ai-action-head strong { color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); }
      .sv-sc-ai-action-head span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-run-status { display:grid; gap:9px; max-width:720px; padding:12px 14px; border:1px solid var(--sv-accent-line); border-radius:9px; background:var(--sv-accent-soft); }
      .sv-sc-run-status[data-current="false"] { border-color:#f3d7b0; background:#fff9f0; }
      .sv-sc-run-status .sv-note { padding:0; border:0; color:var(--lwb-muted); background:transparent; }
      .sv-sc-auto-quality { display:grid; gap:7px; max-width:720px; }
      .sv-sc-auto-quality > p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.6; }
      .sv-sc-polish { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
      .sv-sc-polish > .sv-sc-polish-label { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-sc-tiermini { display:flex; gap:4px; }
      .sv-sc-tiermini button { padding:3px 10px; border:1px solid var(--lwb-line); border-radius:6px; background:var(--lwb-surface); color:var(--lwb-muted); cursor:pointer; font:inherit; font-size:var(--lwb-text-sm,13px); }
      .sv-sc-tiermini button[data-on="true"] { border-color:var(--sv-accent); background:var(--sv-accent-soft); color:var(--sv-accent-ink); font-weight:700; }
      .sv-sc-polish input { flex:1 1 140px; min-width:120px; height:28px; padding:0 9px; border:1px solid var(--lwb-line); border-radius:6px; color:var(--lwb-ink); background:var(--lwb-surface); font:inherit; font-size:var(--lwb-text-sm,13px); }
      .sv-sc-polish-actions { display:flex; gap:7px; margin-left:auto; }
      .sv-sc-report { display:grid; gap:8px; max-width:720px; padding:12px 14px; border-radius:10px; background:var(--lwb-page); }
      .sv-sc-report-empty { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.6; }
      .sv-sc-ritual { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; flex:1; padding:9px 13px; border:1px solid #bfe3cf; border-radius:10px; background:#f6fcf8; }
      .sv-sc-ritual-info { display:grid; gap:2px; min-width:0; }
      .sv-sc-ritual-info strong { color:#16865f; font-size:var(--lwb-text-base,14px); }
      .sv-sc-ritual-info span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); }
      .sv-sc-gate-note { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      /* 稿件辅助信息不再替换正文，而是显示在独立弹窗中。 */
      .sv-sc-modal-backdrop { position:fixed; z-index:44; inset:0; display:grid; place-items:center; padding:24px; background:rgba(27,39,53,.32); }
      .sv-sc-modal { display:flex; flex-direction:column; width:min(720px,100%); max-height:min(780px,calc(100vh - 48px)); overflow:hidden; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); box-shadow:0 18px 50px rgba(20,34,49,.22); }
      .sv-sc-modal-head { display:flex; flex:none; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 20px 14px; border-bottom:1px solid var(--lwb-line); }
      .sv-sc-modal-title { display:grid; min-width:0; gap:4px; }
      .sv-sc-modal-title h4 { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-section,18px); }
      .sv-sc-modal-title p { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.55; }
      .sv-sc-modal-scroll { min-height:0; overflow:auto; padding:18px 20px 22px; }
      .sv-sc-modal-foot { display:flex; flex:none; flex-wrap:wrap; justify-content:flex-end; gap:8px; padding:13px 20px; border-top:1px solid var(--lwb-line); background:var(--lwb-page); }
      .sv-sc-modal-section { display:grid; gap:9px; }
      .sv-sc-modal-section + .sv-sc-modal-section { margin-top:20px; padding-top:18px; border-top:1px solid var(--lwb-line); }
      .sv-sc-modal-section h5 { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); }
      .sv-sc-modal-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .sv-sc-modal-fact { display:grid; gap:4px; min-width:0; padding:11px 12px; border:1px solid var(--lwb-line); border-radius:8px; background:var(--lwb-page); }
      .sv-sc-modal-fact span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-sc-modal-fact p { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); line-height:1.65; white-space:pre-wrap; word-break:break-word; }
      .sv-sc-modal-form { display:grid; gap:13px; }
      .sv-sc-modal-form label { display:grid; gap:6px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-sc-modal-form .sv-textarea { min-height:88px; resize:vertical; }
      .sv-sc-modal-note { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.65; }
      .sv-sc-candidate-copy { margin:0 0 12px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.65; }
      .sv-sc-modal .sv-sc-manuscript { max-width:100%; font-size:var(--lwb-text-md,15px); line-height:1.8; }
      body[data-ds-dark-theme] .sv-sc-drawer-tool[data-tone="context"] { border-color:rgba(96,165,250,.45); color:#93c5fd; background:rgba(59,130,246,.14); }
      body[data-ds-dark-theme] .sv-sc-drawer-tool[data-tone="ai"] { border-color:rgba(196,181,253,.45); color:#c4b5fd; background:rgba(124,58,237,.16); }
      body[data-ds-dark-theme] .sv-sc-drawer-tool[data-tone="quality"] { border-color:rgba(252,211,77,.42); color:#fcd34d; background:rgba(245,158,11,.12); }
      body[data-ds-dark-theme] .sv-sc-modal-foot,body[data-ds-dark-theme] .sv-sc-modal-fact { background:rgba(255,255,255,.03); }
      /* 确认闸门是写稿页唯一的绿色放行动作，与紫色生成动作明确区分 */
      .lwb-primary-button.sv-sc-approve { border-color:#16865f; background:#16865f; color:#fff; }
      .lwb-primary-button.sv-sc-approve:hover:not(:disabled) { background:#12764f; }
      body[data-ds-dark-theme] .lwb-primary-button.sv-sc-approve { background:#16865f; border-color:#16865f; }
      body[data-ds-dark-theme] .sv-sc-state[data-state="draft"] { border-color:rgba(249,115,22,.35); background:rgba(249,115,22,.14); color:#fdba74; }
      body[data-ds-dark-theme] .sv-sc-state[data-state="approved"] { border-color:rgba(16,185,129,.4); background:rgba(16,185,129,.14); color:#6ee7b7; }
      body[data-ds-dark-theme] .sv-sc-archived { background:#22313f; color:#8a94a6; }
      body[data-ds-dark-theme] .sv-sc-report { background:rgba(255,255,255,.03); }
      body[data-ds-dark-theme] .sv-sc-run-status[data-current="false"] { border-color:rgba(236,179,63,.35); background:rgba(236,179,63,.1); }
      body[data-ds-dark-theme] .sv-sc-ritual { border-color:rgba(16,185,129,.35); background:rgba(16,185,129,.08); }
      body[data-ds-dark-theme] .sv-sc-ritual-info strong { color:#6ee7b7; }
      body[data-ds-dark-theme] .sv-sc-fact-check { border-color:rgba(236,179,63,.35); background:rgba(236,179,63,.1); }
      body[data-ds-dark-theme] .sv-sc-fact-check strong { color:#fcd34d; }
      body[data-ds-dark-theme] .sv-sc-fact-check ul { color:#f5d99e; }
      /* ---- 发布页专属：视频货架卡片 + 封面预览/上传/提示词 + 发布资料表单（accent 红，复用 sv-tp-* 任务套件与 sv-sc-state 徽章）---- */
      .sv-pb-covers { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .sv-pb-cover { display:grid; gap:8px; padding:12px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-page); }
      .sv-pb-cover-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
      .sv-pb-cover-head strong { color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); }
      .sv-pb-cover-head span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-pb-cover-frame { display:grid; place-items:center; min-height:120px; overflow:hidden; border:1px dashed var(--lwb-line); border-radius:8px; background:var(--lwb-surface); }
      .sv-pb-cover-frame img { display:block; max-width:100%; max-height:240px; object-fit:contain; }
      .sv-pb-cover-empty { padding:22px 10px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); text-align:center; }
      .sv-pb-cover-error { margin:0; padding:7px 9px; border:1px solid #eec9c9; border-radius:7px; background:#fffafa; color:#a94343; font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-pb-cover-acts { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
      .sv-pb-cover-acts .sv-meta { flex:1 1 120px; margin:0; }
      .sv-pb-form { display:grid; gap:13px; max-width:720px; }
      .sv-pb-field { display:grid; gap:6px; }
      .sv-pb-field > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-pb-field-note { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .sv-pb-tags { display:flex; flex-wrap:wrap; gap:5px; }
      .sv-pb-tag { display:inline-flex; align-items:center; padding:2px 9px; border:1px solid var(--sv-accent-line); border-radius:999px; background:var(--sv-accent-soft); color:var(--sv-accent-ink); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-pb-prompt { display:grid; gap:6px; }
      .sv-pb-prompt > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); font-weight:700; }
      .sv-pb-prompt .sv-textarea { min-height:64px; font-size:var(--lwb-text-sm,13px); }
      .sv-pb-shelf { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
      .sv-pb-card { display:grid; gap:10px; padding:12px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      .sv-pb-thumb { position:relative; display:grid; place-items:center; min-height:150px; overflow:hidden; border:1px solid var(--lwb-line); border-radius:8px; background:#0e1a2b; }
      .sv-pb-thumb img { display:block; width:100%; height:100%; max-height:220px; object-fit:cover; }
      .sv-pb-thumb video { display:block; width:100%; max-height:340px; }
      .sv-pb-thumb-empty { padding:30px 12px; color:#8a94a6; font-size:var(--lwb-text-sm,13px); text-align:center; }
      .sv-pb-play { position:absolute; display:grid; place-items:center; width:46px; height:46px; border:0; border-radius:50%; background:rgba(255,255,255,.88); cursor:pointer; }
      .sv-pb-play::after { content:''; margin-left:3px; border-left:14px solid #1f2937; border-top:9px solid transparent; border-bottom:9px solid transparent; }
      .sv-pb-play:hover:not(:disabled) { background:#fff; }
      .sv-pb-play:disabled { opacity:.55; cursor:default; }
      .sv-pb-card-head { display:flex; min-width:0; align-items:flex-start; justify-content:space-between; gap:8px; }
      .sv-pb-card-title { overflow:hidden; margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); font-weight:700; line-height:1.5; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      .sv-pb-card-meta { margin:0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      .sv-pb-card-foot { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
      body[data-ds-dark-theme] .sv-pb-cover { border-color:var(--lwb-line); background:rgba(255,255,255,.03); }
      body[data-ds-dark-theme] .sv-pb-cover-frame { border-color:rgba(255,255,255,.14); }
      body[data-ds-dark-theme] .sv-pb-cover-error { border-color:rgba(229,72,77,.4); background:rgba(229,72,77,.12); color:#fda4a4; }
      body[data-ds-dark-theme] .sv-pb-tag { border-color:rgba(var(--sv-accent-rgb),.45); background:rgba(var(--sv-accent-rgb),.16); }
      .sv-pb-drawer { width:min(1040px,100vw); padding:0; display:flex; flex-direction:column; overflow:hidden; }
      .sv-pb-drawer .sv-drawer-head { margin:0; padding:24px 28px 20px; background:linear-gradient(120deg,var(--sv-accent-soft),var(--lwb-surface) 75%); border-bottom:1px solid var(--lwb-line); }
      .sv-pb-drawer .sv-drawer-scroll { flex:1; min-height:0; padding:24px; background:var(--lwb-page); }
      .sv-pb-drawer .sv-sc-drawer-body { display:grid; gap:20px; padding:0; }
      .sv-pb-drawer .sv-pb-section { min-width:0; padding:22px; border:1px solid var(--lwb-line); border-radius:14px; background:var(--lwb-surface); box-shadow:var(--sv-shadow-sm); }
      .sv-pb-drawer .sv-pb-form { max-width:none; gap:16px; }
      .sv-pb-drawer .sv-tp-drawer-foot { flex:none; margin:0; padding:16px 24px; background:var(--lwb-surface); border-top:1px solid var(--lwb-line); }
      .sv-pb-section-number { margin:0 0 10px; color:var(--sv-accent-ink); font-size:11px; font-weight:750; letter-spacing:.08em; }
      .sv-pb-section-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
      .sv-pb-section-heading h4 { margin:0; font-size:18px; }
      .sv-pb-section-heading p:not(.sv-pb-section-number) { margin:6px 0 0; color:var(--lwb-muted); font-size:12px; }
      .sv-pb-final .sv-pb-thumb { height:280px; }
      .sv-pb-final .sv-pb-thumb img { object-fit:contain; max-height:280px; }
      .sv-pb-drawer .sv-pb-cover { padding:16px; gap:12px; align-content:start; }
      .sv-pb-drawer .sv-pb-cover-head { align-items:flex-start; flex-direction:column; gap:5px; }
      .sv-pb-drawer .sv-pb-cover-frame { height:230px; border-style:solid; background:var(--lwb-page); }
      .sv-pb-drawer .sv-pb-cover-frame img { max-height:228px; }
      .sv-pb-download { display:grid; gap:6px; justify-items:start; flex:none; }
      .sv-pb-player { position:fixed; inset:0; width:100vw; height:100dvh; max-width:none; max-height:none; margin:0; border:0; padding:24px; background:transparent; color:var(--lwb-ink); }
      .sv-pb-player[open] { display:grid; place-items:center; }
      .sv-pb-player::backdrop { background:rgba(8,14,26,.76); backdrop-filter:blur(6px); }
      .sv-pb-player-panel { width:min(1080px,100%); max-height:calc(100dvh - 48px); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--lwb-line); border-radius:18px; background:var(--lwb-surface); box-shadow:0 24px 90px #0006; }
      .sv-pb-player header,.sv-pb-player footer { display:flex; flex:none; justify-content:space-between; align-items:center; gap:20px; padding:18px 22px; }
      .sv-pb-player header p { margin:0 0 6px; color:var(--lwb-muted); font-size:11px; }
      .sv-pb-player h3 { margin:0; font-size:18px; line-height:1.5; overflow-wrap:anywhere; }
      .sv-pb-player footer { font-size:12px; color:var(--lwb-muted); }
      .sv-pb-player-stage { min-height:150px; min-width:0; overflow:auto; background:#080f1c; display:grid; place-items:center; color:#d0d7e4; }
      .sv-pb-player-stage > p { padding:30px; }
      .sv-pb-player video { display:block; width:100%; max-height:calc(100dvh - 210px); }
      .sv-as-history { display:grid; gap:16px; }
      .sv-as-history-filters { display:grid; grid-template-columns:minmax(180px,1fr) 140px 145px; gap:8px; }
      .sv-as-history-drawer { width:min(1000px,100vw); display:flex; flex-direction:column; overflow:hidden; }
      .sv-as-history-drawer .sv-drawer-scroll { min-height:0; flex:1; padding:2px 4px 12px; }
      .sv-as-history-drawer .sv-as-history-filters { position:sticky; top:0; z-index:1; padding:8px 0; background:var(--lwb-surface); }
      .sv-as-history-drawer .sv-audio-pagebar { position:sticky; bottom:-12px; z-index:1; margin:0; padding:12px 0; background:var(--lwb-surface); border-top:1px solid var(--lwb-line); }
      .sv-as-history-drawer h3 { margin:0; font-size:21px; }
      .sv-as-round { min-width:0; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); overflow:hidden; }
      .sv-as-round-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:17px 18px 10px; }
      .sv-as-round-toggle { display:grid; gap:7px; min-width:0; padding:0; border:0; background:none; color:var(--lwb-ink); text-align:left; font:inherit; cursor:pointer; }
      .sv-as-round-toggle strong { font-size:14px; overflow-wrap:anywhere; }
      .sv-as-round-toggle span,.sv-as-round-message { color:var(--lwb-muted); font-size:12px; line-height:1.7; }
      .sv-as-round-toggle small { color:var(--sv-accent-ink); font-size:12px; }
      .sv-as-round-message { margin:0; padding:0 18px 12px; }
      .sv-as-round-items { display:grid; gap:10px; padding:4px 18px 18px; }
      .sv-as-result { display:grid; grid-template-columns:150px minmax(0,1fr); gap:15px; align-items:center; padding:10px; border:1px solid var(--lwb-line); border-radius:9px; }
      .sv-as-result .sv-pb-thumb { min-height:84px; height:84px; }
      .sv-as-result .sv-pb-thumb img { object-fit:contain; max-height:84px; }
      .sv-as-result .sv-pb-thumb-empty { padding:12px; font-size:12px; }
      .sv-as-result .sv-pb-play { width:32px; height:32px; }
      .sv-as-result .sv-pb-play::after { border-left-width:10px; border-top-width:6px; border-bottom-width:6px; }
      .sv-as-result-info { display:grid; gap:7px; justify-items:start; min-width:0; }
      .sv-as-result-info strong { font-size:14px; line-height:1.6; overflow-wrap:anywhere; }
      .sv-as-result-info span { font-size:12px; color:var(--lwb-muted); }
      .sv-as-round-detail { display:grid; gap:14px; padding:20px 18px; border-top:1px solid var(--lwb-line); background:var(--lwb-page); }
      .sv-as-page-size { width:auto; }
      .sv-ex-state[data-status="partial"] { background:#fff4da; color:#a5680b; }
      body[data-ds-dark-theme] .sv-ex-state[data-status="partial"] { background:#493819; color:#ffd383; }
      @media(max-width:680px) { .sv-as-history-filters { grid-template-columns:1fr 1fr; } .sv-as-history-filters input { grid-column:1/-1; } .sv-as-result { grid-template-columns:100px minmax(0,1fr); gap:10px; } .sv-pb-drawer .sv-drawer-head,.sv-pb-drawer .sv-drawer-scroll { padding:16px; } .sv-pb-drawer .sv-pb-section { padding:16px; } .sv-pb-player { padding:10px; } .sv-pb-player-panel { max-height:calc(100dvh - 20px); } .sv-pb-section-heading { align-items:flex-start; flex-wrap:wrap; } }
      @media (max-width:680px) { .sv-pb-covers { grid-template-columns:1fr; } .sv-pb-shelf { grid-template-columns:1fr; } }
      @media (max-width:680px) { .sv-sc-drawer-head { display:grid; } .sv-sc-drawer-tools { justify-content:flex-start; } .sv-drawer-wide { width:100vw; padding-top:58px; } .sv-sc-brief-row { grid-template-columns:1fr; gap:4px; } .sv-sc-editor .sv-textarea { min-height:320px; } .sv-sc-modal-backdrop { align-items:start; padding:58px 12px 16px; } .sv-sc-modal { width:100%; max-height:calc(100vh - 74px); } .sv-sc-modal-head,.sv-sc-modal-scroll,.sv-sc-modal-foot { padding-left:14px; padding-right:14px; } .sv-sc-modal-grid { grid-template-columns:1fr; } }

      .lwb-page-capability:has(.sv-page) > .lwb-page-intro { display:none; }
      /* Type follows the workbench scale; shrink columns to the actual content width. */
      body[data-ds-dark-theme] .sv-page { --sv-brand:#a5b4fc; }
      body[data-ds-dark-theme] .sv-primary-mini,body[data-ds-dark-theme] .sv-filter-chip[data-on="true"] { background:#4f46e5; }
      body[data-ds-dark-theme] .sv-heromini-cell strong[data-tone="red"] { color:#fca5a5; }
      body[data-ds-dark-theme] .sv-heromini-cell strong[data-tone="orange"] { color:#fdba74; }
      .sv-page { font-size:var(--lwb-text-base,14px); line-height:1.55; container-type:inline-size; }
      .sv-layout > *,.sv-split > *,.sv-top > *,.sv-item-head > * { min-width:0; }
      .sv-input,.sv-select,.sv-drawer-search { min-height:40px; }
      .sv-tabs,.sv-tp-acctabs { max-width:100%; overflow-x:auto; }
      .sv-tab { flex:none; }
      .sv-drawer-head > :first-child { min-width:0; overflow-wrap:anywhere; }
      .sv-drawer-head > button { flex:none; }
      .sv-top-actions { flex-wrap:wrap; }
      .sv-stat,.sv-cmd-stat { min-width:0; }
      .sv-page :is(button,a,summary):focus-visible { outline:2px solid var(--lwb-blue); outline-offset:3px; }
      .sv-sc-manuscript,.sv-sc-modal .sv-sc-manuscript { font-size:var(--lwb-text-lg,16px); }
      @container (max-width:850px) {
        .sv-layout,.sv-split,.sv-dashboard,.sv-audio-workbench { grid-template-columns:minmax(0,1fr); }
        .sv-video-workbench { grid-template-columns:minmax(0,1fr); grid-template-areas:'sources' 'tasks'; }
        .sv-insight-panel { position:static; }
      }
      @container (max-width:480px) {
        .sv-board-grid,.sv-source-grid,.sv-source-compact-grid,.sv-acc-grid,.sv-pb-shelf { grid-template-columns:minmax(0,1fr); }
        .sv-inline-form,.sv-media-config-grid,.sv-audio-parameters { grid-template-columns:minmax(0,1fr); }
        .sv-top-actions { width:100%; }
      }
      @media (max-width:680px) {
        .sv-drawer { z-index:91; padding:18px 16px; }
        .sv-pb-drawer { padding:0; }
        .sv-pb-drawer,.sv-as-history-drawer { max-width:100%; }
        .sv-pb-drawer .sv-sc-drawer-head { display:flex; align-items:flex-start; }
        .sv-pb-drawer .sv-sc-drawer-tools { flex:none; }
        .sv-tp-drawer-foot { flex-wrap:wrap; margin:14px -16px -18px; padding:13px 16px; }
        .sv-tp-drawer-foot > span { flex-wrap:wrap; max-width:100%; }
        .sv-drawer-backdrop { z-index:90; }
        .sv-confirm-backdrop,.sv-sc-modal-backdrop { z-index:95; }
        .sv-input,.sv-textarea,.sv-select,.sv-drawer-search { font-size:16px; }
        .sv-tp-srcgrid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @media (prefers-reduced-motion:reduce) { .sv-page * { animation:none !important; transition:none !important; } }
    `;
    function installStyle() {
      const existing = document.getElementById('lwb-spoken-video-style');
      // A pack can be reloaded in place by the workbench. Replace old rules so
      // updated page layouts do not remain pinned to the earlier bundle's CSS.
      if (existing) { existing.setAttribute('data-plugin', '@scitiger-ai/lwb-spoken-video'); existing.textContent = productCss; return; }
      const style = document.createElement('style');
      style.id = 'lwb-spoken-video-style';
      style.setAttribute('data-plugin', '@scitiger-ai/lwb-spoken-video');
      style.textContent = productCss;
      document.head.appendChild(style);
    }
    function actionKey(prefix) { return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    function sourceName(id) { return SOURCES[id] || id || '未知来源'; }
    function sourceLabel(sources, id) { return sources.find((source) => source.id === id)?.name || sourceName(id); }
    function csv(value) { return String(value || '').split(/[，,]/u).map((item) => item.trim()).filter(Boolean); }
    function sourceStatus(source) { if (!source.enabled) return ['已停用', 'sv-status-disabled']; if (source.health?.status === 'ready') return ['正常', '']; if (source.health?.status === 'error') return ['异常', 'sv-status-error']; return ['未采集', '']; }
    function sourceActivity(source) { return `最近成功 ${formatTime(source.health?.lastSuccessAt)} · ${source.signalCount} 条`; }
    function stageName(project) { return LABEL[project.stage] || project.stage; }
    function stageData(detail, stage) { return detail?.artifacts?.[stage]?.data; }
    function done(detail, stage) { return Boolean(detail?.artifacts?.[stage]); }
    function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未执行'; }
    const FAMILY_ORDER = ['公共热点', '内容平台', '科技与商业', '开发者社区', 'AI / 开源'];
    const FRESH_LABEL = { fresh: '新鲜', recent: '较新', stale: '过期', none: '今日暂无数据' };
    function formatHot(value) { if (!value) return ''; if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`; if (value >= 10000) return `${(value / 10000).toFixed(1)}万`; return String(value); }
    function relativeTime(value) {
      if (!value) return '尚未采集';
      const diff = Date.now() - Date.parse(value);
      if (!Number.isFinite(diff) || diff < 0) return formatTime(value);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes} 分钟前`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} 小时前`;
      return `${Math.floor(hours / 24)} 天前`;
    }
    const AVATAR_HUES = [258, 210, 152, 16, 288, 330, 190, 42, 124, 268];
    function accountAvatar(name) {
      const chars = Array.from(String(name || '账'));
      const letter = chars[0] || '账';
      const hash = String(name || '').split('').reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 7);
      return { letter, background: `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]}, 62%, 47%)` };
    }
    async function remote(packId, method, request) {
      if (packId !== 'spoken-video' || !connection?.rpc?.call) throw new Error('能力包连接尚未就绪。');
      const response = await connection.rpc.call('/api', `spokenVideo/${method}`, { args: request === undefined ? {} : { request } });
      if (!response?.ok) throw new Error(response?.error?.message || '口播视频操作未完成。');
      return response.value;
    }
    async function remoteStatic(method, request) {
      if (!connection?.rpc?.call) throw new Error('工作台连接不可用。');
      const response = await connection.rpc.call('/api', `spokenVideo/${method}`, { args: request === undefined ? {} : { request } });
      if (!response?.ok) throw new Error(response?.error?.message || '口播视频操作未完成。');
      return response.value;
    }
    async function base64FromAudioFile(file) {
      if (!file || typeof FileReader !== 'function') throw new Error('当前浏览器无法读取所选音频。');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('无法读取所选音频。'));
        reader.onabort = () => reject(new Error('音频读取已取消。'));
        reader.onload = () => {
          const encoded = typeof reader.result === 'string' ? reader.result : '';
          const separator = encoded.indexOf(',');
          const header = separator < 0 ? '' : encoded.slice(0, separator);
          if (!header.startsWith('data:') || !/;base64$/iu.test(header)) { reject(new Error('浏览器未能读取音频。')); return; }
          resolve(encoded.slice(separator + 1));
        };
        reader.readAsDataURL(file);
      });
    }
    const MODULE_CONTEXT = {
      '账号定位': ['内容策略', '#8b5cf6'],
      '信号': ['内容情报', '#3b82f6'],
      '选题': ['创作策划', '#f97316'],
      '写稿': ['内容生产', '#7c3aed'],
      '配音 / 字幕': ['音频与字幕', '#ec4899'],
      '视频 / 预览': ['视频制作', '#10b981'],
      '发布': ['发布资料', '#ef4444'],
      '内容安排': ['运营安排', '#0ea5e9'],
    };
    function Intro({ title, copy, actions }) {
      const ctx = MODULE_CONTEXT[title];
      return h('header', { className: 'sv-top' },
        h('div', null,
          ctx && h('p', { className: 'sv-module-kicker' }, h('span', { className: 'sv-module-dot', style: { background: ctx[1] } }), ctx[0]),
          h('h1', null, title),
          h('p', null, copy),
          ),
        actions ? h('div', { className: 'sv-top-actions' }, actions) : null,
      );
    }
    function Notice({ error }) { return error ? h('p', { className: 'sv-error', role: 'alert' }, error) : null; }
    /* 应用内确认对话框：复用宿主 lwb 对话框视觉体系（modal 遮罩 / 卡片 / 三类按钮），层级高于 sv-drawer。 */
    function useSvConfirm() {
      const [meta, setMeta] = React.useState(null);
      React.useEffect(() => {
        if (!meta) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setMeta(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [meta]);
      const node = meta && h('div', { className: 'sv-confirm-backdrop', role: 'presentation', onClick: () => setMeta(null) },
        h('div', { className: 'lwb-card lwb-pack-detail sv-confirm-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': meta.title, onClick: (event) => event.stopPropagation() },
          h('div', { className: 'lwb-pack-detail-head' },
            h('div', null, h('h2', { className: 'lwb-modal-title' }, meta.title), meta.copy ? h('p', { className: 'lwb-modal-copy' }, meta.copy) : null),
            h('button', { type: 'button', className: 'lwb-detail-close', title: '取消', 'aria-label': '取消', onClick: () => setMeta(null) }, '×'),
          ),
          h('div', { className: 'lwb-row-actions', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setMeta(null) }, '取消'),
            h('button', { type: 'button', className: meta.danger ? 'lwb-danger-button' : 'lwb-primary-button', onClick: () => { const action = meta.onConfirm; setMeta(null); action(); } }, meta.confirm || '确认'),
          ),
        ),
      );
      return [node, setMeta];
    }
    function NeedPack() { return h('section', { className: 'sv-form' }, h('p', null, '正在准备能力包工作区…')); }
    function useProjects(packId) {
      const [projects, setProjects] = React.useState([]); const [error, setError] = React.useState(null); const [loading, setLoading] = React.useState(false);
      const refresh = React.useCallback(async () => { if (!packId) { setProjects([]); return []; } setLoading(true); try { const next = await remote(packId, 'list'); setProjects(next); setError(null); return next; } catch (cause) { setError(cause.message); return []; } finally { setLoading(false); } }, [packId]);
      React.useEffect(() => { void refresh(); }, [refresh]); return { projects, error, setError, loading, refresh };
    }
    function useDetail(packId, projectId) {
      const [detail, setDetail] = React.useState(null); const [error, setError] = React.useState(null);
      const reload = React.useCallback(async (id = projectId) => { if (!packId || !id) { setDetail(null); return null; } try { const next = await remote(packId, 'get', { projectId: id }); setDetail(next); setError(null); return next; } catch (cause) { setError(cause.message); return null; } }, [packId, projectId]);
      React.useEffect(() => { void reload(); }, [reload]); return { detail, error, reload };
    }
    function StageDots({ project }) {
      return h('span', { className: 'sv-proj-dots', 'aria-label': `已完成 ${project.completedStages.length}/${STAGES.length} 阶段` }, STAGES.map((stage) => h('i', { key: stage, 'data-on': project.completedStages.includes(stage) ? (project.stage === stage ? 'true' : 'done') : project.stage === stage ? 'true' : undefined, title: LABEL[stage] })));
    }
    function ProjectList({ projects, selectedId, onSelect, empty }) {
      return projects.length ? h('div', { className: 'sv-list' }, projects.map((project) => h('button', { key: project.id, type: 'button', className: 'sv-item', 'data-active': selectedId === project.id ? 'true' : 'false', onClick: () => onSelect(project.id), style: { textAlign: 'left', cursor: 'pointer' } }, h('span', { className: 'sv-item-head' }, h('span', { className: 'sv-item-title' }, project.title), h('span', { className: 'sv-stage' }, stageName(project))), h(StageDots, { project }), h('span', { className: 'sv-meta' }, `版本 ${project.revision} · 已完成 ${project.completedStages.length}/${STAGES.length} 阶段`)))) : h('div', { className: 'sv-empty' }, empty);
    }
    function useCommit(packId, refreshProjects, reloadDetail, setError) {
      const [saving, setSaving] = React.useState(false);
      const commit = React.useCallback(async (detail, stage, payload) => { if (!detail) return null; setSaving(true); try { const result = await remote(packId, 'commit', { projectId: detail.id, expectedRevision: detail.revision, stage, payload, idempotencyKey: actionKey(stage) }); await refreshProjects(); await reloadDetail(result.project.id); setError(null); return result; } catch (cause) { setError(cause.message); return null; } finally { setSaving(false); } }, [packId, refreshProjects, reloadDetail, setError]);
      return { saving, commit };
    }
    function useSelectedProject(projects, condition = () => true) {
      const conditionRef = React.useRef(condition);
      conditionRef.current = condition;
      const projectIds = projects.map((project) => project.id).join('|');
      const [selectedId, setSelectedId] = React.useState(null);
      React.useEffect(() => {
        setSelectedId((current) => current && projects.some((project) => project.id === current)
          ? current
          : projects.find(conditionRef.current)?.id || null);
      }, [projectIds]);
      return [selectedId, setSelectedId];
    }

    const PLATFORM_GLYPHS = { '抖音': ['#171B26', '抖'], 'B站': ['#FB7299', 'B'], '公众号': ['#07C160', '公'], '小红书': ['#FF2442', '红'], '视频号': ['#FA9D3B', '视'], '微博': ['#E6162D', '微'], '知乎': ['#0084FF', '知'] };
    function glyphFor(item, fallbackName) {
      const platform = item?.platform || null;
      const known = platform && PLATFORM_GLYPHS[platform];
      if (known) return { color: known[0], letter: known[1], label: platform };
      const name = platform || fallbackName || '来源';
      return { color: '#3b82f6', letter: name.charAt(0), label: platform || name };
    }
    function SignalDrawerBody({ packId, sources, spec, today, busy, onClose, onCollect, onChanged, ask, selection }) {
      const [signals, setSignals] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [acting, setActing] = React.useState(null)
      const [filter, setFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      const reload = React.useCallback(async () => {
        try {
          const next = await remote(packId, 'listSignals', { sourceIds: [spec.sourceId], ...(spec.platform ? { platform: spec.platform } : {}), limit: 200 })
          setSignals(next)
          setLoadError(null)
        } catch (cause) { setLoadError(cause.message) }
      }, [packId, spec.sourceId, spec.platform])
      React.useEffect(() => { void reload() }, [reload])
      const source = sources.find((item) => item.id === spec.sourceId)
      const setState = async (item, state) => {
        setActing(item.id)
        try { await remote(packId, 'setSignalState', { signalId: item.id, state }); await reload(); onChanged() } catch (cause) { setLoadError(cause.message) } finally { setActing(null) }
      }
      const inToday = (item) => Boolean(today) && item.capturedAt >= today.startIso && item.capturedAt < today.endIso
      const [statusText, statusClass] = source ? sourceStatus(source) : ['—', 'sv-status-disabled']
      const all = signals || []
      const savedCount = all.filter((item) => item.state === 'saved').length
      const activeCount = all.filter((item) => item.state === 'active').length
      const excludedCount = selection ? all.filter((item) => selection.excluded.has(item.id)).length : 0
      const toggleSelect = selection && typeof selection.onToggle === 'function' ? selection.onToggle : null
      const matches = (item) => {
        if (filter === 'today' && !inToday(item)) return false
        if (filter === 'saved' && item.state !== 'saved') return false
        if (filter === 'ignored' && item.state !== 'ignored') return false
        if (filter === 'excluded' && (!selection || !selection.excluded.has(item.id))) return false
        const q = query.trim().toLowerCase()
        if (q && !`${item.title}\n${item.summary || ''}`.toLowerCase().includes(q)) return false
        return true
      }
      const filtered = all.filter(matches)
      const todayItems = filtered.filter(inToday)
      const earlierItems = filtered.filter((item) => !inToday(item))
      const rankTier = (rank) => (rank <= 1 ? 'top' : rank <= 3 ? 'hot' : undefined)
      const row = (item) => {
        const glyph = glyphFor(item, spec.name)
        const tags = (item.tags || []).filter((tag) => !/^\d+$/u.test(tag))
        const fresh = inToday(item)
        const excluded = selection ? selection.excluded.has(item.id) : false
        const checkbox = selection && item.state === 'active' ? h('button', { type: 'button', className: 'sv-sig-check', 'data-on': excluded ? 'false' : 'true', 'aria-pressed': !excluded, 'aria-label': excluded ? '本次参与' : '本次排除', onClick: () => { toggleSelect(item.id) } }, excluded ? null : h('span', { className: 'sv-sig-check-tick' })) : null
        return h('article', { key: item.id, className: 'sv-signal-card', 'data-excluded': selection && excluded ? 'true' : 'false' },
          h('div', { className: 'sv-sig-head' },
            checkbox,
            h('span', { className: 'sv-glyph', style: { background: glyph.color }, title: glyph.label }, glyph.letter),
            h('div', { className: 'sv-sig-titlebox' },
              h('p', { className: 'sv-sig-src' }, item.platform ? glyph.label : spec.name),
              h('h3', { className: 'sv-signal-title' }, item.title),
            ),
            selection && excluded && h('span', { className: 'sv-tag sv-sig-excluded-tag' }, '本次排除'),
            item.state !== 'active' && h('span', { className: `sv-tag ${item.state === 'saved' ? 'sv-status-ready' : 'sv-status-disabled'}` }, item.state === 'saved' ? '已收藏' : '已忽略'),
            item.rank ? h('span', { className: 'sv-rank', 'data-tier': rankTier(item.rank) }, `#${item.rank}`) : null,
          ),
          h('p', { className: 'sv-signal-summary' }, item.summary || '该来源未提供摘要。'),
          h('div', { className: 'sv-sig-metrics' },
            h('span', { className: 'sv-scorebar' }, h('i', { style: { '--sv-fill': `${Math.min(100, item.score || 0)}%` } }), h('strong', null, item.score)),
            item.hotValue ? h('span', { className: 'sv-hot' }, h('i', null), formatHot(item.hotValue)) : null,
            h('span', { className: fresh ? 'sv-new' : 'sv-meta' }, fresh ? h('i', null) : null, `${relativeTime(item.capturedAt)}${fresh ? ' · 今日新增' : ''}`),
            tags.length ? h('span', { className: 'sv-meta' }, tags.slice(0, 3).join(' · ')) : null,
          ),
          h('div', { className: 'sv-sig-acts' },
            h('span', { className: 'sv-sig-tools' },
              item.url && h('a', { href: item.url, target: '_blank', rel: 'noreferrer', className: 'sv-outline-mini' }, '原文'),
              item.state !== 'saved' && h('button', { type: 'button', className: 'sv-outline-mini', disabled: Boolean(acting), onClick: () => { void setState(item, 'saved') } }, '收藏'),
              item.state !== 'ignored' && h('button', { type: 'button', className: 'sv-outline-mini', disabled: Boolean(acting), onClick: () => { void setState(item, 'ignored') } }, '忽略'),
              item.state !== 'active' && h('button', { type: 'button', className: 'sv-outline-mini', disabled: Boolean(acting), onClick: () => { void setState(item, 'active') } }, '恢复'),
            ),
          ),
        )
      }
      const chip = (id, label) => h('button', { key: id, type: 'button', className: 'sv-filter-chip', 'data-on': filter === id ? 'true' : 'false', onClick: () => setFilter(id) }, label)
      return h(React.Fragment, null,
        h('div', { className: 'sv-drawer-head' },
          h('div', { className: 'sv-drawer-src' },
            h('span', { className: 'sv-glyph', style: { background: glyphFor({ platform: spec.platform }, spec.name).color } }, glyphFor({ platform: spec.platform }, spec.name).letter),
            h('div', { className: 'sv-drawer-srcbox' },
              h('h3', { className: 'sv-item-title' }, spec.name),
              h('p', { className: 'sv-source-detail' }, source ? `${source.enabled ? '自动采集在位' : '已停用'} · ${source.kind || ''}` : '来源未在位'),
            ),
            h('span', { className: `sv-tag ${statusClass}` }, statusText),
            source && h('button', { type: 'button', className: 'sv-primary-mini', disabled: Boolean(busy), onClick: () => ask({ title: '立即采集', copy: `从「${source.name}」立即采集一次？不影响自动采集计划。`, confirm: '采集', onConfirm: () => onCollect([source.id]) }) }, busy ? '采集中…' : '立即采集'),
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: onClose }, '关闭'),
          ),
          h('div', { className: 'sv-drawer-stats' },
            h('div', { className: 'sv-drawer-stat' }, h('strong', { 'data-tone': 'brand' }, all.filter(inToday).length), h('span', null, '今日新增')),
            h('div', { className: 'sv-drawer-stat' }, h('strong', null, activeCount), h('span', null, '活跃')),
            h('div', { className: 'sv-drawer-stat' }, h('strong', null, savedCount), h('span', null, '已收藏')),
            selection ? h('div', { className: 'sv-drawer-stat' }, h('strong', { 'data-tone': excludedCount ? 'alert' : undefined }, excludedCount), h('span', null, '本次排除')) : null,
          ),
        ),
        h('div', { className: 'sv-drawer-scroll' },
          selection && h('p', { className: 'sv-drawer-selhint' }, '取消勾选 = 本次生成不参与；「忽略」是跨选题的全局动作，可在信号模块恢复。'),
          h('div', { className: 'sv-drawer-tools' },
            chip('all', `全部 ${all.length}`),
            chip('today', `今日 ${all.filter(inToday).length}`),
            chip('saved', `已收藏 ${savedCount}`),
            chip('ignored', `已忽略 ${all.filter((item) => item.state === 'ignored').length}`),
            selection ? chip('excluded', `本次排除 ${excludedCount}`) : null,
            h('input', { className: 'sv-drawer-search', value: query, maxLength: 120, placeholder: '搜索标题 / 摘要', onChange: (event) => setQuery(event.target.value) }),
          ),
          h(Notice, { error: loadError }),
          signals === null && !loadError && h('div', { className: 'sv-empty' }, '正在读取信号…'),
          signals !== null && h(React.Fragment, null,
            h('p', { className: 'sv-group-title' }, `今日新增 ${todayItems.length}`),
            todayItems.length ? h('div', { className: 'sv-drawer-list' }, todayItems.map(row)) : h('div', { className: 'sv-empty' }, '今天暂无新信号。'),
            h('p', { className: 'sv-group-title', 'data-tone': 'muted' }, `更早 ${earlierItems.length}`),
            earlierItems.length ? h('div', { className: 'sv-drawer-list' }, earlierItems.map(row)) : null,
          ),
        ),
      )
    }

    function HeroMini({ cells }) {
      return h('section', { className: 'sv-heromini' }, cells.map((cell) => h('div', { key: cell.label, className: 'sv-heromini-cell' }, h('span', null, cell.label), h('strong', cell.tone ? { 'data-tone': cell.tone } : null, cell.value))));
    }
    // One task inspector for every module. It observes execution; closing it only
    // aborts read subscriptions and never controls the production task.
    let executionSelection = null;
    const executionListeners = new Set();
    function openExecution(request) { executionSelection = request; executionListeners.forEach((notify) => notify()); }
    function ExecutionButton({ kind, id, projectId, label = '执行详情' }) {
      return h('button', { type: 'button', className: 'lwb-plain-button sv-ex-open', onClick: () => openExecution({ kind, id, projectId }) }, label);
    }
    const EX_STATUS = { queued: '排队中', running: '进行中', completed: '已完成', succeeded: '已完成', success: '已完成', failed: '失败', cancelled: '已停止', skipped: '已跳过', unchanged: '复用快照' };
    const EX_PHASE = { preparing: '准备素材', directing: '视觉创作', preflight: '工程预检', rendering: '视频渲染', 'technical-qc': '技术质检', 'editorial-review': '独立审片', committing: '保存产物', completed: '完成', agent: '文案生成', covers: '封面生成', ready: '资料就绪' };
    const EX_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '参考资料' };
    const exLive = (value) => ['queued', 'running'].includes(value?.status) || ['queued', 'running'].includes(value?.record?.subtitle?.status);
    const exText = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const exJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
    function ExecutionText({ text, streaming = false }) { return h('div', { className: 'sv-ex-prose' }, h(MarkdownText, { text: String(text || ''), streaming, labels: EX_LABELS })); }
    function ExecutionData({ label, value, open = false }) {
      if (value == null || value === '') return null;
      return h('details', { className: 'sv-ex-disclosure', open }, h('summary', null, label), h('pre', { className: 'sv-ex-code' }, exText(value)));
    }
    const EX_FIELD = { name: '名称', positioning: '账号定位', audience: '目标受众', pillars: '内容方向', boundary: '内容边界', summary: '说明', mode: '执行模式', tier: '创作档位', instructions: '创作要求', prompt: '提示词', model: '模型', provider: '服务渠道', voiceId: '音色', rate: '语速', volume: '音量', outputFormat: '音频格式', orientation: '画幅', renderer: '制作方式', visualBrief: '画面要求', subtitleEnabled: '字幕', title: '标题', description: '发布描述', tags: '话题标签', hashtags: '话题标签', copy: '发布文案', temperature: '创作自由度', imageProvider: '封面服务', language: '语言', sourceId: '采集来源', reason: '触发方式', fetchedCount: '读取条数', filteredCount: '筛除条数', addedCount: '新增条数', duplicateCount: '重复条数', message: '采集说明', httpStatus: '响应状态', durationMs: '用时（毫秒）' };
    function ExecutionFields({ label, value }) {
      if (!value) return null;
      const entries = Object.entries(value).filter(([, item]) => item != null && item !== '' && (!Array.isArray(item) || item.length));
      const simple = entries.filter(([key, item]) => EX_FIELD[key] && (typeof item !== 'object' || Array.isArray(item) && item.every((part) => typeof part === 'string')));
      return h('section', { className: 'sv-ex-fields' }, h('h4', null, label), simple.length ? h('dl', null, simple.map(([key, item]) => h('div', { key }, h('dt', null, EX_FIELD[key]), h('dd', null, Array.isArray(item) ? item.join(' · ') : typeof item === 'boolean' ? item ? '开启' : '关闭' : String(item))))) : null, h(ExecutionData, { label: '完整记录', value }));
    }
    function ExecutionReport({ label, value }) {
      if (!value) return null;
      const issues = value.issues || value.failures || value.rewriteReasons || value.warnings || [];
      return h('article', { className: 'sv-ex-paper' }, h('div', { className: 'sv-ex-message-head' }, h('strong', null, label), Number.isFinite(value.qualityScore) ? h('span', { className: 'sv-ex-state', 'data-status': value.rewriteRequired ? 'failed' : 'succeeded' }, `${value.qualityScore} 分`) : typeof value.passed === 'boolean' ? h('span', { className: 'sv-ex-state', 'data-status': value.passed ? 'succeeded' : 'failed' }, value.passed ? '通过' : '未通过') : null), value.summary ? h(ExecutionText, { text: value.summary }) : null, issues.length ? h('ul', { className: 'sv-ex-issues' }, issues.map((item, index) => h('li', { key: index }, typeof item === 'string' ? item : item.message || item.description || exText(item)))) : null, h(ExecutionData, { label: '指标与完整证据', value }));
    }
    function executionChunks(blocks, chunk) {
      const next = blocks.slice(); const index = Number.isInteger(chunk.index) ? chunk.index : 0;
      const prev = next[index] || {};
      if (chunk.type === 'block-start') next[index] = { type: chunk.blockType, text: '', arguments: '' };
      else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') next[index] = { type: chunk.type === 'text-delta' ? 'text' : 'reasoning', text: (prev.text || '') + chunk.text };
      else if (chunk.type === 'tool-call-delta') next[index] = { type: 'tool-call', name: chunk.name || prev.name, arguments: (prev.arguments || '') + (chunk.argumentsDelta || '') };
      else if (chunk.type === 'block-end') next[index] = chunk.block;
      return next;
    }
    // These are projections of durable DSH events, not generated process copy.
    function executionContext(source) {
      if (!source || source.kind === 'user') return null;
      const names = (items, key) => [...new Set((items || []).map((item) => item[key]).filter(Boolean))].join(', ');
      const label = source.kind === 'plugin' ? source.plugin : source.kind === 'skill-invocation' ? source.name : source.kind === 'agent-instructions' ? names(source.changes, 'path') : source.kind === 'session-reference' ? names(source.references, 'label') : source.kind;
      return { title: source.kind === 'session-reference' ? '上下文召回' : '上下文注入', label: label || source.kind || '未知来源' };
    }
    function executionPreview(text, streaming = false) {
      const lines = String(text || '').trim().split('\n');
      return (streaming ? lines.at(-1) : lines[0]).replaceAll('**', '');
    }
    function executionToolSummary(name, raw) {
      const args = typeof raw === 'string' ? exJson(raw) : raw;
      if (!args || typeof args !== 'object') return executionPreview(raw);
      if (name === 'structured_output') return executionPreview(args.summary || args.title || args.name || '提交本轮生成的结构化结果');
      const kind = String(name || '').toLowerCase();
      const keys = kind === 'bash' ? ['description', 'command'] : ['read', 'write', 'edit'].includes(kind) ? ['path', 'file_path', 'url'] : kind === 'search' ? ['query', 'pattern', 'url'] : ['description'];
      if (kind === 'search' && Array.isArray(args.queries)) return args.queries.filter((value) => typeof value === 'string').map((value) => executionPreview(value)).join(', ');
      const value = keys.map((key) => args[key]).find((value) => typeof value === 'string' && value) || Object.values(args).find((value) => typeof value === 'string' && value);
      return executionPreview(value);
    }
    function executionContent(event) {
      const data = event.data || {};
      return data.message?.content || data.content || (data.chunks || []).reduce(executionChunks, []);
    }
    function executionTurns(records) {
      const turns = []; let current;
      for (const { event } of records) {
        if (event.type === 'execution/omitted') continue;
        if (!current || event.type === 'turn/start' && current.events.length) {
          current = { key: event.seq, events: [] }; turns.push(current);
        }
        current.events.push(event);
      }
      return turns.map((turn) => {
        const calls = new Map(); const rows = [];
        const callKey = (event, id) => id == null ? null : `${event.data?.turn ?? ''}:${event.data?.step ?? ''}:${id}`;
        for (const event of turn.events) {
          if (event.type === 'tool/result') {
            const key = callKey(event, event.data?.message?.source?.callId);
            const call = key === null ? null : calls.get(key);
            if (call) { call.result = event; continue; }
          }
          const row = { event }; rows.push(row);
          if (event.type === 'tool/call') {
            const key = callKey(event, event.data?.callId);
            if (key !== null) calls.set(key, row);
          }
        }
        const end = turn.events.findLast((event) => event.type === 'turn/end');
        const lastAssistant = rows.findLast((row) => row.event.type === 'assistant/message');
        const blocks = lastAssistant ? executionContent(lastAssistant.event) : [];
        const hasFinal = Boolean(end && Array.isArray(blocks) && blocks.some((block) => block.type === 'text' && block.text) && !blocks.some((block) => block.type === 'tool-call') && !rows.some((row) => row.event.seq > lastAssistant.event.seq && row.event.type === 'tool/call'));
        let answer = null;
        if (hasFinal) {
          answer = { ...lastAssistant.event, data: { message: { content: blocks.filter((block) => block.type !== 'reasoning') } } };
          lastAssistant.event = { ...lastAssistant.event, data: { message: { content: blocks.filter((block) => block.type === 'reasoning') } } };
        }
        return { ...turn, rows, answer, ended: Boolean(end), contexts: turn.events.filter((event) => event.type === 'user/message' && executionContext(event.data?.source)).length, tools: turn.events.filter((event) => event.type === 'tool/call').length };
      });
    }
    function ExecutionProcessRow({ kind, title, preview, status, children }) {
      const icons = { context: 'M4 5h3m10 0h3v16H4V5Zm4-2h8v5H8V3Zm0 9h8m-8 4h6', reasoning: 'M9 18h6m-6 3h6M8 15a7 7 0 1 1 8 0l-1 3H9l-1-3Z', tool: 'm5 7 4 4-4 4m7 0h6M3 3h18v18H3V3Z', result: 'm5 12 4 4L19 6' };
      return h('details', { className: 'sv-ex-process-row', 'data-kind': kind },
        h('summary', null, h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: icons[kind] || icons.tool })), h('span', { className: 'sv-ex-row-title' }, title), preview ? h('span', { className: 'sv-ex-row-preview', title: preview }, preview) : null, status ? h('span', { className: 'sv-ex-row-status', 'data-error': status === '失败' || undefined }, status) : null),
        h('div', { className: 'sv-ex-row-body' }, children));
    }
    function ExecutionBlocks({ content, streaming = false }) {
      if (typeof content === 'string') return h(ExecutionText, { text: content, streaming });
      return (content || []).filter(Boolean).map((block, index) => {
        if (block.type === 'text') return h(ExecutionText, { key: index, text: block.text, streaming });
        if (block.type === 'reasoning') return block.text ? h(ExecutionProcessRow, { key: index, kind: 'reasoning', title: '思考', preview: executionPreview(block.text, streaming), status: streaming ? '输出中' : null }, h(ExecutionText, { text: block.text, streaming })) : null;
        if (block.type === 'tool-call' && streaming) return h(ExecutionProcessRow, { key: index, kind: 'tool', title: block.name === 'structured_output' ? '提交生成结果' : block.name || '工具调用', preview: executionToolSummary(block.name, block.arguments), status: '组织参数' }, h('pre', { className: 'sv-ex-code' }, exText(exJson(block.arguments) || block.arguments)));
        if (block.type === 'tool-result') return h(ExecutionBlocks, { key: index, content: block.content });
        if (['image', 'file', 'image-ref', 'file-ref'].includes(block.type)) return h('p', { key: index, className: 'sv-meta' }, `附件 · ${block.name || block.type}`);
        return null;
      });
    }
    function ExecutionEvent({ event, result, ended = false }) {
      const data = event.data || {};
      if (event.type === 'execution/omitted') return null;
      if (event.type === 'user/message') {
        const context = executionContext(data.source);
        if (context) return h(ExecutionProcessRow, { kind: 'context', title: context.title, preview: context.label }, h(ExecutionBlocks, { content: executionContent(event) }), h(ExecutionData, { label: '来源详情', value: data.source }));
        return h('details', { className: 'sv-ex-message sv-ex-input' }, h('summary', null, '任务输入', h('time', null, formatTime(event.time))), h(ExecutionBlocks, { content: executionContent(event) }));
      }
      if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        const content = executionContent(event);
        if (!Array.isArray(content)) return h(ExecutionText, { text: content });
        if (!content.some((block) => ['text', 'reasoning'].includes(block.type))) return null;
        return h('div', { className: 'sv-ex-assistant' }, event.type === 'assistant/attempt' ? h('p', { className: 'sv-meta' }, 'DSH · 未完成的输出') : null, h(ExecutionBlocks, { content }));
      }
      if (event.type === 'tool/call' || event.type === 'tool/result') {
        const output = event.type === 'tool/result' ? event : result;
        const failed = output && (output.data?.error || output.data?.message?.isError || output.data?.message?.content?.some((block) => block.isError));
        return h(ExecutionProcessRow, { kind: 'tool', title: event.type === 'tool/result' ? '工具返回' : data.name === 'structured_output' ? '提交生成结果' : data.name === 'bash' ? 'Bash' : data.name || '工具调用', preview: event.type === 'tool/call' ? executionToolSummary(data.name, data.arguments) : '', status: output ? failed ? '失败' : '完成' : ended ? '未记录返回' : '执行中' },
          event.type === 'tool/call' ? h(ExecutionData, { label: data.name === 'structured_output' ? '结构化结果' : '调用参数', value: exJson(data.arguments) ?? data.arguments, open: true }) : null,
          output ? h('div', { className: 'sv-ex-tool-output' }, h('strong', null, failed ? '工具返回 · 异常' : '工具返回'), h(ExecutionBlocks, { content: executionContent(output) }), output.data?.error ? h(ExecutionData, { label: '错误详情', value: output.data.error, open: true }) : null, h(ExecutionData, { label: '完整返回', value: output.data })) : null);
      }
      const labels = { 'step/start': '请求模型', 'turn/start': '开始执行', 'turn/end': data.reason?.kind === 'completed' ? 'DSH 执行完成' : `本轮结束 · ${data.reason?.kind || '未知原因'}`, 'llm/retry-started': '模型请求重试', 'llm/retry': '重试结束', 'approval/asked': '等待授权', 'approval/decided': '已收到授权决定' };
      return labels[event.type] ? h('div', { className: 'sv-ex-marker' }, h('i'), h('span', null, labels[event.type]), h('time', null, formatTime(event.time))) : null;
    }
    function ExecutionTranscript({ records, partial }) {
      const turns = executionTurns(records);
      if (!turns.length && partial) turns.push({ key: 'live', rows: [], contexts: 0, tools: 0 });
      return turns.map((turn, index) => h('div', { key: turn.key, className: 'sv-ex-turn' },
        h('details', { className: 'sv-ex-process', open: true }, h('summary', null, h('span', null, turn.ended ? '执行过程' : '本轮执行过程'), h('span', { className: 'sv-ex-process-counts' }, [turn.contexts ? `${turn.contexts} 项上下文` : '', turn.tools ? `${turn.tools} 次工具调用` : ''].filter(Boolean).join(' · '))),
          h('div', { className: 'sv-ex-process-body' }, turn.rows.map((row) => h(ExecutionEvent, { key: row.event.seq, ...row, ended: turn.ended })), index === turns.length - 1 && partial ? h('div', { className: 'sv-ex-assistant', 'aria-label': '正在输出' }, h(ExecutionBlocks, { content: partial.blocks, streaming: true })) : null)),
        turn.answer ? h('article', { className: 'sv-ex-message' }, h('div', { className: 'sv-ex-message-head' }, h('strong', null, 'DSH · 结果输出'), h('time', null, formatTime(turn.answer.time))), h(ExecutionBlocks, { content: executionContent(turn.answer) })) : null));
    }
    function ExecutionSession({ request, session }) {
      const [state, setState] = React.useState({ records: [], hasMore: false, cursor: -1, partial: null });
      const [error, setError] = React.useState(null); const [retry, setRetry] = React.useState(0); const [loading, setLoading] = React.useState(true);
      const [olderBusy, setOlderBusy] = React.useState(false);
      const currentRef = React.useRef(state);
      const sessionRequest = { ...request, role: session.role };
      React.useEffect(() => {
        const controller = new AbortController(); let timer; let stopped = false; let subscription;
        let current = { records: [], hasMore: false, cursor: -1, partial: null }; currentRef.current = current;
        const publish = () => { if (!timer) timer = setTimeout(() => { timer = null; if (!stopped) setState({ ...current }); }, 80); };
        const run = async () => {
          setLoading(true); setError(null);
          try {
            if (!executionRemote) throw new Error('会话连接正在准备，请稍后重试。');
            subscription = executionStreams.$stream({ name: 'spoken-video execution', open: (signal) => executionRemote.followExecution(sessionRequest, signal), ended: () => new Error('会话订阅已结束，可重新连接读取记录。'), carrierFailed: () => { if (!stopped) setError('连接中断，正在恢复会话…'); } });
            for await (const delivery of subscription) {
              const frame = delivery.value;
              if (stopped) break;
              if (frame.type === 'snapshot') {
                delivery.accept(); setError(null);
                const active = frame.assistantStream?.activeAttempt;
                current = { records: frame.records || [], cursor: frame.cursor, hasMore: frame.hasMore, partial: active ? { id: active.attemptId, nextIndex: active.nextIndex, blocks: (active.chunks || []).reduce(executionChunks, []) } : null };
                currentRef.current = current; setState({ ...current }); setLoading(false);
              } else if (frame.type === 'event') {
                current.records = [...current.records.filter((item) => item.event.seq !== frame.event.seq), frame];
                current.cursor = Math.max(current.cursor, frame.event.seq);
                if (['assistant/message', 'assistant/attempt'].includes(frame.event.type)) current.partial = null;
              } else if (frame.type === 'assistant-stream') {
                const item = frame.frame;
                if (item.type === 'start') current.partial = { id: item.attemptId, nextIndex: 0, blocks: [] };
                else if (item.type === 'chunk' && current.partial?.id === item.attemptId) {
                  if (item.index > current.partial.nextIndex) throw new Error('实时内容连接发生间断，请重新连接以恢复完整记录。');
                  if (item.index === current.partial.nextIndex) current.partial = { ...current.partial, nextIndex: item.index + 1, blocks: executionChunks(current.partial.blocks, item.chunk) };
                } else if (item.type === 'end' && current.partial?.id === item.attemptId && (item.outcome?.kind === 'abandoned' || current.records.some((record) => record.event.seq === item.outcome?.seq))) current.partial = null;
              }
              publish();
            }
          } catch (cause) { if (!stopped) { setError(cause.message || '会话记录暂不可用。'); setLoading(false); } }
        };
        void run();
        return () => { stopped = true; controller.abort(); void subscription?.dispose(); clearTimeout(timer); };
      }, [request.kind, request.id, request.projectId, session.childSessionId, retry]);
      const older = async () => {
        setOlderBusy(true);
        try {
          const page = await remoteStatic('executionPage', { ...sessionRequest, throughSeq: state.cursor, beforeSeq: state.records[0]?.event.seq });
          const current = currentRef.current;
          current.records = [...page.records, ...current.records].filter((item, index, items) => items.findIndex((other) => other.event.seq === item.event.seq) === index).sort((a, b) => a.event.seq - b.event.seq); current.hasMore = page.hasMore; setState({ ...current });
        } catch (cause) { setError(cause.message); } finally { setOlderBusy(false); }
      };
      return h('section', { className: 'sv-ex-session' },
        h('div', { className: 'sv-ex-section-head' }, h('span', { className: 'sv-ex-avatar' }, 'D'), h('div', null, h('strong', null, session.label || 'DSH 执行'), h('p', null, '原生会话 · 实时内容与历史记录'))),
        loading ? h('p', { className: 'sv-ex-empty' }, '正在读取会话…') : null,
        error ? h('div', { className: 'sv-ex-alert' }, h('p', null, error), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setRetry((value) => value + 1) }, '重新连接')) : null,
        state.hasMore ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: olderBusy, onClick: older }, olderBusy ? '正在读取…' : '加载更早内容') : null,
        h(ExecutionTranscript, { records: state.records, partial: state.partial }),
        !loading && !error && !state.records.length && !state.partial ? h('p', { className: 'sv-ex-empty' }, '会话已建立，等待第一条执行内容。') : null,
      );
    }
    function ExecutionAsset({ request, asset }) {
      const [value, setValue] = React.useState(null); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(null);
      const [url, setUrl] = React.useState(null);
      React.useEffect(() => {
        if (!value?.data) return;
        const bytes = Uint8Array.from(atob(value.data), (char) => char.charCodeAt(0));
        const next = URL.createObjectURL(new Blob([bytes], { type: value.mediaType })); setUrl(next);
        return () => URL.revokeObjectURL(next);
      }, [value]);
      const read = async () => { setBusy(true); setError(null); try { setValue(await remoteStatic('executionAsset', { ...request, assetId: asset.id })); } catch (cause) { setError(cause.message); } finally { setBusy(false); } };
      return h('article', { className: 'sv-ex-asset' }, h('div', { className: 'sv-ex-message-head' }, h('strong', null, asset.label), !value ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: read }, busy ? '正在加载…' : asset.type === 'text' ? '查看内容' : '预览') : null),
        url ? asset.type === 'image' ? h('img', { src: url, alt: asset.label }) : h(asset.type === 'video' ? 'video' : 'audio', { src: url, controls: true, preload: 'metadata' }) : null,
        value?.text != null ? h('pre', { className: 'sv-ex-code' }, value.text) : null,
        error ? h('p', { className: 'sv-error' }, error) : null);
    }
    function ExecutionResults({ detail, request }) {
      const record = detail.record;
      const packageResult = record.result?.content ? record.result : record.result?.artifact?.data?.content ? record.result.artifact.data : null;
      const draft = record.draft;
      const subtitle = record.subtitle?.current || (record.type === 'subtitles' ? record.result?.artifact?.data || record.result : null);
      return h('div', { className: 'sv-ex-results' },
        record.candidates?.map((item, index) => h('article', { key: item.id || index, className: 'sv-ex-candidate' }, h('div', { className: 'sv-ex-message-head' }, h('span', { className: 'sv-ex-number' }, String(index + 1).padStart(2, '0')), index === 0 ? h('span', { className: 'sv-tag' }, '推荐选题') : null, h('span', { className: 'sv-meta' }, item.selection?.state === 'selected' ? '已加入待写稿' : '候选')), h('h3', null, item.title), h(ExecutionText, { text: item.contentCore }), h('p', { className: 'sv-meta' }, item.angle), item.whyNow ? h('p', { className: 'sv-ex-why' }, `为什么现在做 · ${item.whyNow}`) : null, h(ExecutionData, { label: '引用信号', value: (record.materialSnapshot || []).filter((signal) => item.signalIds?.includes(signal.id)) }))),
        draft ? h('article', { className: 'sv-ex-paper' }, h('span', { className: 'sv-ex-kicker' }, record.appliedAt ? `已保存 · 稿件版本 ${record.scriptRevision || '—'}` : '本次生成稿件'), h('h3', null, draft.title || detail.title), h(ExecutionText, { text: draft.script }), h(ExecutionData, { label: '核实提示与生成说明', value: Object.fromEntries(Object.entries(draft).filter(([key]) => !['script', 'title', 'suggestedTitle'].includes(key))) })) : null,
        packageResult ? h('article', { className: 'sv-ex-paper' }, h('h3', null, packageResult.content?.title || '发布资料'), h(ExecutionText, { text: packageResult.content?.copy }), h(ExecutionFields, { label: '描述与标签', value: packageResult.content }), h(ExecutionData, { label: '封面提示词', value: packageResult.prompts })) : null,
        record.suggestion ? h(ExecutionFields, { label: '账号定位建议', value: { ...record.suggestion.suggestion, summary: record.suggestion.summary } }) : null,
        subtitle?.srt ? h('article', { className: 'sv-ex-paper' }, h('h3', null, `时间轴字幕 · ${subtitle.cueCount || 0} 条`), h('pre', { className: 'sv-ex-code' }, subtitle.srt), h(ExecutionData, { label: '识别诊断', value: subtitle.diagnostics }), h(ExecutionData, { label: '字幕历史版本', value: record.subtitle?.history })) : null,
        h(ExecutionReport, { label: '稿件质量报告', value: record.quality }),
        h(ExecutionReport, { label: '技术质检', value: record.pipeline?.technical || record.result?.qc?.technical || record.result?.technical }),
        h(ExecutionReport, { label: '独立审片结论与证据', value: record.pipeline?.review || record.result?.qc?.review }),
        detail.assets.length ? h('div', { className: 'sv-ex-assets' }, detail.assets.map((asset) => h(ExecutionAsset, { key: asset.file, asset, request }))) : null,
        record.projectSync ? h('p', { className: 'sv-note' }, `已同步到项目版本 ${record.projectSync.revision}`) : detail.kind === 'audio' && record.status === 'succeeded' ? h('p', { className: 'sv-note' }, record.source?.projectId ? record.projectSyncError || '音频已生成；尚未同步为项目当前配音。' : '独立音频任务，未关联项目。') : null,
        detail.kind === 'source' ? h(ExecutionFields, { label: '采集结果', value: record }) : null,
        record.subtitleSyncError ? h('p', { className: 'sv-note' }, record.subtitleSyncError) : null,
        record.coverErrors && Object.keys(record.coverErrors).length ? h(ExecutionData, { label: '部分封面生成失败', value: record.coverErrors, open: true }) : null,
        h(ExecutionData, { label: '完整结果记录', value: record.result }),
        detail.kind !== 'source' && !draft && !record.candidates?.length && !record.result && !record.suggestion && !detail.assets.length ? h('p', { className: 'sv-ex-empty' }, exLive(detail) ? '产物生成后会在这里展示。' : '这条历史记录没有保存可展示的产物。') : null,
      );
    }
    function ExecutionProcess({ detail, request }) {
      const record = detail.record;
      const events = record.executionEvents || [];
      const steps = record.steps || Object.entries(record.pipeline?.stages || {}).map(([id, value]) => ({ id, label: EX_PHASE[id] || id, ...value }));
      return h('div', { className: 'sv-ex-process' },
        steps.length ? h('div', { className: 'sv-ex-steps' }, steps.map((step) => h('div', { key: step.id, 'data-status': step.status }, h('i'), h('strong', null, step.label), h('span', null, step.detail || EX_STATUS[step.status] || ({ done: '完成', pending: '待执行', error: '失败' })[step.status] || step.status)))) : null,
        events.length ? h('section', { className: 'sv-ex-timeline' }, h('h4', null, '执行记录'), events.map((event) => h('div', { key: event.id, className: 'sv-ex-timeline-row', 'data-status': event.status }, h('i'), h('div', null, h('div', { className: 'sv-ex-message-head' }, h('strong', null, event.label), h('time', null, formatTime(event.at))), h('span', { className: 'sv-ex-actor' }, event.actor), event.detail ? h(ExecutionData, { label: '详情', value: event.detail }) : null)))) : null,
        detail.sessions.map((session) => h(ExecutionSession, { key: session.childSessionId, session, request })),
        !detail.sessions.length ? h('p', { className: 'sv-ex-empty' }, exLive(detail) && ['topic', 'script', 'account'].includes(detail.kind) ? '任务已提交，等待 DSH 会话建立。' : detail.kind === 'publish' && !record.coverKind && exLive(detail) ? '发布文案任务正在准备。' : events.length ? '以上为服务与本地处理的实际执行记录。' : '该任务未保存详细过程；可查看已记录的输入、状态和产物。') : null,
        record.subtitle?.error ? h('p', { className: 'sv-ex-alert' }, `字幕生成失败：${mediaErrorText(record.subtitle.error)}`) : null,
        record.dsh?.events?.length ? h(ExecutionData, { label: '简要事件记录', value: record.dsh.events }) : null,
      );
    }
    function ExecutionDrawer({ request, onClose }) {
      const [detail, setDetail] = React.useState(null); const [error, setError] = React.useState(null); const [tab, setTab] = React.useState(null);
      const [wide, setWide] = React.useState(false); const [refresh, setRefresh] = React.useState(0); const root = React.useRef(null); const modal = React.useRef(null);
      React.useEffect(() => {
        let active = true; let timer; let settled = 0; let failures = 0;
        const load = async () => {
          try {
            const value = await remoteStatic('executionDetail', request);
            settled = exLive(value) ? 0 : settled + 1; failures = 0;
            if (active) { setDetail(value); setError(null); setTab((current) => current || (exLive(value) || value.status === 'failed' ? 'process' : 'results')); }
          } catch (cause) { failures += 1; if (active) setError(cause.message); }
          if (active && settled < 3 && failures < 3) timer = setTimeout(load, failures ? 3500 : 1800);
        };
        void load();
        return () => { active = false; clearTimeout(timer); };
      }, [request.kind, request.id, request.projectId, refresh]);
      React.useEffect(() => {
        const previous = document.activeElement; modal.current?.showModal(); root.current?.focus();
        const key = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const nodes = [...(root.current?.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]') || [])].filter((node) => node.getClientRects().length);
            if (!nodes.length) return;
            if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === root.current)) { event.preventDefault(); nodes.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
          }
        };
        document.addEventListener('keydown', key, true);
        return () => { document.removeEventListener('keydown', key, true); modal.current?.close(); if (previous?.isConnected) previous.focus(); };
      }, []);
      const record = detail?.record || {};
      const actor = detail?.sessions.length ? (['topic', 'script', 'account'].includes(detail.kind) ? 'DSH 会话' : 'DSH · 服务与本地处理') : request.kind === 'audio' ? '配音 / 字幕服务' : request.kind === 'publish' && record.coverKind ? '封面生图服务' : request.kind === 'source' ? '来源采集程序' : '任务执行';
      return h('dialog', { ref: modal, className: 'sv-ex-layer', 'aria-label': '执行详情', onCancel: (event) => { event.preventDefault(); onClose(); } }, h('button', { className: 'sv-ex-backdrop', type: 'button', 'aria-label': '关闭执行详情', onClick: onClose }),
        h('aside', { ref: root, tabIndex: -1, className: 'sv-ex-drawer', 'data-wide': wide },
          h('header', { className: 'sv-ex-header' }, h('div', null, h('p', { className: 'sv-ex-kicker' }, `${detail?.moduleLabel || '任务'} / 执行详情`), h('h2', null, detail?.title || '正在读取…'), h('p', { className: 'sv-ex-subtitle' }, detail ? `${formatTime(detail.createdAt)} · ${actor}` : '读取任务与会话关联')),
            h('div', { className: 'sv-ex-header-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setWide((value) => !value), 'aria-label': wide ? '收起宽屏' : '展开宽屏' }, wide ? '收起' : '展开'), h('button', { type: 'button', className: 'lwb-plain-button', onClick: onClose }, '关闭'))),
          h('div', { className: 'sv-ex-toolbar' }, h('div', { role: 'tablist', 'aria-label': '执行详情视图', className: 'sv-ex-tabs' }, [['overview', '执行概览'], ['process', '执行过程'], ['results', '结果产物']].map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id) }, label))), h('span', { className: 'sv-ex-state', 'data-status': detail?.status, role: 'status' }, EX_STATUS[detail?.status] || '读取中')),
          h('div', { key: tab, className: 'sv-ex-body', role: 'tabpanel' }, error ? h('div', { className: 'sv-ex-alert' }, h('p', null, error), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setRefresh((value) => value + 1) }, '重新读取')) : null,
            detail?.record.error ? h('div', { className: 'sv-ex-alert' }, h('strong', null, '执行未完成'), h('p', null, ['audio', 'media'].includes(request.kind) ? mediaErrorText(detail.record.error) : detail.record.error)) : null,
            detail && tab === 'overview' ? h(React.Fragment, null,
              h('div', { className: 'sv-ex-metrics' }, h('div', null, h('span', null, '执行状态'), h('strong', null, EX_STATUS[detail.status] || detail.status)), h('div', null, h('span', null, 'DSH 会话'), h('strong', null, detail.sessions.length ? `${detail.sessions.length} 个` : '无')), h('div', null, h('span', null, '用时'), h('strong', null, detail.completedAt && detail.createdAt ? `${Math.max(0, Math.round((Date.parse(detail.completedAt) - Date.parse(detail.createdAt)) / 1000))} 秒` : exLive(detail) ? '执行中' : '—'))),
              h(ExecutionFields, { label: '任务输入与配置', value: record.input || { mode: record.mode, tier: record.tier, instructions: record.instructions, prompt: record.prompt, imageProvider: record.imageProvider } }),
              h(ExecutionData, { label: '账号定位快照', value: record.account }),
              h(ExecutionData, { label: '输入稿件与素材快照', value: record.source || record.sourceSnapshot }),
              h(ExecutionData, { label: `参与信号 · ${record.materialSnapshot?.length || 0} 条`, value: record.materialSnapshot }),
              h(ExecutionData, { label: '来源批次', value: record.materialBatches }),
              record.unavailableSources?.length ? h(ExecutionData, { label: '未获得当天数据的来源', value: record.unavailableSources, open: true }) : null,
              request.kind === 'source' ? h(ExecutionData, { label: '采集结果', value: record, open: true }) : null,
              h('p', { className: 'sv-ex-footnote' }, '这里展示本次任务记录的版本与内容；后续编辑不会改写 DSH 原始会话。')) : null,
            detail && tab === 'process' ? h(ExecutionProcess, { detail, request }) : null,
            detail && tab === 'results' ? h(ExecutionResults, { detail, request }) : null),
          h('footer', { className: 'sv-ex-footer' }, h('span', null, exLive(detail) ? '实时更新 · 关闭面板不影响执行' : '历史记录 · 只读查看'), h('span', null, record.expectedRevision ? `输入项目版本 ${record.expectedRevision}` : ''))));
    }
    function ExecutionPortal() {
      const request = React.useSyncExternalStore((notify) => { executionListeners.add(notify); return () => executionListeners.delete(notify); }, () => executionSelection);
      React.useEffect(() => () => { executionSelection = null; }, []);
      return request ? h(ExecutionDrawer, { key: `${request.kind}:${request.id}`, request, onClose: () => openExecution(null) }) : null;
    }
    function ExecutionHistory({ kind, projectId, refreshKey }) {
      const [items, setItems] = React.useState([]); const [error, setError] = React.useState(null); const [retry, setRetry] = React.useState(0);
      React.useEffect(() => { let active = true; void remoteStatic('executionList', { kind, projectId }).then((value) => { if (active) { setItems(value); setError(null); } }).catch((cause) => { if (active) setError(cause.message); }); return () => { active = false; }; }, [kind, projectId, refreshKey, retry]);
      if (error) return h('div', { className: 'sv-ex-alert' }, h('p', null, `执行历史读取失败：${error}`), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setRetry((value) => value + 1) }, '重新读取'));
      return items.length ? h('details', { className: 'sv-ex-disclosure' }, h('summary', null, `执行历史 · ${items.length} 次`), h('div', { className: 'sv-ex-history' }, items.map((item) => h('button', { key: item.id, type: 'button', onClick: () => openExecution({ kind, id: item.id, projectId }) }, h('span', null, formatTime(item.createdAt)), h('strong', null, EX_STATUS[item.status] || item.status), h('span', null, '查看详情 →'))))) : null;
    }

    function PackFrame({ packId, openConversation, title, copy, className, intro = true, hero, accent, introActions, children }) {
      if (!packId) return h(NeedPack, { openConversation });
      return h('div', { className: `sv-page${className ? ` ${className}` : ''}`, ...(accent ? { 'data-accent': accent } : {}) },
        intro && h(Intro, { title, copy, actions: introActions }),
        hero,
        children,
        h(ExecutionPortal),
      );
    }
    function SignalsPage({ packId, openConversation }) {
      const [board, setBoard] = React.useState(null)
      const [sources, setSources] = React.useState([])
      const [runs, setRuns] = React.useState([])
      const [view, setView] = React.useState('board')
      const [adminTab, setAdminTab] = React.useState('sources')
      const [drawer, setDrawer] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [confirmNode, ask] = useSvConfirm()

      const refresh = React.useCallback(async () => {
        if (!packId) return
        try {
          const [nextBoard, nextSources, nextRuns] = await Promise.all([
            remote(packId, 'board'),
            remote(packId, 'sources'),
            remote(packId, 'sourceRuns'),
          ])
          setBoard(nextBoard)
          setSources(nextSources)
          setRuns(nextRuns)
          setError(null)
        } catch (cause) { setError(cause.message) }
      }, [packId])

      React.useEffect(() => { void refresh() }, [refresh])

      if (!packId) return h(NeedPack, { openConversation })

      const closeDrawer = () => setDrawer(null)
      const invoke = async (method, request, marker) => {
        setBusy(marker)
        try { await remote(packId, method, request); await refresh() } catch (cause) { setError(cause.message) } finally { setBusy(null) }
      }
      const collect = (ids, marker) => { void invoke('collectSources', { ...(ids ? { sourceIds: ids } : {}) }, marker) }
      const openSignalDrawer = (spec) => setDrawer({ kind: 'signals', ...spec })

      const totals = board?.totals
      const boardSources = (board?.sources || []).filter((card) => card.id !== 'ai-daily-import')
      const families = [...new Set([...FAMILY_ORDER, ...boardSources.map((card) => card.family)])].filter((family) => boardSources.some((card) => card.family === family))
      const boardStatus = (card) => {
        if (!card.enabled) return ['已停用', 'sv-status-disabled']
        if (card.status === 'error') return ['异常', 'sv-status-error']
        if (card.status === 'ready') return ['正常', 'sv-status-ready']
        return ['未采集', 'sv-status-disabled']
      }
      const previewList = (card) => h('ol', { className: 'sv-board-preview' }, card.preview.length ? card.preview.map((item) => h('li', { key: item.id }, `${item.rank ? `#${item.rank} ` : ''}${item.title}`, item.hotValue ? h('small', null, ` · ${formatHot(item.hotValue)}`) : null)) : [h('li', { key: 'empty' }, '暂无信号')])
      const sourceCard = (card) => {
        const [status, statusClass] = boardStatus(card)
        const health = card.status === 'error' ? 'error' : 'ok'
        return h('article', { key: card.id, className: 'sv-board-card', 'data-health': health },
          h('button', { type: 'button', className: 'sv-board-card-main', onClick: () => openSignalDrawer({ sourceId: card.id, platform: null, name: card.name }) },
            h('div', { className: 'sv-item-head' }, h('strong', null, card.name), h('span', { className: `sv-tag ${statusClass}` }, status)),
            h('p', { className: 'sv-board-today' }, `今日新增 ${card.todayCount} · 活跃 ${card.activeCount}`),
            card.lastError ? h('p', { className: 'sv-source-detail', style: { color: '#a94343' } }, card.lastError) : h('p', { className: 'sv-board-meta' }, `${card.previewScope === 'today' ? '今日 Top' : '最近信号'} · 最近采集 ${relativeTime(card.lastAttemptAt || card.lastSuccessAt)}`),
            previewList(card),
          ),
          h('div', { className: 'sv-board-card-foot' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy), onClick: () => ask({ title: '立即采集', copy: `从「${card.name}」立即采集一次？不影响自动采集计划。`, confirm: '采集', onConfirm: () => collect([card.id], `collect:${card.id}`) }) }, busy === `collect:${card.id}` ? '采集中…' : '采集')),
        )
      }
      const platformCard = (card) => {
        const freshClass = { fresh: 'sv-status-ready', recent: 'sv-status-manual', stale: 'sv-status-disabled', none: 'sv-status-disabled' }[card.freshness] || 'sv-status-disabled'
        return h('article', { key: card.platform, className: 'sv-board-card', 'data-empty': card.totalCount ? undefined : 'true' },
          card.totalCount
            ? h('button', { type: 'button', className: 'sv-board-card-main', onClick: () => openSignalDrawer({ sourceId: 'ai-daily-import', platform: card.platform, name: `AI 内容日报 · ${card.platform}` }) },
              h('div', { className: 'sv-item-head' }, h('strong', null, `AI 内容日报 · ${card.platform}`), h('span', { className: `sv-tag ${freshClass}` }, FRESH_LABEL[card.freshness] || card.freshness)),
              h('p', { className: 'sv-board-today' }, `今日新增 ${card.todayCount} · 累计 ${card.totalCount}`),
              h('p', { className: 'sv-board-meta' }, `最近更新 ${relativeTime(card.lastImportedAt)}`),
              previewList(card),
            )
            : h('div', { className: 'sv-board-card-main' },
              h('div', { className: 'sv-item-head' }, h('strong', null, `AI 内容日报 · ${card.platform}`), h('span', { className: `sv-tag ${freshClass}` }, FRESH_LABEL[card.freshness] || card.freshness)),
              h('p', { className: 'sv-board-meta' }, '今日暂无数据 · 采集服务每 60 分钟自动拉取'),
            ),
        )
      }
      const boardView = board && h('section', { className: 'sv-board' },
        families.map((family) => h('section', { key: family, className: 'sv-board-group' },
          h('div', { className: 'sv-section-head' }, h('h3', null, family), h('span', null, `${boardSources.filter((card) => card.family === family).length} 个来源 · 自动采集`)),
          h('div', { className: 'sv-board-grid' }, boardSources.filter((card) => card.family === family).map(sourceCard)),
        )),
        h('section', { className: 'sv-board-group' },
          h('div', { className: 'sv-section-head' }, h('h3', null, 'AI 内容日报'), h('span', null, `报告导入 · 覆盖 ${board.aiDaily.platforms.length} 个平台 · 每 60 分钟自动拉取`)),
          h('div', { className: 'sv-board-grid' }, board.aiDaily.platforms.map(platformCard)),
        ),
      )

      const renderSourceCard = (source) => {
        const [status, statusClass] = sourceStatus(source)
        const isDaily = source.id === 'ai-daily-import'
        return h('article', { key: source.id, className: 'sv-source-compact' },
          h('div', { className: 'sv-item-head' }, h('strong', null, source.name), h('span', { className: `sv-tag ${statusClass}` }, status)),
          h('p', { className: 'sv-source-detail' }, isDaily ? '报告导入 · 覆盖：抖音 / B站 / 公众号 / 小红书 / 视频号' : `${source.enabled ? `每 ${source.intervalMinutes} 分钟自动采集` : '已停用'}`),
          h('p', { className: 'sv-source-detail' }, sourceActivity(source)),
          source.health?.lastError && h('p', { className: 'sv-source-detail', style: { color: '#a94343' } }, source.health.lastError),
          h('div', { className: 'sv-actions' },
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy), onClick: () => ask({ title: '立即采集', copy: `从「${source.name}」立即采集一次？不影响自动采集计划。`, confirm: '采集', onConfirm: () => collect([source.id], `collect:${source.id}`) }) }, busy === `collect:${source.id}` ? '采集中…' : '采集'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy), onClick: () => ask({ title: source.enabled ? '停用来源' : '启用来源', copy: `${source.enabled ? '停用' : '启用'}「${source.name}」的自动采集？`, confirm: source.enabled ? '停用' : '启用', danger: source.enabled, onConfirm: () => { void invoke('setSourceEnabled', { sourceId: source.id, enabled: !source.enabled }, `toggle:${source.id}`) } }) }, source.enabled ? '停用' : '启用'),
          ),
        )
      }
      const runItems = runs.slice(0, 20).map((run) => h('article', { key: run.id, className: 'sv-item' },
        h('div', { className: 'sv-item-head' },
          h('strong', null, sourceLabel(sources, run.sourceId)),
          h('span', { className: `sv-tag ${run.status === 'failed' ? 'sv-status-error' : run.status === 'skipped' ? 'sv-status-disabled' : ''}` }, run.status === 'success' ? '成功' : run.status === 'skipped' ? '未变化' : '失败'),
        ),
        h('p', { className: 'sv-meta' }, `${run.message} · ${formatTime(run.completedAt)}`),
        h('p', { className: 'sv-source-detail' }, `读取 ${run.fetchedCount} · 过滤 ${run.filteredCount} · 新增 ${run.addedCount} · 去重 ${run.duplicateCount} · ${run.durationMs} ms`),
        h(ExecutionButton, { kind: 'source', id: run.id }),
      ))
      const adminFamilies = [...new Set(sources.map((source) => source.family || '其他'))]
      const sourcesView = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' },
          h('div', null, h('h3', null, '来源库'), h('p', { className: 'sv-meta' }, '产品内置的信号来源目录：可立即采集或停用，不提供增删与参数配置。')),
        ),
        h('div', { className: 'sv-source-table' }, adminFamilies.map((family) => {
          const familySources = sources.filter((source) => source.family === family)
          return h('section', { key: family, className: 'sv-family-section' },
            h('div', { className: 'sv-section-head' }, h('h3', null, family), h('span', null, `${familySources.length} 个来源`)),
            h('div', { className: 'sv-source-compact-grid' }, familySources.map(renderSourceCard)),
          )
        })),
      )
      const runsView = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '采集记录'), h('span', null, '成功、未变化和失败均保留')),
        runs.length ? h('div', { className: 'sv-list sv-run-list' }, runItems) : h('div', { className: 'sv-empty' }, '尚未执行采集。'),
      )
      const adminView = h(React.Fragment, null,
        h('nav', { className: 'sv-tabs', 'aria-label': '来源管理视图' }, [['sources', '来源库'], ['runs', '采集记录']].map(([id, label]) => h('button', { key: id, type: 'button', className: 'sv-tab', 'data-active': adminTab === id ? 'true' : 'false', onClick: () => setAdminTab(id) }, label))),
        adminTab === 'sources' && sourcesView,
        adminTab === 'runs' && runsView,
      )

      const cmdBar = h('section', { className: 'sv-cmdbar', 'aria-label': '信号池概览' },
        h('div', { className: 'sv-cmd-title' },
          h('p', { className: 'sv-cmd-kicker' }, h('span', { className: 'sv-module-dot', style: { background: '#3b82f6' } }), '内容情报'),
          h('h2', null, '信号板'),
        ),
        h('span', { className: 'sv-live-pill' }, h('span', { className: 'sv-live-dot' }), busy ? '正在采集…' : '采集服务待命'),
        h('span', { className: 'sv-cmd-sep' }),
        h('div', { className: 'sv-cmd-stats' },
          h('div', { className: 'sv-cmd-stat' }, h('span', null, '今日新增'), h('strong', { 'data-tone': 'brand' }, totals?.todayNew ?? '—')),
          h('div', { className: 'sv-cmd-stat' }, h('span', null, '已采集来源'), h('strong', null, `${totals?.collectedToday ?? 0}/${totals?.collectableSources ?? 0}`)),
          h('div', { className: 'sv-cmd-stat' }, h('span', null, '异常来源'), h('strong', { 'data-tone': totals?.errorSources ? 'alert' : 'ok' }, totals?.errorSources ?? '—')),
          h('div', { className: 'sv-cmd-stat' }, h('span', null, '最近采集'), h('strong', { 'data-tone': 'time' }, totals ? relativeTime(totals.lastCollectAt) : '—')),
        ),
        h('div', { className: 'sv-cmd-actions' },
          h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(busy), onClick: () => ask({ title: '全量采集', copy: `立即采集全部 ${totals?.collectableSources ?? 0} 个来源？可能需要数十秒。`, confirm: '采集', onConfirm: () => collect(null, 'collect-all') }) }, busy === 'collect-all' ? '正在采集…' : `采集 ${totals?.collectableSources ?? 0} 个来源`),
          h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setView(view === 'board' ? 'admin' : 'board') }, view === 'board' ? '来源管理' : '返回信号板'),
        ),
      )

      const drawerView = drawer && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: closeDrawer }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': drawer.name },
          h(SignalDrawerBody, { packId, sources, spec: drawer, today: board?.today, busy, onClose: closeDrawer, onCollect: (ids) => collect(ids, `collect:${ids[0]}`), onChanged: () => { void refresh() }, ask }),
        ),
      )

      return h(PackFrame, { packId, openConversation, className: 'sv-signal-shell', intro: false, hero: cmdBar },
        board && totals.todayNew === 0 && view === 'board' && h('p', { className: 'sv-note' }, '今天暂无新信号，卡片展示最近一次采集的信号；可点击“采集”获取最新内容。'),
        h(Notice, { error }),
        h('nav', { className: 'sv-tabs', 'aria-label': '信号工作台视图' }, [['board', '信号板'], ['admin', '来源管理']].map(([id, label]) => h('button', { key: id, type: 'button', className: 'sv-tab', 'data-active': view === id ? 'true' : 'false', onClick: () => setView(id) }, label))),
        view === 'board' && (boardView || h('div', { className: 'sv-empty' }, '正在读取信号板…')),
        view === 'admin' && adminView,
        drawerView,
        confirmNode,
      )
    }

    function AccountPositioningPage({ packId, openConversation }) {
      const [accountExecutionId, setAccountExecutionId] = React.useState(null);
      const emptyForm = () => ({ name: '', positioning: '', audience: '', pillars: '', boundary: '' });
      const formFor = (account) => account ? { name: account.name || '', positioning: account.positioning || '', audience: account.audience || '', pillars: (account.pillars || []).join('、'), boundary: account.boundary || '' } : emptyForm();
      const [library, setLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [editing, setEditing] = React.useState(null);
      const [form, setForm] = React.useState(emptyForm);
      const [saving, setSaving] = React.useState(false);
      const [completing, setCompleting] = React.useState(false);
      const [completionNote, setCompletionNote] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [confirmNode, ask] = useSvConfirm();
      const openCreate = () => { setEditing({ account: null }); setForm(emptyForm()); setCompletionNote(null); };
      const openEdit = (account) => { setEditing({ account }); setForm(formFor(account)); setCompletionNote(null); };
      const closeDrawer = () => setEditing(null);
      const load = React.useCallback(async () => {
        if (!packId) return;
        try { const next = await remote(packId, 'listAccounts'); setLibrary(next); setError(null); } catch (cause) { setError(cause.message); }
      }, [packId]);
      React.useEffect(() => { void load(); }, [load]);
      if (!packId) return h(NeedPack, { openConversation });
      const active = library.accounts.filter((item) => item.status === 'active');
      const archived = library.accounts.filter((item) => item.status === 'archived');
      const editingAccount = editing ? editing.account : null;
      const save = async (event) => {
        event.preventDefault(); setSaving(true);
        const payload = { name: form.name, positioning: form.positioning, audience: form.audience, pillars: csv(form.pillars), boundary: form.boundary };
        try {
          const result = editingAccount ? await remote(packId, 'updateAccount', { accountId: editingAccount.id, ...payload }) : await remote(packId, 'createAccount', payload);
          setLibrary(result.library); setError(null); closeDrawer();
        } catch (cause) { setError(cause.message); } finally { setSaving(false); }
      };
      const setStatus = async (account, status) => {
        if (!account) return; setSaving(true);
        try {
          const result = await remote(packId, 'setAccountStatus', { accountId: account.id, status });
          setLibrary(result.library); setError(null);
          if (status === 'archived') closeDrawer();
        } catch (cause) { setError(cause.message); } finally { setSaving(false); }
      };
      const makeDefault = async (account) => {
        if (!account || account.status !== 'active') return; setSaving(true);
        try { setLibrary(await remote(packId, 'setDefaultAccount', { accountId: account.id })); setError(null); } catch (cause) { setError(cause.message); } finally { setSaving(false); }
      };
      const deleteAccount = async (account) => {
        if (!account || account.status !== 'archived') return;
        setSaving(true);
        try {
          const result = await remote(packId, 'deleteAccount', { accountId: account.id });
          setLibrary(result.library); setError(null);
        } catch (cause) { setError(cause.message); } finally { setSaving(false); }
      };
      const FIELD_LABELS = { name: '账号名称', positioning: '账号定位', audience: '目标受众', pillars: '内容方向', boundary: '内容边界' };
      const formHasInput = Boolean(form.name.trim() || form.positioning.trim() || form.audience.trim() || csv(form.pillars).length || form.boundary.trim());
      const complete = async () => {
        if (saving || completing || !formHasInput) return;
        setCompleting(true); setError(null); setCompletionNote(null);
        try {
          const executionId = actionKey('account-completion'); setAccountExecutionId(executionId);
          const result = await remote(packId, 'suggestAccountProfile', { executionId, name: form.name, positioning: form.positioning, audience: form.audience, pillars: csv(form.pillars), boundary: form.boundary });
          const suggestion = result.suggestion || {};
          setForm({
            name: suggestion.name || form.name,
            positioning: suggestion.positioning || form.positioning,
            audience: suggestion.audience || form.audience,
            pillars: (suggestion.pillars || []).join('、') || form.pillars,
            boundary: suggestion.boundary || form.boundary,
          });
          const filled = (result.filled || []).map((field) => FIELD_LABELS[field] || field);
          const updated = (result.updated || []).map((field) => FIELD_LABELS[field] || field);
          const parts = [];
          if (updated.length) parts.push(`已润色改写：${updated.join('、')}`);
          if (filled.length) parts.push(`已补齐：${filled.join('、')}`);
          setCompletionNote(parts.length ? `Agent 完善完成（${parts.join('；')}）。请检查后再保存。${result.summary ? ` · ${result.summary}` : ''}` : '当前字段已齐全，没有需要补全的内容。');
        } catch (cause) { setError(cause.message); } finally { setCompleting(false); }
      };
      const accountCard = (account) => {
        const isDefault = account.id === library.defaultAccountId;
        const avatar = accountAvatar(account.name);
        const doneFields = [account.positioning, account.audience, account.boundary].filter(Boolean).length + (account.pillars.length ? 1 : 0);
        return h('button', { key: account.id, type: 'button', className: 'sv-acc-card', 'data-state': account.configured ? 'ready' : 'todo', 'data-default': isDefault ? 'true' : 'false', onClick: () => openEdit(account) },
          h('span', { className: 'sv-acc-head' },
            h('span', { className: 'sv-acc-avatar', style: { background: avatar.background }, title: account.name }, avatar.letter),
            h('span', { className: 'sv-acc-id' },
              h('span', { className: 'sv-acc-name' }, account.name),
              h('span', { className: 'sv-acc-badges' },
                isDefault ? h('span', { className: 'sv-acc-pill', 'data-tone': 'default' }, '默认') : null,
                h('span', { className: 'sv-acc-pill', 'data-tone': account.configured ? 'done' : 'todo' }, account.configured ? '已完善' : '待完善'),
              ),
            ),
          ),
          h('p', { className: 'sv-acc-summary', 'data-empty': account.configured ? 'false' : 'true' }, account.positioning || account.audience || '尚未填写内容约束，完善后选题与写稿将自动继承'),
          account.pillars.length ? h('span', { className: 'sv-acc-chips' }, account.pillars.map((pillar) => h('span', { key: pillar, className: 'sv-acc-chip' }, pillar))) : null,
          h('span', { className: 'sv-acc-meter', 'data-full': doneFields === 4 ? 'true' : 'false', title: `定位完善度 ${doneFields}/4（定位 / 受众 / 方向 / 边界）` },
            [0, 1, 2, 3].map((index) => h('i', { key: index, 'data-on': index < doneFields ? 'true' : 'false' })),
            h('span', { className: 'sv-acc-meter-text' }, `完善度 ${doneFields}/4`),
          ),
          h('span', { className: 'sv-acc-foot' },
            h('span', null, `更新于 ${relativeTime(account.updatedAt)}`),
            h('span', null, account.configured ? '选题与写稿可继承' : '可用 Agent 补齐'),
          ),
        );
      };
      const newTile = h('button', { key: 'new', type: 'button', className: 'sv-acc-new', disabled: saving, onClick: openCreate },
        h('span', null, '新建账号定位'),
        h('span', { className: 'sv-acc-new-sub' }, '建立后，选题与写稿自动继承定位约束'),
      );
      const defaultAccount = library.accounts.find((account) => account.id === library.defaultAccountId) || null;
      const accountHero = h(HeroMini, { cells: [{ label: '启用账号', value: String(active.length), tone: 'brand' }, { label: '默认账号', value: defaultAccount ? defaultAccount.name : '未设置', tone: defaultAccount ? 'green' : undefined }, { label: '已归档', value: String(archived.length) }] });
      const drawerView = editing && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: closeDrawer }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': editingAccount ? `编辑账号定位 · ${editingAccount.name}` : '新建账号定位' },
          h('form', { className: 'sv-drawer-list', onSubmit: save },
            h('div', { className: 'sv-drawer-head' },
              h('div', null,
                h('h3', { style: { margin: '0', fontSize: 'var(--lwb-text-section,18px)' } }, editingAccount ? '编辑账号定位' : '新建账号定位'),
                editingAccount && h('p', { className: 'sv-meta' }, editingAccount.configured ? `已完善 · ${editingAccount.status === 'active' ? '启用' : '已归档'}` : '待完善 · 尚未填写内容约束'),
              ),
              h('button', { type: 'button', className: 'lwb-plain-button', onClick: closeDrawer }, '关闭'),
            ),
            h('div', { className: 'sv-acc-complete' },
              h('button', { type: 'button', className: 'lwb-primary-button', disabled: saving || completing || !formHasInput, onClick: () => { void complete(); } }, completing ? 'Agent 正在完善…' : 'Agent协助完善'),
              h('span', { className: 'sv-meta' }, '把录入内容当作草稿：Agent 可润色、扩写并补齐全部字段；结果回填表单，需人工检查后才保存。'),
            ),
            completionNote && h('p', { className: 'sv-note' }, completionNote),
            h('label', { className: 'sv-meta' }, '账号名称 *'),
            h('input', { className: 'sv-input', value: form.name, maxLength: 80, required: true, placeholder: '例如：AI 工具解读号', disabled: saving, onChange: (event) => setForm({ ...form, name: event.target.value }) }),
            accountExecutionId ? h(ExecutionButton, { kind: 'account', id: accountExecutionId }) : null,
            h('label', { className: 'sv-meta' }, '账号定位'),
            h('textarea', { className: 'sv-textarea', style: { minHeight: '70px' }, value: form.positioning, maxLength: 600, placeholder: '例如：面向普通创作者的 AI 工具解读', disabled: saving, onChange: (event) => setForm({ ...form, positioning: event.target.value }) }),
            h('label', { className: 'sv-meta' }, '目标受众'),
            h('input', { className: 'sv-input', value: form.audience, maxLength: 300, placeholder: '例如：想提升效率的职场创作者', disabled: saving, onChange: (event) => setForm({ ...form, audience: event.target.value }) }),
            h('label', { className: 'sv-meta' }, '内容方向（用顿号或逗号分隔）'),
            h('input', { className: 'sv-input', value: form.pillars, maxLength: 480, placeholder: '工具拆解、行业观察', disabled: saving, onChange: (event) => setForm({ ...form, pillars: event.target.value }) }),
            h('label', { className: 'sv-meta' }, '内容边界'),
            h('textarea', { className: 'sv-textarea', style: { minHeight: '70px' }, value: form.boundary, maxLength: 600, placeholder: '允许和禁止的内容，例如：不做医疗与投资建议', disabled: saving, onChange: (event) => setForm({ ...form, boundary: event.target.value }) }),
            h('div', { className: 'sv-actions' },
              h('button', { type: 'submit', className: 'lwb-primary-button', disabled: saving || !form.name.trim() }, saving ? '正在保存…' : editingAccount ? '保存账号' : '创建账号'),
              editingAccount?.status === 'active' && editingAccount.id !== library.defaultAccountId ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: saving, onClick: () => { void makeDefault(editingAccount); } }, '设为默认') : null,
              editingAccount?.status === 'active' ? h('button', { type: 'button', className: 'lwb-plain-button sv-acc-danger', disabled: saving, onClick: () => ask({ title: '归档账号', copy: `归档账号「${editingAccount.name}」？归档后不再出现在选题账号列表中。`, confirm: '归档', danger: true, onConfirm: () => { void setStatus(editingAccount, 'archived'); } }) }, '归档账号') : null,
            ),
            h('p', { className: 'sv-note' }, editingAccount ? '保存后的定位仅影响后续新生成的选题；归档不会删除已确认项目中的账号快照。' : '创建后即可在选题时选择该账号；确认选题后定位快照会绑定到项目，写稿自动继承。'),
          ),
        ),
      );
      return h(PackFrame, { packId, openConversation, title: '账号定位', copy: '管理本工作区的账号定位库。选题时明确选择一个账号，确认后会将定位快照绑定到项目；写稿自动继承该项目的账号上下文。', hero: accountHero },
        h(Notice, { error }),
        h(ExecutionHistory, { kind: 'account', refreshKey: completing }),
        h('section', { className: 'sv-section' },
          h('div', { className: 'sv-section-head' },
            h('h3', null, '账号定位库'),
            h('span', null, `${active.length} 个启用 · 上限 50`),
          ),
          h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: saving, onClick: openCreate }, '新建账号')),
          active.length ? h('div', { className: 'sv-acc-grid' }, [...active.map(accountCard), newTile]) : h('div', { className: 'sv-empty-cta' }, h('p', null, '还没有账号定位。建立第一个账号后，选题与写稿会自动继承它的定位约束。'), h('div', null, h('button', { type: 'button', className: 'lwb-primary-button', disabled: saving, onClick: openCreate }, '建立第一个账号'))),
          archived.length ? h('section', { className: 'sv-section' },
            h('div', { className: 'sv-section-head' }, h('h3', null, '已归档'), h('span', null, '归档不会删除已确认项目中的账号快照')),
            h('div', { className: 'sv-list' }, archived.map((account) => h('div', { key: account.id, className: 'sv-acc-arch' },
              h('span', { className: 'sv-acc-arch-info' },
                h('strong', null, account.name),
                h('span', null, `归档于 ${relativeTime(account.updatedAt)} · 快照保留在已确认项目中`),
              ),
              h('div', { className: 'sv-acc-arch-actions' },
                h('button', { type: 'button', className: 'lwb-plain-button', disabled: saving, onClick: () => { void setStatus(account, 'active'); } }, '恢复'),
                h('button', { type: 'button', className: 'lwb-plain-button sv-acc-danger', disabled: saving, onClick: () => ask({ title: '删除账号', copy: `删除账号“${account.name}”？删除不可恢复，但不影响已确认项目中的账号快照。`, confirm: '删除', danger: true, onConfirm: () => { void deleteAccount(account); } }) }, '删除'),
              ),
            ))),
          ) : null,
        ),
        drawerView,
        confirmNode,
      );
    }

    const GENERAL_TAB = '__general__';
    function AccountTabs({ accountLibrary, activeTab, onChange, label, disabled = false, children }) {
      const accounts = accountLibrary.accounts.filter((account) => account.status === 'active');
      const tab = (id, name) => h('button', {
        key: id, type: 'button', role: 'tab', className: 'sv-tp-tab',
        'data-active': activeTab === id ? 'true' : 'false', 'aria-selected': activeTab === id,
        disabled, onClick: () => onChange(id),
      }, id === accountLibrary.defaultAccountId ? h('span', { className: 'sv-tp-tab-dot', title: '默认账号', 'aria-label': '默认账号' }) : null, name);
      return h('div', { className: 'sv-tp-tabs', role: 'tablist', 'aria-label': label },
        accounts.map((account) => tab(account.id, account.name)),
        tab(GENERAL_TAB, '通用（无账号定位）'), children,
      );
    }
    const TOPIC_HISTORY_PAGE_SIZE = 6;
    function emptyTopicForm() { return { angle: '', offSources: new Set(), offPlatforms: new Set(), excluded: new Set() }; }
    function sourceDotColor(name) {
      const hash = String(name || '').split('').reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 11);
      return `hsl(${hash % 360}, 62%, 52%)`;
    }
    function TopicsPage({ packId, openConversation }) {
      const { projects, refresh, error, setError } = useProjects(packId);
      const [board, setBoard] = React.useState(null);
      const [sources, setSources] = React.useState([]);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [formsByTab, setFormsByTab] = React.useState({});
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const [history, setHistory] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [launching, setLaunching] = React.useState(false);
      const [historyFilter, setHistoryFilter] = React.useState('all');
      const [historyPage, setHistoryPage] = React.useState(0);
      const [drawer, setDrawer] = React.useState(null);
      const [openSummary, setOpenSummary] = React.useState(null);
      const [openCand, setOpenCand] = React.useState(null);
      const [confirmNode, ask] = useSvConfirm();

      const loadHistory = React.useCallback(async () => {
        if (!packId) return [];
        try { const next = await remote(packId, 'listTopicGenerations'); setHistory(next); return next; } catch (cause) { setError(cause.message); return []; }
      }, [packId, setError]);

      React.useEffect(() => {
        if (!packId) return;
        void Promise.all([remote(packId, 'board'), remote(packId, 'sources'), remote(packId, 'listAccounts'), remote(packId, 'listTopicGenerations')])
          .then(([nextBoard, nextSources, nextAccounts, nextHistory]) => {
            setBoard(nextBoard); setSources(nextSources); setAccountLibrary(nextAccounts); setHistory(nextHistory);
            setActiveTab((current) => current !== GENERAL_TAB && nextAccounts.accounts.some((item) => item.id === current && item.status === 'active') ? current : nextAccounts.defaultAccountId || GENERAL_TAB);
          }).catch((cause) => setError(cause.message));
      }, [packId, setError]);

      const activeTasks = history.filter((item) => item.status === 'queued' || item.status === 'running');
      const runningCount = activeTasks.filter((item) => item.status === 'running').length;
      const queuedCount = activeTasks.length - runningCount;
      React.useEffect(() => {
        if (!packId || !activeTasks.length) return undefined;
        let active = true;
        const tick = () => { void remote(packId, 'listTopicGenerations').then((list) => { if (active) setHistory(list); }).catch((cause) => { if (active) setError(cause.message); }); };
        const timer = setInterval(tick, 1500);
        return () => { active = false; clearInterval(timer); };
      }, [packId, activeTasks.length, setError]);

      if (!packId) return h(NeedPack, { openConversation });

      const activeAccounts = accountLibrary.accounts.filter((item) => item.status === 'active');
      const form = formsByTab[activeTab] || emptyTopicForm();
      const patchForm = (fn) => setFormsByTab((prev) => ({ ...prev, [activeTab]: fn(prev[activeTab] || emptyTopicForm()) }));
      const publicCards = (board?.sources || []).filter((card) => card.id !== 'ai-daily-import');
      const platformCards = board?.aiDaily?.platforms || [];
      const allPublicIds = publicCards.map((card) => card.id);
      const selectedPublic = allPublicIds.filter((id) => !form.offSources.has(id));
      const selectedPlatforms = platformCards.map((card) => card.platform).filter((name) => !form.offPlatforms.has(name));
      const aiDailyOn = selectedPlatforms.length > 0;
      const allPlatformsSelected = platformCards.length > 0 && selectedPlatforms.length === platformCards.length;
      const selectedCount = selectedPublic.length + selectedPlatforms.length;
      const submitSourceIds = [...selectedPublic, ...(aiDailyOn ? ['ai-daily-import'] : [])];
      const activeAccount = activeAccounts.find((item) => item.id === activeTab) || null;
      const selectedSourceNames = [
        ...publicCards.filter((card) => !form.offSources.has(card.id)).map((card) => card.name),
        ...(aiDailyOn ? [`AI 内容日报 · ${allPlatformsSelected ? '全部平台' : selectedPlatforms.join('、')}`] : []),
      ];
      const selectedCandidatesOf = (record) => (record.candidates || []).filter((candidate) => candidate.selection?.state === 'selected');
      const queuedCandidateCount = history.reduce((count, record) => count + selectedCandidatesOf(record).length, 0);
      const terminalTasks = history.filter((item) => item.status !== 'queued' && item.status !== 'running');
      const filteredTerminalTasks = terminalTasks.filter((item) => historyFilter === 'all' || item.status === historyFilter);
      const historyPageCount = Math.max(1, Math.ceil(filteredTerminalTasks.length / TOPIC_HISTORY_PAGE_SIZE));
      const currentHistoryPage = Math.min(historyPage, historyPageCount - 1);
      const pagedTerminalTasks = filteredTerminalTasks.slice(currentHistoryPage * TOPIC_HISTORY_PAGE_SIZE, (currentHistoryPage + 1) * TOPIC_HISTORY_PAGE_SIZE);
      const historyRangeStart = filteredTerminalTasks.length ? currentHistoryPage * TOPIC_HISTORY_PAGE_SIZE + 1 : 0;
      const historyRangeEnd = Math.min((currentHistoryPage + 1) * TOPIC_HISTORY_PAGE_SIZE, filteredTerminalTasks.length);
      const historyFilters = [
        { id: 'all', label: '全部', count: terminalTasks.length },
        { id: 'completed', label: '已完成', count: terminalTasks.filter((item) => item.status === 'completed').length },
        { id: 'failed', label: '失败', count: terminalTasks.filter((item) => item.status === 'failed').length },
      ];
      React.useEffect(() => { setHistoryPage(0); }, [historyFilter]);
      React.useEffect(() => {
        if (historyPage >= historyPageCount) setHistoryPage(historyPageCount - 1);
      }, [historyPage, historyPageCount]);

      const toggleSource = (id) => { if (launching) return; patchForm((current) => { const offSources = new Set(current.offSources); if (offSources.has(id)) offSources.delete(id); else offSources.add(id); return { ...current, offSources }; }); };
      const togglePlatform = (name) => { if (launching) return; patchForm((current) => { const offPlatforms = new Set(current.offPlatforms); if (offPlatforms.has(name)) offPlatforms.delete(name); else offPlatforms.add(name); return { ...current, offPlatforms }; }); };
      const selectAllSources = () => { if (launching) return; patchForm((current) => ({ ...current, offSources: new Set(), offPlatforms: new Set() })); };
      const clearSources = () => { if (launching) return; patchForm((current) => ({ ...current, offSources: new Set(allPublicIds), offPlatforms: new Set(platformCards.map((card) => card.platform)) })); };
      const toggleExclude = (signalId) => patchForm((current) => { const excluded = new Set(current.excluded); if (excluded.has(signalId)) excluded.delete(signalId); else excluded.add(signalId); return { ...current, excluded }; });
      const clearExcluded = () => patchForm((current) => ({ ...current, excluded: new Set() }));

      const currentPayload = () => ({
          angle: form.angle.trim() || undefined,
          accountId: activeTab === GENERAL_TAB ? undefined : activeTab,
          sourceIds: submitSourceIds.length ? submitSourceIds : undefined,
          platforms: aiDailyOn && !allPlatformsSelected ? selectedPlatforms : undefined,
          excludeSignalIds: form.excluded.size ? [...form.excluded] : undefined,
        });
      const launch = async (payload) => {
        if (launching) return;
        setLaunching(true); setError(null);
        try { await remote(packId, 'startTopicGeneration', payload); await loadHistory(); }
        catch (cause) { setError(cause.message); } finally { setLaunching(false); }
      };
      const confirmLaunch = (payload, description) => {
        if (launching) return;
        ask({
          title: '启动选题任务？',
          copy: `${description}。任务将先确认渠道当天采集，缺失时自动补采；补采仍失败的渠道会被跳过，不阻塞本轮选题，再交给 DSH 生成最多 5 个候选。任务会立即出现在右侧；你可以继续编辑并启动其他任务。完成后推荐候选会自动加入待写稿。`,
          confirm: '启动任务',
          onConfirm: () => { void launch(payload); },
        });
      };
      const generate = () => {
        if (launching || selectedCount === 0) return;
        const accountLabel = activeAccount ? `账号「${activeAccount.name}」` : '通用（无账号定位）';
        const angleLabel = form.angle.trim() ? `选题角度「${form.angle.trim()}」` : '未设置选题角度';
        const exclusions = form.excluded.size ? `，排除 ${form.excluded.size} 条信号` : '';
        confirmLaunch(currentPayload(), `${accountLabel}；${angleLabel}；参与渠道：${selectedSourceNames.join('、')}${exclusions}`);
      };
      const regenerate = (record) => {
        if (launching) return;
        const accountLabel = record.account?.name ? `账号「${record.account.name}」` : '通用（无账号定位）';
        confirmLaunch(record.input || {}, `将按该任务的冻结配置重新生成：${accountLabel}`);
        setOpenCand(null);
      };
      const toggleCandidateSelection = async (record, candidate) => {
        const state = candidate?.selection?.state || 'available';
        if (!candidate || busy || state === 'activating' || state === 'deactivating') return;
        setBusy(true);
        try {
          await remote(packId, 'setTopicCandidateSelection', { id: record.id, candidateId: candidate.id, selected: state !== 'selected' });
          setError(null);
          await refresh(); await loadHistory();
        } catch (cause) { setError(cause.message); } finally { setBusy(false); }
      };

      const openSourceDrawer = (card) => setDrawer({ kind: 'signals', sourceId: card.id, platform: null, name: card.name });
      const openPlatformDrawer = (card) => setDrawer({ kind: 'signals', sourceId: 'ai-daily-import', platform: card.platform, name: `AI 内容日报 · ${card.platform}` });
      const openCandidate = (record) => { setOpenCand(record.id); };

      const tabs = h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号定位选择选题范围' });

      const accountNote = activeAccount
        ? h('p', { className: 'sv-tp-acct-note' }, `本次将注入「${activeAccount.name}」${activeAccount.configured ? '的定位约束' : '（尚未填写内容约束）'}；加入待写稿时定位快照绑定到项目。`)
        : h('p', { className: 'sv-tp-acct-note' }, '本次不注入账号定位。', h('button', { type: 'button', className: 'sv-tp-acct-link', onClick: () => { setActiveTab(accountLibrary.defaultAccountId || GENERAL_TAB); } }, activeAccounts.length ? ' 切换到账号 Tab' : ' 去「账号定位」建立账号'));

      const sourceCard = (card) => {
        const on = !form.offSources.has(card.id);
        return h('div', { key: card.id, className: 'sv-tp-src', 'data-on': on ? 'true' : 'false' },
          h('div', { className: 'sv-tp-src-head' },
            h('button', { type: 'button', className: 'sv-tp-src-check', disabled: launching, 'aria-pressed': on, 'aria-label': `${on ? '取消' : '选择'}${card.name}`, onClick: () => toggleSource(card.id) }, h('i', null)),
            h('button', { type: 'button', className: 'sv-tp-src-main', onClick: () => openSourceDrawer(card) },
              h('span', { className: 'sv-tp-src-titlerow' }, h('span', { className: 'sv-tp-src-dot', style: { background: sourceDotColor(card.name) } }), h('span', { className: 'sv-tp-src-name' }, card.name)),
              h('span', { className: 'sv-tp-src-meta' }, `最新 ${relativeTime(card.lastSuccessAt)} · 今日 ${card.todayCount}`),
            ),
          ),
        );
      };
      const platformCard = (card) => {
        const on = !form.offPlatforms.has(card.platform);
        const glyph = PLATFORM_GLYPHS[card.platform];
        return h('div', { key: card.platform, className: 'sv-tp-src', 'data-on': on ? 'true' : 'false' },
          h('div', { className: 'sv-tp-src-head' },
            h('button', { type: 'button', className: 'sv-tp-src-check', disabled: launching, 'aria-pressed': on, 'aria-label': `${on ? '取消' : '选择'}${card.platform}`, onClick: () => togglePlatform(card.platform) }, h('i', null)),
            h('button', { type: 'button', className: 'sv-tp-src-main', onClick: () => openPlatformDrawer(card) },
              h('span', { className: 'sv-tp-src-titlerow' }, h('span', { className: 'sv-tp-src-dot', style: { background: glyph ? glyph[0] : sourceDotColor(card.platform) } }), h('span', { className: 'sv-tp-src-name' }, card.platform)),
              h('span', { className: 'sv-tp-src-meta' }, `最新 ${relativeTime(card.lastImportedAt)} · 今日 ${card.todayCount}`),
            ),
          ),
        );
      };

      const configCard = h('section', { className: 'sv-form' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '新建选题任务'), h('span', null, activeAccount ? activeAccount.name : '通用 · 无账号定位')),
        tabs,
        accountNote,
        h('label', { className: 'sv-meta' }, '选题角度（选填）'),
        h('textarea', { className: 'sv-textarea', style: { minHeight: '64px' }, value: form.angle, maxLength: 500, placeholder: '例如：避坑角度 · 真实使用场景，面向新手创作者', disabled: launching, onChange: (event) => patchForm((current) => ({ ...current, angle: event.target.value })) }),
        h('div', { className: 'sv-section-head' },
          h('label', { className: 'sv-meta' }, `参与渠道（初始已全选 · 已选 ${selectedCount}）`),
          h('span', { className: 'sv-actions' },
            h('button', { type: 'button', className: 'sv-tp-acct-link', disabled: launching, onClick: selectAllSources }, '全选'),
            h('button', { type: 'button', className: 'sv-tp-acct-link', disabled: launching, onClick: clearSources }, '清空'),
          ),
        ),
        h('p', { className: 'sv-tp-acct-note' }, '勾选决定哪些渠道的最新采集进入本轮。启动时会先补采当天缺失的渠道；补采失败的渠道会跳过，不阻塞本轮选题。点渠道名可查看信号，并排除单条。'),
        publicCards.length ? h('div', { className: 'sv-tp-srcgrid' }, publicCards.map(sourceCard)) : h('p', { className: 'sv-note' }, '正在读取信号源…'),
        platformCards.length ? h(React.Fragment, null,
          h('label', { className: 'sv-meta' }, 'AI 内容日报（报告导入 · 按平台）'),
          h('div', { className: 'sv-tp-srcgrid' }, platformCards.map(platformCard)),
        ) : null,
        form.excluded.size ? h('div', { className: 'sv-tp-exclbar' }, h('span', null, `已在抽屉中排除 ${form.excluded.size} 条信号，本次生成不参与。`), h('button', { type: 'button', disabled: launching, onClick: clearExcluded }, '清空排除')) : null,
        h('div', { className: 'sv-actions' },
          h('button', { type: 'button', className: 'lwb-primary-button', disabled: launching || selectedCount === 0, onClick: generate }, launching ? '正在创建任务…' : '生成选题'),
          selectedCount === 0 ? h('span', { className: 'sv-meta' }, '至少选择一个参与渠道') : null,
        ),
      );

      const stepPills = (record) => h('div', { className: 'sv-tp-steps' }, (record.steps || []).map((step) => h('span', { key: step.id, className: 'sv-tp-step', 'data-state': step.status, title: step.detail || step.label }, h('i', null), step.detail || step.label)));
      const taskCard = (record) => {
        const selectedCandidates = selectedCandidatesOf(record);
        const taskActive = record.status === 'queued' || record.status === 'running';
        const statusTag = record.status === 'queued' ? ['排队中', 'sv-status-manual']
          : record.status === 'running' ? ['运行中', '']
          : record.status === 'failed' ? ['失败', 'sv-status-error']
          : selectedCandidates.length ? [`待写稿 ${selectedCandidates.length}`, 'sv-stage']
          : [`${record.returned} 个候选`, ''];
        return h('div', { key: record.id, className: 'sv-tp-task', 'data-status': record.status, 'data-confirmed': selectedCandidates.length ? 'true' : 'false' },
          h('div', { className: 'sv-tp-task-head' },
            h('div', null,
              h('p', { className: 'sv-tp-task-title' }, record.summary || '选题生成'),
              h('p', { className: 'sv-tp-task-meta' }, `${relativeTime(record.startedAt)} · 账号：${record.account?.name || '无'}${record.elapsedMs != null ? ` · 耗时 ${(record.elapsedMs / 1000).toFixed(1)}s` : ''}`),
            ),
            h('span', { className: 'sv-tp-task-badges' }, h('span', { className: `sv-tag ${statusTag[1]}` }, statusTag[0])),
          ),
          taskActive ? h('div', { role: 'status', 'aria-live': 'polite' }, stepPills(record)) : null,
          record.unavailableSources?.length ? h('p', { className: 'sv-note', role: 'status' }, `部分信号源未获得当天数据，本轮未使用：${record.unavailableSources.map((item) => item.name || item.id).join('、')}。${record.materialSignalIds?.length ? '已使用其他可用来源继续生成。' : '已按用户输入与账号定位继续生成。'}`) : null,
          selectedCandidates.length ? h('div', { className: 'sv-tp-confirmed' },
            h('span', { className: 'sv-tp-confirmed-title' }, `已加入待写稿 ${selectedCandidates.length} 个`),
            h('span', { className: 'sv-tp-confirmed-meta' }, selectedCandidates.map((candidate) => {
              const project = candidate.selection?.projectId ? projects.find((item) => item.id === candidate.selection.projectId) : null;
              return `${candidate.title}${project ? ` · ${stageName(project)}` : ' · 正在建立项目'}`;
            }).join('；')),
          ) : null,
          h('div', { className: 'sv-tp-task-acts' },
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setOpenSummary(record.id) }, '执行详情'),
            record.status === 'completed' && record.returned ? h('button', { type: 'button', className: selectedCandidates.length ? 'lwb-plain-button' : 'lwb-primary-button', onClick: () => openCandidate(record) }, selectedCandidates.length ? '管理候选' : '查看候选') : null,
            record.status === 'failed' ? h('button', { type: 'button', className: 'lwb-primary-button', disabled: launching, onClick: () => regenerate(record) }, '重试') : null,
            record.status === 'queued' ? h('span', { className: 'sv-note' }, '等待可用的生成执行位；可以继续创建其他任务。') : null,
            record.status === 'running' ? h('span', { className: 'sv-note' }, '切换页面不会中断，完成后在此查看候选。') : null,
          ),
        );
      };

      const taskPanel = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '选题任务 · 全部账号'), h('span', { role: 'status', 'aria-live': 'polite' }, activeTasks.length ? `运行 ${runningCount} · 排队 ${queuedCount}` : `${terminalTasks.length} 条历史 · ${queuedCandidateCount} 个待写稿`)),
        history.length ? h(React.Fragment, null,
          activeTasks.length ? h('div', { className: 'sv-tp-task-group' },
            h('div', { className: 'sv-tp-task-group-head' }, h('h4', { className: 'sv-tp-task-group-title' }, '进行中的任务'), h('span', { className: 'sv-tp-task-group-meta' }, `${activeTasks.length} 个任务始终置顶`)),
            h('div', { className: 'sv-list' }, activeTasks.map(taskCard)),
          ) : null,
          h('div', { className: 'sv-tp-task-group' },
            h('div', { className: 'sv-tp-task-group-head' }, h('h4', { className: 'sv-tp-task-group-title' }, '历史任务'), h('span', { className: 'sv-tp-task-group-meta' }, filteredTerminalTasks.length ? `显示 ${historyRangeStart}-${historyRangeEnd} / ${filteredTerminalTasks.length}` : '没有历史任务')),
            h('div', { className: 'sv-tp-history-filters', role: 'group', 'aria-label': '按任务状态筛选历史任务' }, historyFilters.map((filter) => h('button', { key: filter.id, type: 'button', className: 'sv-tp-history-filter', 'aria-pressed': historyFilter === filter.id, onClick: () => setHistoryFilter(filter.id) }, `${filter.label} ${filter.count}`))),
            pagedTerminalTasks.length ? h(React.Fragment, null,
              h('div', { className: 'sv-list' }, pagedTerminalTasks.map(taskCard)),
              historyPageCount > 1 ? h('div', { className: 'sv-tp-pagination', 'aria-label': '历史任务分页' },
                h('button', { type: 'button', className: 'lwb-plain-button', title: '上一页', 'aria-label': '上一页', disabled: currentHistoryPage === 0, onClick: () => setHistoryPage((page) => Math.max(0, page - 1)) }, '←'),
                h('span', { className: 'sv-tp-pagination-page', 'aria-live': 'polite' }, `第 ${currentHistoryPage + 1} / ${historyPageCount} 页`),
                h('button', { type: 'button', className: 'lwb-plain-button', title: '下一页', 'aria-label': '下一页', disabled: currentHistoryPage >= historyPageCount - 1, onClick: () => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1)) }, '→'),
              ) : null,
            ) : h('div', { className: 'sv-empty' }, '没有符合当前筛选条件的历史任务。'),
          ),
        ) : h('div', { className: 'sv-empty' }, '尚无选题任务。左侧圈定参与渠道后点击「生成选题」。'),
      );

      const summaryRecord = history.find((item) => item.id === openSummary) || null;
      const summaryDrawer = summaryRecord && h(ExecutionDrawer, { key: summaryRecord.id, request: { kind: 'topic', id: summaryRecord.id }, onClose: () => setOpenSummary(null) });

      const candRecord = history.find((item) => item.id === openCand) || null;
      const candidateDrawer = candRecord && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: () => { setOpenCand(null); } }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '候选选题' },
          h('div', { className: 'sv-drawer-head' },
            h('div', null,
              h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, `提供选题 · ${candRecord.returned} 个`),
              h('p', { className: 'sv-meta' }, `${candRecord.account?.name || '通用'} · ${relativeTime(candRecord.startedAt)}${candRecord.elapsedMs != null ? ` · 耗时 ${(candRecord.elapsedMs / 1000).toFixed(1)}s` : ''} · 推荐项已自动加入待写稿`),
            ),
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => { setOpenCand(null); } }, '关闭'),
          ),
          h('div', { className: 'sv-drawer-list' },
            h('p', { className: 'sv-note' }, '候选按 DSH 推荐程度排序。第一个已自动加入待写稿；可继续加入其他候选，未写稿前也可移出。'),
            candRecord.candidates.length ? candRecord.candidates.map((candidate, index) => {
              const state = candidate.selection?.state || 'available';
              const project = candidate.selection?.projectId ? projects.find((item) => item.id === candidate.selection.projectId) : null;
              const hasScript = Boolean(project?.completedStages?.includes('script'));
              const stateLabel = state === 'selected' ? hasScript ? '已有稿件' : '已加入待写稿' : state === 'activating' ? '加入中…' : state === 'deactivating' ? '移出中…' : '加入待写稿';
              return h('button', { key: candidate.id, type: 'button', className: 'sv-tp-cand', 'data-sel': state === 'selected' ? 'true' : 'false', disabled: busy || state === 'activating' || state === 'deactivating' || hasScript, onClick: () => { void toggleCandidateSelection(candRecord, candidate); } },
              h('span', { className: 'sv-tp-cand-head' },
                h('span', { className: 'sv-tp-cand-radio' }, h('i', null)),
                h('span', { className: 'sv-tp-cand-title' }, candidate.title),
                index === 0 ? h('span', { className: 'sv-tp-rec' }, '推荐') : null,
                h('span', { className: state === 'selected' ? 'sv-stage' : 'sv-tag' }, stateLabel),
              ),
              h('p', { className: 'sv-tp-cand-meta' }, [candidate.videoForm, candidate.angle, `依据 ${candidate.signalIds.length} 条信号`].filter(Boolean).join(' · ')),
              candidate.contentCore ? h('p', { className: 'sv-tp-cand-core' }, candidate.contentCore) : null,
              candidate.whyNow ? h('p', { className: 'sv-tp-cand-why' }, `为什么现在做：${candidate.whyNow}`) : null,
              candidate.selection?.error ? h('p', { className: 'sv-error' }, candidate.selection.error) : null,
            );
            }) : h('p', { className: 'sv-note' }, '本轮没有获得候选，请调整输入后重新生成。'),
          ),
          h('div', { className: 'sv-tp-drawer-foot' },
            h('span', { className: 'sv-meta' }, `已加入待写稿 ${selectedCandidatesOf(candRecord).length} 个`),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: launching, onClick: () => regenerate(candRecord) }, '生成新一批'),
            h('button', { type: 'button', className: 'lwb-primary-button', onClick: () => { setOpenCand(null); } }, '完成'),
          ),
        ),
      );

      const collectFromDrawer = async (ids) => {
        setBusy(true); setError(null);
        try { await remote(packId, 'collectSources', { sourceIds: ids }); await remote(packId, 'board').then(setBoard); }
        catch (cause) { setError(cause.message); } finally { setBusy(false); }
      };
      const signalsDrawer = drawer && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: () => setDrawer(null) }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': drawer.name },
          h(SignalDrawerBody, { packId, sources, spec: drawer, today: board?.today, busy, onClose: () => setDrawer(null), onCollect: (ids) => { void collectFromDrawer(ids); }, onChanged: () => { void remote(packId, 'board').then(setBoard).catch(() => {}); }, ask, selection: { excluded: form.excluded, onToggle: toggleExclude } }),
        ),
      );

      return h(PackFrame, { packId, openConversation, title: '选题', copy: '按账号定位分 Tab 选择参与渠道与选题角度。确认后任务会立即进入右侧列表；可继续创建其他任务。启动时会补采当天缺失的渠道，本轮仅使用各渠道最新一次采集的信号。推荐项自动加入待写稿，其他候选可按需加入或移出。', hero: h(HeroMini, { cells: [{ label: '近 7 日可用', value: String(board?.totals?.active ?? '—') }, { label: '任务状态', value: activeTasks.length ? `运行 ${runningCount} · 排队 ${queuedCount}` : '空闲', tone: activeTasks.length ? 'orange' : 'green' }, { label: '待写稿选题', value: String(queuedCandidateCount), tone: 'brand' }] }) },
        h(Notice, { error }),
        h('section', { className: 'sv-split' }, configCard, taskPanel),
        signalsDrawer,
        summaryDrawer,
        candidateDrawer,
        confirmNode,
      );
    }
    const ARCHIVED_TAB = '__archived__';
    function emptyScriptForm() { return { tier: 'medium', instructions: '', targetId: null }; }
    const SCRIPT_STATE_LABEL = { none: '未写稿', draft: '已保存', approved: '已保存' };
    const TIER_OPTIONS = [['short', '短篇', '300-999 字'], ['medium', '中篇', '1000-2499 字'], ['long', '长篇', '2500 字以上']];
    const TIER_LABEL = { short: '短篇', medium: '中篇', long: '长篇' };
    const TIER_SHORT = { short: '短', medium: '中', long: '长' };
    function scriptDurationLabel(text) {
      const spoken = Array.from(String(text || '').replace(/[\s\p{P}\p{S}]/gu, '')).length;
      const secs = Math.round(spoken / 4.1);
      return `${Math.floor(secs / 60)} 分 ${String(secs % 60).padStart(2, '0')} 秒`;
    }
    function charCount(text) { return Array.from(String(text || '').replace(/\s+/g, '')).length; }
    function originalityLabel(risk) { return risk === 'high' ? '高' : risk === 'medium' ? '中' : '低'; }

    /**
     * The script page keeps the topic page's shape — configure a new run on the
     * left, watch runs on the right — and puts the whole script lifecycle
     * (AI generation -> optional edit -> polish -> quality -> approve) inside
     * one drawer.
     * Account binding is deliberately absent: a project's account is decided
     * when its topic is confirmed, and rebinding here would rewrite the topic
     * artifact and destroy the script plus every downstream stage.
     */
    function ScriptPage({ packId, openConversation, openPackMenu }) {
      const { projects, refresh, error, setError } = useProjects(packId);
      const [topics, setTopics] = React.useState([]);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [formsByTab, setFormsByTab] = React.useState({});
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const [history, setHistory] = React.useState([]);
      const [historyFilter, setHistoryFilter] = React.useState('all');
      const [historyPage, setHistoryPage] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [openMore, setOpenMore] = React.useState(false);
      const [openSummary, setOpenSummary] = React.useState(null);
      // One selection surface for the whole page: the drawer is keyed by project.
      const [openProject, setOpenProject] = React.useState(null);
      const [drawerMode, setDrawerMode] = React.useState('read');
      const [scriptModal, setScriptModal] = React.useState(null);
      const drawerScrollRef = React.useRef(null);
      const editorRef = React.useRef(null);
      const [moreFilter, setMoreFilter] = React.useState('all');
      const [moreQuery, setMoreQuery] = React.useState('');
      const [body, setBody] = React.useState('');
      const [report, setReport] = React.useState(null);
      const [reportBody, setReportBody] = React.useState('');
      const [reportBusy, setReportBusy] = React.useState(false);
      const [draftTier, setDraftTier] = React.useState('medium');
      const [polishNote, setPolishNote] = React.useState('');
      const [regenerateNote, setRegenerateNote] = React.useState('');
      const [confirmNode, ask] = useSvConfirm();

      const { detail, error: detailError, reload } = useDetail(packId, openProject);
      const { saving, commit } = useCommit(packId, refresh, reload, setError);

      const loadTopics = React.useCallback(async () => {
        if (!packId) return [];
        try { const next = await remote(packId, 'listWritableTopics'); setTopics(next); return next; }
        catch (cause) { setError(cause.message); return []; }
      }, [packId, setError]);
      const loadHistory = React.useCallback(async () => {
        if (!packId) return [];
        try { const next = await remote(packId, 'listScriptGenerations'); setHistory(next); return next; }
        catch (cause) { setError(cause.message); return []; }
      }, [packId, setError]);

      React.useEffect(() => {
        if (!packId) return;
        void Promise.all([remote(packId, 'listAccounts'), loadTopics(), loadHistory()])
          .then(([accounts]) => {
            setAccountLibrary(accounts);
            setActiveTab((current) => current !== GENERAL_TAB && accounts.accounts.some((item) => item.id === current && item.status === 'active') ? current : accounts.defaultAccountId || GENERAL_TAB);
          }).catch((cause) => setError(cause.message));
      }, [packId, loadTopics, loadHistory, setError]);

      // Commits and approvals change a topic's scriptState, so follow the project list.
      React.useEffect(() => { void loadTopics(); }, [projects, loadTopics]);

      const anyRunning = history.some((item) => item.status === 'running');
      const projectIsRunning = (projectId) => history.some((item) => item.projectId === projectId && (item.status === 'queued' || item.status === 'running'));
      const projectBusy = Boolean(openProject && projectIsRunning(openProject));
      React.useEffect(() => { setHistoryPage(0); }, [historyFilter]);
      React.useEffect(() => {
        if (!packId || !anyRunning) return undefined;
        let active = true;
        const tick = () => {
          void (async () => {
            await loadHistory();
            if (!active) return;
            await Promise.all([loadTopics(), refresh(), openProject ? reload() : Promise.resolve()]);
          })();
        };
        tick();
        const timer = setInterval(tick, 1500);
        return () => { active = false; clearInterval(timer); };
      }, [packId, anyRunning, loadHistory, loadTopics, refresh, reload, openProject]);

      const activeAccounts = accountLibrary.accounts.filter((item) => item.status === 'active');
      const activeIds = new Set(activeAccounts.map((item) => item.id));
      const tabOf = (topic) => (!topic.account ? GENERAL_TAB : activeIds.has(topic.account.id) ? topic.account.id : ARCHIVED_TAB);
      const sortTopics = (list) => { const rank = { approved: 0, none: 1 }; return [...list].sort((a, b) => (rank[a.scriptState] - rank[b.scriptState]) || b.updatedAt.localeCompare(a.updatedAt)); };
      const tabTopics = sortTopics(topics.filter((topic) => tabOf(topic) === activeTab));
      const archivedTopics = sortTopics(topics.filter((topic) => tabOf(topic) === ARCHIVED_TAB));
      const tabName = activeTab === GENERAL_TAB ? '通用（无账号定位）' : (activeAccounts.find((item) => item.id === activeTab)?.name || '—');

      // Keep a valid new-run target for the active tab.
      React.useEffect(() => {
        const ids = new Set(topics.map((topic) => topic.projectId));
        setFormsByTab((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            const current = next[key] || emptyScriptForm();
            if (current.targetId && !ids.has(current.targetId)) next[key] = { ...current, targetId: null };
          }
          return next;
        });
      }, [topics]);
      React.useEffect(() => {
        setFormsByTab((prev) => {
          const current = prev[activeTab] || emptyScriptForm();
          if (current.targetId && tabTopics.some((topic) => topic.projectId === current.targetId)) return prev;
          return { ...prev, [activeTab]: { ...current, targetId: tabTopics[0]?.projectId || null } };
        });
      }, [activeTab, tabTopics]);

      const form = formsByTab[activeTab] || emptyScriptForm();
      const patchForm = (fn) => setFormsByTab((prev) => ({ ...prev, [activeTab]: fn(prev[activeTab] || emptyScriptForm()) }));

      const topicData = stageData(detail, 'topic');
      const account = topicData?.account || null;
      const signalItems = stageData(detail, 'signals')?.items || [];
      const savedScript = stageData(detail, 'script')?.body || '';
      const approved = Boolean(savedScript.trim());
      const dirty = Boolean(detail) && body !== savedScript;
      React.useEffect(() => { setBody(stageData(detail, 'script')?.body || ''); setReport(null); setReportBody(''); }, [detail?.id, detail?.revision]);

      const projectRecords = openProject ? history.filter((item) => item.projectId === openProject) : [];
      const activeRunningRecord = history.find((item) => item.status === 'running') || null;
      const runningRecord = projectRecords.find((item) => item.status === 'running') || null;
      const otherRunningRecord = activeRunningRecord && activeRunningRecord.id !== runningRecord?.id ? activeRunningRecord : null;
      const latestDraft = projectRecords.find((item) => item.status === 'completed' && item.draft?.script) || null;
      const latestDraftMatchesDetail = Boolean(latestDraft
        && detail?.artifacts?.script?.revision != null
        && latestDraft.scriptRevision === detail.artifacts.script.revision);
      React.useEffect(() => { setDraftTier(latestDraft?.tier || 'medium'); setPolishNote(''); setRegenerateNote(''); }, [detail?.id, latestDraft?.id]);
      React.useEffect(() => {
        if (!scriptModal) return undefined;
        const onKey = (event) => { if (event.key === 'Escape' && !reportBusy) setScriptModal(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [scriptModal, reportBusy]);
      React.useEffect(() => {
        const node = editorRef.current;
        if (drawerMode !== 'edit' || !node) return;
        node.style.height = 'auto';
        node.style.height = `${node.scrollHeight}px`;
      }, [body, drawerMode]);

      if (!packId) return h(NeedPack, { openConversation });

      const INLINE_LIMIT = 6;
      const inlineTopics = tabTopics.slice(0, INLINE_LIMIT);
      const hiddenInTab = tabTopics.length - inlineTopics.length;
      const canOpenMore = topics.length > 0;

      const selectTab = (tab) => { setActiveTab(tab); setOpenMore(false); };
      const selectTarget = (topic) => patchForm((current) => ({ ...current, targetId: topic.projectId }));
      const resetDrawer = () => { setOpenProject(null); setDrawerMode('read'); setScriptModal(null); };
      const openDraft = (projectId) => {
        const open = () => { setOpenProject(projectId); setOpenMore(false); setDrawerMode('edit'); setScriptModal(null); };
        if (dirty && projectId !== openProject) {
          ask({ title: '放弃未保存的修改？', danger: true, confirm: '放弃修改', copy: '切换稿件后会丢失当前未保存的修改。', onConfirm: open });
          return;
        }
        open();
      };
      const closeDraft = () => {
        if (!dirty) { resetDrawer(); return; }
        ask({
          title: '放弃未保存的修改？', danger: true, confirm: '放弃修改',
          copy: '编辑器里有尚未保存的稿件修改，关闭后会丢失。',
          onConfirm: resetDrawer,
        });
      };
      const scrollDrawerTop = () => {
        requestAnimationFrame(() => { drawerScrollRef.current?.scrollTo({ top: 0 }); });
      };

      const startGeneration = async ({ projectId, mode, tier, instructions }) => {
        if (!projectId || busy || projectIsRunning(projectId)) return false;
        setBusy(true); setError(null);
        try {
          await remote(packId, 'startScriptGeneration', { projectId, mode, tier, instructions: instructions || undefined });
          await loadHistory();
          await Promise.all([refresh(), openProject ? reload() : Promise.resolve()]);
          return true;
        }
        catch (cause) { setError(cause.message); return false; } finally { setBusy(false); }
      };
      const confirmGeneration = (payload, title = '写稿') => {
        if (!payload.projectId || busy || projectIsRunning(payload.projectId)) return;
        const topic = topics.find((item) => item.projectId === payload.projectId);
        const project = projects.find((item) => item.id === payload.projectId);
        ask({
          title,
          copy: `将为「${topic?.title || project?.title || '当前选题'}」启动${payload.mode === 'polish' ? '润色' : '写稿'}任务，篇幅为${TIER_LABEL[payload.tier] || payload.tier}。${payload.instructions ? `额外要求：${payload.instructions}。` : ''}生成完成后会自动保存稿件，可直接进入配音。`,
          confirm: '启动任务',
          onConfirm: () => { void startGeneration(payload); },
        });
      };
      const generateNew = () => confirmGeneration({ projectId: form.targetId, mode: 'new', tier: form.tier, instructions: form.instructions.trim() });
      // Polish needs a durable source body. Pending editor changes are saved
      // automatically so users never need a separate save action.
      const startPolish = async () => {
        if (!detail || busy || projectIsRunning(detail.id) || !body.trim()) return;
        if (dirty) { const saved = await commit(detail, 'script', { body }); if (!saved) return; }
        const started = await startGeneration({ projectId: detail.id, mode: 'polish', tier: draftTier, instructions: polishNote.trim() });
        if (started) setScriptModal('ai');
      };
      const startRegenerate = async () => {
        if (!detail || busy || projectIsRunning(detail.id)) return;
        if (dirty) { const saved = await commit(detail, 'script', { body }); if (!saved) return; }
        const started = await startGeneration({ projectId: detail.id, mode: 'new', tier: draftTier, instructions: regenerateNote.trim() });
        if (started) setScriptModal('ai');
      };
      const analyze = async (target) => {
        if (!detail || !String(target || '').trim()) return;
        setReportBusy(true);
        try {
          const next = await remote(packId, 'analyzeScript', { projectId: detail.id, title: detail.title, body: target, tier: draftTier });
          setReport(next); setReportBody(String(target));
        }
        catch (cause) { setError(cause.message); } finally { setReportBusy(false); }
      };
      const approve = () => ask({
        title: dirty ? '保存并进入配音' : '进入配音', confirm: dirty ? '保存并进入' : '进入配音',
        copy: dirty ? `保存「${detail.title}」当前修改并进入配音？` : `选择「${detail.title}」进入配音模块？`,
        onConfirm: async () => {
          setBusy(true);
          try {
            const saved = dirty ? await commit(detail, 'script', { body }) : { project: detail };
            if (!saved) return;
            await refresh(); await reload(); await loadTopics(); setError(null);
            // The next page owns its selected-project state, so carry the approved project across navigation.
            audioCaptionsHandoff = saved.project.id;
            openPackMenu?.('audio-captions');
          } catch (cause) { setError(cause.message); } finally { setBusy(false); }
        },
      });

      const stepPills = (record) => h('div', { className: 'sv-tp-steps' }, (record.steps || []).map((step) => h('span', { key: step.id, className: 'sv-tp-step', 'data-state': step.status, title: step.detail || step.label }, h('i', null), step.detail || step.label)));
      const generationStatus = (record, currentProject) => h('section', { className: 'sv-sc-run-status', 'data-current': currentProject ? 'true' : 'false' },
        h('div', { className: 'sv-sc-ai-action-head' },
          h('strong', null, currentProject ? `DSH 正在${record.mode === 'polish' ? '润色当前稿件' : '重新起稿'}` : '另一份稿件正在生成'),
          h('span', null, `${TIER_LABEL[record.tier] || record.tier}${currentProject ? '' : ` · ${record.projectTitle || '未命名项目'}`}`),
        ),
        stepPills(record),
        h('p', { className: 'sv-note' }, currentProject ? '任务已提交，会持续更新步骤；关闭此抽屉不会中断生成。' : '另一份稿件正在生成，本任务不会被中断。'),
      );
      // Archived-account topics have no Tab to host a new run, so they are
      // open-only rather than selectable — a selection the left column cannot
      // show would silently vanish.
      const topicCard = (topic, archived) => h('div', { key: topic.projectId, className: 'sv-tp-cand', 'data-sel': archived ? 'false' : form.targetId === topic.projectId ? 'true' : 'false', ...(archived ? { style: { cursor: 'default' } } : { role: 'button', tabIndex: 0, onClick: () => selectTarget(topic), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTarget(topic); } } }) },
        h('span', { className: 'sv-tp-cand-head' },
          archived ? null : h('span', { className: 'sv-tp-cand-radio' }, h('i', null)),
          h('span', { className: 'sv-tp-cand-title' }, topic.title),
          h('span', { className: 'sv-sc-state', 'data-state': topic.scriptState }, SCRIPT_STATE_LABEL[topic.scriptState] || '未写稿'),
          archived ? h('span', { className: 'sv-sc-archived' }, `已归档 · ${topic.account?.name || ''}`) : null,
        ),
        h('p', { className: 'sv-tp-cand-meta' }, [topic.angle ? `角度：${topic.angle}` : '角度：未填写', `信号 ${topic.signalCount} 条`, topic.scriptChars ? `已存稿 ${topic.scriptChars} 字` : null, relativeTime(topic.updatedAt)].filter(Boolean).join(' · ')),
        topic.scriptState !== 'none' ? h('div', null, h('button', { type: 'button', className: 'sv-sc-open', onClick: (event) => { event.stopPropagation(); openDraft(topic.projectId); } }, '打开稿件 →')) : null,
      );
      const taskCard = (record) => {
        const score = record.quality?.qualityScore;
        const ready = record.status === 'completed' && Boolean(record.draft?.script);
        const statusTag = record.status === 'running' ? ['运行中', '']
          : record.status === 'failed' ? ['失败', 'sv-status-error']
          : score != null ? [`质检 ${score}`, score >= 80 ? 'sv-stage' : '']
          : ['已完成', 'sv-stage'];
        return h('div', { key: record.id, className: 'sv-tp-task', 'data-status': record.status, 'data-confirmed': ready ? 'true' : 'false' },
          h('div', { className: 'sv-tp-task-head' },
            h('div', null,
              h('p', { className: 'sv-tp-task-title' }, record.projectTitle || record.summary || '写稿生成'),
              h('p', { className: 'sv-tp-task-meta' }, `${relativeTime(record.startedAt)} · 账号：${record.account?.name || '通用'} · ${record.mode === 'polish' ? '润色' : '新起稿'} · ${TIER_LABEL[record.tier] || record.tier}${record.elapsedMs != null ? ` · 耗时 ${(record.elapsedMs / 1000).toFixed(1)}s` : ''}`),
            ),
            h('span', { className: 'sv-tp-task-badges' }, h('span', { className: `sv-tag ${statusTag[1]}` }, statusTag[0])),
          ),
          record.status === 'running' ? stepPills(record) : null,
          ready ? h('div', { className: 'sv-tp-confirmed' },
            h('span', { className: 'sv-tp-confirmed-title' }, 'AI 稿件已保存，可直接进入配音'),
            h('span', { className: 'sv-tp-confirmed-meta' }, `正文 ${charCount(record.draft.script)} 字 · 可按需调整`),
          ) : null,
          h('div', { className: 'sv-tp-task-acts' },
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setOpenSummary(record.id) }, '执行详情'),
            h('button', { type: 'button', className: ready ? 'lwb-primary-button' : 'lwb-plain-button', disabled: !record.projectId, onClick: () => openDraft(record.projectId) }, ready ? '查看稿件' : '打开稿件'),
            record.status === 'failed' ? h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || projectIsRunning(record.projectId), onClick: () => confirmGeneration({ projectId: record.projectId, mode: record.mode, tier: record.tier, instructions: record.instructions }, '重试写稿任务') }, '重试') : null,
            record.status === 'running' ? h('span', { className: 'sv-note' }, '切换页面不会中断，完成后在此查看稿件。') : null,
          ),
        );
      };

      const tabs = h(AccountTabs, { accountLibrary, activeTab, onChange: selectTab, label: '按账号筛选可写稿选题' });

      const topicArea = tabTopics.length
        ? h(React.Fragment, null,
            h('div', { className: 'sv-list' }, inlineTopics.map((topic) => topicCard(topic, false))),
            hiddenInTab > 0 ? h('button', { type: 'button', className: 'sv-sc-more', onClick: () => setOpenMore(true) }, `还有 ${hiddenInTab} 个 · 查看更多`) : null,
          )
        : h('div', { className: topics.length ? 'sv-empty' : 'sv-empty-cta' }, topics.length ? '当前账号 Tab 暂无可写稿选题，可点「查看更多」浏览其他账号或已归档选题。' : h(React.Fragment, null, h('p', null, '还没有可写稿选题。'), h('p', null, '先到「选题」页生成候选并确认选题，确认后的选题会自动出现在这里。')));

      const configCard = h('section', { className: 'sv-form' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '新建写稿任务'), h('span', null, `当前 Tab · ${tabName}`)),
        tabs,
        h('p', { className: 'sv-tp-acct-note' }, '选题按选题页确认时的账号定位分组；通用 Tab 收录未绑定账号的选题。'),
        h('div', { className: 'sv-section-head' },
          h('h3', null, '可写稿选题'),
          h('span', null, `${tabTopics.length} 个`, canOpenMore ? h('button', { type: 'button', className: 'sv-tp-acct-link', style: { marginLeft: '8px' }, onClick: () => setOpenMore(true) }, '查看更多') : null),
        ),
        topicArea,
        h('label', { className: 'sv-meta' }, '篇幅'),
        h('div', { className: 'sv-sc-seg' }, TIER_OPTIONS.map(([value, name, range]) => h('button', { key: value, type: 'button', 'data-on': form.tier === value ? 'true' : 'false', disabled: projectIsRunning(form.targetId), onClick: () => patchForm((current) => ({ ...current, tier: value })) }, h('strong', null, name), h('span', null, range)))),
        h('label', { className: 'sv-meta' }, '额外要求（可选，≤500 字）'),
        h('textarea', { className: 'sv-textarea', style: { minHeight: '64px' }, value: form.instructions, maxLength: 500, placeholder: '例如：更口语一点、多用例子', disabled: projectIsRunning(form.targetId), onChange: (event) => patchForm((current) => ({ ...current, instructions: event.target.value })) }),
        h('p', { className: 'sv-note' }, form.targetId ? '新起稿依据选题与信号素材生成；生成后在右侧任务列表点「查看稿件」，即可在抽屉里编辑、润色并保存。已有稿件的选题可直接点卡片上的「打开稿件」。' : '先在上方选择一个可写稿选题。'),
        h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || projectIsRunning(form.targetId) || !form.targetId, onClick: generateNew }, projectIsRunning(form.targetId) ? '该项目已有任务…' : '写稿')),
      );

      const activeHistoryTasks = history.filter((item) => item.status === 'queued' || item.status === 'running');
      const terminalHistoryTasks = history.filter((item) => item.status !== 'queued' && item.status !== 'running');
      const filteredHistoryTasks = terminalHistoryTasks.filter((item) => historyFilter === 'all' || item.status === historyFilter);
      const historyPages = Math.max(1, Math.ceil(filteredHistoryTasks.length / 6));
      const pagedHistoryTasks = filteredHistoryTasks.slice(historyPage * 6, historyPage * 6 + 6);
      const taskPanel = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '写稿任务 · 全部账号'), h('span', null, `${history.filter((item) => item.status === 'running').length} 个运行中 · ${history.filter((item) => item.status === 'queued').length} 个排队中`)),
        activeHistoryTasks.length ? h('div', { className: 'sv-list' }, activeHistoryTasks.map(taskCard)) : null,
        terminalHistoryTasks.length ? h(React.Fragment, null,
          h('div', { className: 'sv-filter-chips' }, [{ id: 'all', label: '全部' }, { id: 'completed', label: '已完成' }, { id: 'failed', label: '失败' }].map((item) => h('button', { key: item.id, type: 'button', className: 'sv-filter-chip', 'data-on': historyFilter === item.id ? 'true' : 'false', onClick: () => setHistoryFilter(item.id) }, item.label))),
          h('div', { className: 'sv-list' }, pagedHistoryTasks.map(taskCard)),
          h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta' }, `第 ${historyPage + 1}/${historyPages} 页 · 共 ${filteredHistoryTasks.length} 条`), h('span', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '上一页', disabled: historyPage === 0, onClick: () => setHistoryPage((current) => Math.max(0, current - 1)) }, '上一页'), h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '下一页', disabled: historyPage + 1 >= historyPages, onClick: () => setHistoryPage((current) => current + 1) }, '下一页'))),
        ) : !activeHistoryTasks.length ? h('div', { className: 'sv-empty' }, '尚无写稿任务。左侧选择选题后点「写稿」。') : null,
      );

      const candidateScript = latestDraft?.draft?.script || '';
      const readableScript = dirty ? body : savedScript.trim() || candidateScript;
      const showingCandidate = !dirty && !savedScript.trim() && Boolean(candidateScript);
      const reportIsCurrent = Boolean(report && reportBody === readableScript);
      const automaticQuality = latestDraft?.quality || null;
      const automaticReport = automaticQuality?.checks ? automaticQuality : null;
      const automaticReportIsCurrent = Boolean(automaticReport && candidateScript.trim() && candidateScript.trim() === readableScript.trim());
      const visibleReport = reportIsCurrent ? report : automaticReportIsCurrent ? automaticReport : null;
      const visibleReportSource = reportIsCurrent ? 'manual' : automaticReportIsCurrent ? 'automatic' : null;
      const drawerState = approved ? 'approved' : savedScript.trim() ? 'draft' : candidateScript ? 'candidate' : 'none';
      const drawerStateLabel = drawerState === 'candidate' ? '历史 AI 候选稿' : SCRIPT_STATE_LABEL[drawerState];
      const enterEditor = (text = readableScript) => { setBody(text); setDrawerMode('edit'); setScriptModal(null); scrollDrawerTop(); };
      const discardEdits = () => {
        const leave = () => { setBody(savedScript); setDrawerMode('read'); scrollDrawerTop(); };
        if (dirty) {
          ask({ title: '放弃未保存的修改？', danger: true, confirm: '放弃修改', copy: '返回阅读后不会保留本次编辑。', onConfirm: leave });
          return;
        }
        leave();
      };
      const useCandidateForEditing = () => {
        if (!candidateScript) return;
        const adopt = () => { setBody(candidateScript); setDrawerMode('edit'); setScriptModal(null); scrollDrawerTop(); };
        if (dirty) {
          ask({ title: '替换未保存的修改？', danger: true, confirm: '继续编辑此稿', copy: '这会覆盖当前未保存的编辑内容；保存后可直接进入配音。', onConfirm: adopt });
          return;
        }
        adopt();
      };
      const qualityPanel = (quality, source, empty) => h('div', { className: 'sv-sc-report' },
        quality?.checks ? h(React.Fragment, null,
          h('div', { className: 'sv-qa-score' }, h('strong', null, String(quality.qualityScore)), h('em', null, '质检分'), h('span', { className: `sv-tag ${quality.verdict === 'pass' ? 'sv-stage' : 'sv-status-error'}` }, quality.verdict === 'pass' ? '通过' : '建议改写')),
          h('p', { className: 'sv-meta' }, source === 'automatic' ? 'AI 稿件保存完成时已自动质检。' : '根据当前正文重新完成质检。'),
          h('p', { className: 'sv-meta' }, `正文 ${quality.checks.length.scriptChars} 字（${quality.checks.length.lengthTier} 档） · 段落 ${quality.checks.structure.paragraphCount} · 预估口播 ${quality.checks.length.estimatedDurationSeconds}s`),
          h('p', { className: 'sv-meta' }, `对比已有稿件 ${quality.checks.similarity.comparedRecords} 篇 · 原创风险 ${originalityLabel(quality.originalityRisk)}`),
          (quality.checks.similarity.topMatches || []).slice(0, 3).map((match, index) => h('p', { key: index, className: 'sv-meta' }, `· ${match.title || '未命名稿件'}：全文重叠 ${(match.ngramJaccard * 100).toFixed(0)}%，最长相同片段 ${match.longestCommonSubstring.length} 字`)),
          quality.recommendations?.length ? h('ul', { className: 'sv-warn-list' }, quality.recommendations.slice(0, 6).map((item, index) => h('li', { key: index }, item))) : h('p', { className: 'sv-note' }, '无改进建议。'),
        ) : quality ? h(React.Fragment, null,
          h('div', { className: 'sv-qa-score' }, h('strong', null, String(quality.qualityScore)), h('em', null, '质检分'), h('span', { className: `sv-tag ${quality.verdict === 'pass' ? 'sv-stage' : 'sv-status-error'}` }, quality.verdict === 'pass' ? '通过' : '建议改写')),
          h('p', { className: 'sv-sc-report-empty' }, '这是旧记录保留的自动质检摘要；完整明细需对当前正文重新质检。'),
        ) : h('p', { className: 'sv-sc-report-empty' }, empty),
      );
      const reportPanel = qualityPanel(visibleReport, visibleReportSource, report ? '正文已变更，现有报告不再对应当前稿件。请重新质检。' : '尚未质检。质检会检查长度节奏、段落结构、口播表达与已有稿件相似度。');
      const contextContent = h(React.Fragment, null,
        h('section', { className: 'sv-sc-modal-section' },
          h('h5', null, '创作背景'),
          h('div', { className: 'sv-sc-modal-grid' },
            h('div', { className: 'sv-sc-modal-fact' }, h('span', null, '账号'), h('p', null, account?.name || '通用写稿')),
            h('div', { className: 'sv-sc-modal-fact' }, h('span', null, '选题角度'), h('p', null, topicData?.angle || '未填写')),
            account?.positioning ? h('div', { className: 'sv-sc-modal-fact' }, h('span', null, '账号定位'), h('p', null, account.positioning)) : null,
            account?.audience ? h('div', { className: 'sv-sc-modal-fact' }, h('span', null, '目标受众'), h('p', null, account.audience)) : null,
            account?.pillars?.length ? h('div', { className: 'sv-sc-modal-fact' }, h('span', null, '内容方向'), h('p', null, account.pillars.join('、'))) : null,
          ),
        ),
        h('section', { className: 'sv-sc-modal-section' },
          h('h5', null, `素材依据 · ${signalItems.length} 条信号`),
          signalItems.length ? h('div', { className: 'sv-sc-context-list' }, signalItems.map((item) => h('article', { key: item.id, className: 'sv-sc-context-item' }, h('p', null, item.title || item.text), h('span', null, item.source || sourceName(item.sourceId))))) : h('p', { className: 'sv-sc-report-empty' }, '该选题没有可展示的信号依据。'),
        ),
      );
      const tierPicker = (label) => h('label', null, label,
        h('div', { className: 'sv-sc-seg' }, TIER_OPTIONS.map(([value, name, range]) => h('button', { key: value, type: 'button', 'data-on': draftTier === value ? 'true' : 'false', disabled: busy || projectBusy, onClick: () => setDraftTier(value) }, h('strong', null, name), h('span', null, range)))),
      );
      const aiContent = h('div', { className: 'sv-sc-ai-actions' },
        runningRecord ? generationStatus(runningRecord, true) : otherRunningRecord ? generationStatus(otherRunningRecord, false) : null,
        latestDraftMatchesDetail ? h('section', { className: 'sv-sc-ai-action' }, h('div', { className: 'sv-sc-ai-action-head' }, h('strong', null, 'AI 稿件已保存，可直接使用'), h('span', null, `${relativeTime(latestDraft.completedAt || latestDraft.startedAt)} · ${latestDraft.mode === 'polish' ? '润色' : '新起稿'}`))) : null,
        h('section', { className: 'sv-sc-ai-action' },
          h('div', { className: 'sv-sc-ai-action-head' }, h('strong', null, '润色当前稿件'), h('span', null, savedScript.trim() || body.trim() ? (dirty ? '会自动保存当前修改，再基于此润色' : '基于当前稿件') : '需先补充正文')),
          h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || projectBusy || !body.trim(), onClick: () => setScriptModal('polish') }, '润色')),
        ),
        h('section', { className: 'sv-sc-ai-action' },
          h('div', { className: 'sv-sc-ai-action-head' }, h('strong', null, '重新起稿'), h('span', null, '生成完成后会自动替换当前稿件')),
          h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy || projectBusy, onClick: () => setScriptModal('regenerate') }, '重新起稿')),
        ),
      );
      const polishContent = h('form', { className: 'sv-sc-modal-form', onSubmit: (event) => { event.preventDefault(); void startPolish(); } },
        h('p', { className: 'sv-sc-modal-note' }, dirty ? '当前编辑内容会自动保存，再交给 DSH 润色。完成后，润色稿会自动成为当前稿件。' : 'DSH 将基于当前稿件润色，完成后会自动替换为新的稿件版本。'),
        h('p', { className: 'sv-sc-modal-note' }, `待处理正文 ${charCount(body)} 字 · 预估口播 ${scriptDurationLabel(body)}`),
        tierPicker('目标篇幅'),
        h('label', null, '润色要求（可选）', h('textarea', { className: 'sv-textarea', value: polishNote, maxLength: 500, placeholder: '例如：开头更有张力，减少书面表达', disabled: busy || projectBusy, onChange: (event) => setPolishNote(event.target.value) })),
      );
      const regenerateContent = h('form', { className: 'sv-sc-modal-form', onSubmit: (event) => { event.preventDefault(); void startRegenerate(); } },
        h('p', { className: 'sv-sc-modal-note' }, '这会围绕当前选题和创作依据重新起稿。生成完成后会自动保存为当前稿件，并取消此前的稿件确认及下游产物。'),
        tierPicker('新稿篇幅'),
        h('label', null, '新稿要求（可选）', h('textarea', { className: 'sv-textarea', value: regenerateNote, maxLength: 500, placeholder: '例如：改成更冷静的实测口吻', disabled: busy || projectBusy, onChange: (event) => setRegenerateNote(event.target.value) })),
      );
      const candidateContent = h(React.Fragment, null,
        h('p', { className: 'sv-sc-candidate-copy' }, `这份历史候选稿生成于 ${relativeTime(latestDraft?.completedAt || latestDraft?.startedAt)}。选择“以此版本继续编辑”后即可保存并进入配音。`),
        h('article', { className: 'sv-sc-manuscript', 'data-candidate': 'true' }, candidateScript),
        latestDraft?.draft?.needsVerification?.length ? h('section', { className: 'sv-sc-fact-check' }, h('strong', null, `待核实 ${latestDraft.draft.needsVerification.length} 项`), h('ul', null, latestDraft.draft.needsVerification.map((item, index) => h('li', { key: index }, item)))) : null,
        automaticQuality ? h('section', { className: 'sv-sc-auto-quality' }, h('p', null, '自动质检结果'), qualityPanel(automaticQuality, 'automatic', '')) : null,
      );
      const qualityContent = h(React.Fragment, null,
        h('p', { className: 'sv-sc-modal-note' }, `检查对象：当前${drawerMode === 'edit' ? '编辑中' : '阅读中'}的正文 · ${charCount(readableScript)} 字 · 预估口播 ${scriptDurationLabel(readableScript)}`),
        visibleReportSource === 'automatic' ? h('p', { className: 'sv-sc-modal-note' }, '以下为生成完成时已自动产出的结果，无需再次运行；可按需重新质检。') : null,
        reportBusy ? h('p', { className: 'sv-note' }, '正在分析长度、结构、口播表达与相似度，请稍候。') : null,
        reportPanel,
      );
      const modalConfig = scriptModal === 'context'
        ? { title: '创作依据', copy: '账号定位、选题角度与本次写稿使用的信号素材。', content: contextContent }
        : scriptModal === 'ai'
          ? { title: 'AI 调整', copy: '每个动作都会先说明影响范围，再由你确认提交。', content: aiContent }
          : scriptModal === 'polish'
            ? { title: '润色当前稿件', copy: '生成完成后会自动保存为当前稿件版本。', content: polishContent }
          : scriptModal === 'regenerate'
              ? { title: '重新起稿', copy: '重新生成完成后会自动保存为当前稿件版本。', content: regenerateContent }
              : scriptModal === 'candidate'
                ? { title: '未采用的新稿', copy: '这是一份与当前正式稿不同的候选版本。', content: candidateContent }
                : scriptModal === 'quality'
                  ? { title: visibleReport ? '稿件质检报告' : '开始稿件质检', copy: '质检不会修改正文，只生成当前版本的诊断报告。', content: qualityContent }
                  : null;
      const closeScriptModal = () => { if (!reportBusy) setScriptModal(null); };
      const scriptModalFoot = scriptModal === 'polish'
        ? h(React.Fragment, null, h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy || saving || projectBusy, onClick: closeScriptModal }, '取消'), h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || saving || projectBusy || !body.trim(), onClick: () => { void startPolish(); } }, '开始润色'))
        : scriptModal === 'regenerate'
          ? h(React.Fragment, null, h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy || saving || projectBusy, onClick: closeScriptModal }, '取消'), h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || saving || projectBusy, onClick: () => { void startRegenerate(); } }, '开始生成'))
          : scriptModal === 'candidate'
            ? h(React.Fragment, null, h('button', { type: 'button', className: 'lwb-plain-button', onClick: closeScriptModal }, '关闭'), h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || projectBusy, onClick: useCandidateForEditing }, '以此版本继续编辑'))
            : scriptModal === 'quality'
              ? h(React.Fragment, null, h('button', { type: 'button', className: 'lwb-plain-button', disabled: reportBusy, onClick: closeScriptModal }, visibleReport ? '关闭' : '取消'), h('button', { type: 'button', className: 'lwb-primary-button', disabled: reportBusy || !readableScript.trim(), onClick: () => { void analyze(readableScript); } }, reportBusy ? '正在质检…' : visibleReport ? '重新质检' : '开始质检'))
              : h('button', { type: 'button', className: 'lwb-primary-button', onClick: closeScriptModal }, '完成');
      const runStatus = runningRecord ? generationStatus(runningRecord, true) : otherRunningRecord ? generationStatus(otherRunningRecord, false) : null;
      const automaticQualityPanel = automaticReportIsCurrent && !reportIsCurrent ? h('section', { className: 'sv-sc-auto-quality' }, h('p', null, '自动质检结果'), reportPanel) : null;
      const scriptView = drawerMode === 'edit'
        ? h('div', { className: 'sv-sc-drawer-body' },
            runStatus,
            h('div', { className: 'sv-sc-editor' },
              h('div', { className: 'sv-sc-editor-label' }, h('strong', null, '编辑稿件'), h('span', null, `${charCount(body)} 字（不含空白） · 预估口播 ${scriptDurationLabel(body)}`)),
              h('textarea', { ref: editorRef, className: 'sv-textarea', value: body, maxLength: 30000, placeholder: '编写可口播、可审阅的脚本正文', disabled: projectBusy, onChange: (event) => setBody(event.target.value), onInput: (event) => { event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`; } }),
            ),
          )
          : h('div', { className: 'sv-sc-drawer-body' },
            runStatus,
            readableScript.trim()
              ? h('article', { className: 'sv-sc-manuscript', 'data-candidate': showingCandidate ? 'true' : 'false' }, readableScript)
              : h('div', { className: 'sv-sc-empty-manuscript' }, h('p', null, '还没有稿件正文。'), h('button', { type: 'button', className: 'lwb-primary-button', onClick: () => enterEditor('') }, '开始写稿')),
            automaticQualityPanel,
          );
      const scriptModalNode = detail && modalConfig && h('div', { className: 'sv-sc-modal-backdrop', role: 'presentation', onClick: closeScriptModal },
        h('section', { className: 'sv-sc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': modalConfig.title, onClick: (event) => event.stopPropagation() },
          h('div', { className: 'sv-sc-modal-head' }, h('div', { className: 'sv-sc-modal-title' }, h('h4', null, modalConfig.title), h('p', null, modalConfig.copy)), h('button', { type: 'button', className: 'sv-ghost-btn', title: '关闭', 'aria-label': '关闭', disabled: reportBusy, onClick: closeScriptModal }, '×')),
          h('div', { className: 'sv-sc-modal-scroll' }, modalConfig.content),
          h('div', { className: 'sv-sc-modal-foot' }, scriptModalFoot),
        ),
      );
      const draftDrawer = detail && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: closeDraft }),
        h('aside', { className: 'sv-drawer sv-drawer-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': `稿件 · ${detail.title}` },
          h('div', { className: 'sv-drawer-head sv-sc-drawer-head' },
            h('div', { className: 'sv-sc-drawer-title' },
              h('div', { className: 'sv-sc-drawer-titleline' }, h('h3', null, detail.title), h('span', { className: 'sv-sc-state', 'data-state': drawerState }, drawerStateLabel), dirty ? h('span', { className: 'sv-tag' }, '未保存') : null),
              h('p', { className: 'sv-sc-drawer-meta' }, `${charCount(readableScript)} 字 · 预估口播 ${scriptDurationLabel(readableScript)}`),
            ),
            h('div', { className: 'sv-sc-drawer-tools' },
              h('button', { type: 'button', className: 'sv-sc-drawer-tool', 'data-tone': 'context', 'data-active': scriptModal === 'context', onClick: () => setScriptModal('context') }, `创作依据${signalItems.length ? ` · ${signalItems.length}` : ''}`),
              h('button', { type: 'button', className: 'sv-sc-drawer-tool', 'data-tone': 'ai', 'data-active': scriptModal === 'ai' || scriptModal === 'candidate' || scriptModal === 'polish' || scriptModal === 'regenerate', onClick: () => setScriptModal('ai') }, 'AI 调整'),
              h('button', { type: 'button', className: 'sv-sc-drawer-tool', 'data-tone': 'quality', 'data-active': scriptModal === 'quality', disabled: !readableScript.trim(), onClick: () => setScriptModal('quality') }, reportBusy ? '质检中…' : '质检'),
              h('button', { type: 'button', className: 'sv-ghost-btn', title: '关闭', 'aria-label': '关闭', onClick: closeDraft }, '×'),
            ),
          ),
          h('div', { ref: drawerScrollRef, className: 'sv-drawer-scroll' }, scriptView),
          h('div', { className: 'sv-tp-drawer-foot' },
            drawerMode === 'edit' ? h(React.Fragment, null,
              h('p', { className: 'sv-sc-gate-note' }, dirty ? '保存当前修改并进入配音' : '当前稿件可直接进入配音'),
              h('span', { style: { display: 'flex', gap: '8px', flex: 'none' } }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: saving || anyRunning, onClick: discardEdits }, '取消编辑'), h('button', { type: 'button', className: 'lwb-primary-button sv-sc-approve', disabled: busy || saving || projectBusy || !body.trim(), onClick: approve }, busy || saving ? '正在处理…' : dirty ? '保存并进入配音' : '进入配音')),
            ) : approved ? h(React.Fragment, null,
              h('div', { className: 'sv-sc-ritual' }, h('div', { className: 'sv-sc-ritual-info' }, h('strong', null, '稿件已保存 · 可进入配音'), h('span', null, `版本 ${detail.artifacts?.script?.revision || '—'}`))),
              h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => enterEditor(readableScript) }, '编辑稿件'),
            ) : h(React.Fragment, null,
              h('p', { className: 'sv-sc-gate-note' }, savedScript.trim() ? '已保存，可直接进入配音' : showingCandidate ? '历史 AI 候选稿尚未保存' : '尚未保存稿件'),
              h('span', { style: { display: 'flex', gap: '8px', flex: 'none' } },
                h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => enterEditor(readableScript) }, '编辑稿件'),
                savedScript.trim() ? h('button', { type: 'button', className: 'lwb-primary-button sv-sc-approve', disabled: busy || saving || projectBusy, onClick: approve }, '进入配音') : null,
              ),
            ),
          ),
        ),
      );

      const matchesMore = (topic) => {
        if (moreFilter !== 'all' && topic.scriptState !== moreFilter) return false;
        const q = moreQuery.trim().toLowerCase();
        if (q && !`${topic.title}\n${topic.angle || ''}`.toLowerCase().includes(q)) return false;
        return true;
      };
      const scopedAll = topics.filter((topic) => tabOf(topic) === activeTab);
      const chipCount = (state) => scopedAll.filter((topic) => topic.scriptState === state).length;
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const moreScoped = sortTopics(scopedAll.filter(matchesMore));
      const moreRecent = moreScoped.filter((topic) => Date.parse(topic.updatedAt) >= weekAgo);
      const moreEarlier = moreScoped.filter((topic) => Date.parse(topic.updatedAt) < weekAgo);
      const moreArchived = archivedTopics.filter(matchesMore);
      const moreChip = (id, label) => h('button', { key: id, type: 'button', className: 'sv-filter-chip', 'data-on': moreFilter === id ? 'true' : 'false', onClick: () => setMoreFilter(id) }, label);
      const moreDrawer = openMore && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: () => setOpenMore(false) }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '全部可写稿选题' },
          h('div', { className: 'sv-drawer-head' },
            h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, `全部可写稿选题 · ${tabName}`), h('p', { className: 'sv-meta' }, `当前账号 ${scopedAll.length} 个${moreArchived.length ? ` · 已归档 ${moreArchived.length} 个` : ''} · 点卡片选为新建目标，点「打开稿件」进入编辑`)),
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setOpenMore(false) }, '关闭'),
          ),
          h('div', { className: 'sv-drawer-scroll' },
            h('div', { className: 'sv-drawer-tools' },
              moreChip('all', `全部 ${scopedAll.length}`), moreChip('none', `未写稿 ${chipCount('none')}`), moreChip('approved', `已保存 ${chipCount('approved')}`),
              h('input', { className: 'sv-drawer-search', value: moreQuery, maxLength: 120, placeholder: '搜索标题 / 角度', onChange: (event) => setMoreQuery(event.target.value) }),
            ),
            moreScoped.length || moreArchived.length ? h(React.Fragment, null,
              moreRecent.length ? h(React.Fragment, null, h('p', { className: 'sv-group-title' }, `本周 ${moreRecent.length}`), h('div', { className: 'sv-drawer-list' }, moreRecent.map((topic) => topicCard(topic, false)))) : null,
              moreEarlier.length ? h(React.Fragment, null, h('p', { className: 'sv-group-title', 'data-tone': 'muted' }, `更早 ${moreEarlier.length}`), h('div', { className: 'sv-drawer-list' }, moreEarlier.map((topic) => topicCard(topic, false)))) : null,
              moreArchived.length ? h(React.Fragment, null, h('p', { className: 'sv-group-title', 'data-tone': 'muted' }, `已归档账号 ${moreArchived.length} · 仅可打开稿件，不能作为新建目标`), h('div', { className: 'sv-drawer-list' }, moreArchived.map((topic) => topicCard(topic, true)))) : null,
            ) : h('div', { className: 'sv-empty' }, '没有符合筛选条件的选题。'),
          ),
        ),
      );

      const summaryRecord = history.find((item) => item.id === openSummary) || null;
      const summaryDrawer = summaryRecord && h(ExecutionDrawer, { key: summaryRecord.id, request: { kind: 'script', id: summaryRecord.id }, onClose: () => setOpenSummary(null) });

      const draftCount = topics.filter((topic) => topic.scriptState === 'draft').length;
      const approvedCount = topics.filter((topic) => topic.scriptState === 'approved').length;
      const hero = h(HeroMini, { cells: [{ label: '可写稿选题', value: String(topics.length), tone: 'brand' }, { label: '已保存稿件', value: String(draftCount + approvedCount), tone: 'green' }, { label: '当前账号', value: tabName, tone: 'brand' }, { label: '生成状态', value: anyRunning ? '生成中' : '空闲', tone: anyRunning ? 'brand' : 'green' }] });

      return h(PackFrame, { packId, openConversation, title: '写稿', accent: 'violet', copy: '按账号定位分 Tab；左侧选择可写稿选题、篇幅与额外要求交给 DSH 写稿，右侧是任务列表。AI 生成的稿件会自动保存并可直接进入配音；编辑后用“保存并进入配音”一次完成。切换页面不会中断生成。', hero },
        h(Notice, { error: error || detailError }),
        h('section', { className: 'sv-split' }, configCard, taskPanel),
        moreDrawer,
        draftDrawer,
        scriptModalNode,
        summaryDrawer,
        confirmNode,
      );
    }

    function AudioCaptionsPage({ packId, openConversation }) {
      const { projects, refresh, error, setError } = useProjects(packId); const candidates = projects.filter((project) => project.completedStages.includes('script') && project.scriptApproval?.current); const [selectedId, setSelectedId] = useSelectedProject(projects, (project) => project.completedStages.includes('script') && project.scriptApproval?.current); const { detail, error: detailError, reload } = useDetail(packId, selectedId); const { saving, commit } = useCommit(packId, refresh, reload, setError); const [voiceover, setVoiceover] = React.useState(''), [subtitles, setSubtitles] = React.useState('');
      React.useEffect(() => { setVoiceover(stageData(detail, 'voiceover')?.notes || ''); setSubtitles(stageData(detail, 'subtitles')?.srt || ''); }, [detail?.id, detail?.revision]); if (!packId) return h(NeedPack, { openConversation });
      const subtitleData = stageData(detail, 'subtitles'); const subtitleWarnings = subtitleData?.warnings || [];
      const scriptBody = stageData(detail, 'script')?.body || '';
      return h('div', { className: 'sv-page' }, h(Intro, { title: '配音 / 字幕', copy: '只接受已在写稿页确认的口播稿；稿件更新后需重新确认。TTS、ASR 和音频资产必须由已获批的 DSH 工具接入；未接入时可以保存人工配音说明和校对后的 SRT。' }), h(Notice, { error: error || detailError }), h('section', { className: 'sv-layout' }, h('section', { className: 'sv-section' }, h('div', { className: 'sv-section-head' }, h('h3', null, '已确认稿件的项目'), h('span', null, `${candidates.length} 个`)), h(ProjectList, { projects: candidates, selectedId, onSelect: setSelectedId, empty: '请先在写稿页保存并确认稿件。' })), detail ? h('div', { className: 'sv-section' }, scriptBody ? h('details', { className: 'sv-form', open: false }, h('summary', null, `口播稿（${[...scriptBody].length} 字，来自写稿阶段）`), h('p', { className: 'sv-basis-text' }, scriptBody)) : null, h('form', { className: 'sv-form', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'voiceover', { notes: voiceover }); } }, h('h3', null, '配音'), h('p', { className: 'sv-note' }, '记录人工录音位置、音色、语速，或由获批工具生成的音频资产引用。'), h('textarea', { className: 'sv-textarea', value: voiceover, maxLength: 6000, placeholder: '配音说明或音频资产引用', onChange: (event) => setVoiceover(event.target.value) }), h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-primary-button', disabled: saving || !voiceover.trim() }, saving ? '正在保存…' : '保存配音产物'))), h('form', { className: 'sv-form', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'subtitles', { srt: subtitles }); } }, h('h3', null, '字幕'), h('textarea', { className: 'sv-textarea', value: subtitles, maxLength: 30000, placeholder: '粘贴或编辑经校对的 SRT 字幕（序号、时间码、文本）', onChange: (event) => setSubtitles(event.target.value) }), subtitleData ? h('p', { className: 'sv-meta' }, `当前已保存 ${subtitleData.cueCount ?? '?'} 条字幕${subtitleWarnings.length ? `，${subtitleWarnings.length} 条规格警告` : ''}`) : null, subtitleWarnings.length ? h('ul', { className: 'sv-warn-list' }, subtitleWarnings.map((warning, index) => h('li', { key: index }, warning))) : null, h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-primary-button', disabled: saving || !subtitles.trim() }, saving ? '正在保存…' : '保存字幕')))) : h('div', { className: 'sv-empty' }, '选择项目后配置配音与字幕。')));
    }

    function VideoPreviewPage({ packId, openConversation }) {
      const { projects, refresh, error, setError } = useProjects(packId); const candidates = projects.filter((project) => project.completedStages.includes('subtitles')); const [selectedId, setSelectedId] = useSelectedProject(projects, (project) => project.completedStages.includes('subtitles')); const { detail, error: detailError, reload } = useDetail(packId, selectedId); const { saving, commit } = useCommit(packId, refresh, reload, setError); const [visualBrief, setVisualBrief] = React.useState(''), [checks, setChecks] = React.useState({ script: false, voiceover: false, subtitles: false, video: false }), [notes, setNotes] = React.useState('');
      React.useEffect(() => { setVisualBrief(stageData(detail, 'video')?.visualBrief || ''); setChecks(stageData(detail, 'qc')?.checks || { script: false, voiceover: false, subtitles: false, video: false }); setNotes(stageData(detail, 'qc')?.notes || ''); }, [detail?.id, detail?.revision]); if (!packId) return h(NeedPack, { openConversation });
      const upstreamPresent = ['script', 'voiceover', 'subtitles'].every((stage) => done(detail, stage)); const upstreamMissing = ['script', 'voiceover', 'subtitles'].filter((stage) => !done(detail, stage));
      return h('div', { className: 'sv-page' }, h(Intro, { title: '视频 / 预览', copy: '记录画面模板、素材和渲染版本，并在发布前完成质检。真实视频预览必须由获批的渲染适配器写入。' }), h(Notice, { error: error || detailError }), h('section', { className: 'sv-layout' }, h('section', { className: 'sv-section' }, h('div', { className: 'sv-section-head' }, h('h3', null, '待制作项目'), h('span', null, `${candidates.length} 个`)), h(ProjectList, { projects: candidates, selectedId, onSelect: setSelectedId, empty: '请先完成配音和字幕。' })), detail ? h('div', { className: 'sv-section' }, h('form', { className: 'sv-form', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'video', { visualBrief }); } }, h('h3', null, '视频制作与预览'), h('details', { className: 'sv-form', open: false }, h('summary', null, `口播稿（${[...(stageData(detail, 'script')?.body || '')].length} 字）`), h('p', { className: 'sv-basis-text' }, stageData(detail, 'script')?.body || '尚未写稿。')), h('p', { className: 'sv-note' }, `配音说明：${stageData(detail, 'voiceover')?.notes || '尚未保存。'}`), stageData(detail, 'subtitles') ? h('p', { className: 'sv-meta' }, `字幕：${stageData(detail, 'subtitles').cueCount ?? '?'} 条${stageData(detail, 'subtitles').warnings?.length ? `，${stageData(detail, 'subtitles').warnings.length} 条规格警告` : ''}`) : null, h('textarea', { className: 'sv-textarea', value: visualBrief, maxLength: 6000, placeholder: '模板、素材、镜头、版式和渲染产物引用', onChange: (event) => setVisualBrief(event.target.value) }), h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-primary-button', disabled: saving || !visualBrief.trim() }, saving ? '正在保存…' : '保存视频版本'))), done(detail, 'video') && h('form', { className: 'sv-form', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'qc', { checks, notes }); } }, h('h3', null, '质检'), upstreamPresent ? h('p', { className: 'sv-note' }, '自动核对：稿件、配音、字幕、画面说明四个上游产物齐备。') : h('p', { className: 'sv-error' }, `上游产物缺失：${upstreamMissing.map((stage) => LABEL[stage]).join('、')}。`), h('div', { className: 'sv-checks' }, ['script', 'voiceover', 'subtitles', 'video'].map((name) => h('label', { key: name }, h('input', { type: 'checkbox', checked: checks[name] === true, onChange: (event) => setChecks((current) => Object.assign({}, current, { [name]: event.target.checked })) }), LABEL[name]))), h('textarea', { className: 'sv-textarea', value: notes, maxLength: 2000, placeholder: '质检备注（可选）', onChange: (event) => setNotes(event.target.value) }), h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-primary-button', disabled: saving || !upstreamPresent || !Object.values(checks).every(Boolean) }, saving ? '正在保存…' : '确认质检通过')))) : h('div', { className: 'sv-empty' }, '选择项目后管理视频版本。')));
    }

    const AS_WEEKDAYS = [{ day: 1, label: '周一' }, { day: 2, label: '周二' }, { day: 3, label: '周三' }, { day: 4, label: '周四' }, { day: 5, label: '周五' }, { day: 6, label: '周六' }, { day: 7, label: '周日' }];
    const AS_DEPTHS = [
      { id: 'topic', label: '选题', copy: '生成候选、建项目并加入待写稿' },
      { id: 'script', label: '写稿', copy: '再自动起稿并保存版本，稿件留待人工确认' },
      { id: 'video', label: '成片 + 质检', copy: '再配音、字幕、渲染成片并通过质检' },
      { id: 'packaging', label: '发布资料', copy: '再生成标题文案标签与横竖封面' },
    ];
    const AS_APPROVING = new Set(['video', 'packaging']);
    const AS_STEPS = { topic: '选题', script: '写稿', approve: '确认稿件', voiceover: '配音', subtitles: '字幕', video: '成片质检', packaging: '发布资料' };
    const AS_TIERS = [{ id: 'short', label: '短（300-999 字）' }, { id: 'medium', label: '中（1000-2499 字）' }, { id: 'long', label: '长（2500 字以上）' }];
    const AS_RUN_STATUS = { running: '执行中', completed: '已完成', partial: '部分完成', failed: '失败', missed: '已错过', cancelled: '已停止' };
    const AS_ITEM_STATUS = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' };
    const AS_STAGE_TONE = { done: 'sv-stage', failed: 'sv-status-error', running: '', skipped: 'sv-status-disabled' };
    function emptyScheduleForm() {
      return { name: '', days: new Set([1, 2, 3, 4, 5]), time: '21:00', angle: '', offSources: new Set(), offPlatforms: new Set(), excluded: new Set(), depth: 'packaging', perRunLimit: 1, orientation: 'landscape', scriptTier: 'medium', subtitleEnabled: true, visualBrief: '' };
    }
    /** Rehydrate a per-tab form from a stored task so editing reuses the create form. */
    function scheduleFormOf(schedule, board) {
      const publicIds = (board?.sources || []).filter((card) => card.id !== 'ai-daily-import').map((card) => card.id);
      const platformNames = (board?.aiDaily?.platforms || []).map((card) => card.platform);
      const chosen = new Set(schedule.sources?.sourceIds || []);
      const chosenPlatforms = new Set(schedule.sources?.platforms || []);
      return {
        name: schedule.name || '',
        days: new Set(schedule.days?.length ? schedule.days : [1, 2, 3, 4, 5]),
        time: schedule.time || '21:00',
        angle: schedule.angle || '',
        offSources: new Set(publicIds.filter((id) => !chosen.has(id))),
        offPlatforms: new Set(platformNames.filter((name) => !chosenPlatforms.has(name))),
        excluded: new Set(schedule.sources?.excludeSignalIds || []),
        depth: schedule.depth || 'packaging',
        perRunLimit: schedule.perRunLimit || 1,
        orientation: schedule.production?.orientation === 'landscape' ? 'landscape' : 'portrait',
        scriptTier: schedule.production?.scriptTier || 'medium',
        subtitleEnabled: schedule.production?.subtitleEnabled !== false,
        visualBrief: schedule.production?.visualBrief || '',
      };
    }
    function ScheduleRunDetails({ packId, runId, onChanged }) {
      const [detail, setDetail] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [refresh, setRefresh] = React.useState(0);
      const [confirmNode, ask] = useSvConfirm();
      React.useEffect(() => {
        let active = true; let timer;
        const load = async () => {
          try {
            const next = await remote(packId, 'scheduleRun', { runId });
            if (!active) return;
            setDetail(next); setError(null);
            if (next.run.status === 'running') timer = setTimeout(load, 1500);
          } catch (cause) { if (active) setError(cause.message); }
        };
        void load();
        return () => { active = false; clearTimeout(timer); };
      }, [packId, runId, refresh]);
      const run = detail?.run;
      return h('div', { className: 'sv-as-round-detail', id: `run-${runId}` },
        error ? h('div', { className: 'sv-error', role: 'alert' }, error, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setRefresh((value) => value + 1) }, '重试读取')) : null,
        !run && !error ? h('p', { className: 'sv-meta', role: 'status' }, '正在读取本轮执行过程…') : null,
        run ? h(React.Fragment, null,
          run.error ? h('p', { className: 'sv-error' }, run.error) : null,
          h('div', { className: 'sv-section-head' }, h('strong', null, '本轮执行过程'), h('span', null, `记录 ${run.id.slice(0, 8)}`)),
          run.refs?.topicGenerationId ? h(ExecutionButton, { kind: 'topic', id: run.refs.topicGenerationId, label: '本轮选题 · 执行详情' }) : null,
          run.items.length ? run.items.map((item, index) => h('section', { key: item.projectId || index, className: 'sv-as-item' },
            h('div', { className: 'sv-as-item-head' }, h('strong', null, item.title || '标题待定'), h('span', { className: 'sv-ex-state', 'data-status': item.status }, AS_ITEM_STATUS[item.status] || item.status)),
            h('p', { className: 'sv-meta' }, [item.signalCount != null ? `依据 ${item.signalCount} 条信号` : null, item.scriptChars != null ? `稿件 ${item.scriptChars} 字` : null, item.durationSeconds != null ? `成片 ${Math.round(item.durationSeconds)} 秒` : null, item.qcPassed ? '质检通过' : null, ({ both: '横竖封面已生成', partial: '单侧封面缺失', none: '封面生成失败', disabled: '未配置生图服务' })[item.coverState]].filter(Boolean).join(' · ')),
            item.error ? h('p', { className: 'sv-error' }, item.error) : null,
            h('div', { className: 'sv-as-life' }, item.stages.map((stage) => h('div', { key: stage.step, className: 'sv-as-life-stage', 'data-status': stage.status },
              h('strong', null, AS_STEPS[stage.step] || stage.step),
              stage.refId ? h(ExecutionButton, { kind: stage.step === 'topic' ? 'topic' : stage.step === 'script' ? 'script' : stage.step === 'packaging' ? 'publish' : 'media', id: stage.refId, projectId: item.projectId, label: '查看过程 →' }) : null,
              h('p', null, stage.message || ({ pending: '未开始', skipped: '已跳过' })[stage.status] || '—'),
              h('span', { className: 'sv-as-life-dot' }, h('i', null), stage.status === 'done' && stage.completedAt ? relativeTime(stage.completedAt) : ({ running: '进行中', failed: '失败', skipped: '跳过' })[stage.status] || '待执行'),
            ))),
          )) : h('p', { className: 'sv-note' }, run.status === 'missed' ? '本次执行被跳过，没有产出。' : run.status === 'running' ? '本轮刚开始，还没有产出条目。' : '本轮没有产出条目。'),
          detail.active ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: () => ask({ title: '停止本轮执行？', copy: '已完成的阶段产物会保留，未开始的阶段不再推进。', confirm: '停止本轮', danger: true, onConfirm: async () => {
            setBusy(true);
            try { await remote(packId, 'cancelScheduleRun', { runId }); setRefresh((value) => value + 1); onChanged(); }
            catch (cause) { setError(cause.message); } finally { setBusy(false); }
          } }) }, busy ? '正在停止…' : '停止本轮') : null,
        ) : null,
        confirmNode,
      );
    }
    function ScheduleRunHistory({ packId, scheduleId, refreshKey, onPublish, onContinue }) {
      const [status, setStatus] = React.useState('all');
      const [trigger, setTrigger] = React.useState('all');
      const [query, setQuery] = React.useState('');
      const [page, setPage] = React.useState(0);
      const [pageSize, setPageSize] = React.useState(8);
      const [expanded, setExpanded] = React.useState(null);
      const [feed, setFeed] = React.useState({ items: [], total: 0, loading: true });
      const [error, setError] = React.useState(null);
      const [refresh, setRefresh] = React.useState(0);
      React.useEffect(() => {
        let active = true; let timer;
        setFeed((current) => ({ ...current, loading: true }));
        const load = async () => {
          try {
            const next = await remote(packId, 'listScheduleRuns', { scheduleId, status, trigger, query, offset: page * pageSize, limit: pageSize });
            if (!active) return;
            const lastPage = Math.max(0, Math.ceil(next.total / pageSize) - 1);
            if (page > lastPage) { setPage(lastPage); return; }
            setFeed({ ...next, loading: false }); setError(null);
            timer = setTimeout(load, next.anyRunning ? 1500 : 10000);
          } catch (cause) { if (active) { setError(cause.message); setFeed((current) => ({ ...current, loading: false })); } }
        };
        void load();
        return () => { active = false; clearTimeout(timer); };
      }, [packId, scheduleId, status, trigger, query, page, pageSize, refresh, refreshKey]);
      const changeFilter = (setter, value) => { setter(value); setPage(0); setExpanded(null); };
      const pages = Math.max(1, Math.ceil(feed.total / pageSize));
      return h('div', { className: 'sv-as-history' },
        h('div', { className: 'sv-as-history-filters' },
          h('input', { className: 'sv-input', 'aria-label': '搜索执行记录', placeholder: '搜索任务名称、视频标题或执行信息', value: query, maxLength: 160, onChange: (event) => changeFilter(setQuery, event.target.value) }),
          h('select', { className: 'sv-select', 'aria-label': '执行状态', value: status, onChange: (event) => changeFilter(setStatus, event.target.value) }, h('option', { value: 'all' }, '全部状态'), Object.entries(AS_RUN_STATUS).map(([value, label]) => h('option', { key: value, value }, label))),
          h('select', { className: 'sv-select', 'aria-label': '触发方式', value: trigger, onChange: (event) => changeFilter(setTrigger, event.target.value) }, h('option', { value: 'all' }, '全部触发方式'), h('option', { value: 'automatic' }, '定时触发'), h('option', { value: 'manual' }, '手动执行')),
        ),
        error ? h('div', { className: 'sv-error', role: 'alert' }, error, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setRefresh((value) => value + 1) }, '重试读取')) : null,
        h('div', { className: 'sv-list', 'aria-busy': feed.loading }, feed.loading ? h('p', { className: 'sv-empty', role: 'status' }, '正在读取执行记录…') : feed.items.length ? feed.items.map((run) => h('article', { key: run.id, className: 'sv-as-round', 'data-status': run.status },
          h('div', { className: 'sv-as-round-head' },
            h('button', { type: 'button', className: 'sv-as-round-toggle', 'aria-expanded': expanded === run.id, 'aria-controls': `run-${run.id}`, onClick: () => setExpanded((current) => current === run.id ? null : run.id) },
              h('strong', null, `${scheduleId ? '' : `${run.scheduleName} · `}${formatTime(run.triggeredAt)}`),
              h('span', null, `${run.trigger === 'manual' ? '手动执行' : '定时触发'} · ${run.depthLabel || '—'} · 完成 ${run.completedCount}/${run.itemCount} 条${run.elapsedMs != null ? ` · 耗时 ${Math.max(1, Math.round(run.elapsedMs / 60000))} 分钟` : ''}`),
              h('small', null, expanded === run.id ? '收起本轮详情 ↑' : '展开本轮详情 ↓'),
            ),
            h('span', { className: 'sv-ex-state', 'data-status': run.status }, AS_RUN_STATUS[run.status] || run.status),
          ),
          run.message ? h('p', { className: 'sv-as-round-message' }, run.message) : null,
          run.items.length ? h('div', { className: 'sv-as-round-items' }, run.items.map((item, index) => h('div', { key: item.projectId || index, className: 'sv-as-result' },
            h(PublishVideoThumb, { packId, item: { ...item, id: item.projectId }, videoThumbnail: true }),
            h('div', { className: 'sv-as-result-info' }, h('strong', null, item.title || '标题待定'), h('span', null, `${AS_ITEM_STATUS[item.status] || item.status}${item.qcPassed ? ' · 质检通过' : ''}`),
              item.qcPassed && item.video && item.projectId ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => onPublish(item.projectId) }, '去发布页核对资料 →') : null,
              !item.qcPassed && item.projectId && onContinue ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => onContinue(item) }, item.scriptChars != null ? '去配音页继续 →' : '去写稿页查看 →') : null,
            ),
          ))) : h('p', { className: 'sv-as-round-message' }, run.status === 'running' ? `正在${AS_STEPS[run.step] || '准备'}，尚无产出` : '本轮没有产出'),
          expanded === run.id ? h(ScheduleRunDetails, { key: run.id, packId, runId: run.id, onChanged: () => setRefresh((value) => value + 1) }) : null,
        )) : h('div', { className: 'sv-empty' }, '没有匹配的执行记录。')),
        h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta', role: 'status' }, `共 ${feed.total} 轮 · 第 ${page + 1}/${pages} 页`), h('div', { className: 'sv-actions' },
          h('select', { className: 'sv-select sv-as-page-size', 'aria-label': '每页记录数', value: pageSize, onChange: (event) => changeFilter(setPageSize, Number(event.target.value)) }, [8, 20, 50].map((size) => h('option', { key: size, value: size }, `每页 ${size} 轮`))),
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: feed.loading || page === 0, onClick: () => { setExpanded(null); setPage((value) => value - 1); } }, '上一页'),
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: feed.loading || page + 1 >= pages, onClick: () => { setExpanded(null); setPage((value) => value + 1); } }, '下一页'),
        )),
      );
    }
    function ContentSchedulePage({ packId, openConversation, openPackMenu }) {
      const [board, setBoard] = React.useState(null);
      const [sources, setSources] = React.useState([]);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [runtime, setRuntime] = React.useState(null);
      const [schedules, setSchedules] = React.useState([]);
      const [runs, setRuns] = React.useState([]);
      const [formsByTab, setFormsByTab] = React.useState({});
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const [editingId, setEditingId] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [signalDrawer, setSignalDrawer] = React.useState(null);
      const [historySchedule, setHistorySchedule] = React.useState(null);
      const [historyRefresh, setHistoryRefresh] = React.useState(0);
      const [confirmNode, ask] = useSvConfirm();
      const fail = React.useCallback((message) => { setError(message); }, [setError]);

      const loadSchedules = React.useCallback(async () => {
        if (!packId) return { schedules: [], runs: [] };
        try {
          const next = await remote(packId, 'listSchedules');
          setSchedules(next.schedules || []); setRuns(next.runs || []); setError(null);
          return next;
        } catch (cause) { fail(cause.message); return { schedules: [], runs: [] }; }
      }, [packId, setError, fail]);

      React.useEffect(() => {
        if (!packId) return;
        void Promise.all([
          remote(packId, 'board'),
          remote(packId, 'sources'),
          remote(packId, 'listAccounts'),
          remoteStatic('scheduleRuntimeStatus').catch(() => null),
        ]).then(([nextBoard, nextSources, nextAccounts, nextRuntime]) => {
          setBoard(nextBoard); setSources(nextSources); setAccountLibrary(nextAccounts); setRuntime(nextRuntime);
          setActiveTab((current) => current !== GENERAL_TAB && nextAccounts.accounts.some((item) => item.id === current && item.status === 'active') ? current : nextAccounts.defaultAccountId || GENERAL_TAB);
        }).catch((cause) => fail(cause.message));
        void loadSchedules();
      }, [packId, fail, loadSchedules]);

      const anyRunning = runs.some((run) => run.status === 'running');
      React.useEffect(() => {
        if (!packId) return undefined;
        let active = true;
        const timer = setInterval(() => { if (active) void loadSchedules(); }, anyRunning ? 1500 : 10000);
        return () => { active = false; clearInterval(timer); };
      }, [packId, anyRunning, loadSchedules]);

      if (!packId) return h(NeedPack, { openConversation });

      const activeAccounts = accountLibrary.accounts.filter((item) => item.status === 'active');
      const activeAccount = activeAccounts.find((item) => item.id === activeTab) || null;
      const form = formsByTab[activeTab] || emptyScheduleForm();
      const patchForm = (fn) => setFormsByTab((prev) => ({ ...prev, [activeTab]: fn(prev[activeTab] || emptyScheduleForm()) }));
      const editing = editingId ? schedules.find((item) => item.id === editingId) || null : null;

      const publicCards = (board?.sources || []).filter((card) => card.id !== 'ai-daily-import');
      const platformCards = board?.aiDaily?.platforms || [];
      const allPublicIds = publicCards.map((card) => card.id);
      const selectedPublic = allPublicIds.filter((id) => !form.offSources.has(id));
      const selectedPlatforms = platformCards.map((card) => card.platform).filter((name) => !form.offPlatforms.has(name));
      const allPlatformsSelected = platformCards.length > 0 && selectedPlatforms.length === platformCards.length;
      const selectedCount = selectedPublic.length + selectedPlatforms.length;
      const submitSourceIds = [...selectedPublic, ...(selectedPlatforms.length ? ['ai-daily-import'] : [])];
      const sortedDays = [...form.days].sort((a, b) => a - b);
      // A topic-only round needs no media chain, so only depth blockers apply.
      const blockersFor = (depth) => (runtime?.blockers || []).filter((item) => (depth === 'topic' || depth === 'script' ? item.depth === 'topic' : true));
      const formValid = Boolean(form.name.trim()) && sortedDays.length > 0 && /^\d{2}:\d{2}$/u.test(form.time) && selectedCount > 0;

      const payloadOf = () => ({
        name: form.name.trim(),
        enabled: editing ? editing.enabled : true,
        accountId: activeTab === GENERAL_TAB ? null : activeTab,
        days: sortedDays,
        time: form.time,
        angle: form.angle.trim() || null,
        sources: {
          sourceIds: submitSourceIds,
          // All platforms selected is the same as no platform filter.
          platforms: selectedPlatforms.length && !allPlatformsSelected ? selectedPlatforms : [],
          excludeSignalIds: [...form.excluded],
        },
        depth: form.depth,
        perRunLimit: form.perRunLimit,
        production: {
          orientation: form.orientation,
          subtitleEnabled: form.subtitleEnabled,
          scriptTier: form.scriptTier,
          visualBrief: form.visualBrief.trim() || null,
        },
      });

      const submit = () => {
        if (!formValid || busy) return;
        const label = activeAccount ? `账号「${activeAccount.name}」` : '通用（无账号定位）';
        const daysLabel = sortedDays.length === 7 ? '每天' : sortedDays.map((day) => AS_WEEKDAYS[day - 1].label).join('、');
        const depthLabel = AS_DEPTHS.find((item) => item.id === form.depth)?.label || form.depth;
        const description = `${label}；${daysLabel} ${form.time}；深度「${depthLabel}」；每轮最多 ${form.perRunLimit} 条；参与渠道 ${selectedCount} 个`;
        ask({
          title: editing ? '保存任务修改？' : '创建定时任务？',
          copy: `${description}。${AS_APPROVING.has(form.depth) ? '该深度将自动确认 AI 稿件，不再人工过稿；' : ''}到点后由主机侧调度器无人值守执行，切换页面不会中断。发布动作永远不会自动执行。`,
          confirm: editing ? '保存修改' : '创建任务',
          onConfirm: async () => {
            setBusy('save');
            try {
              if (editing) await remote(packId, 'updateSchedule', { scheduleId: editing.id, ...payloadOf() });
              else await remote(packId, 'createSchedule', payloadOf());
              setEditingId(null);
              setFormsByTab((prev) => ({ ...prev, [activeTab]: emptyScheduleForm() }));
              await loadSchedules();
            } catch (cause) { fail(cause.message); } finally { setBusy(null); }
          },
        });
      };

      const invoke = (method, request, marker, confirm, then) => {
        const run = async () => {
          setBusy(marker);
          try {
            const result = await remote(packId, method, request);
            await loadSchedules();
            if (then) await then(result);
          } catch (cause) { fail(cause.message); } finally { setBusy(null); }
        };
        if (confirm) ask({ ...confirm, onConfirm: () => { void run(); } });
        else void run();
      };

      const startEdit = (schedule) => {
        const tab = schedule.accountId && activeAccounts.some((item) => item.id === schedule.accountId) ? schedule.accountId : GENERAL_TAB;
        setActiveTab(tab);
        setFormsByTab((prev) => ({ ...prev, [tab]: scheduleFormOf(schedule, board) }));
        setEditingId(schedule.id);
      };
      const cancelEdit = () => {
        setEditingId(null);
        setFormsByTab((prev) => ({ ...prev, [activeTab]: emptyScheduleForm() }));
      };

      const toggleDay = (day) => { if (busy) return; patchForm((current) => { const days = new Set(current.days); if (days.has(day)) days.delete(day); else days.add(day); return { ...current, days }; }); };
      const setDays = (list) => { if (busy) return; patchForm((current) => ({ ...current, days: new Set(list) })); };
      const toggleSource = (id) => { if (busy) return; patchForm((current) => { const offSources = new Set(current.offSources); if (offSources.has(id)) offSources.delete(id); else offSources.add(id); return { ...current, offSources }; }); };
      const togglePlatform = (name) => { if (busy) return; patchForm((current) => { const offPlatforms = new Set(current.offPlatforms); if (offPlatforms.has(name)) offPlatforms.delete(name); else offPlatforms.add(name); return { ...current, offPlatforms }; }); };
      const selectAllSources = () => { if (busy) return; patchForm((current) => ({ ...current, offSources: new Set(), offPlatforms: new Set() })); };
      const clearSources = () => { if (busy) return; patchForm((current) => ({ ...current, offSources: new Set(allPublicIds), offPlatforms: new Set(platformCards.map((card) => card.platform)) })); };
      const toggleExclude = (signalId) => patchForm((current) => { const excluded = new Set(current.excluded); if (excluded.has(signalId)) excluded.delete(signalId); else excluded.add(signalId); return { ...current, excluded }; });
      const clearExcluded = () => patchForm((current) => ({ ...current, excluded: new Set() }));

      const tabs = h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号定位选择任务归属', disabled: Boolean(editing) });

      const sourceCard = (card) => {
        const on = !form.offSources.has(card.id);
        return h('div', { key: card.id, className: 'sv-tp-src', 'data-on': on ? 'true' : 'false' },
          h('div', { className: 'sv-tp-src-head' },
            h('button', { type: 'button', className: 'sv-tp-src-check', disabled: Boolean(busy), 'aria-pressed': on, 'aria-label': `${on ? '取消' : '选择'}${card.name}`, onClick: () => toggleSource(card.id) }, h('i', null)),
            h('button', { type: 'button', className: 'sv-tp-src-main', onClick: () => setSignalDrawer({ kind: 'signals', sourceId: card.id, platform: null, name: card.name }) },
              h('span', { className: 'sv-tp-src-titlerow' }, h('span', { className: 'sv-tp-src-dot', style: { background: sourceDotColor(card.name) } }), h('span', { className: 'sv-tp-src-name' }, card.name)),
              h('span', { className: 'sv-tp-src-meta' }, `最新 ${relativeTime(card.lastSuccessAt)} · 今日 ${card.todayCount}`),
            ),
          ),
        );
      };
      const platformCard = (card) => {
        const on = !form.offPlatforms.has(card.platform);
        const glyph = PLATFORM_GLYPHS[card.platform];
        return h('div', { key: card.platform, className: 'sv-tp-src', 'data-on': on ? 'true' : 'false' },
          h('div', { className: 'sv-tp-src-head' },
            h('button', { type: 'button', className: 'sv-tp-src-check', disabled: Boolean(busy), 'aria-pressed': on, 'aria-label': `${on ? '取消' : '选择'}${card.platform}`, onClick: () => togglePlatform(card.platform) }, h('i', null)),
            h('button', { type: 'button', className: 'sv-tp-src-main', onClick: () => setSignalDrawer({ kind: 'signals', sourceId: 'ai-daily-import', platform: card.platform, name: `AI 内容日报 · ${card.platform}` }) },
              h('span', { className: 'sv-tp-src-titlerow' }, h('span', { className: 'sv-tp-src-dot', style: { background: glyph ? glyph[0] : sourceDotColor(card.platform) } }), h('span', { className: 'sv-tp-src-name' }, card.platform)),
              h('span', { className: 'sv-tp-src-meta' }, `最新 ${relativeTime(card.lastImportedAt)} · 今日 ${card.todayCount}`),
            ),
          ),
        );
      };

      const runtimeBlockers = blockersFor(form.depth);
      const configCard = h('section', { className: 'sv-form' },
        h('div', { className: 'sv-section-head' },
          h('h3', null, editing ? `编辑任务 · ${editing.name}` : '新建自动化任务'),
          h('span', null, activeAccount ? activeAccount.name : '通用 · 无账号定位'),
        ),
        tabs,
        h('label', { className: 'sv-as-field' },
          h('span', { className: 'sv-as-label' }, '任务名称'),
          h('input', { className: 'sv-input', value: form.name, maxLength: 120, disabled: Boolean(busy), placeholder: '例如：晚间自动出片', onChange: (event) => patchForm((current) => ({ ...current, name: event.target.value })) }),
        ),
        h('div', { className: 'sv-as-field' },
          h('span', { className: 'sv-as-label' }, `执行日（已选 ${sortedDays.length} 天）`),
          h('div', { className: 'sv-as-chips' },
            ...AS_WEEKDAYS.map((item) => h('button', { key: item.day, type: 'button', className: 'sv-as-chip', 'data-on': form.days.has(item.day) ? 'true' : 'false', disabled: Boolean(busy), onClick: () => toggleDay(item.day) }, item.label)),
            h('button', { type: 'button', className: 'sv-as-chip', 'data-kind': 'quick', disabled: Boolean(busy), onClick: () => setDays([1, 2, 3, 4, 5, 6, 7]) }, '每天'),
            h('button', { type: 'button', className: 'sv-as-chip', 'data-kind': 'quick', disabled: Boolean(busy), onClick: () => setDays([1, 2, 3, 4, 5]) }, '工作日'),
            h('button', { type: 'button', className: 'sv-as-chip', 'data-kind': 'quick', disabled: Boolean(busy), onClick: () => setDays([6, 7]) }, '周末'),
          ),
        ),
        h('div', { className: 'sv-as-field' },
          h('span', { className: 'sv-as-label' }, '执行时刻（本机本地时间）'),
          h('div', { className: 'sv-as-chips' },
            h('input', { className: 'sv-input', type: 'time', value: form.time, style: { width: '128px', flex: 'none' }, disabled: Boolean(busy), onChange: (event) => patchForm((current) => ({ ...current, time: event.target.value })) }),
            ...['07:00', '09:00', '12:00', '18:00', '21:00'].map((item) => h('button', { key: item, type: 'button', className: 'sv-as-chip', 'data-on': form.time === item ? 'true' : 'false', disabled: Boolean(busy), onClick: () => patchForm((current) => ({ ...current, time: item })) }, item)),
          ),
          h('p', { className: 'sv-as-task-note' }, '到点时主机未运行则跳过本次，不自动补跑，只在该任务的运行记录里记一条「已错过」。'),
        ),
        h('label', { className: 'sv-as-field' },
          h('span', { className: 'sv-as-label' }, '选题角度（选填）'),
          h('textarea', { className: 'sv-textarea', style: { minHeight: '58px' }, value: form.angle, maxLength: 500, disabled: Boolean(busy), placeholder: '例如：避坑角度 · 真实使用场景，面向新手创作者', onChange: (event) => patchForm((current) => ({ ...current, angle: event.target.value })) }),
        ),
        h('div', { className: 'sv-section-head' },
          h('span', { className: 'sv-as-label' }, `参与渠道（初始已全选 · 已选 ${selectedCount}）`),
          h('span', { className: 'sv-actions' },
            h('button', { type: 'button', className: 'sv-tp-acct-link', disabled: Boolean(busy), onClick: selectAllSources }, '全选'),
            h('button', { type: 'button', className: 'sv-tp-acct-link', disabled: Boolean(busy), onClick: clearSources }, '清空'),
          ),
        ),
        h('p', { className: 'sv-tp-acct-note' }, '与选题页同一套渠道卡。执行时会先补采当天缺失的渠道；点渠道名可查看信号并排除单条。'),
        publicCards.length ? h('div', { className: 'sv-tp-srcgrid' }, publicCards.map(sourceCard)) : h('p', { className: 'sv-note' }, '正在读取信号源…'),
        platformCards.length ? h(React.Fragment, null,
          h('span', { className: 'sv-as-label' }, 'AI 内容日报（报告导入 · 按平台）'),
          h('div', { className: 'sv-tp-srcgrid' }, platformCards.map(platformCard)),
        ) : null,
        form.excluded.size ? h('div', { className: 'sv-tp-exclbar' }, h('span', null, `已排除 ${form.excluded.size} 条信号，本任务每次执行都不参与。`), h('button', { type: 'button', disabled: Boolean(busy), onClick: clearExcluded }, '清空排除')) : null,
        h('div', { className: 'sv-as-field' },
          h('span', { className: 'sv-as-label' }, '自动化深度（每轮跑到哪一步就停）'),
          h('div', { className: 'sv-as-depth' }, AS_DEPTHS.map((item) => h('button', { key: item.id, type: 'button', className: 'sv-as-depth-opt', 'data-on': form.depth === item.id ? 'true' : 'false', disabled: Boolean(busy), onClick: () => patchForm((current) => ({ ...current, depth: item.id })) },
            h('strong', null, item.label),
            h('span', null, item.copy),
          ))),
          AS_APPROVING.has(form.depth) ? h('p', { className: 'sv-as-warn' }, h('strong', null, '将自动确认 AI 稿件，不再人工过稿。'), h('span', null, '深度到达「成片」或「发布资料」时，自动化会代为确认稿件后继续配音与渲染。想保留人工把关请选「写稿」档：跑完停在稿件等你确认。')) : null,
          runtimeBlockers.length ? h('div', { className: 'sv-as-blockers' }, runtimeBlockers.map((item, index) => h('p', { key: index, className: 'sv-as-warn' }, item.message))) : null,
          runtime?.model?.provider ? h('p', { className: 'sv-meta' }, `本轮使用的场景任务模型：${runtime.model.provider} · ${runtime.model.model}${runtime.model.state === 'missing-credential' ? `，未配置凭据（${runtime.model.ref}）` : runtime.model.state === 'unverifiable' ? '，凭据状态未知' : ''}`) : null,
          runtime && runtime.automationAvailable === false ? h('p', { className: 'sv-error' }, '当前运行环境不提供执行自动化所需的 Agent 服务，任务保存后无法执行。') : null,
        ),
        h('div', { className: 'sv-as-adv' },
          h('p', { className: 'sv-as-adv-title' }, '每轮产量与成片规格'),
          h('div', { className: 'sv-as-grid2' },
            h('label', { className: 'sv-as-field' }, h('span', { className: 'sv-as-label' }, '每轮最多几条'), h('select', { className: 'sv-select', value: String(form.perRunLimit), disabled: Boolean(busy), onChange: (event) => patchForm((current) => ({ ...current, perRunLimit: Number(event.target.value) })) }, [1, 2, 3].map((item) => h('option', { key: item, value: String(item) }, `${item} 条`)))),
            h('label', { className: 'sv-as-field' }, h('span', { className: 'sv-as-label' }, '视频方向'), h('select', { className: 'sv-select', value: form.orientation, disabled: Boolean(busy), onChange: (event) => patchForm((current) => ({ ...current, orientation: event.target.value })) }, h('option', { value: 'landscape' }, '横屏'), h('option', { value: 'portrait' }, '竖屏'))),
            h('label', { className: 'sv-as-field' }, h('span', { className: 'sv-as-label' }, '稿件篇幅'), h('select', { className: 'sv-select', value: form.scriptTier, disabled: Boolean(busy), onChange: (event) => patchForm((current) => ({ ...current, scriptTier: event.target.value })) }, AS_TIERS.map((item) => h('option', { key: item.id, value: item.id }, item.label)))),
            h('label', { className: 'sv-as-field' }, h('span', { className: 'sv-as-label' }, '字幕'), h('select', { className: 'sv-select', value: form.subtitleEnabled ? 'on' : 'off', disabled: Boolean(busy), onChange: (event) => patchForm((current) => ({ ...current, subtitleEnabled: event.target.value === 'on' })) }, h('option', { value: 'on' }, '生成字幕'), h('option', { value: 'off' }, '不要字幕'))),
          ),
          h('label', { className: 'sv-as-field' },
            h('span', { className: 'sv-as-label' }, '画面制作说明（选填）'),
            h('textarea', { className: 'sv-textarea', style: { minHeight: '58px' }, value: form.visualBrief, maxLength: 6000, disabled: Boolean(busy), placeholder: '留空则交给 AI 视觉导演按稿件语义自由发挥', onChange: (event) => patchForm((current) => ({ ...current, visualBrief: event.target.value })) }),
          ),
          h('p', { className: 'sv-as-task-note' }, '音色默认使用系统预置音色；需要为某个账号固定音色时，请先在「配音 / 字幕」页人工跑一次确认效果。'),
        ),
        h('div', { className: 'sv-actions' },
          h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(busy) || !formValid, onClick: submit }, busy === 'save' ? '正在保存…' : editing ? '保存修改' : '创建任务'),
          editing ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy), onClick: cancelEdit }, '取消编辑，恢复为新建') : null,
          !form.name.trim() ? h('span', { className: 'sv-meta' }, '请填写任务名称')
            : !sortedDays.length ? h('span', { className: 'sv-meta' }, '请至少选择一个执行日')
              : selectedCount === 0 ? h('span', { className: 'sv-meta' }, '至少选择一个参与渠道') : null,
        ),
      );

      const scopedSchedules = schedules.filter((item) => (activeTab === GENERAL_TAB ? !item.accountId : item.accountId === activeTab));
      const runningRunOf = (scheduleId) => runs.find((run) => run.scheduleId === scheduleId && run.status === 'running') || null;
      const latestRunOf = (scheduleId) => runs.find((run) => run.scheduleId === scheduleId) || null;
      const taskCard = (schedule) => {
        const running = runningRunOf(schedule.id);
        const latest = schedule.latestRun || latestRunOf(schedule.id);
        const badge = running ? ['执行中', ''] : schedule.disabledReason ? ['不可用', 'sv-status-error'] : schedule.enabled ? ['启用', 'sv-stage'] : ['停用', 'sv-status-disabled'];
        const blocked = blockersFor(schedule.depth);
        return h('div', { key: schedule.id, className: 'sv-tp-task sv-as-task', 'data-status': running ? 'running' : 'idle', 'data-disabled': schedule.disabledReason ? 'true' : 'false' },
          h('div', { className: 'sv-tp-task-head' },
            h('div', { style: { minWidth: 0 } },
              h('p', { className: 'sv-tp-task-title' }, schedule.name),
              h('p', { className: 'sv-tp-task-meta' }, `${schedule.daysLabel} ${schedule.time} · 深度「${schedule.depthLabel}」· 每轮 ${schedule.perRunLimit} 条 · ${schedule.production.orientation === 'landscape' ? '横屏' : '竖屏'}`),
            ),
            h('span', { className: 'sv-tp-task-badges' },
              schedule.approvesScript ? h('span', { className: 'sv-tag sv-status-manual', title: '该深度会自动确认 AI 稿件' }, '自动确认稿件') : null,
              h('span', { className: `sv-tag ${badge[1]}` }, badge[0]),
            ),
          ),
          schedule.disabledReason ? h('p', { className: 'sv-as-disabled' }, schedule.disabledReason) : null,
          blocked.length ? h('p', { className: 'sv-as-disabled' }, blocked[0].message) : null,
          running ? h('p', { className: 'sv-as-task-note' }, `正在执行「${AS_STEPS[running.step] || running.step || '—'}」· ${relativeTime(running.triggeredAt)}触发`)
            : latest ? h('p', { className: 'sv-as-task-note' }, `最近 ${relativeTime(latest.triggeredAt)} · ${AS_RUN_STATUS[latest.status] || latest.status}${latest.itemCount ? ` · ${latest.itemCount} 条` : ''}${latest.message ? ` · ${latest.message}` : ''}`)
              : h('p', { className: 'sv-as-task-note' }, schedule.enabled ? `下次执行：${schedule.nextRunAt ? formatTime(schedule.nextRunAt) : '—'}` : '任务已停用，不会自动执行。'),
          h('div', { className: 'sv-tp-task-acts' },
            h('button', { type: 'button', className: 'lwb-plain-button', title: '查看该任务的全部执行记录', onClick: () => setHistorySchedule(schedule) }, '运行记录'),
            running ? h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(busy), onClick: () => invoke('cancelScheduleRun', { runId: running.id }, `cancel:${running.id}`, { title: '停止本轮执行？', copy: `停止「${schedule.name}」的本轮自动化？已完成的阶段产物会保留，未开始的阶段不再推进。`, confirm: '停止本轮', danger: true }, () => setHistoryRefresh((value) => value + 1)) }, busy === `cancel:${running.id}` ? '正在停止…' : '停止本轮')
              : h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(busy) || Boolean(schedule.disabledReason) || blocked.length > 0, onClick: () => invoke('runSchedule', { scheduleId: schedule.id }, `run:${schedule.id}`, { title: '立即执行一次？', copy: `按「${schedule.name}」的当前配置立即跑一轮，深度「${schedule.depthLabel}」。${schedule.approvesScript ? '将自动确认 AI 稿件。' : ''}一轮可能耗时十几分钟到一小时，期间可随时停止。`, confirm: '立即执行' }, () => { setHistorySchedule(schedule); setHistoryRefresh((value) => value + 1); }) }, busy === `run:${schedule.id}` ? '正在启动…' : '立即执行'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy) || Boolean(running), onClick: () => startEdit(schedule) }, '编辑'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy) || Boolean(running) || Boolean(schedule.disabledReason), onClick: () => invoke('setScheduleEnabled', { scheduleId: schedule.id, enabled: !schedule.enabled }, `toggle:${schedule.id}`, { title: schedule.enabled ? '停用任务？' : '启用任务？', copy: schedule.enabled ? `停用「${schedule.name}」后不再到点自动执行，历史记录保留。` : `启用「${schedule.name}」后将在 ${schedule.daysLabel} ${schedule.time} 自动执行。`, confirm: schedule.enabled ? '停用' : '启用', danger: schedule.enabled }) }, schedule.enabled ? '停用' : '启用'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy) || Boolean(running), onClick: () => invoke('deleteSchedule', { scheduleId: schedule.id }, `delete:${schedule.id}`, { title: '删除任务？', copy: `删除「${schedule.name}」及其全部运行历史？此操作不可撤销；已生成的项目与成片不受影响。`, confirm: '删除', danger: true }) }, '删除'),
          ),
        );
      };

      const taskPanel = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '定时任务'), h('span', { role: 'status', 'aria-live': 'polite' }, anyRunning ? '有任务正在执行' : `${scopedSchedules.length} 个任务`)),
        scopedSchedules.length ? h('div', { className: 'sv-list' }, scopedSchedules.map(taskCard)) : h('div', { className: 'sv-empty' }, '当前账号下还没有定时任务。左侧配置后点「创建任务」。'),
      );

      const enabledSchedules = schedules.filter((item) => item.enabled && !item.disabledReason);
      const nextRun = enabledSchedules.map((item) => item.nextRunAt).filter(Boolean).sort()[0] || null;
      const lastRun = runs[0] || null;
      const hero = h(HeroMini, { cells: [
        { label: '启用中任务', value: String(enabledSchedules.length), tone: 'brand' },
        { label: '下次执行', value: nextRun ? formatTime(nextRun) : '—', tone: nextRun ? 'green' : undefined },
        { label: '最近产出', value: lastRun ? `${lastRun.itemCount || 0} 条` : '—', tone: lastRun?.itemCount ? 'brand' : undefined },
        { label: '最近结果', value: lastRun ? AS_RUN_STATUS[lastRun.status] || lastRun.status : '—', tone: lastRun ? (['failed', 'cancelled'].includes(lastRun.status) ? 'red' : lastRun.status === 'partial' ? 'orange' : lastRun.status === 'missed' ? undefined : 'green') : undefined },
      ] });

      const signalsDrawerNode = signalDrawer && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: () => setSignalDrawer(null) }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': signalDrawer.name },
          h(SignalDrawerBody, { packId, sources, spec: signalDrawer, today: board?.today, busy: Boolean(busy), onClose: () => setSignalDrawer(null), onCollect: (ids) => { void remote(packId, 'collectSources', { sourceIds: ids }).then(() => remote(packId, 'board')).then(setBoard).catch((cause) => fail(cause.message)); }, onChanged: () => { void remote(packId, 'board').then(setBoard).catch(() => {}); }, ask, selection: { excluded: form.excluded, onToggle: toggleExclude } }),
        ),
      );

      const goPublish = (projectId) => { publishHandoff = { packId, projectId }; setHistorySchedule(null); openPackMenu?.('publish'); };
      const continueItem = (item) => { setHistorySchedule(null); if (item.scriptChars != null) audioCaptionsHandoff = item.projectId; openPackMenu?.(item.scriptChars != null ? 'audio-captions' : 'scripts'); };
      const runDetailDrawer = historySchedule && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭运行记录', onClick: () => setHistorySchedule(null) }),
        h('aside', { className: 'sv-drawer sv-drawer-wide sv-as-history-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '运行记录' },
          h('div', { className: 'sv-drawer-head' }, h('div', null, h('p', { className: 'sv-ex-kicker' }, '内容安排 / 执行记录'), h('h3', null, historySchedule.name), h('p', { className: 'sv-meta' }, '每一轮单独记录，点击展开执行过程。')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setHistorySchedule(null) }, '关闭')),
          h('div', { className: 'sv-drawer-scroll' }, h(ScheduleRunHistory, { key: historySchedule.id, packId, scheduleId: historySchedule.id, refreshKey: historyRefresh, onPublish: goPublish, onContinue: continueItem })),
        ),
      );
      return h(PackFrame, { packId, openConversation, title: '内容安排', accent: 'sky', copy: '按账号配置定时任务：到点后由主机侧调度器无人值守跑完「选题 → 写稿 → 配音字幕 → 成片质检 → 发布资料」。深度决定跑到哪一步；选到成片及以后会自动确认 AI 稿件。发布动作永远不会自动执行——跑完后到「发布」页人工核对。', hero },
        h(Notice, { error }),
        h('section', { className: 'sv-split' }, configCard, taskPanel),
        signalsDrawerNode,
        runDetailDrawer,
        confirmNode,
      );
    }
    function mediaRunLabel(type) { return ({ voiceover: '配音生成', subtitles: '字幕对齐', video: '视频渲染', qc: '技术质检' })[type] || type; }
    function mediaStatusLabel(status) { return ({ queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败' })[status] || status; }
    function mediaErrorText(error) {
      const value = String(error || '').replace(/^Error \[[A-Z0-9_]+\]\s*/u, '');
      return /(?:insufficient[ _-]*points|积分不足|余额不足)/iu.test(value)
        ? 'LWB 账户积分不足，请充值后重试，或切换到百炼 BYOK。'
        : value;
    }
    function videoPhaseLabel(phase) { return ({ preparing: '正在准备制作空间', directing: 'AI 视觉导演创作中', preflight: '正在检查 Remotion 工程', rendering: '正在渲染成片', 'technical-qc': '正在执行技术质检', 'editorial-review': '独立审片中', committing: '正在提交成片', completed: '已完成', failed: '失败' })[phase] || null; }
    function mediaDataUrl(media) { return media?.data && media?.mediaType ? `data:${media.mediaType};base64,${media.data}` : null; }
    function downloadBase64(media, filename) {
      if (!media?.data) return;
      const decoded = globalThis.atob(media.data); const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: media.mediaType || 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    function MediaRunList({ runs }) {
      if (!runs?.length) return null;
      const items = runs.slice(0, 12).map((run) => h(
        'article',
        { key: run.id, className: 'sv-item' },
        h('div', { className: 'sv-item-head' },
          h('strong', null, mediaRunLabel(run.type)),
          h('span', { className: `sv-tag ${run.status === 'failed' ? 'sv-status-error' : run.status === 'succeeded' ? 'sv-stage' : 'sv-status-manual'}` }, mediaStatusLabel(run.status)),
        ),
        h('p', { className: 'sv-meta' }, `${formatTime(run.createdAt)} · 版本 ${run.expectedRevision}`),
        run.error ? h('p', { className: 'sv-error' }, run.error) : null,
      ));
      return h(
        'section',
        { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '媒体任务'), h('span', null, `${runs.length} 条`)),
        h('div', { className: 'sv-list sv-run-list' }, items),
      );
    }
    function useMediaRuns(packId, projectId, refreshProjects, reloadDetail, setError) {
      const [service, setService] = React.useState(null); const [runs, setRuns] = React.useState([]); const [busy, setBusy] = React.useState(null);
      const refreshRuns = React.useCallback(async () => {
        if (!packId) { setService(null); setRuns([]); return; }
        try {
          const [nextService, nextRuns] = await Promise.all([remoteStatic('mediaStatus'), projectId ? remote(packId, 'mediaOperations', { projectId }) : Promise.resolve([])]);
          setService(nextService); setRuns(nextRuns); setError(null);
          if (projectId && nextRuns.some((run) => run.status === 'succeeded' || run.status === 'failed')) { await refreshProjects(); await reloadDetail(projectId); }
        } catch (cause) { setError(cause.message); }
      }, [packId, projectId, refreshProjects, reloadDetail, setError]);
      React.useEffect(() => { void refreshRuns(); }, [refreshRuns]);
      React.useEffect(() => {
        if (!runs.some((run) => run.status === 'queued' || run.status === 'running')) return undefined;
        const timer = setInterval(() => { void refreshRuns(); }, 1800); return () => clearInterval(timer);
      }, [runs, refreshRuns]);
      const start = React.useCallback(async (method, request, marker) => {
        setBusy(marker);
        try { const started = await remote(packId, method, request); await refreshRuns(); setError(null); return started; } catch (cause) { setError(cause.message); return null; } finally { setBusy(null); }
      }, [packId, refreshRuns, setError]);
      return { service, runs, busy, start, refreshRuns };
    }
    function useMediaTasks(packId, setError) {
      const [tasks, setTasks] = React.useState([]);
      const refresh = React.useCallback(async () => {
        if (!packId) { setTasks([]); return []; }
        try { const next = await remote(packId, 'listMediaTasks'); setTasks(next); return next; }
        catch (cause) { setError(cause.message); return []; }
      }, [packId, setError]);
      React.useEffect(() => { void refresh(); }, [refresh]);
      const anyRunning = tasks.some((task) => task.status === 'queued' || task.status === 'running');
      React.useEffect(() => {
        if (!anyRunning) return undefined;
        const timer = setInterval(() => { void refresh(); }, 1800);
        return () => clearInterval(timer);
      }, [anyRunning, refresh]);
      return { tasks, refresh, anyRunning };
    }
    function useAudioTasks(packId, query, status, page, scope, setError, refreshProjects) {
      const emptyResult = { items: [], total: 0, counts: { all: 0, queued: 0, running: 0, succeeded: 0, failed: 0 } };
      const [result, setResult] = React.useState(emptyResult);
      const [loading, setLoading] = React.useState(false);
      const requestKey = JSON.stringify([packId, query, status, page, scope.accountId, scope.general]);
      const currentKey = React.useRef(requestKey);
      const requestVersion = React.useRef(0);
      currentKey.current = requestKey;
      const refresh = React.useCallback(async () => {
        const version = ++requestVersion.current;
        const isCurrent = () => currentKey.current === requestKey && requestVersion.current === version;
        if (!packId) { setResult({ ...emptyResult, requestKey }); return null; }
        setLoading(true);
        try {
          const next = await remote(packId, 'listAudioTasks', { query, status, offset: page * 8, limit: 8, ...(scope.accountId ? { accountId: scope.accountId } : {}), ...(scope.general ? { general: true } : {}) });
          if (!isCurrent()) return null;
          setResult({ ...next, requestKey }); setError(null); await refreshProjects(); return next;
        } catch (cause) {
          if (isCurrent()) { setResult({ ...emptyResult, requestKey }); setError(cause.message); }
          return null;
        } finally { if (isCurrent()) setLoading(false); }
      }, [packId, query, status, page, scope.accountId, scope.general, requestKey, setError, refreshProjects]);
      React.useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
      const current = result.requestKey === requestKey ? result : emptyResult;
      const anyRunning = current.counts.queued > 0 || current.counts.running > 0 || current.items.some((task) => ['queued', 'running'].includes(task.subtitle?.status));
      React.useEffect(() => {
        if (!anyRunning) return undefined;
        const timer = setInterval(() => { void refresh(); }, 1800);
        return () => clearInterval(timer);
      }, [anyRunning, refresh]);
      return { ...current, loading: loading || result.requestKey !== requestKey, refresh, anyRunning };
    }
    function useVideoTasks(packId, query, status, page, scope, setError, refreshProjects) {
      const [result, setResult] = React.useState({ items: [], total: 0, counts: { all: 0, queued: 0, running: 0, succeeded: 0, failed: 0 } });
      const [loading, setLoading] = React.useState(false);
      const refresh = React.useCallback(async () => {
        if (!packId) { setResult({ items: [], total: 0, counts: { all: 0, queued: 0, running: 0, succeeded: 0, failed: 0 } }); return null; }
        setLoading(true);
        try {
          const next = await remote(packId, 'listVideoTasks', { query, status, offset: page * 6, limit: 6, ...(scope.accountId ? { accountId: scope.accountId } : {}), ...(scope.general ? { general: true } : {}) });
          setResult(next); setError(null); await refreshProjects(); return next;
        } catch (cause) { setError(cause.message); return null; } finally { setLoading(false); }
      }, [packId, query, status, page, scope.accountId, scope.general, setError]);
      React.useEffect(() => { void refresh(); }, [refresh]);
      const anyRunning = result.items.some((task) => task.status === 'queued' || task.status === 'running');
      React.useEffect(() => {
        if (!anyRunning) return undefined;
        const timer = setInterval(() => { void refresh(); void refreshProjects(); }, 1800);
        return () => clearInterval(timer);
      }, [anyRunning, refresh, refreshProjects]);
      return { ...result, loading, refresh, anyRunning };
    }
    function formatMediaDuration(value) {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) return '时长待确认';
      const rounded = Math.round(seconds);
      return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
    }
    function formatMediaClock(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    function subtitleTaskProgress(task, now = Date.now()) {
      const subtitle = task?.subtitle || {};
      if (subtitle.status === 'queued') return { label: '字幕任务正在排队…', button: '字幕排队中…', percent: null };
      if (subtitle.status !== 'running') return null;
      const duration = Number(task?.result?.audio?.durationSeconds);
      const startedAt = Date.parse(subtitle.startedAt || '');
      if (subtitle.input?.provider !== 'bailian' || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startedAt)) {
        return { label: '字幕服务正在处理音频…', button: '字幕生成中…', percent: null };
      }
      const elapsed = Math.max(0, (now - startedAt) / 1000);
      const processed = Math.min(duration, elapsed);
      const percent = Math.min(99, Math.max(1, Math.floor(processed / duration * 100)));
      const remaining = Math.max(0, duration - elapsed);
      return remaining > 0
        ? { label: `实时识别 ${formatMediaClock(processed)} / ${formatMediaClock(duration)} · 约剩 ${formatMediaClock(Math.ceil(remaining))}`, button: `实时识别 ${percent}%`, percent }
        : { label: '音频已发送，正在整理识别结果…', button: '正在整理字幕…', percent: 99 };
    }
    function formatMediaBytes(value) {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes <= 0) return '大小待确认';
      return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
    }
    function subtitleCues(srt) {
      return String(srt || '').trim().split(/\n\s*\n/u).filter(Boolean).map((block, index) => {
        const lines = block.split('\n');
        const time = lines.find((line) => line.includes('-->')) || '';
        const timeIndex = lines.indexOf(time);
        return { id: `${index}-${time}`, time, text: lines.slice(timeIndex + 1).join('\n') };
      });
    }
    function srtFromSubtitleCues(cues) {
      return cues.map((cue, index) => `${index + 1}\n${cue.time}\n${cue.text.trim()}`).join('\n\n');
    }
    function AudioTaskPreview({ packId, taskId, setError }) {
      const [audioUrl, setAudioUrl] = React.useState(null);
      React.useEffect(() => {
        let cancelled = false;
        setAudioUrl(null);
        void remote(packId, 'readAudioTaskMedia', { taskId }).then((next) => {
          if (!cancelled) setAudioUrl(mediaDataUrl(next));
        }).catch((cause) => { if (!cancelled) setError(cause.message); });
        return () => { cancelled = true; };
      }, [packId, taskId, setError]);
      return h('div', { className: 'sv-audio-player' }, audioUrl
        ? h('audio', { controls: true, preload: 'metadata', src: audioUrl })
        : h('p', null, '正在加载音频…'));
    }
    function VideoTaskMediaPreview({ packId, task, stage, setError }) {
      const [mediaUrl, setMediaUrl] = React.useState(null);
      React.useEffect(() => {
        let cancelled = false;
        setMediaUrl(null);
        void remote(packId, 'readVideoTaskMedia', { projectId: task.projectId, taskId: task.id, stage }).then((next) => {
          if (!cancelled) setMediaUrl(mediaDataUrl(next));
        }).catch((cause) => { if (!cancelled) setError(cause.message); });
        return () => { cancelled = true; };
      }, [packId, task.projectId, task.id, stage, setError]);
      if (stage === 'voiceover' || stage === 'bgm') return h('div', { className: 'sv-audio-player' }, mediaUrl
        ? h('audio', { controls: true, preload: 'metadata', src: mediaUrl })
        : h('p', null, stage === 'bgm' ? '正在加载任务 BGM…' : '正在加载任务配音…'));
      return h('div', { className: 'sv-video-stage' }, mediaUrl
        ? h('video', { controls: true, preload: 'metadata', src: mediaUrl })
        : h('p', null, '正在加载成片预览…'));
    }
    function LegacyAudioCaptionsPageV2({ packId, openConversation }) {
      const { projects, refresh, error, setError } = useProjects(packId);
      const candidates = projects.filter((project) => project.completedStages.includes('script') && project.scriptApproval?.current);
      const [selectedId, setSelectedId] = useSelectedProject(projects, (project) => project.completedStages.includes('script') && project.scriptApproval?.current);
      const { detail, error: detailError, reload } = useDetail(packId, selectedId);
      const { saving, commit } = useCommit(packId, refresh, reload, setError);
      const media = useMediaRuns(packId, selectedId, refresh, reload, setError);
      const taskFeed = useMediaTasks(packId, setError);
      const [voiceover, setVoiceover] = React.useState('');
      const [subtitles, setSubtitles] = React.useState('');
      const [provider, setProvider] = React.useState(null);
      const [apiKey, setApiKey] = React.useState('');
      const [voiceSource, setVoiceSource] = React.useState('system');
      const [rate, setRate] = React.useState(1);
      const [volume, setVolume] = React.useState(1);
      const [configOpen, setConfigOpen] = React.useState(false);
      const [connectionBusy, setConnectionBusy] = React.useState(null);
      const [openAudioTaskId, setOpenAudioTaskId] = React.useState(null);
      const [subtitleDrawer, setSubtitleDrawer] = React.useState(null);

      React.useEffect(() => {
        setVoiceover(stageData(detail, 'voiceover')?.notes || '');
        setSubtitles(stageData(detail, 'subtitles')?.srt || '');
      }, [detail?.id, detail?.revision]);
      React.useEffect(() => {
        const handoff = audioCaptionsHandoff;
        if (!handoff || !candidates.some((project) => project.id === handoff)) return;
        setSelectedId(handoff);
        audioCaptionsHandoff = null;
      }, [candidates, setSelectedId]);
      React.useEffect(() => {
        if (provider || !media.service?.connection?.provider) return;
        setProvider(media.service.connection.provider);
      }, [provider, media.service?.connection?.provider]);

      if (!packId) return h(NeedPack, { openConversation });

      const scriptBody = stageData(detail, 'script')?.body || '';
      const providerId = provider || media.service?.connection?.provider || 'bailian';
      const selectedProvider = media.service?.providers?.[providerId];
      const providerCredential = selectedProvider?.credential;
      const providerLabel = providerId === 'bailian' ? '百炼 BYOK' : 'LWB 账号';
      const referenceVoiceReady = selectedProvider?.referenceVoiceConfigured;
      const credentialStatus = !selectedProvider?.configured ? '服务不可用' : !referenceVoiceReady ? '默认音色未配置' : providerCredential?.configured ? '连接已保存' : '需要 API Key';
      const canGenerate = Boolean(selectedProvider?.configured && referenceVoiceReady && providerCredential?.configured);
      const voiceReady = done(detail, 'voiceover');
      const subtitleReady = done(detail, 'subtitles');
      const voiceArtifact = stageData(detail, 'voiceover');
      const subtitleData = stageData(detail, 'subtitles');
      const startVoiceover = async () => {
        if (!detail) return;
        const started = await media.start('startVoiceover', { projectId: detail.id, expectedRevision: detail.revision, provider: providerId, voiceSource, rate: Number(rate), volume: Number(volume) }, 'voiceover');
        if (started) void taskFeed.refresh();
      };
      const startSubtitles = async () => {
        if (!detail) return;
        const started = await media.start('startSubtitles', { projectId: detail.id, expectedRevision: detail.revision, provider: providerId, language: 'zh', aiOptimize: true }, 'subtitles');
        if (started) void taskFeed.refresh();
      };
      const saveConnection = async () => {
        if (!apiKey.trim()) return;
        setConnectionBusy('save');
        try {
          const saved = await remoteStatic('configureMediaConnection', { provider: providerId, apiKey });
          setProvider(saved.provider);
          setApiKey('');
          await media.refreshRuns();
          setError(null);
        } catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };
      const clearConnection = async () => {
        setConnectionBusy('clear');
        try {
          const saved = await remoteStatic('clearMediaConnectionCredential', { provider: providerId });
          setProvider(saved.provider);
          setApiKey('');
          await media.refreshRuns();
          setError(null);
        } catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };
      const openSubtitles = async (task) => {
        setSelectedId(task.projectId);
        setSubtitleDrawer({ task, loading: true, project: null, data: null });
        try {
          const project = await remote(packId, 'get', { projectId: task.projectId });
          setSubtitleDrawer({ task, loading: false, project, data: stageData(project, 'subtitles') || null });
        } catch (cause) {
          setError(cause.message);
          setSubtitleDrawer(null);
        }
      };

      const voiceHero = h(HeroMini, { cells: [
        { label: '已确认稿件', value: String(candidates.length), tone: 'brand' },
        { label: '待配音', value: String(candidates.filter((project) => !project.completedStages.includes('voiceover')).length), tone: 'orange' },
        { label: '字幕就绪', value: String(candidates.filter((project) => project.completedStages.includes('subtitles')).length), tone: 'green' },
        { label: '任务状态', value: taskFeed.anyRunning ? '生成中' : '空闲', tone: taskFeed.anyRunning ? 'brand' : 'green' },
      ] });
      const voiceCopy = '从已确认稿件生成可播放配音，并基于真实音频时间轴生成字幕。';

      const providerConfigStrip = h('section', { className: 'sv-media-config-strip' },
        h('div', { className: 'sv-media-config-summary' },
          h('span', { className: 'sv-media-config-mark', 'aria-hidden': 'true' }, '♪'),
          h('div', { className: 'sv-media-config-copy' }, h('strong', null, providerLabel), h('span', null, providerCredential?.configured ? '已保存连接' : '等待配置')),
        ),
        h('div', { className: 'sv-media-config-meta' },
          h('span', { className: `sv-tag ${canGenerate ? 'sv-stage' : selectedProvider?.configured ? 'sv-status-manual' : 'sv-status-disabled'}` }, credentialStatus),
          h('button', { type: 'button', className: 'sv-media-config-trigger', title: '连接设置', 'aria-label': '打开连接设置', onClick: () => setConfigOpen(true) }, h('span', { 'aria-hidden': 'true' }, '⚙'), h('span', null, '连接设置')),
        ),
      );
      const providerConfigDrawer = configOpen && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭连接设置', onClick: () => setConfigOpen(false) }),
        h('aside', { className: 'sv-drawer sv-media-config-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '连接设置' },
          h('div', { className: 'sv-drawer-head' },
            h('div', null, h('p', { className: 'sv-eyebrow' }, 'CONNECTION'), h('h3', { className: 'sv-media-drawer-title' }, '连接设置'), h('p', { className: 'sv-media-drawer-copy' }, '密钥保存到 DSH 私有凭据库，重启后仍可用；不会写入项目、媒体任务或浏览器存储。')),
            h('button', { type: 'button', className: 'sv-ghost-btn', title: '关闭', 'aria-label': '关闭连接设置', onClick: () => setConfigOpen(false) }, '×'),
          ),
          h('div', { className: 'sv-media-drawer-body' },
            h('section', { className: 'sv-media-settings-section', style: { paddingTop: 0, borderTop: 0 } },
              h('h4', null, '生成方式'),
              h('div', { className: 'sv-media-provider-picker', role: 'tablist', 'aria-label': '生成方式' },
                h('button', { type: 'button', className: 'sv-media-provider-choice', role: 'tab', 'aria-selected': providerId === 'bailian' ? 'true' : 'false', 'data-active': providerId === 'bailian' ? 'true' : 'false', disabled: Boolean(connectionBusy), onClick: () => { setProvider('bailian'); setApiKey(''); } }, '百炼 BYOK'),
                h('button', { type: 'button', className: 'sv-media-provider-choice', role: 'tab', 'aria-selected': providerId === 'lwb' ? 'true' : 'false', 'data-active': providerId === 'lwb' ? 'true' : 'false', disabled: Boolean(connectionBusy), onClick: () => { setProvider('lwb'); setApiKey(''); } }, 'LWB 账号'),
              ),
            ),
            h('section', { className: 'sv-media-settings-section' },
              h('h4', null, '访问凭据'),
              h('label', { className: 'sv-media-field' }, h('span', null, providerId === 'bailian' ? '百炼 API Key' : 'LWB API Key'), h('input', { className: 'sv-input', type: 'password', value: apiKey, maxLength: 512, autoComplete: 'off', placeholder: providerCredential?.configured ? '已保存，输入新值可更新' : '输入后保存到私有凭据库', disabled: Boolean(connectionBusy), onChange: (event) => setApiKey(event.target.value) })),
              h('p', { className: 'sv-note' }, providerCredential?.configured ? (providerCredential.writable ? '密钥已保存。输入新值后可更新，密钥不会回显。' : '密钥由启动环境管理，当前页面不能修改或清除。') : '尚未保存密钥。保存后，后续启动无需重复输入。'),
            ),
          ),
          h('div', { className: 'sv-media-drawer-foot' },
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(connectionBusy) || !providerCredential?.configured || !providerCredential.writable, onClick: () => { void clearConnection(); } }, connectionBusy === 'clear' ? '正在清除…' : '清除已保存密钥'),
            h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(connectionBusy) || !apiKey.trim(), onClick: () => { void saveConnection(); } }, connectionBusy === 'save' ? '正在保存…' : '保存连接'),
          ),
        ),
      );

      const configPanel = h('section', { className: 'sv-form sv-audio-config' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '新建配音任务'), h('span', null, `${candidates.length} 个可用稿件`)),
        h('label', { className: 'sv-media-field' }, h('span', null, '已确认稿件'), h('select', { className: 'sv-select', value: selectedId || '', onChange: (event) => setSelectedId(event.target.value || null) }, h('option', { value: '' }, candidates.length ? '选择一篇已确认稿件' : '暂无已确认稿件'), candidates.map((project) => h('option', { key: project.id, value: project.id }, project.title)))),
        detail ? h('div', { className: 'sv-audio-project' }, h('strong', null, detail.title), h('span', null, `已确认 · ${charCount(scriptBody)} 字 · ${scriptDurationLabel(scriptBody)} 预计口播`)) : null,
        h('label', { className: 'sv-media-field' }, h('span', null, '文本内容'), h('textarea', { className: 'sv-textarea sv-audio-script', value: scriptBody, readOnly: true, placeholder: '选择已确认稿件后显示正文' })),
        h('p', { className: 'sv-note' }, '文本与已确认稿件绑定。需要改文案时，请返回写稿模块修改并重新确认。'),
        h('label', { className: 'sv-media-field' }, h('span', null, '音色'), h('select', { className: 'sv-select', value: voiceSource, onChange: (event) => setVoiceSource(event.target.value) }, h('option', { value: 'system' }, 'Tiffy - 自信（系统默认）'))),
        h('p', { className: 'sv-note' }, '首次使用时会将系统默认参考音频提交给当前配音服务，后续会自动复用。'),
        h('div', { className: 'sv-audio-parameters' },
          h('label', { className: 'sv-media-field' }, h('span', null, '语速'), h('input', { className: 'sv-input', type: 'number', min: '0.5', max: '2', step: '0.05', value: rate, onChange: (event) => setRate(event.target.value) })),
          h('label', { className: 'sv-media-field' }, h('span', null, '音量'), h('input', { className: 'sv-input', type: 'number', min: '0', max: '2', step: '0.05', value: volume, onChange: (event) => setVolume(event.target.value) })),
        ),
        h('div', { className: 'sv-audio-connect-note' }, h('span', null, credentialStatus), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setConfigOpen(true) }, '连接设置')),
        h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: media.busy || !detail || !canGenerate, onClick: () => { void startVoiceover(); } }, media.busy === 'voiceover' ? '正在提交…' : '生成配音')),
        voiceReady ? h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: subtitleReady ? 'lwb-plain-button' : 'lwb-primary-button', disabled: media.busy || !canGenerate, onClick: () => { void startSubtitles(); } }, media.busy === 'subtitles' ? '正在对齐…' : subtitleReady ? '重新生成字幕' : '从真实音频生成字幕')) : null,
        h('details', { className: 'sv-form', open: false },
          h('summary', null, '人工记录与字幕校对'),
          h('form', { className: 'sv-list', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'voiceover', { notes: voiceover }); } },
            h('label', { className: 'sv-media-field' }, h('span', null, '人工配音记录'), h('textarea', { className: 'sv-textarea', value: voiceover, maxLength: 6000, placeholder: '记录人工录音位置、音色、语速与复核说明', onChange: (event) => setVoiceover(event.target.value) })),
            h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-plain-button', disabled: saving || !detail || !voiceover.trim() }, saving ? '正在保存…' : '保存人工记录')),
          ),
          h('form', { className: 'sv-list', onSubmit: (event) => { event.preventDefault(); void commit(detail, 'subtitles', { srt: subtitles }); } },
            h('label', { className: 'sv-media-field' }, h('span', null, '校对后的 SRT'), h('textarea', { className: 'sv-textarea', value: subtitles, maxLength: 30000, placeholder: '粘贴或编辑经校对的 SRT 字幕', onChange: (event) => setSubtitles(event.target.value) })),
            h('div', { className: 'sv-actions' }, h('button', { type: 'submit', className: 'lwb-plain-button', disabled: saving || !detail || !subtitles.trim() }, saving ? '正在保存…' : '保存校对字幕')),
          ),
        ),
      );

      const taskCard = (task) => {
        const isVoice = task.type === 'voiceover';
        const audio = task.result?.audio || null;
        const taskMeta = [
          mediaRunLabel(task.type), formatTime(task.createdAt), task.input?.provider === 'bailian' ? '百炼 BYOK' : task.input?.provider === 'lwb' ? 'LWB 账号' : null,
          task.input?.voiceId ? `音色 ${task.input.voiceId}` : task.input?.voiceName || null,
          task.input?.rate ? `语速 ${task.input.rate}` : null,
        ].filter(Boolean).join(' · ');
        return h('article', { key: task.id, className: 'sv-audio-task', 'data-status': task.status, 'data-active': task.projectId === selectedId ? 'true' : 'false' },
          h('div', { className: 'sv-audio-task-head' },
            h('div', null, h('p', { className: 'sv-audio-task-title' }, task.projectTitle || '未命名项目'), h('p', { className: 'sv-audio-task-meta' }, taskMeta)),
            h('span', { className: `sv-tag ${task.status === 'failed' ? 'sv-status-error' : task.status === 'succeeded' ? 'sv-stage' : 'sv-status-manual'}` }, mediaStatusLabel(task.status)),
          ),
          isVoice && audio ? h('div', { className: 'sv-audio-task-detail' }, h('span', null, `时长 ${formatMediaDuration(audio.durationSeconds)}`), h('span', null, audio.sampleRate ? `${audio.sampleRate} Hz` : '采样率待确认'), h('span', null, formatMediaBytes(audio.bytes))) : null,
          !isVoice && task.result?.cueCount != null ? h('div', { className: 'sv-audio-task-detail' }, h('span', null, `已对齐 ${task.result.cueCount} 条字幕`), task.result?.warnings?.length ? h('span', null, `${task.result.warnings.length} 条提示`) : null) : null,
          task.error ? h('p', { className: 'sv-error' }, mediaErrorText(task.error)) : null,
          h('div', { className: 'sv-actions' },
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSelectedId(task.projectId) }, task.projectId === selectedId ? '当前稿件' : '查看稿件'),
            isVoice && task.status === 'succeeded' ? h('button', { type: 'button', className: openAudioTaskId === task.id ? 'lwb-plain-button' : 'lwb-primary-button', onClick: () => setOpenAudioTaskId((current) => current === task.id ? null : task.id) }, openAudioTaskId === task.id ? '收起播放器' : '播放音频') : null,
            !isVoice && task.status === 'succeeded' ? h('button', { type: 'button', className: 'lwb-primary-button', onClick: () => { void openSubtitles(task); } }, '查看字幕') : null,
          ),
          isVoice && openAudioTaskId === task.id ? h(MediaAudioPreview, { packId, projectId: task.projectId, setError }) : null,
        );
      };
      const taskPanel = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '配音任务'), h('span', null, taskFeed.anyRunning ? '生成进行中' : `${taskFeed.tasks.length} 条记录`)),
        taskFeed.tasks.length ? h('div', { className: 'sv-list sv-run-list' }, taskFeed.tasks.map(taskCard)) : h('div', { className: 'sv-empty' }, '尚无配音或字幕任务。左侧选择已确认稿件后生成配音。'),
      );

      const subtitleDataForDrawer = subtitleDrawer?.data;
      const drawerCues = subtitleCues(subtitleDataForDrawer?.srt);
      const subtitlesDrawer = subtitleDrawer && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭字幕内容', onClick: () => setSubtitleDrawer(null) }),
        h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '字幕内容' },
          h('div', { className: 'sv-drawer-head' },
            h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, `字幕内容 · ${subtitleDrawer.project?.title || subtitleDrawer.task.projectTitle}`), h('p', { className: 'sv-meta' }, subtitleDataForDrawer ? `${subtitleDataForDrawer.cueCount || drawerCues.length} 条 · ${relativeTime(subtitleDrawer.task.createdAt)}` : '读取当前字幕中')),
            h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSubtitleDrawer(null) }, '关闭'),
          ),
          h('div', { className: 'sv-drawer-scroll' },
            subtitleDrawer.loading ? h('p', { className: 'sv-note' }, '正在读取字幕…') : subtitleDataForDrawer ? h(React.Fragment, null,
              subtitleDataForDrawer.warnings?.length ? h('ul', { className: 'sv-warn-list' }, subtitleDataForDrawer.warnings.map((warning, index) => h('li', { key: index }, warning))) : null,
              h('div', { className: 'sv-subtitle-cues' }, drawerCues.map((cue) => h('article', { key: cue.id, className: 'sv-subtitle-cue' }, h('time', null, cue.time), h('p', null, cue.text)))),
              h('details', { className: 'sv-form', open: false }, h('summary', null, '查看 SRT 源文'), h('pre', { className: 'sv-subtitle-raw' }, subtitleDataForDrawer.srt)),
            ) : h('div', { className: 'sv-empty' }, '当前项目还没有可展示的字幕。'),
          ),
        ),
      );

      return h(PackFrame, { packId, openConversation, title: '配音 / 字幕', accent: 'pink', copy: voiceCopy, hero: voiceHero },
        h(Notice, { error: error || detailError }),
        providerConfigStrip,
        h('section', { className: 'sv-split sv-audio-workbench' }, configPanel, taskPanel),
        providerConfigDrawer,
        subtitlesDrawer,
      );
    }
    const BAILIAN_REGION_NOTICE = '当前内置百炼接入使用中国内地·华北 2（北京）地域，请填写该地域的 API Key。其他地域的 API Key 不能直接用于当前默认地址。';
    function availableMediaProvider(current, available, saved) {
      return available.includes(current) ? current : available.includes(saved) ? saved : available[0] || null;
    }
    function lwbServiceUnavailableText(account, credential, serviceId) {
      const location = serviceId === 'cover-image' ? '封面生图配置' : '连接配置';
      const serviceName = serviceId === 'cover-image' ? '封面生图' : '配音 / 字幕';
      if (account?.phase === 'loading') return '正在读取 LWB 账号状态…';
      if (!account?.user) return account?.error || `尚未登录 LWB 账号。请在「${location}」中前往设置登录，或配置百炼 API Key。`;
      const state = account.catalog?.services?.[serviceId];
      const reason = account.error || account.serviceError || state?.reason || (credential?.authenticated ? credential.reason : null);
      if (reason) return `已登录 LWB 账号。${reason}`;
      if (!credential || credential.authenticated === false || (state?.available && !credential.configured)) return `已登录 LWB 账号，正在同步${serviceName}服务状态…`;
      return `已登录 LWB 账号，但${serviceName}服务暂未开放。请在「${location}」中查看详情，或配置百炼 API Key。`;
    }
    function ServiceConnectionDrawer({ open, onClose, image, lwbAccount, provider, setProvider, credential, apiKey, setApiKey, model, setModel, busy, save, clear, selected }) {
      if (!open) return null;
      const title = image ? '封面生图配置' : '连接配置';
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': `关闭${title}`, onClick: onClose }),
        h('aside', { className: 'sv-drawer sv-media-config-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { className: 'sv-media-drawer-title' }, title), h('p', { className: 'sv-media-drawer-copy' }, '选择 LWB 账号服务，或使用自己的百炼账户。')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: onClose }, '关闭')),
          h('div', { className: 'sv-media-drawer-body' },
            h('div', { className: 'sv-media-provider-picker', role: 'tablist', 'aria-label': title }, ['lwb', 'bailian'].map(id => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': provider === id, className: 'sv-media-provider-choice', 'data-active': provider === id ? 'true' : 'false', disabled: Boolean(busy), onClick: () => { setProvider(id); setApiKey(''); } }, id === 'lwb' ? 'LWB 账号' : '百炼'))),
            provider === 'lwb' ? (lwbAccount?.ServiceCard ? h(lwbAccount.ServiceCard, { service: image ? 'cover-image' : 'tts', description: image ? '可使用 LWB 提供的封面图片生成服务，无需配置 API Key。' : '可使用 LWB 提供的配音和字幕服务，无需配置 API Key。' }) : h('p', { className: 'sv-note' }, 'LWB 账号服务暂不可用。')) : h(React.Fragment, null,
              h('p', { className: 'sv-note', role: 'note' }, BAILIAN_REGION_NOTICE),
              h('label', { className: 'sv-media-field' }, h('span', null, '百炼 API Key'), h('input', { className: 'sv-input', type: 'password', value: apiKey, maxLength: 512, autoComplete: 'off', placeholder: credential?.configured ? '已保存；输入新值可更新' : '输入 API Key', onChange: event => setApiKey(event.target.value) })),
              image && h('label', { className: 'sv-media-field' }, h('span', null, '生图模型（可选）'), h('input', { className: 'sv-input', value: model, maxLength: 120, placeholder: '默认模型', onChange: event => setModel(event.target.value) })),
              h('p', { className: 'sv-note' }, credential?.configured ? '密钥已保存，不会回显。' : '密钥保存到私有凭据库，不会写入浏览器存储。')),
            h('p', { className: 'sv-note' }, `当前默认服务：${selected === 'bailian' ? '百炼' : 'LWB 账号'}。如需切换，请选择页签后点击下方按钮确认。`),
          ),
          h('div', { className: 'sv-media-drawer-foot' },
            provider === 'bailian' && h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(busy) || !credential?.configured || !credential?.writable, onClick: () => { void clear(); } }, busy === 'clear' ? '正在清除…' : '清除密钥'),
            h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(busy) || (provider === 'lwb' ? !credential?.configured : !apiKey.trim() && !credential?.configured), onClick: () => { void save(); } }, busy === 'save' ? '正在保存…' : provider === 'lwb' ? '使用 LWB 账号服务' : '保存并使用百炼')),
        ));
    }
    function AudioCaptionsPageV2({ packId, openConversation, lwbAccount }) {
      const account = lwbAccount.useAccount();
      const { projects, refresh, error, setError } = useProjects(packId);
      const [service, setService] = React.useState(null);
      const [provider, setProvider] = React.useState(null);
      const [text, setText] = React.useState('');
      const [source, setSource] = React.useState(null);
      const [voiceSource, setVoiceSource] = React.useState('system');
      const [voiceReference, setVoiceReference] = React.useState(null);
      const [voicePresetId, setVoicePresetId] = React.useState(BAILIAN_PRESET_VOICES[0].id);
      const [voiceUploading, setVoiceUploading] = React.useState(false);
      const [rate, setRate] = React.useState(1);
      const [volume, setVolume] = React.useState(1);
      const [subtitleEnabled, setSubtitleEnabled] = React.useState(true);
      const [submitting, setSubmitting] = React.useState(null);
      const [connectionOpen, setConnectionOpen] = React.useState(false);
      const [connectionProvider, setConnectionProvider] = React.useState('lwb');
      const [apiKey, setApiKey] = React.useState('');
      const [connectionBusy, setConnectionBusy] = React.useState(null);
      const [pickerOpen, setPickerOpen] = React.useState(false);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const [pickerQuery, setPickerQuery] = React.useState('');
      const [pickerPage, setPickerPage] = React.useState(0);
      const [picker, setPicker] = React.useState({ items: [], total: 0, loading: false });
      const [taskQuery, setTaskQuery] = React.useState('');
      const [taskFilter, setTaskFilter] = React.useState('all');
      const [taskPage, setTaskPage] = React.useState(0);
      const [sourceDrawer, setSourceDrawer] = React.useState(null);
      const [subtitleDrawer, setSubtitleDrawer] = React.useState(null);
      const [confirmNode, ask] = useSvConfirm();
      const textRef = React.useRef(null);
      const voiceFileInputRef = React.useRef(null);

      const refreshService = React.useCallback(async () => {
        try { const next = await remoteStatic('mediaStatus'); setService(next); setError(null); return next; }
        catch (cause) { setError(cause.message); return null; }
      }, [setError]);
      React.useEffect(() => { void refreshService(); }, [refreshService, account.user?.id, account.phase, account.catalog, account.serviceError, account.error]);
      React.useEffect(() => {
        if (!packId) return;
        void remote(packId, 'listAccounts').then((next) => {
          setAccountLibrary(next);
          setActiveTab((current) => current !== GENERAL_TAB && next.accounts.some((item) => item.id === current && item.status === 'active') ? current : next.defaultAccountId || GENERAL_TAB);
        }).catch((cause) => setError(cause.message));
      }, [packId, setError]);
      React.useEffect(() => { setTaskPage(0); }, [activeTab, taskQuery, taskFilter]);
      React.useEffect(() => { setPickerPage(0); }, [activeTab, pickerQuery]);
      React.useEffect(() => {
        const node = textRef.current;
        if (!node) return;
        node.style.height = 'auto'; node.style.height = `${Math.max(node.scrollHeight, 136)}px`;
      }, [text]);
      const providerEntries = ['lwb', 'bailian'].filter((id) => service?.providers?.[id]?.configured && service.providers[id].credential?.configured);
      React.useEffect(() => {
        setProvider((current) => availableMediaProvider(current, providerEntries, service?.connection?.provider));
      }, [providerEntries.join('|'), service?.connection?.provider]);
      React.useEffect(() => {
        if (!pickerOpen || !packId) return undefined;
        let cancelled = false;
        const load = async () => {
          setPicker((current) => ({ ...current, loading: true }));
          try {
            const next = await remote(packId, 'listScripts', { query: pickerQuery, offset: pickerPage * 8, limit: 8, ...(activeTab === GENERAL_TAB ? { general: true } : { accountId: activeTab }) });
            if (!cancelled) { setPicker({ ...next, loading: false }); setError(null); }
          } catch (cause) { if (!cancelled) { setPicker((current) => ({ ...current, loading: false })); setError(cause.message); } }
        };
        void load(); return () => { cancelled = true; };
      }, [pickerOpen, pickerQuery, pickerPage, packId, activeTab, setError]);
      React.useEffect(() => {
        const handoff = audioCaptionsHandoff;
        if (!handoff || !packId) return;
        audioCaptionsHandoff = null;
        void remote(packId, 'get', { projectId: handoff }).then((detail) => {
          const body = stageData(detail, 'script')?.body || '';
          if (!body.trim()) return;
          setSource({ projectId: detail.id, title: detail.title }); setText(body);
        }).catch((cause) => setError(cause.message));
      }, [packId, setError]);
      const taskFeed = useAudioTasks(packId, taskQuery, taskFilter, taskPage, activeTab === GENERAL_TAB ? { general: true } : { accountId: activeTab }, setError, refresh);
      const settlement = (taskFeed.items || []).map(task => `${task.id}:${task.status}:${task.subtitle?.status || ''}`).join('|');
      React.useEffect(() => { if (settlement) void lwbAccount.refresh(); }, [settlement, lwbAccount]);

      if (!packId) return h(NeedPack, { openConversation });

      const providerId = provider || null;
      const selectedProvider = providerId ? service?.providers?.[providerId] : null;
      const providerName = providerId === 'bailian' ? '百炼' : providerId === 'lwb' ? 'LWB 账号' : '尚未配置';
      const referenceVoiceReady = voiceSource === 'upload' ? Boolean(voiceReference) : selectedProvider?.referenceVoiceConfigured;
      const presetVoiceReady = voiceSource !== 'preset' || (providerId === 'bailian' && Boolean(voicePresetId));
      const canGenerate = Boolean(providerId && selectedProvider?.credential?.configured && selectedProvider?.configured && referenceVoiceReady && presetVoiceReady);
      const inActiveTab = (project) => activeTab === GENERAL_TAB ? !project.account : project.account?.id === activeTab;
      const tabProjects = projects.filter(inActiveTab);
      const visibleTasks = taskFeed.items;
      const confirmedCount = tabProjects.filter((project) => project.completedStages.includes('script')).length;
      const taskPages = Math.max(1, Math.ceil((taskFeed.total || 0) / 8));
      React.useEffect(() => { if (!taskFeed.loading) setTaskPage((current) => Math.min(current, taskPages - 1)); }, [taskFeed.loading, taskPages]);
      const selectScript = async (item) => {
        setSubmitting('script');
        try {
          const detail = await remote(packId, 'get', { projectId: item.id });
          const body = stageData(detail, 'script')?.body || '';
          if (!body.trim()) throw new Error('该稿件没有可用正文，请刷新后重新选择。');
          setSource({ projectId: detail.id, title: detail.title }); setText(body); setPickerOpen(false); setError(null);
        } catch (cause) { setError(cause.message); } finally { setSubmitting(null); }
      };
      const createAudioTask = async () => {
        if (!canGenerate || !text.trim()) return;
        setSubmitting('voiceover');
        try {
          await remote(packId, 'startAudioTask', { text, subtitleEnabled, ...(source?.projectId ? { sourceProjectId: source.projectId } : { title: source?.title || '手动输入文稿' }), provider: providerId, voiceSource, ...(voiceSource === 'upload' ? { referenceAudio: voiceReference, voiceName: voiceReference.name } : {}), ...(voiceSource === 'preset' ? { voiceId: voicePresetId, voiceName: BAILIAN_PRESET_VOICES.find((voice) => voice.id === voicePresetId)?.label || voicePresetId } : {}), rate: Number(rate), volume: Number(volume) });
          await taskFeed.refresh(); setError(null);
        } catch (cause) { setError(cause.message); } finally { setSubmitting(null); }
      };
      const uploadVoiceReference = async (event) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file || voiceUploading) return;
        const limit = service?.voiceReferenceMaxBytes || 20 * 1024 * 1024;
        if (file.size < 1 || file.size > limit) { setError(`参考音频必须小于 ${formatMediaBytes(limit)}。`); return; }
        setVoiceUploading(true);
        try {
          const data = await base64FromAudioFile(file);
          const uploaded = await remote(packId, 'uploadVoiceReference', { name: file.name, mediaType: file.type, data });
          setVoiceReference(uploaded); setVoiceSource('upload'); setError(null);
        } catch (cause) { setError(cause.message); } finally { setVoiceUploading(false); }
      };
      const startSubtitles = async (task) => {
        if (!canGenerate) return;
        setSubmitting(`subtitle:${task.id}`);
        try { await remote(packId, 'startAudioTaskSubtitles', { taskId: task.id, provider: providerId, language: 'zh', aiOptimize: true }); await taskFeed.refresh(); setError(null); }
        catch (cause) { setError(cause.message); } finally { setSubmitting(null); }
      };
      const openSubtitles = (task) => setSubtitleDrawer({ task, cues: subtitleCues(task.subtitle?.srt), saving: false });
      const syncAudioResult = async (task) => {
        setSubmitting(`sync:${task.id}`);
        try {
          const updated = await remote(packId, 'syncAudioTask', { taskId: task.id });
          await taskFeed.refresh();
          setError(updated.projectSyncError || updated.subtitleSyncError || null);
        } catch (cause) { setError(cause.message); } finally { setSubmitting(null); }
      };
      const saveSubtitles = async () => {
        if (!subtitleDrawer?.cues.length || subtitleDrawer.cues.some((cue) => !cue.text.trim())) return;
        const srt = srtFromSubtitleCues(subtitleDrawer.cues);
        setSubtitleDrawer((current) => ({ ...current, saving: true }));
        try {
          const updated = await remote(packId, 'saveAudioTaskSubtitles', { taskId: subtitleDrawer.task.id, srt });
          await taskFeed.refresh(); setSubtitleDrawer({ task: updated, cues: subtitleCues(updated.subtitle?.srt || srt), saving: false }); setError(null);
        } catch (cause) { setError(cause.message); setSubtitleDrawer((current) => ({ ...current, saving: false })); }
      };
      const saveConnection = async () => {
        setConnectionBusy('save');
        try { await remoteStatic('configureMediaConnection', { provider: connectionProvider, ...(connectionProvider === 'bailian' && apiKey.trim() ? { apiKey } : {}) }); setProvider(connectionProvider); setApiKey(''); await refreshService(); setError(null); }
        catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };
      const clearConnection = async () => {
        setConnectionBusy('clear');
        try { await remoteStatic('clearMediaConnectionCredential', { provider: connectionProvider }); await refreshService(); setError(null); }
        catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };
      const filterOptions = [{ id: 'all', label: '全部' }, { id: 'succeeded', label: '已完成' }, { id: 'failed', label: '失败' }];
      const hero = h(HeroMini, { cells: [
        { label: '可选稿件', value: String(confirmedCount), tone: 'brand' },
        { label: '音频任务', value: String(taskFeed.counts?.all || 0), tone: 'pink' },
        { label: '生成状态', value: taskFeed.anyRunning ? '进行中' : '空闲', tone: taskFeed.anyRunning ? 'orange' : 'green' },
      ] });
      const providerControl = !service
        ? h('p', { className: 'sv-note' }, '正在读取连接状态…')
        : providerEntries.length === 2
          ? h('div', { className: 'sv-media-provider-picker', role: 'group', 'aria-label': '配音服务' }, providerEntries.map((id) => h('button', { key: id, type: 'button', className: 'sv-media-provider-choice', 'data-active': providerId === id ? 'true' : 'false', onClick: () => setProvider(id) }, id === 'bailian' ? '百炼' : 'LWB 账号')))
          : providerEntries.length === 1
            ? h('p', { className: 'sv-note' }, providerId === 'lwb' ? '当前使用：LWB 账号服务，无需单独配置 API Key。' : '当前使用：百炼，API Key 已配置。')
            : h('p', { className: 'sv-error', role: 'status' }, lwbServiceUnavailableText(account, service?.providers?.lwb?.credential, 'tts'));
      const scriptPickerDrawer = pickerOpen && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭稿件选择', onClick: () => setPickerOpen(false) }),
        h('aside', { className: 'sv-drawer sv-audio-picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择稿件' },
          h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, '选择稿件'), h('p', { className: 'sv-meta' }, '选择后载入当前稿件正文；随后可继续修改，不会改写原稿。')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setPickerOpen(false) }, '关闭')),
          h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号筛选稿件' }),
          h('div', { className: 'sv-drawer-scroll sv-audio-picker-body' },
            h('input', { className: 'sv-input', value: pickerQuery, maxLength: 160, placeholder: '搜索标题或正文', onChange: (event) => { setPickerQuery(event.target.value); setPickerPage(0); } }),
            picker.loading ? h('p', { className: 'sv-note' }, '正在加载稿件…') : picker.items.length ? h('div', { className: 'sv-list' }, picker.items.map((item) => h('article', { key: item.id, className: 'sv-audio-picker-item' }, h('div', null, h('strong', null, item.title), h('p', null, `${item.scriptChars} 字 · ${item.account?.name || '通用'} · 更新于 ${relativeTime(item.updatedAt)}`)), h('button', { type: 'button', className: 'lwb-primary-button', disabled: submitting === 'script', onClick: () => { void selectScript(item); } }, submitting === 'script' ? '载入中…' : '选择')))) : h('div', { className: 'sv-empty' }, '没有匹配的稿件。'),
          ),
          h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta' }, `共 ${picker.total || 0} 篇 · 第 ${pickerPage + 1}/${Math.max(1, Math.ceil((picker.total || 0) / 8))} 页`), h('span', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: pickerPage === 0, onClick: () => setPickerPage((current) => Math.max(0, current - 1)) }, '上一页'), h('button', { type: 'button', className: 'lwb-plain-button', disabled: pickerPage + 1 >= Math.max(1, Math.ceil((picker.total || 0) / 8)), onClick: () => setPickerPage((current) => current + 1) }, '下一页'))),
        ),
      );
      const connectionCredential = service?.providers?.[connectionProvider]?.credential;
      const connectionDrawer = h(ServiceConnectionDrawer, { open: connectionOpen, onClose: () => setConnectionOpen(false), image: false, lwbAccount, provider: connectionProvider, setProvider: setConnectionProvider, credential: connectionCredential, apiKey, setApiKey, busy: connectionBusy, save: saveConnection, clear: clearConnection, selected: service?.connection?.provider });
      const newTaskPanel = h('section', { className: 'sv-form sv-audio-config' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '新建配音任务'), h('span', null, source ? '已载入稿件' : '可直接输入文稿')),
        h('div', { className: 'sv-audio-source-row' }, source ? h('div', { className: 'sv-audio-project' }, h('strong', null, source.title), h('span', null, `当前稿件 · ${charCount(text)} 字 · 可继续修改`)) : h('p', { className: 'sv-note' }, '稿件为可选项。也可以直接输入自己的口播内容。'), h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => { setPickerPage(0); setPickerOpen(true); } }, source ? '更换稿件' : '选择稿件'), source ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSource(null) }, '改为手动输入') : null)),
        h('label', { className: 'sv-media-field' }, h('span', null, '文本内容'), h('textarea', { ref: textRef, className: 'sv-textarea sv-audio-script', value: text, maxLength: 60000, placeholder: '输入或粘贴需要配音的口播文稿', onChange: (event) => setText(event.target.value), onInput: (event) => { event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.max(event.currentTarget.scrollHeight, 136)}px`; } })),
        h('p', { className: 'sv-meta' }, `${charCount(text)} 字 · 预计口播 ${scriptDurationLabel(text)}`),
        h('label', { className: 'sv-media-field' }, h('span', null, '配音服务'), providerControl),
        h('label', { className: 'sv-media-field' }, h('span', null, '音色'), h('select', { className: 'sv-select', value: voiceSource, onChange: (event) => setVoiceSource(event.target.value) }, h('option', { value: 'system' }, 'Tiffy - 自信（系统默认）'), h('option', { value: 'preset' }, '百炼预置音色'), h('option', { value: 'upload' }, '上传自己的参考音频'))),
        voiceSource === 'preset' ? h('div', { className: 'sv-voice-upload' },
          h('label', { className: 'sv-media-field' }, h('span', null, '预置音色'), h('select', { className: 'sv-select', value: voicePresetId, onChange: (event) => setVoicePresetId(event.target.value) }, BAILIAN_PRESET_VOICES.map((voice) => h('option', { key: voice.id, value: voice.id }, voice.label)))),
          h('p', { className: providerId === 'bailian' ? 'sv-note' : 'sv-error' }, providerId === 'bailian'
            ? '预置音色由百炼提供，将按所选渠道的账户计费。'
            : '预置音色仅适用于百炼渠道，请在上方「配音服务」中切换到百炼。'),
        ) : null,
        voiceSource === 'upload' ? h('div', { className: 'sv-voice-upload' },
          h('input', { ref: voiceFileInputRef, type: 'file', accept: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg', tabIndex: -1, style: { display: 'none' }, onChange: (event) => { void uploadVoiceReference(event); } }),
          h('div', { className: 'sv-voice-upload-row' },
            h('p', { className: 'sv-voice-upload-file' }, voiceReference ? h(React.Fragment, null, voiceReference.name, h('span', null, ` · ${formatMediaBytes(voiceReference.bytes)} · ${formatMediaDuration(voiceReference.durationSeconds)}`)) : '尚未选择参考音频'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: voiceUploading || Boolean(submitting), onClick: () => voiceFileInputRef.current?.click?.() }, voiceUploading ? '正在上传…' : voiceReference ? '更换音频' : '选择音频'),
            voiceReference ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: voiceUploading || Boolean(submitting), onClick: () => setVoiceReference(null) }, '移除') : null,
          ),
          h('p', { className: 'sv-note' }, '支持 MP3、WAV、M4A 和 OGG，最大 20 MiB。请上传只包含目标人声的清晰音频。'),
        ) : null,
        h('div', { className: 'sv-audio-parameters' }, h('label', { className: 'sv-media-field' }, h('span', null, '语速'), h('input', { className: 'sv-input', type: 'number', min: '0.5', max: '2', step: '0.05', value: rate, onChange: (event) => setRate(event.target.value) })), h('label', { className: 'sv-media-field' }, h('span', null, '音量'), h('input', { className: 'sv-input', type: 'number', min: '0', max: '2', step: '0.05', value: volume, onChange: (event) => setVolume(event.target.value) }))),
        h('label', { className: 'sv-audio-subtitle-option' }, h('input', { type: 'checkbox', checked: subtitleEnabled, onChange: (event) => setSubtitleEnabled(event.target.checked) }), h('span', null, h('strong', null, '同时生成字幕'), h('small', null, '配音完成后自动对齐字幕；字幕失败不影响音频，可单独重试。'))),
        h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(submitting) || voiceUploading || !canGenerate || !text.trim(), onClick: () => ask({ title: '生成配音', copy: `将使用${providerName}和${voiceSource === 'upload' ? `参考音频「${voiceReference?.name || ''}」` : voiceSource === 'preset' ? `预置音色「${BAILIAN_PRESET_VOICES.find((voice) => voice.id === voicePresetId)?.label || voicePresetId}」` : '系统默认音色'}为「${source?.title || '手动输入文稿'}」创建新的配音任务${subtitleEnabled ? '，并在配音完成后自动生成字幕' : ''}，提交后会调用远端服务。`, confirm: '确认生成', onConfirm: () => { void createAudioTask(); } }) }, submitting === 'voiceover' ? '正在提交…' : subtitleEnabled ? '生成配音和字幕' : '生成配音')),
      );
      const taskCard = (task) => {
        const subtitle = task.subtitle || { status: 'idle' };
        const audio = task.result?.audio;
        const activeSubtitle = ['queued', 'running'].includes(subtitle.status);
        const subtitleProgress = subtitleTaskProgress(task);
        const subtitleButton = task.status !== 'succeeded' || task.current === false ? null : activeSubtitle
          ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: true }, subtitleProgress?.button || '字幕生成中…')
          : h('button', { type: 'button', className: subtitle.status === 'succeeded' ? 'lwb-plain-button' : 'lwb-primary-button', disabled: !canGenerate || Boolean(submitting), onClick: () => ask({ title: subtitle.status === 'succeeded' ? '重新生成字幕' : '生成字幕', copy: subtitle.status === 'succeeded' ? '将基于这条音频重新生成字幕，现有字幕版本会保留为历史结果。' : '将基于这条音频的真实时间轴生成字幕。', confirm: subtitle.status === 'succeeded' ? '重新生成' : '生成字幕', onConfirm: () => { void startSubtitles(task); } }) }, submitting === `subtitle:${task.id}` ? '正在提交…' : subtitle.status === 'succeeded' ? '重新生成字幕' : '生成字幕');
        return h('article', { key: task.id, className: 'sv-audio-task', 'data-status': task.status },
          h('div', { className: 'sv-audio-task-head' }, h('div', null, h('p', { className: 'sv-audio-task-title' }, task.source?.title || '手动输入文稿'), h('p', { className: 'sv-audio-task-meta' }, [formatTime(task.createdAt), task.input?.provider === 'bailian' ? '百炼' : task.input?.provider === 'lwb' ? 'LWB 账号' : task.input?.provider, task.source?.kind === 'manual-text' ? '手动文稿' : task.source?.kind === 'edited-script-copy' ? '已保存稿件副本' : '已保存稿件'].filter(Boolean).join(' · '))), h('span', { className: `sv-tag ${task.status === 'failed' ? 'sv-status-error' : task.status === 'succeeded' ? 'sv-stage' : 'sv-status-manual'}` }, mediaStatusLabel(task.status))),
          audio ? h('div', { className: 'sv-audio-task-detail' }, h('span', null, `时长 ${formatMediaDuration(audio.durationSeconds)}`), h('span', null, formatMediaBytes(audio.bytes)), h('span', null, subtitle.status === 'succeeded' ? `字幕 ${subtitle.cueCount || 0} 条` : subtitle.status === 'failed' ? '字幕失败 · 配音可用' : activeSubtitle ? '字幕实时处理中' : '未生成字幕')) : null,
          subtitleProgress ? h('div', { className: 'sv-audio-subtitle-progress', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'sv-audio-subtitle-progress-head' }, h('strong', null, subtitleProgress.label), subtitleProgress.percent == null ? null : h('span', null, `${subtitleProgress.percent}%`)),
            subtitleProgress.percent == null ? null : h('progress', { max: 100, value: subtitleProgress.percent, 'aria-label': '字幕识别进度' }),
          ) : null,
          task.status === 'succeeded' ? h(AudioTaskPreview, { packId, taskId: task.id, setError }) : null,
          task.error ? h('p', { className: 'sv-error' }, mediaErrorText(task.error)) : null,
          subtitle.error ? h('p', { className: 'sv-error' }, `字幕生成失败，配音已保留：${mediaErrorText(subtitle.error)}`) : null,
          task.status === 'succeeded' && task.source?.projectId ? h('div', { className: 'sv-list' },
            h('p', { className: task.projectSyncError || task.subtitleSyncError ? 'sv-error' : 'sv-note', role: 'status' }, task.current === false ? '历史配音版本，可试听和查看字幕。当前项目已使用其他稿件或配音。' : task.projectSyncError || task.subtitleSyncError || (task.projectSync ? '配音已同步到项目，可在「视频 / 预览」中使用。' : '配音已生成，尚未同步到项目。同步后可在「视频 / 预览」中使用。')),
            task.current !== false && (!task.projectSync || task.projectSyncError || task.subtitleSyncError) ? h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: Boolean(submitting) || activeSubtitle, onClick: () => { void syncAudioResult(task); } }, submitting === `sync:${task.id}` ? '正在同步…' : '同步到视频'), h('span', { className: 'sv-meta' }, '复用已有音频和字幕，不会重新生成。')) : null,
          ) : null,
          h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSourceDrawer(task) }, '查看稿件'), h(ExecutionButton, { ...(task.execution || { kind: 'audio', id: task.id }), label: task.subtitleExecution ? '配音执行详情' : '执行详情' }), task.subtitleExecution ? h(ExecutionButton, { ...task.subtitleExecution, label: '字幕执行详情' }) : null, subtitleButton, subtitle.status === 'succeeded' ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => openSubtitles(task) }, '查看字幕') : null),
        );
      };
      const taskPanel = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '配音任务'), h('span', null, taskFeed.anyRunning ? '生成进行中' : `共 ${taskFeed.total || 0} 条记录`)),
        h('div', { className: 'sv-audio-task-tools' }, h('input', { className: 'sv-input', value: taskQuery, maxLength: 160, placeholder: '搜索稿件标题或内容', onChange: (event) => setTaskQuery(event.target.value) }), h('div', { className: 'sv-filter-chips' }, filterOptions.map((item) => h('button', { key: item.id, type: 'button', className: 'sv-filter-chip', 'data-on': taskFilter === item.id ? 'true' : 'false', onClick: () => setTaskFilter(item.id) }, `${item.label} ${item.id === 'all' ? taskFeed.counts?.all || 0 : item.id === 'succeeded' ? taskFeed.counts?.succeeded || 0 : taskFeed.counts?.failed || 0}`)))),
        visibleTasks.length ? h('div', { className: 'sv-list' }, visibleTasks.map(taskCard)) : h('div', { className: 'sv-empty' }, taskFeed.loading ? '正在读取任务…' : '当前账号暂无配音任务。可选择稿件，也可直接输入文稿。'),
        h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta' }, `第 ${taskPage + 1}/${taskPages} 页 · 共 ${taskFeed.total || 0} 条`), h('span', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '上一页', disabled: taskPage === 0, onClick: () => setTaskPage((current) => Math.max(0, current - 1)) }, '上一页'), h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '下一页', disabled: taskPage + 1 >= taskPages, onClick: () => setTaskPage((current) => current + 1) }, '下一页'))),
      );
      const sourceDrawerNode = sourceDrawer && h(React.Fragment, null, h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭稿件内容', onClick: () => setSourceDrawer(null) }), h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '稿件内容' }, h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, sourceDrawer.source?.title || '稿件内容'), h('p', { className: 'sv-meta' }, sourceDrawer.source?.kind === 'manual-text' ? '手动输入文稿快照' : '任务创建时冻结的稿件快照')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSourceDrawer(null) }, '关闭')), h('div', { className: 'sv-drawer-scroll' }, h('article', { className: 'sv-sc-manuscript' }, sourceDrawer.source?.text || ''))));
      const subtitleDrawerNode = subtitleDrawer && h(React.Fragment, null, h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭字幕内容', onClick: () => setSubtitleDrawer(null) }), h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '编辑字幕' }, h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, `字幕 · ${subtitleDrawer.task.source?.title || '手动文稿'}`), h('p', { className: 'sv-meta' }, `${subtitleDrawer.cues.length} 条字幕，可直接校对错别字并保存。`)), h('button', { type: 'button', className: 'lwb-plain-button', disabled: subtitleDrawer.saving, onClick: () => setSubtitleDrawer(null) }, '关闭')), h('div', { className: 'sv-drawer-scroll sv-audio-subtitle-editor' }, h('div', { className: 'sv-subtitle-cues' }, subtitleDrawer.cues.map((cue, index) => h('article', { key: cue.id, className: 'sv-subtitle-cue' }, h('time', null, cue.time), h('textarea', { className: 'sv-textarea sv-subtitle-text', value: cue.text, readOnly: subtitleDrawer.task.current === false, maxLength: 30000, 'aria-label': `第 ${index + 1} 条字幕文本`, onChange: (event) => setSubtitleDrawer((current) => ({ ...current, cues: current.cues.map((currentCue, currentIndex) => currentIndex === index ? { ...currentCue, text: event.target.value } : currentCue) })) }))))), h('div', { className: 'sv-media-drawer-foot' }, h('span', { className: 'sv-meta' }, subtitleDrawer.task.current === false ? '历史版本字幕，仅供查看。' : '保存校对会更新项目字幕，已有视频和发布资料需重新制作。'), h('button', { type: 'button', className: 'lwb-primary-button', disabled: subtitleDrawer.task.current === false || subtitleDrawer.saving || !subtitleDrawer.cues.length || subtitleDrawer.cues.some((cue) => !cue.text.trim()), onClick: () => ask({ title: '保存字幕', copy: `将保存这 ${subtitleDrawer.cues.length} 条字幕的文本修改，时间码保持不变。`, confirm: '确认保存', onConfirm: () => { void saveSubtitles(); } }) }, subtitleDrawer.saving ? '正在保存…' : '保存字幕'))));
      const accountTabs = h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号查看配音任务' });
      return h(PackFrame, { packId, openConversation, title: '配音 / 字幕', accent: 'pink', copy: '按账号选择稿件并生成配音；默认同时生成字幕，也可取消；字幕失败不影响已完成的配音。每条任务保留执行记录并同步项目产物。', hero, introActions: h('button', { type: 'button', className: 'sv-media-config-trigger', 'data-attention': service && !providerEntries.length ? 'true' : 'false', onClick: () => { setConnectionProvider('lwb'); setConnectionOpen(true); } }, h(React.Fragment, null, h(IconSettingsOutlineRegular, { size: 16, 'aria-hidden': true }), '连接配置', h('span', { className: 'sv-config-state' }, !service ? '读取中' : providerEntries.length ? '已就绪' : '待配置'))) }, h(Notice, { error }), accountTabs, h('section', { className: 'sv-split sv-audio-workbench' }, newTaskPanel, taskPanel), scriptPickerDrawer, connectionDrawer, sourceDrawerNode, subtitleDrawerNode, confirmNode);
    }
    function VideoPreviewPageV2({ packId, openConversation }) {
      const { projects, refresh, error, setError } = useProjects(packId);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const inActiveTab = (project) => activeTab === GENERAL_TAB ? !project.account : project.account?.id === activeTab;
      const candidates = projects.filter((project) => inActiveTab(project) && project.completedStages.includes('script') && project.completedStages.includes('voiceover'));
      const [selectedId, setSelectedId] = useSelectedProject(candidates);
      const { detail, error: detailError, reload } = useDetail(packId, selectedId);
      const [visualBrief, setVisualBrief] = React.useState('');
      const [subtitleEnabled, setSubtitleEnabled] = React.useState(true);
      const [orientation, setOrientation] = React.useState('landscape');
      const [backgroundMusic, setBackgroundMusic] = React.useState(null);
      const [bgmVolume, setBgmVolume] = React.useState('0.12');
      const [bgmUploading, setBgmUploading] = React.useState(false);
      const bgmFileInputRef = React.useRef(null);
      const renderer = 'remotion';
      const [sourcePickerOpen, setSourcePickerOpen] = React.useState(false);
      const [sourceQuery, setSourceQuery] = React.useState('');
      const [sourcePage, setSourcePage] = React.useState(0);
      const [taskQuery, setTaskQuery] = React.useState('');
      const [taskFilter, setTaskFilter] = React.useState('all');
      const [taskPage, setTaskPage] = React.useState(0);
      const [submitting, setSubmitting] = React.useState(null);
      const [scriptDrawer, setScriptDrawer] = React.useState(null);
      const [mediaDrawer, setMediaDrawer] = React.useState(null);
      const [summaryDrawer, setSummaryDrawer] = React.useState(null);
      const [confirmNode, ask] = useSvConfirm();
      const taskFeed = useVideoTasks(packId, taskQuery, taskFilter, taskPage, activeTab === GENERAL_TAB ? { general: true } : { accountId: activeTab }, setError, refresh);
      React.useEffect(() => {
        if (!packId) return;
        void remote(packId, 'listAccounts').then((next) => {
          setAccountLibrary(next);
          setActiveTab((current) => current !== GENERAL_TAB && next.accounts.some((item) => item.id === current && item.status === 'active') ? current : next.defaultAccountId || GENERAL_TAB);
        }).catch((cause) => setError(cause.message));
      }, [packId, setError]);
      React.useEffect(() => {
        const savedVideo = stageData(detail, 'video');
        const savedBrief = savedVideo?.visualBrief || '';
        setVisualBrief(['默认信息型竖屏口播版式。', '默认信息型口播版式。', DEFAULT_VIDEO_VISUAL_BRIEF].includes(savedBrief) ? '' : savedBrief);
        setSubtitleEnabled(savedVideo ? savedVideo.subtitleEnabled !== false : done(detail, 'subtitles'));
        setOrientation(savedVideo?.orientation === 'portrait' ? 'portrait' : 'landscape');
        setBackgroundMusic(savedVideo?.backgroundMusic || null);
        setBgmVolume(String(savedVideo?.bgmVolume ?? 0.12));
      }, [detail?.id, detail?.revision]);
      React.useEffect(() => { setTaskPage(0); }, [activeTab, taskFilter, taskQuery]);
      React.useEffect(() => { setSourcePage(0); }, [activeTab, sourceQuery]);
      React.useEffect(() => {
        if (taskPage > 0 && taskPage >= Math.max(1, Math.ceil(taskFeed.total / 6))) setTaskPage(Math.max(0, Math.ceil(taskFeed.total / 6) - 1));
      }, [taskPage, taskFeed.total]);
      React.useEffect(() => {
        if (selectedId && taskFeed.items.some((task) => task.projectId === selectedId && (task.status === 'succeeded' || task.status === 'failed'))) void reload();
      }, [selectedId, taskFeed.items, reload]);
      if (!packId) return h(NeedPack, { openConversation });
      const hasRequiredSource = detail && done(detail, 'script') && done(detail, 'voiceover') && (!subtitleEnabled || done(detail, 'subtitles'));
      const selectedSource = candidates.find((project) => project.id === selectedId) || null;
      const projectForTask = (task) => projects.find((project) => project.id === task.projectId) || null;
      const createVideoTask = async (source = detail, settings = { visualBrief, subtitleEnabled, orientation, backgroundMusic, bgmVolume: Number(bgmVolume) }) => {
        if (!source) return;
        setSubmitting(source.id);
        try {
          await remote(packId, 'startVideoRender', { projectId: source.id, expectedRevision: source.revision, visualBrief: settings.visualBrief.trim() || DEFAULT_VIDEO_VISUAL_BRIEF, subtitleEnabled: settings.subtitleEnabled, orientation: settings.orientation === 'portrait' ? 'portrait' : 'landscape', renderer, backgroundMusic: settings.backgroundMusic || null, bgmVolume: settings.backgroundMusic ? Number(settings.bgmVolume ?? 0.12) : null });
          await taskFeed.refresh(); setError(null);
        } catch (cause) { setError(cause.message); } finally { setSubmitting(null); }
      };
      const uploadVideoBgm = async (event) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file || !detail || bgmUploading) return;
        const limit = 20 * 1024 * 1024;
        if (file.size < 1 || file.size > limit) { setError(`BGM 必须小于 ${formatMediaBytes(limit)}。`); return; }
        setBgmUploading(true);
        try {
          const data = await base64FromAudioFile(file);
          const uploaded = await remote(packId, 'uploadVideoBgm', { projectId: detail.id, name: file.name, mediaType: file.type, data });
          setBackgroundMusic(uploaded); setError(null);
        } catch (cause) { setError(cause.message); } finally { setBgmUploading(false); }
      };
      const retryTask = (task) => {
        const project = projectForTask(task);
        if (!project || project.revision !== task.expectedRevision) { setError('稿件、配音或字幕已更新。请在左侧重新选择当前稿件后创建新的视频任务。'); return; }
        ask({ title: '重试视频任务', copy: `将按该任务冻结的配置，重新提交「${task.projectTitle}」当前版本的视频渲染。`, confirm: '确认重试', onConfirm: () => { void createVideoTask(project, task.input); } });
      };
      const taskPages = Math.max(1, Math.ceil(taskFeed.total / 6));
      const sourceMatches = candidates.filter((project) => !sourceQuery.trim() || project.title.toLowerCase().includes(sourceQuery.trim().toLowerCase()));
      const sourcePages = Math.max(1, Math.ceil(sourceMatches.length / 8));
      const visibleSources = sourceMatches.slice(sourcePage * 8, sourcePage * 8 + 8);
      const taskFilters = [{ id: 'all', label: '全部', count: taskFeed.counts.all }, { id: 'active', label: '进行中', count: taskFeed.counts.queued + taskFeed.counts.running }, { id: 'succeeded', label: '已完成', count: taskFeed.counts.succeeded }, { id: 'failed', label: '失败', count: taskFeed.counts.failed }];
      const videoHero = h(HeroMini, { cells: [{ label: '可制作稿件', value: String(candidates.length), tone: 'brand' }, { label: '视频任务', value: String(taskFeed.counts.all), tone: taskFeed.anyRunning ? 'orange' : undefined }, { label: '制作链路', value: 'DSH + Remotion', tone: 'green' }] });
      const accountTabs = h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号筛选视频稿件与任务' });
      const sourceCard = (project) => h('button', { key: project.id, type: 'button', className: 'sv-video-source-item', 'data-active': selectedId === project.id ? 'true' : 'false', onClick: () => setSelectedId(project.id) }, h('span', { className: 'sv-item-head' }, h('strong', { className: 'sv-item-title' }, project.title), h('span', { className: 'sv-stage' }, project.completedStages.includes('subtitles') ? '配音、字幕已完成' : '配音已完成')), h('span', { className: 'sv-meta' }, `${relativeTime(project.updatedAt)} · ${project.account?.name || '通用'}`));
      const taskCard = (task) => {
        const taskQc = task.qc || null;
        const qcPassed = taskQc?.status === 'succeeded' && taskQc.result?.technical?.passed === true && (task.result?.qc ? taskQc.result?.review?.passed === true : true);
        const liveStatus = task.status === 'running' ? videoPhaseLabel(task.phase) || mediaStatusLabel(task.status) : mediaStatusLabel(task.status);
        const statusClass = task.status === 'failed' ? 'sv-status-error' : task.status === 'succeeded' ? 'sv-stage' : 'sv-status-manual';
        return h('article', { key: task.id, className: 'sv-video-task', 'data-status': task.status },
          h('div', { className: 'sv-video-task-head' }, h('div', null, h('p', { className: 'sv-video-task-title' }, task.projectTitle), h('p', { className: 'sv-video-task-meta' }, `${formatTime(task.createdAt)} · 稿件版本 ${task.expectedRevision} · ${task.input?.orientation === 'portrait' ? '竖屏' : '横屏'} · ${task.input?.subtitleEnabled === false ? '不含字幕' : '含字幕'} · ${task.input?.backgroundMusic ? `BGM：${task.input.backgroundMusic.name}` : '无 BGM'}`)), h('span', { className: `sv-tag ${statusClass}` }, liveStatus)),
          task.status === 'succeeded' && task.result?.video ? h(React.Fragment, null, h(VideoTaskMediaPreview, { packId, task, stage: 'video', setError }), h('div', { className: 'sv-video-task-detail' }, h('span', null, `${task.result.video.width || '?'}x${task.result.video.height || '?'} · ${task.result.video.fps || '?'}fps`), h('span', null, `时长 ${formatMediaDuration(task.result.video.durationSeconds)}`), h('span', null, formatMediaBytes(task.result.video.bytes)))) : null,
          task.error ? h('p', { className: 'sv-error' }, mediaErrorText(task.error)) : null,
          h('div', { className: 'sv-actions' }, task.source?.script?.body ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setScriptDrawer(task) }, '查看稿件') : null, task.source?.voiceover?.audio || task.source?.subtitles || task.input?.backgroundMusic ? h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setMediaDrawer(task) }, '查看配音/字幕/BGM') : null, h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSummaryDrawer(task) }, '执行详情'), task.status === 'failed' ? h('button', { type: 'button', className: 'lwb-primary-button', disabled: submitting === task.projectId, onClick: () => retryTask(task) }, submitting === task.projectId ? '正在提交…' : '重试') : null, qcPassed ? h('span', { className: 'sv-meta' }, task.result?.qc ? '技术质检与独立审片通过' : '技术质检通过') : null),
        );
      };
      const sourcePanel = h('section', { className: 'sv-section sv-video-source' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '选择已完成配音的稿件'), h('span', null, `${candidates.length} 篇`)),
        candidates.length ? h(React.Fragment, null, h('div', { className: 'sv-list' }, candidates.slice(0, 6).map(sourceCard)), candidates.length > 6 ? h('button', { type: 'button', className: 'sv-sc-more', onClick: () => { setSourceQuery(''); setSourcePage(0); setSourcePickerOpen(true); } }, `还有 ${candidates.length - 6} 篇 · 查看更多`) : null) : h('div', { className: 'sv-empty' }, '当前账号暂无可制作视频的稿件。若配音已完成，请到「配音 / 字幕」检查项目同步状态。'),
        detail ? h('section', { className: 'sv-form sv-video-create' },
          h('div', { className: 'sv-section-head' }, h('h3', null, '创建视频任务'), h('span', null, selectedSource?.title || '')),
          h('p', { className: 'sv-note' }, subtitleEnabled ? 'DSH 视觉导演将读取当前稿件、配音和字幕，直接制作 Remotion 成片，再由独立会话审片。' : done(detail, 'subtitles') ? '当前任务将跳过已有字幕，仅使用稿件和配音制作成片。' : '当前稿件没有字幕，将直接制作无字幕成片。'),
          h('div', { className: 'sv-video-option' }, h('span', null, '视频方向'), h('div', { className: 'sv-video-orientation', role: 'radiogroup', 'aria-label': '视频方向' }, [{ id: 'landscape', label: '横屏 16:9' }, { id: 'portrait', label: '竖屏 9:16' }].map((item) => h('button', { key: item.id, type: 'button', role: 'radio', 'aria-checked': orientation === item.id, 'data-active': orientation === item.id ? 'true' : 'false', onClick: () => setOrientation(item.id) }, item.label)))),
          h('label', { className: 'sv-checks' }, h('span', null, h('input', { type: 'checkbox', checked: subtitleEnabled, disabled: !done(detail, 'subtitles'), onChange: (event) => setSubtitleEnabled(event.target.checked) }), '启用字幕')),
          h('div', { className: 'sv-video-option' },
            h('span', null, '背景音乐（可选）'),
            h('input', { ref: bgmFileInputRef, type: 'file', accept: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg', tabIndex: -1, style: { display: 'none' }, onChange: (event) => { void uploadVideoBgm(event); } }),
            h('div', { className: 'sv-video-bgm-upload' },
              h('div', { className: 'sv-video-bgm-row' },
                h('p', { className: 'sv-video-bgm-file' }, backgroundMusic ? h(React.Fragment, null, backgroundMusic.name, h('span', null, ` · ${formatMediaBytes(backgroundMusic.bytes)} · ${formatMediaDuration(backgroundMusic.durationSeconds)}`)) : '未添加 BGM'),
                h('button', { type: 'button', className: 'lwb-plain-button', disabled: bgmUploading || Boolean(submitting), onClick: () => bgmFileInputRef.current?.click?.() }, bgmUploading ? '正在上传…' : backgroundMusic ? '更换 BGM' : '上传 BGM'),
                backgroundMusic ? h('button', { type: 'button', className: 'lwb-plain-button', disabled: bgmUploading || Boolean(submitting), onClick: () => setBackgroundMusic(null) }, '移除') : null,
              ),
              backgroundMusic ? h('label', { className: 'sv-video-bgm-volume' }, h('span', null, 'BGM 音量'), h('input', { type: 'range', min: '0', max: '0.5', step: '0.01', value: bgmVolume, onChange: (event) => setBgmVolume(event.target.value) }), h('output', null, `${Math.round(Number(bgmVolume) * 100)}%`)) : null,
            ),
          ),
          h('textarea', { className: 'sv-textarea', value: visualBrief, maxLength: 6000, placeholder: '可选：补充视觉风格、表现重点或必须避开的表达；留空由 AI 视觉导演自主决定', onChange: (event) => setVisualBrief(event.target.value) }),
          h('div', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-primary-button', disabled: submitting === detail.id || bgmUploading || !hasRequiredSource, onClick: () => ask({ title: '创建视频任务', copy: `将为「${detail.title}」启动 DSH 视觉导演，制作${orientation === 'landscape' ? '横屏 16:9' : '竖屏 9:16'} Remotion 成片。任务会冻结当前稿件、配音${subtitleEnabled ? '、字幕' : ''}${backgroundMusic ? `和 BGM「${backgroundMusic.name}」` : ''}，并在技术质检后交给独立 DSH 会话审片；任一环节不通过都会直接失败。`, confirm: '确认创建', onConfirm: () => { void createVideoTask(); } }) }, submitting === detail.id ? '正在提交…' : '生成视频')),
        ) : null,
      );
      const taskPanel = h('section', { className: 'sv-section sv-video-task-list' }, h('div', { className: 'sv-section-head' }, h('h3', null, '视频制作任务'), h('span', { role: 'status', 'aria-live': 'polite' }, taskFeed.anyRunning ? '任务执行中' : `共 ${taskFeed.total} 条`)), h('div', { className: 'sv-video-task-tools' }, h('input', { className: 'sv-input', value: taskQuery, maxLength: 160, placeholder: '搜索稿件标题、稿件内容或制作说明', onChange: (event) => setTaskQuery(event.target.value) }), h('div', { className: 'sv-filter-chips' }, taskFilters.map((filter) => h('button', { key: filter.id, type: 'button', className: 'sv-filter-chip', 'data-on': taskFilter === filter.id ? 'true' : 'false', onClick: () => setTaskFilter(filter.id) }, `${filter.label} ${filter.count}`)))), taskFeed.items.length ? h('div', { className: 'sv-list' }, taskFeed.items.map(taskCard)) : h('div', { className: 'sv-empty' }, taskFeed.loading ? '正在读取视频任务…' : '尚无视频制作任务。请在左侧选择完成配音的稿件后创建。'), h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta' }, `第 ${taskPage + 1}/${taskPages} 页 · 共 ${taskFeed.total} 条`), h('span', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '上一页', disabled: taskPage === 0, onClick: () => setTaskPage((current) => Math.max(0, current - 1)) }, '上一页'), h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '下一页', disabled: taskPage + 1 >= taskPages, onClick: () => setTaskPage((current) => current + 1) }, '下一页'))));
      const sourcePicker = sourcePickerOpen && h(React.Fragment, null, h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭稿件选择', onClick: () => setSourcePickerOpen(false) }), h('aside', { className: 'sv-drawer sv-audio-picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择已完成配音的稿件' }, h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, '选择已完成配音的稿件'), h('p', { className: 'sv-meta' }, '选择后在左侧创建独立的视频制作任务。')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setSourcePickerOpen(false) }, '关闭')), h('div', { className: 'sv-drawer-scroll sv-audio-picker-body' }, h('input', { className: 'sv-input', value: sourceQuery, maxLength: 160, placeholder: '搜索稿件标题', onChange: (event) => { setSourceQuery(event.target.value); setSourcePage(0); } }), visibleSources.length ? h('div', { className: 'sv-list' }, visibleSources.map((project) => h('article', { key: project.id, className: 'sv-audio-picker-item' }, h('div', null, h('strong', null, project.title), h('p', null, `${project.completedStages.includes('subtitles') ? '配音、字幕已完成' : '配音已完成'} · ${project.account?.name || '通用'} · ${relativeTime(project.updatedAt)}`)), h('button', { type: 'button', className: 'lwb-primary-button', onClick: () => { setSelectedId(project.id); setSourcePickerOpen(false); } }, '选择')))) : h('div', { className: 'sv-empty' }, '没有匹配的稿件。')), h('div', { className: 'sv-audio-pagebar' }, h('span', { className: 'sv-meta' }, `共 ${sourceMatches.length} 篇 · 第 ${sourcePage + 1}/${sourcePages} 页`), h('span', { className: 'sv-actions' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: sourcePage === 0, onClick: () => setSourcePage((page) => Math.max(0, page - 1)) }, '上一页'), h('button', { type: 'button', className: 'lwb-plain-button', disabled: sourcePage + 1 >= sourcePages, onClick: () => setSourcePage((page) => Math.min(sourcePages - 1, page + 1)) }, '下一页')))));
      const scriptDrawerNode = scriptDrawer && h(React.Fragment, null, h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭稿件内容', onClick: () => setScriptDrawer(null) }), h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '任务稿件' }, h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, scriptDrawer.projectTitle), h('p', { className: 'sv-meta' }, `任务创建时冻结的稿件快照 · 稿件版本 ${scriptDrawer.source?.script?.revision || '—'}`)), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setScriptDrawer(null) }, '关闭')), h('div', { className: 'sv-drawer-scroll' }, h('article', { className: 'sv-sc-manuscript' }, scriptDrawer.source?.script?.body || '该历史任务未保存稿件快照。'))));
      const mediaDrawerNode = mediaDrawer && h(React.Fragment, null, h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭配音、字幕和背景音乐', onClick: () => setMediaDrawer(null) }), h('aside', { className: 'sv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '任务配音、字幕和背景音乐' }, h('div', { className: 'sv-drawer-head' }, h('div', null, h('h3', { style: { margin: 0, fontSize: 'var(--lwb-text-section,18px)' } }, `配音 / 字幕 / BGM · ${mediaDrawer.projectTitle}`), h('p', { className: 'sv-meta' }, '展示任务创建时冻结的声音与字幕版本。')), h('button', { type: 'button', className: 'lwb-plain-button', onClick: () => setMediaDrawer(null) }, '关闭')), h('div', { className: 'sv-drawer-scroll sv-video-media-drawer' }, mediaDrawer.source?.voiceover?.audio ? h(React.Fragment, null, h('p', { className: 'sv-meta' }, '配音'), h(VideoTaskMediaPreview, { packId, task: mediaDrawer, stage: 'voiceover', setError })) : null, mediaDrawer.input?.backgroundMusic ? h(React.Fragment, null, h('p', { className: 'sv-meta' }, `BGM · ${mediaDrawer.input.backgroundMusic.name} · ${Math.round(Number(mediaDrawer.input.bgmVolume ?? 0.12) * 100)}%`), h(VideoTaskMediaPreview, { packId, task: mediaDrawer, stage: 'bgm', setError })) : null, mediaDrawer.source?.subtitles ? h(React.Fragment, null, h('p', { className: 'sv-meta' }, `字幕 · ${mediaDrawer.source.subtitles.cueCount || 0} 条`), h('pre', { className: 'sv-subtitle-raw' }, mediaDrawer.source.subtitles.srt || '该任务未包含字幕。')) : h('p', { className: 'sv-note' }, '该视频任务未启用字幕。'))));
      const summaryDrawerNode = summaryDrawer && h(ExecutionDrawer, { key: summaryDrawer.id, request: { kind: 'media', id: summaryDrawer.id, projectId: summaryDrawer.projectId }, onClose: () => setSummaryDrawer(null) });
      return h(PackFrame, { packId, openConversation, title: '视频 / 预览', copy: '选择完成配音的稿件后，DSH 视觉导演会直接制作 Remotion 成片，并由独立 DSH 会话审核。只有技术质检和审片都通过的任务才会展示成片。', hero: videoHero }, h(Notice, { error: error || detailError }), accountTabs, h('section', { className: 'sv-layout sv-video-workbench' }, sourcePanel, taskPanel), sourcePicker, scriptDrawerNode, mediaDrawerNode, summaryDrawerNode, confirmNode);
    }
    const PUBLISH_STATE_LABEL = { none: '未生成', running: '生成中', failed: '生成失败', ready: '已就绪' };
    const PUBLISH_PAGE_SIZE = 8;
    function emptyPublishContent() { return { title: '', copy: '', description: '', tags: [] }; }
    function emptyPublishPrompts() { return { landscape: '', portrait: '', negative: '' }; }
    /** Readiness is the whole contract: a packaging artifact means publishable.
     *  No approval/queue states exist anymore; a failed run is just a retry hint. */
    function publishStateOf(record) {
      if (!record) return 'none';
      const stages = Array.isArray(record.completedStages) ? record.completedStages : [];
      if (stages.includes('packaging') || record.packaging) return 'ready';
      const task = record.task || null;
      if (task && ['queued', 'running'].includes(task.status)) return 'running';
      if (task && task.status === 'failed') return 'failed';
      return 'none';
    }
    function publishStateTone(state) {
      if (state === 'ready') return 'approved';
      if (state === 'running') return 'draft';
      if (state === 'failed') return 'draft';
      return 'none';
    }
    function contentEquals(a, b) {
      return a.title === b.title && a.copy === b.copy && a.description === b.description
        && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
    }
    function promptsEquals(a, b) {
      return a.landscape === (b.landscape || '') && a.portrait === (b.portrait || '') && a.negative === (b.negative || '');
    }
    function mediaDownloadName(title, kind, asset) {
      const extension = ({ 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[asset?.mediaType] || 'bin';
      return `${String(title || '成片').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}-${kind === 'video' ? '视频' : kind === 'landscape' ? '横屏封面' : '竖屏封面'}.${extension}`;
    }
    function PublishAssetDownload({ packId, projectId, title, kind, asset, disabled = false }) {
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const download = async () => {
        setBusy(true); setError(null);
        try {
          const media = asset || await remote(packId, 'readPublishAsset', { projectId, kind });
          downloadBase64(media, mediaDownloadName(title, kind, media));
        } catch (cause) { setError(cause.message); } finally { setBusy(false); }
      };
      return h('div', { className: 'sv-pb-download' }, h('button', { type: 'button', className: 'lwb-plain-button', disabled: disabled || busy, onClick: () => { void download(); } }, busy ? '下载准备中…' : kind === 'video' ? '↓ 下载视频' : '↓ 下载封面'), error ? h('p', { className: 'sv-error', role: 'alert' }, error) : null);
    }
    function PublishVideoModal({ packId, item, onClose }) {
      const modal = React.useRef(null);
      const [asset, setAsset] = React.useState(null);
      const [error, setError] = React.useState(null);
      React.useEffect(() => {
        const previous = document.activeElement;
        modal.current?.showModal();
        return () => { modal.current?.close(); if (previous?.isConnected) previous.focus(); };
      }, []);
      React.useEffect(() => {
        let active = true;
        void remote(packId, 'readPublishAsset', { projectId: item.id, kind: 'video' })
          .then((next) => { if (active) setAsset(next); })
          .catch((cause) => { if (active) setError(cause.message); });
        return () => { active = false; };
      }, [packId, item.id, item.video?.file]);
      return h('dialog', { ref: modal, className: 'sv-pb-player', 'aria-label': `播放成片 · ${item.title}`, onCancel: (event) => { event.preventDefault(); onClose(); }, onClick: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h('div', { className: 'sv-pb-player-panel' },
          h('header', null, h('div', null, h('p', null, '成片预览'), h('h3', null, item.title)), h('button', { type: 'button', className: 'lwb-plain-button', onClick: onClose, autoFocus: true }, '关闭')),
          h('div', { className: 'sv-pb-player-stage' }, error ? h('p', { role: 'alert' }, error) : asset ? h('video', { controls: true, autoPlay: true, preload: 'metadata', src: mediaDataUrl(asset) }) : h('p', { role: 'status' }, '正在载入视频…')),
          h('footer', null, h('span', null, [item.orientation === 'portrait' ? '竖屏 9:16' : '横屏 16:9', formatMediaDuration(item.video?.durationSeconds)].join(' · ')), h(PublishAssetDownload, { packId, projectId: item.id, title: item.title, kind: 'video', asset, disabled: !asset })),
        ),
      );
    }
    /** Cards only request a small thumbnail; video bytes are loaded in a modal. */
    function PublishVideoThumb({ packId, item, videoThumbnail = false }) {
      const [cover, setCover] = React.useState(null);
      const [playing, setPlaying] = React.useState(false);
      const covers = videoThumbnail ? null : item.packaging?.covers || null;
      const prefer = item.orientation === 'portrait' ? 'portrait' : 'landscape';
      const coverKind = covers?.[prefer]?.file ? prefer : covers?.landscape?.file ? 'landscape' : covers?.portrait?.file ? 'portrait' : null;
      const coverFile = coverKind ? covers[coverKind].file : null;
      React.useEffect(() => {
        setCover(null);
        if (!packId || !item.video) return undefined;
        let active = true;
        const read = (kind) => remote(packId, 'readPublishAsset', { projectId: item.id, kind });
        void (coverKind ? read(coverKind).catch(() => read('thumbnail')) : read('thumbnail'))
          .then((next) => { if (active) setCover(next); }).catch(() => {});
        return () => { active = false; };
      }, [packId, item.id, coverKind, coverFile, item.video?.file]);
      return h(React.Fragment, null,
        h('div', { className: 'sv-pb-thumb' },
          cover ? h('img', { src: mediaDataUrl(cover), alt: `${item.title} 视频缩略图` }) : h('div', { className: 'sv-pb-thumb-empty' }, item.video ? '成片预览' : '尚无成片'),
          item.video ? h('button', { type: 'button', className: 'sv-pb-play', title: '弹窗播放成片', 'aria-label': `播放 ${item.title}`, onClick: () => setPlaying(true) }) : null,
        ),
        playing ? h(PublishVideoModal, { key: item.video?.file || item.id, packId, item, onClose: () => setPlaying(false) }) : null,
      );
    }
    /**
     * The publish page is a flat video shelf grouped by account: every
     * QC-passed final cut shows up with modal playback and one 「发布」
     * button. The drawer is the whole lifecycle — it auto-generates publish
     * info on first open, then offers editing, prompt-driven cover
     * regeneration, uploads and full regeneration. Having title/copy/
     * description/tags means publishable; there are no approval or queue
     * gates and nothing is ever sent to a platform.
     */
    function PublishPageV4({ packId, openConversation, lwbAccount }) {
      const account = lwbAccount.useAccount();
      const { refresh, error, setError } = useProjects(packId);
      const [service, setService] = React.useState(null);
      const [accountLibrary, setAccountLibrary] = React.useState({ accounts: [], defaultAccountId: null });
      const [activeTab, setActiveTab] = React.useState(GENERAL_TAB);
      const [items, setItems] = React.useState([]);
      const settlement = items.map(item => `${item.id}:${item.task?.status || ''}`).join('|');
      React.useEffect(() => { if (settlement) void lwbAccount.refresh(); }, [settlement, lwbAccount]);
      const [page, setPage] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [connectionOpen, setConnectionOpen] = React.useState(false);
      const [connectionProvider, setConnectionProvider] = React.useState('lwb');
      const [connectionModel, setConnectionModel] = React.useState('');
      const [apiKey, setApiKey] = React.useState('');
      const [connectionBusy, setConnectionBusy] = React.useState(null);
      // The drawer is the only selection surface; it is keyed by project id.
      const [openProject, setOpenProject] = React.useState(null);
      const [content, setContent] = React.useState(emptyPublishContent());
      const [prompts, setPrompts] = React.useState(emptyPublishPrompts());
      const [covers, setCovers] = React.useState({ landscape: null, portrait: null });
      const [coverBusy, setCoverBusy] = React.useState(null);
      const [triggerError, setTriggerError] = React.useState(null);
      const [tagInput, setTagInput] = React.useState('');
      const [confirmNode, ask] = useSvConfirm();
      const landscapeInputRef = React.useRef(null);
      const portraitInputRef = React.useRef(null);
      const coverInputRef = (kind) => (kind === 'landscape' ? landscapeInputRef : portraitInputRef);
      // Auto-generation is attempted once per project revision; a failure is
      // never retried silently — the drawer shows the error and a retry button.
      const autoTriggered = React.useRef(new Set());

      const { detail, error: detailError, reload } = useDetail(packId, openProject);

      const refreshService = React.useCallback(async () => {
        try { const next = await remoteStatic('publishStatus'); setService(next); return next; }
        catch (cause) { setError(cause.message); return null; }
      }, [setError]);
      const loadItems = React.useCallback(async () => {
        if (!packId) return [];
        try { const next = await remote(packId, 'listPublishItems'); setItems(next.items || []); setError(null); return next.items || []; }
        catch (cause) { setError(cause.message); return []; }
      }, [packId, setError]);

      React.useEffect(() => { void refreshService(); }, [refreshService, account.user?.id, account.phase, account.catalog, account.serviceError, account.error]);
      React.useEffect(() => {
        if (!packId) return;
        void Promise.all([remote(packId, 'listAccounts'), loadItems()])
          .then(([accounts, shelfItems]) => {
            setAccountLibrary(accounts);
            if (publishHandoff?.packId === packId) {
              const target = publishHandoff.projectId; publishHandoff = null;
              const item = shelfItems.find((row) => row.id === target);
              setOpenProject(target);
              setActiveTab(item?.account?.id || GENERAL_TAB);
              return;
            }
            setActiveTab((current) => current !== GENERAL_TAB && accounts.accounts.some((item) => item.id === current && item.status === 'active') ? current : accounts.defaultAccountId || GENERAL_TAB);
          }).catch((cause) => setError(cause.message));
      }, [packId, loadItems, setError]);
      // Reflect the saved image-generation config into the drawer form.
      React.useEffect(() => {
        if (!service) return;
        if (service.provider === 'bailian') setConnectionModel(typeof service.model === 'string' ? service.model : '');
      }, [service?.provider, service?.model]);

      const openItem = openProject ? items.find((item) => item.id === openProject) || null : null;
      const openTask = openItem?.task || null;
      const running = Boolean(openTask && ['queued', 'running'].includes(openTask.status));
      // While a generation runs, keep the shelf, the detail and the task summary fresh.
      React.useEffect(() => {
        if (!packId || !running || !openProject) return undefined;
        let active = true;
        const tick = () => { void (async () => { await loadItems(); if (active) { await Promise.all([reload(), refresh()]); } })(); };
        tick();
        const timer = setInterval(tick, 1500);
        return () => { active = false; clearInterval(timer); };
      }, [packId, running, openProject, loadItems, reload, refresh]);

      const packaging = stageData(detail, 'packaging') || null;
      // Load the persisted publish info into the editor on every artifact change.
      React.useEffect(() => {
        const data = stageData(detail, 'packaging');
        setContent(data?.content ? { title: data.content.title, copy: data.content.copy, description: data.content.description, tags: [...(data.content.tags || [])] } : emptyPublishContent());
        setPrompts(data?.prompts ? { landscape: data.prompts.landscape || '', portrait: data.prompts.portrait || '', negative: data.prompts.negative || '' } : emptyPublishPrompts());
        setTagInput('');
      }, [detail?.id, detail?.revision]);
      const dirty = Boolean(packaging) && (!contentEquals(content, packaging.content) || !promptsEquals(prompts, packaging.prompts));

      // Pull frozen cover bytes whenever the opened project's covers change.
      React.useEffect(() => {
        setCovers({ landscape: null, portrait: null });
        if (!packId || !openProject || !packaging) return undefined;
        const kinds = ['landscape', 'portrait'].filter((kind) => packaging.covers?.[kind]?.file);
        if (!kinds.length) return undefined;
        let cancelled = false;
        void Promise.all(kinds.map((kind) => remote(packId, 'readPublishAsset', { projectId: openProject, kind })
          .then((asset) => [kind, asset]).catch(() => [kind, null])))
          .then((entries) => { if (!cancelled) setCovers((prev) => { const next = { ...prev }; for (const [kind, asset] of entries) if (asset) next[kind] = asset; return next; }); });
        return () => { cancelled = true; };
      }, [packId, openProject, packaging?.covers?.landscape?.file, packaging?.covers?.portrait?.file]);

      const startPackaging = async (projectId, revision) => {
        if (busy) return false;
        setBusy(true); setError(null); setTriggerError(null);
        try {
          await remote(packId, 'startPackaging', { projectId, expectedRevision: revision });
          await loadItems();
          return true;
        } catch (cause) {
          // A rejected trigger creates no task record, so the failure would be
          // invisible inside the drawer. Surface it there with a retry button.
          setTriggerError(cause.message); setError(cause.message); return false;
        } finally { setBusy(false); }
      };
      // Opening a video without publish info starts one generation automatically.
      React.useEffect(() => {
        if (!packId || !openProject || !detail || busy) return;
        if (detail.artifacts?.packaging) return;
        const item = items.find((row) => row.id === openProject);
        if (item?.task && ['queued', 'running'].includes(item.task.status)) return;
        const key = `${detail.id}:${detail.revision}`;
        if (autoTriggered.current.has(key)) return;
        autoTriggered.current.add(key);
        void startPackaging(detail.id, detail.revision);
      }, [packId, openProject, detail?.id, detail?.revision, items, busy]);

      const saveContent = async () => {
        if (!detail || !packaging) return null;
        setBusy(true); setError(null);
        try {
          const saved = await remote(packId, 'updatePackaging', { projectId: detail.id, expectedRevision: detail.revision, content, prompts });
          await Promise.all([reload(), loadItems()]);
          return saved;
        } catch (cause) { setError(cause.message); return null; } finally { setBusy(false); }
      };
      const uploadCover = async (kind, file) => {
        if (!detail || !packaging || !file) return;
        const limit = service?.imageMaxBytes || 20 * 1024 * 1024;
        if (file.size < 1 || file.size > limit) { setError(`封面必须小于 ${formatMediaBytes(limit)}。`); return; }
        setCoverBusy(kind); setError(null);
        try {
          const data = await base64FromAudioFile(file);
          await remote(packId, 'uploadPublishCover', { projectId: detail.id, expectedRevision: detail.revision, kind, data });
          const asset = await remote(packId, 'readPublishAsset', { projectId: detail.id, kind });
          setCovers((prev) => ({ ...prev, [kind]: asset }));
          await Promise.all([reload(), loadItems()]);
        } catch (cause) { setError(cause.message); } finally { setCoverBusy(null); }
      };
      // Regenerating one cover direction reuses the (possibly hand-edited)
      // prompt. Unsaved edits are committed first so the copy the user sees is
      // the copy that survives the regeneration.
      const regenerateCover = async (kind) => {
        if (!detail || !packaging || coverBusy || running) return;
        setCoverBusy(kind); setError(null);
        try {
          let revision = detail.revision;
          if (dirty) {
            const saved = await remote(packId, 'updatePackaging', { projectId: detail.id, expectedRevision: revision, content, prompts });
            revision = saved.project.revision;
            await reload();
          }
          await remote(packId, 'regeneratePublishCover', { projectId: detail.id, expectedRevision: revision, kind, prompt: prompts[kind], negativePrompt: prompts.negative });
          await loadItems();
        } catch (cause) { setError(cause.message); } finally { setCoverBusy(null); }
      };
      const regenerateAll = () => ask({
        title: '重新生成发布信息', danger: true, confirm: '确认重新生成',
        copy: `将由 AI 重新生成「${detail?.title || ''}」的标题、文案、描述、标签与封面提示词${service?.configured ? '，并重新生成横竖封面' : ''}。当前的人工修改会被覆盖。`,
        onConfirm: async () => { if (detail) await startPackaging(detail.id, detail.revision); },
      });
      const saveConnection = async () => {
        setConnectionBusy('save');
        try {
          await remoteStatic('configurePublishConnection', { provider: connectionProvider, ...(connectionProvider === 'bailian' ? { model: connectionModel.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } : {}) });
          setApiKey(''); await refreshService(); setError(null);
        } catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };
      const clearConnection = async () => {
        setConnectionBusy('clear');
        try { await remoteStatic('clearPublishConnectionCredential', { provider: connectionProvider }); await refreshService(); setError(null); }
        catch (cause) { setError(cause.message); } finally { setConnectionBusy(null); }
      };

      const addTag = (raw) => {
        const tag = String(raw || '').trim().replace(/^#+/u, '');
        if (!tag) return;
        setContent((prev) => (prev.tags.includes(tag) || prev.tags.length >= 10 ? prev : { ...prev, tags: [...prev.tags, tag] }));
        setTagInput('');
      };
      const removeTag = (tag) => setContent((prev) => ({ ...prev, tags: prev.tags.filter((item) => item !== tag) }));

      const activeAccounts = accountLibrary.accounts.filter((item) => item.status === 'active');
      const activeIds = new Set(activeAccounts.map((item) => item.id));
      const tabOf = (item) => (!item.account ? GENERAL_TAB : activeIds.has(item.account.id) ? item.account.id : ARCHIVED_TAB);
      const stateRank = { ready: 0, none: 1, failed: 2, running: 3 };
      const sortItems = (list) => [...list].sort((a, b) => (stateRank[publishStateOf(a)] - stateRank[publishStateOf(b)]) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const tabItems = sortItems(items.filter((item) => tabOf(item) === activeTab));
      const archivedItems = sortItems(items.filter((item) => tabOf(item) === ARCHIVED_TAB));
      const tabName = activeTab === GENERAL_TAB ? '通用（无账号定位）' : (activeAccounts.find((item) => item.id === activeTab)?.name || '—');
      const pageCount = Math.max(1, Math.ceil(tabItems.length / PUBLISH_PAGE_SIZE));
      const pagedItems = tabItems.slice(page * PUBLISH_PAGE_SIZE, page * PUBLISH_PAGE_SIZE + PUBLISH_PAGE_SIZE);
      // Shelf pagination follows the audio workbench: reset on tab switch and
      // clamp when the list shrinks underneath the current page.
      React.useEffect(() => { setPage(0); }, [activeTab]);
      React.useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);

      const resetDrawer = () => { setOpenProject(null); setTriggerError(null); };
      const closeDrawer = () => {
        if (!dirty) { resetDrawer(); return; }
        ask({ title: '放弃未保存的修改？', danger: true, confirm: '放弃修改', copy: '发布信息里有尚未保存的修改，关闭后会丢失。', onConfirm: resetDrawer });
      };

      const stateBadge = (item) => {
        const state = publishStateOf(item);
        return h('span', { className: 'sv-sc-state', 'data-state': publishStateTone(state) }, PUBLISH_STATE_LABEL[state]);
      };
      const coverNote = (item) => {
        const covers2 = item.packaging?.covers || null;
        if (!item.packaging) return null;
        const ready = ['landscape', 'portrait'].filter((kind) => covers2?.[kind]?.file);
        const failed = ['landscape', 'portrait'].filter((kind) => item.packaging.coverErrors?.[kind]);
        if (ready.length === 2) return '封面：横竖已就绪';
        if (failed.length) return `封面待补：${failed.map((kind) => kind === 'landscape' ? '横屏' : '竖屏').join('、')}`;
        return ready.length ? `封面：${ready[0] === 'landscape' ? '横屏' : '竖屏'}已就绪` : '封面：尚未生成';
      };
      const videoSpec = (item) => [
        item.orientation === 'portrait' ? '竖屏 9:16' : item.orientation === 'landscape' ? '横屏 16:9' : null,
        item.video?.width && item.video?.height ? `${item.video.width}x${item.video.height}` : null,
        item.video?.durationSeconds ? formatMediaDuration(item.video.durationSeconds) : null,
        item.video?.bytes ? formatMediaBytes(item.video.bytes) : null,
      ].filter(Boolean).join(' · ');
      // The drawer prefers the loaded artifact so the spec shows even before the
      // shelf listing settles; the card falls back to the list item.
      const detailVideo = stageData(detail, 'video') || null;
      const drawerSpec = videoSpec({ orientation: detailVideo?.orientation || openItem?.orientation || null, video: detailVideo?.video || openItem?.video || null });
      const itemCard = (item, archived) => h('article', { key: item.id, className: 'sv-pb-card' },
        h(PublishVideoThumb, { packId, item, setError }),
        h('div', { className: 'sv-pb-card-head' },
          h('p', { className: 'sv-pb-card-title' }, item.title),
          stateBadge(item),
        ),
        h('p', { className: 'sv-pb-card-meta' }, [item.account?.name || '通用', videoSpec(item)].filter(Boolean).join(' · ')),
        h('p', { className: 'sv-pb-card-meta' }, [coverNote(item), item.packaging ? `标签 ${item.packaging.content?.tags?.length || 0} 个` : null, archived ? `已归档 · ${item.account?.name || ''}` : null, relativeTime(item.updatedAt)].filter(Boolean).join(' · ')),
        item.task?.status === 'failed' ? h('p', { className: 'sv-pb-cover-error' }, item.task.error || '发布信息生成失败。') : null,
        h('div', { className: 'sv-pb-card-foot' },
          h('span', { className: 'sv-pb-card-meta' }, publishStateOf(item) === 'ready' ? '标题 / 文案 / 描述 / 标签已就绪' : '点「发布」查看或生成发布资料'),
          h('button', { type: 'button', className: 'lwb-primary-button', onClick: () => setOpenProject(item.id) }, '发布'),
        ),
      );

      const tabs = h(AccountTabs, { accountLibrary, activeTab, onChange: setActiveTab, label: '按账号筛选成片' },
        archivedItems.length ? h('span', { className: 'sv-sc-archived', title: '已归档账号的成片仅在列表尾部展示' }, `已归档 ${archivedItems.length}`) : null,
      );

      const shelf = h('section', { className: 'sv-section' },
        h('div', { className: 'sv-section-head' }, h('h3', null, '成片与发布资料'), h('span', null, `当前 Tab · ${tabName} · ${tabItems.length} 个`)),
        tabs,
        tabItems.length || archivedItems.length ? h(React.Fragment, null,
          h('div', { className: 'sv-pb-shelf' }, pagedItems.map((item) => itemCard(item, false)), page === pageCount - 1 && archivedItems.length ? archivedItems.map((item) => itemCard(item, true)) : null),
          pageCount > 1 ? h('div', { className: 'sv-audio-pagebar' },
            h('span', { className: 'sv-meta' }, `第 ${page + 1}/${pageCount} 页 · 共 ${tabItems.length + archivedItems.length} 个`),
            h('span', { className: 'sv-actions' },
              h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '上一页', disabled: page === 0, onClick: () => setPage((current) => Math.max(0, current - 1)) }, '上一页'),
              h('button', { type: 'button', className: 'lwb-plain-button', 'aria-label': '下一页', disabled: page + 1 >= pageCount, onClick: () => setPage((current) => Math.min(pageCount - 1, current + 1)) }, '下一页'),
            ),
          ) : null,
        ) : h('div', { className: items.length ? 'sv-empty' : 'sv-empty-cta' }, items.length ? '当前账号 Tab 暂无成片，可切换其他账号 Tab。' : h(React.Fragment, null, h('p', null, '还没有通过质检的成片。'), h('p', null, '先到「视频 / 预览」页完成视频制作与质检，质检通过的成片会自动出现在这里。'))),
      );

      // ---- lifecycle drawer ----
      const coverUnavailableText = !service ? '正在读取封面生图服务状态…' : service.provider === 'bailian'
        ? '百炼尚未配置 API Key，请在「封面生图配置」中配置。'
        : lwbServiceUnavailableText(account, service.providers?.lwb?.credential, 'cover-image');
      const coverCard = (kind) => {
        const label = kind === 'landscape' ? '横屏封面 16:9' : '竖屏封面 9:16';
        const descriptor = packaging?.covers?.[kind] || null;
        const asset = covers[kind];
        const coverError = packaging?.coverErrors?.[kind] || null;
        return h('div', { key: kind, className: 'sv-pb-cover', 'data-kind': kind },
          h('div', { className: 'sv-pb-cover-head' }, h('strong', null, label), descriptor ? h('span', null, `${descriptor.width}x${descriptor.height} · ${formatMediaBytes(descriptor.bytes)} · ${descriptor.source === 'upload' ? '人工上传' : 'AI 生成'}`) : h('span', null, '未生成')),
          h('div', { className: 'sv-pb-cover-frame' }, asset?.data ? h('img', { src: `data:${asset.mediaType};base64,${asset.data}`, alt: label }) : h('div', { className: 'sv-pb-cover-empty' }, descriptor ? '正在载入封面…' : '尚无封面')),
          h(PublishAssetDownload, { packId, projectId: detail.id, title: detail.title, kind, asset, disabled: !descriptor }),
          coverError ? h('p', { className: 'sv-pb-cover-error' }, coverError) : null,
          h('label', { className: 'sv-pb-prompt' }, h('span', null, `${label.slice(0, 2)}生图提示词（可修改）`),
            h('textarea', { className: 'sv-textarea', value: prompts[kind], maxLength: 3000, disabled: busy || running, onChange: (event) => setPrompts((prev) => ({ ...prev, [kind]: event.target.value })) }),
          ),
          h('div', { className: 'sv-pb-cover-acts' },
            h('input', { ref: coverInputRef(kind), type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onChange: (event) => { const file = event.target.files?.[0] || null; event.target.value = ''; if (file) void uploadCover(kind, file); } }),
            h('button', { type: 'button', className: 'lwb-primary-button', disabled: !packaging || coverBusy === kind || running || !prompts[kind].trim() || service?.configured !== true, title: service?.configured === true ? '按当前提示词重新生成这张封面' : coverUnavailableText, onClick: () => { void regenerateCover(kind); } }, coverBusy === kind ? '生成中…' : '按此提示词生图'),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: !packaging || coverBusy === kind || running, onClick: () => coverInputRef(kind).current?.click() }, coverBusy === kind ? '上传中…' : descriptor ? '上传替换' : '上传封面'),
          ),
          service?.configured !== true ? h('p', { className: 'sv-pb-field-note', role: 'status' }, `${coverUnavailableText}也可上传自己的封面图。`) : null,
        );
      };
      const tagEditor = h('div', { className: 'sv-pb-field' },
        h('span', null, `标签（${content.tags.length}/10）`),
        content.tags.length ? h('div', { className: 'sv-pb-tags' }, content.tags.map((tag) => h('span', { key: tag, className: 'sv-pb-tag' }, `#${tag}`, h('button', { type: 'button', className: 'sv-tp-acct-link', style: { marginLeft: '5px' }, disabled: !packaging || busy, onClick: () => removeTag(tag) }, '×')))) : h('p', { className: 'sv-pb-field-note' }, '尚无标签，至少需要一个。'),
        h('div', { className: 'sv-actions' },
          h('input', { className: 'sv-input', style: { flex: '1 1 160px' }, value: tagInput, maxLength: 30, placeholder: '输入标签后回车添加', disabled: !packaging || busy || content.tags.length >= 10, onChange: (event) => setTagInput(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagInput); } } }),
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: !packaging || busy || !tagInput.trim() || content.tags.length >= 10, onClick: () => addTag(tagInput) }, '添加'),
        ),
      );
      const stepBlock = (task) => {
        const phases = task.coverKind ? ['covers', 'ready'] : ['agent', 'covers', 'ready'];
        const labels = { agent: '生成发布资料', covers: '生成封面', ready: '就绪' };
        const currentIndex = phases.indexOf(task.phase);
        return h('div', { className: 'sv-tp-steps' }, phases.map((phase, index) => h('span', { key: phase, className: 'sv-tp-step', 'data-state': task.status === 'failed' && index === Math.max(currentIndex, 0) ? 'error' : index < currentIndex || task.status === 'succeeded' ? 'done' : index === currentIndex ? 'running' : undefined }, h('i', null), labels[phase])));
      };

      const drawerBody = detail && h('div', { className: 'sv-sc-drawer-body' },
        h('section', { className: 'sv-pb-section sv-pb-final' },
          h('div', { className: 'sv-pb-section-heading' }, h('div', null, h('p', { className: 'sv-pb-section-number' }, '01 / 成片'), h('h4', null, '预览与下载'), h('p', null, drawerSpec || '上一模块生成的视频')), h(PublishAssetDownload, { packId, projectId: detail.id, title: detail.title, kind: 'video', disabled: !detailVideo?.video && !openItem?.video })),
          h(PublishVideoThumb, { packId, item: { id: detail.id, title: detail.title, video: detailVideo?.video || openItem?.video || null, orientation: detailVideo?.orientation || openItem?.orientation || null, packaging: packaging || openItem?.packaging || null }, setError }),
        ),
        !packaging
          ? h('div', { className: 'sv-sc-empty-manuscript' },
              running
                ? h(React.Fragment, null, h('p', null, openTask?.coverKind ? '正在重新生成封面…' : '正在生成发布信息…'), stepBlock(openTask), h('p', { className: 'sv-sc-report-empty' }, '关闭抽屉不会中断生成。'))
                : openTask?.status === 'failed'
                  ? h(React.Fragment, null,
                      h('p', null, '发布信息生成失败。'),
                      h('p', { className: 'sv-pb-cover-error' }, openTask.error || '未知错误'),
                      h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy, onClick: () => { void startPackaging(detail.id, detail.revision); } }, busy ? '正在提交…' : '重试生成'),
                    )
                  : triggerError
                    ? h(React.Fragment, null,
                        h('p', null, '未能触发生成。'),
                        h('p', { className: 'sv-pb-cover-error' }, triggerError),
                        h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy, onClick: () => { autoTriggered.current.delete(`${detail.id}:${detail.revision}`); void startPackaging(detail.id, detail.revision); } }, busy ? '正在提交…' : '重试生成'),
                      )
                    : h(React.Fragment, null, h('p', null, '正在自动触发一次发布信息生成…'), h('p', { className: 'sv-sc-report-empty' }, '将生成标题、文案、描述、标签与封面提示词' + (service?.configured ? '，并生成横竖封面。' : '；未配置生图服务时可自行上传封面。'))),
            )
          : h(React.Fragment, null,
              running ? h('section', { className: 'sv-sc-run-status' }, h('div', { className: 'sv-sc-ai-action-head' }, h('strong', null, openTask?.coverKind ? '生图服务正在重新生成封面' : 'DSH 正在重新生成发布信息'), h('span', null, relativeTime(openTask.createdAt))), stepBlock(openTask), h('p', { className: 'sv-note' }, '完成后会自动更新下方内容；关闭抽屉不会中断。')) : null,
              h('section', { className: 'sv-pb-section sv-pb-form' },
                h('p', { className: 'sv-pb-section-number' }, '02 / 发布资料'),
                h('div', { className: 'sv-sc-view-head' }, h('h4', null, '核对标题与文案'), h('p', null, packaging.mode === 'agent' ? 'AI 生成，可人工修改后保存' : packaging.mode === 'manual-update' ? '已人工修改' : packaging.mode === 'cover-upload' ? '封面已人工替换' : '封面已按提示词重生')),
                h('label', { className: 'sv-pb-field' }, h('span', null, '标题'), h('input', { className: 'sv-input', value: content.title, maxLength: 80, disabled: busy, onChange: (event) => setContent((prev) => ({ ...prev, title: event.target.value })) })),
                h('label', { className: 'sv-pb-field' }, h('span', null, '视频文案'), h('textarea', { className: 'sv-textarea', style: { minHeight: '96px' }, value: content.copy, maxLength: 2000, disabled: busy, onChange: (event) => setContent((prev) => ({ ...prev, copy: event.target.value })) })),
                h('label', { className: 'sv-pb-field' }, h('span', null, '视频描述'), h('textarea', { className: 'sv-textarea', style: { minHeight: '80px' }, value: content.description, maxLength: 1000, disabled: busy, onChange: (event) => setContent((prev) => ({ ...prev, description: event.target.value })) })),
                tagEditor,
              ),
              h('section', { className: 'sv-pb-section' },
                h('p', { className: 'sv-pb-section-number' }, '03 / 封面素材'),
                h('div', { className: 'sv-sc-view-head' }, h('h4', null, '横竖封面'), h('p', null, '可查看并修改生图提示词后单独重生；也可直接上传自己的封面图。')),
                h('div', { className: 'sv-pb-covers' }, coverCard('landscape'), coverCard('portrait')),
                h('label', { className: 'sv-pb-prompt', style: { marginTop: '10px' } }, h('span', null, '负面提示词（可选，两个方向共用）'),
                  h('textarea', { className: 'sv-textarea', style: { minHeight: '52px' }, value: prompts.negative, maxLength: 1000, disabled: busy || running, onChange: (event) => setPrompts((prev) => ({ ...prev, negative: event.target.value })) }),
                ),
              ),
              openTask ? h('section', { className: 'sv-pb-section sv-pb-generation' }, h('div', { className: 'sv-sc-view-head' }, h('h4', null, '最近一次生成'), h('p', null, `${openTask.status === 'succeeded' ? '已完成' : openTask.status === 'failed' ? '失败' : '进行中'} · ${formatTime(openTask.createdAt)}${openTask.imageProvider ? ` · 封面 ${openTask.imageProvider.provider === 'bailian' ? '百炼' : 'LWB'}` : ' · 未配置生图服务'}`)), openTask.status === 'failed' ? h('p', { className: 'sv-error' }, openTask.error || '生成失败。') : null, h(ExecutionButton, { kind: 'publish', id: openTask.id, projectId: openTask.projectId }), h(ExecutionHistory, { kind: 'publish', projectId: openTask.projectId, refreshKey: openTask.status })) : null,
            ),
      );
      const drawerFoot = detail && h('div', { className: 'sv-tp-drawer-foot' },
        packaging
          ? h(React.Fragment, null,
              h('p', { className: 'sv-sc-gate-note' }, dirty ? '有未保存的修改' : '资料齐备即视为可发布，复制标题/文案/描述/标签与封面到平台即可'),
              h('span', { style: { display: 'flex', gap: '8px', flex: 'none' } },
                h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy || running, onClick: regenerateAll }, '重新生成发布信息'),
                h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || running || !dirty || content.tags.length < 1, onClick: () => { void saveContent(); } }, busy ? '保存中…' : '保存'),
              ),
            )
          : h('p', { className: 'sv-sc-gate-note' }, running ? '发布信息生成中…' : '生成发布信息后可在此编辑标题、文案、描述、标签与封面。'),
      );
      const lifecycleDrawer = detail && h(React.Fragment, null,
        h('button', { type: 'button', className: 'sv-drawer-backdrop', 'aria-label': '关闭面板', onClick: closeDrawer }),
        h('aside', { className: 'sv-drawer sv-drawer-wide sv-pb-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `发布资料 · ${detail.title}` },
          h('div', { className: 'sv-drawer-head sv-sc-drawer-head' },
            h('div', { className: 'sv-sc-drawer-title' },
              h('p', { className: 'sv-pb-section-number' }, '发布工作台 / 资料核对'),
              h('div', { className: 'sv-sc-drawer-titleline' }, h('h3', null, detail.title), h('span', { className: 'sv-sc-state', 'data-state': publishStateTone(packaging ? 'ready' : running ? 'running' : openTask?.status === 'failed' ? 'failed' : 'none') }, packaging ? PUBLISH_STATE_LABEL.ready : running ? PUBLISH_STATE_LABEL.running : openTask?.status === 'failed' ? PUBLISH_STATE_LABEL.failed : PUBLISH_STATE_LABEL.none), dirty ? h('span', { className: 'sv-tag' }, '未保存') : null),
              h('p', { className: 'sv-sc-drawer-meta' }, `${detail.account?.name || '通用'} · 版本 ${detail.revision}${packaging ? ` · 文案 ${charCount(content.copy)} 字 · 标签 ${content.tags.length} 个` : ''}`),
            ),
            h('div', { className: 'sv-sc-drawer-tools' },
              h('button', { type: 'button', className: 'sv-ghost-btn', title: '关闭', 'aria-label': '关闭', onClick: closeDrawer }, '×'),
            ),
          ),
          h('div', { className: 'sv-drawer-scroll' }, drawerBody),
          drawerFoot,
        ),
      );

      const connectionCredential = service?.providers?.[connectionProvider]?.credential;
      const connectionDrawer = h(ServiceConnectionDrawer, { open: connectionOpen, onClose: () => setConnectionOpen(false), image: true, lwbAccount, provider: connectionProvider, setProvider: setConnectionProvider, credential: connectionCredential, apiKey, setApiKey, busy: connectionBusy, save: saveConnection, clear: clearConnection, selected: service?.provider, model: connectionModel, setModel: setConnectionModel });

      const readyCount = items.filter((item) => publishStateOf(item) === 'ready').length;
      const pendingCount = items.filter((item) => publishStateOf(item) === 'none' || publishStateOf(item) === 'failed').length;
      const hero = h(HeroMini, { cells: [
        { label: '可发布成片', value: String(items.length), tone: 'brand' },
        { label: '发布资料就绪', value: String(readyCount), tone: 'green' },
        { label: '待生成', value: String(pendingCount), tone: pendingCount ? 'orange' : 'green' },
        { label: '封面生图', value: service?.configured ? (service.provider === 'bailian' ? '百炼' : 'LWB') : '待配置', tone: service?.configured ? 'green' : undefined },
      ] });

      return h(PackFrame, { packId, openConversation, title: '发布', accent: 'red', copy: '这里直接陈列上一模块生成的成片，可点开播放。点「发布」查看或生成发布资料：标题、文案、描述、标签与横竖封面。资料齐备即视为可发布，复制到平台即可；封面可按提示词重生，也可自行上传。本模块不会向任何平台直发。', hero, introActions: h('button', { type: 'button', className: 'sv-media-config-trigger', 'data-attention': service && !service.configured ? 'true' : 'false', onClick: () => { setConnectionProvider('lwb'); setConnectionOpen(true); } }, h(React.Fragment, null, h(IconSettingsOutlineRegular, { size: 16, 'aria-hidden': true }), '封面生图', h('span', { className: 'sv-config-state' }, !service ? '读取中' : service.configured ? '已就绪' : '待配置'))) },
        h(Notice, { error: error || detailError }),
        shelf,
        lifecycleDrawer,
        connectionDrawer,
        confirmNode,
      );
    }
    async function apply(ctx) {
      try {
      connection = ctx.get('connection'); executionStreams = ctx.get('remote');
      // Mount the pack's dynamic contract on the same native mux used by ordinary conversations.
      await executionStreams.$mount({ package: '@scitiger-ai/lwb-spoken-video', descriptors: [{
        id: '@scitiger-ai/lwb-spoken-video#spokenVideo/followExecution', service: 'spokenVideo', namespace: 'spokenVideo', method: 'followExecution', mode: 'stream', invocation: { kind: 'direct' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: '@scitiger-ai/lwb-spoken-video#ExecutionRequest', create: () => ({ parse(value) { if (!value || typeof value.id !== 'string' || typeof value.kind !== 'string' || typeof value.role !== 'string') throw new Error('执行会话请求无效。'); return value; } }) } }],
        cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
      }] });
      await ctx.plugin({ name: 'spoken-video-execution-client', inject: ['remote.spokenVideo'], apply(scope) { executionRemote = scope.get('remote.spokenVideo'); scope.effect(() => () => { executionRemote = null; }); } });
      installStyle(); ctx.effect(() => ctx.lwbPackClient.register({ packId: 'spoken-video', pages: { positioning: AccountPositioningPage, signals: SignalsPage, topics: TopicsPage, scripts: ScriptPage, 'audio-captions': AudioCaptionsPageV2, 'video-preview': VideoPreviewPageV2, publish: PublishPageV4, 'content-schedule': ContentSchedulePage } }), 'spoken-video: register capability pages');
      } catch (error) { console.error('LWB capability page activation failed', error); throw error; }
    }
    exports.inject = ['connection', 'lwbPackClient', 'remote']; exports.apply = apply; return module.exports;
  },
});
