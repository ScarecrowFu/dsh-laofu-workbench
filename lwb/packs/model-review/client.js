window.__ModuleLoader__.load({
  id: '@scitiger-ai/lwb-model-review',
  factory: (require) => {
    // DSH evaluates this factory in the browser without global CommonJS exports.
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const h = React.createElement;
    let connection;

    /**
     * Product visual system for this pack.
     *
     * Three colour roles, kept apart on purpose: the page's own tone says where
     * you are (violet question bank / orange evaluation / cyan archive), the
     * brand colour says what is operable, and the status colours say what state
     * a run is in. Depth has four levels (page, group, item, inset) so a card
     * can never be mistaken for a group.
     */
    const css = `
      .lwb-page-capability:has(.mr-page) > .lwb-page-intro{display:none}
      /* 历史任务页的最后一行是一条贴底的工具条，所以这一页自己拿走外壳的页底留白。
         留着它，报告条就会停在窗口下沿上方半个页脚的位置：填掉列表以后剩下的空间
         又从这里冒出来。只认这一页的归属色，题库页与测评页的页脚不动。 */
      .lwb-page-capability:has(.mr-page[data-tone="cyan"]){padding-bottom:0}
      .mr-page{--mr-brand:#4f46e5;--mr-brand-soft:#eef2ff;--mr-violet:#8b5cc4;--mr-violet-soft:#f2ebfb;--mr-orange:#cf762b;--mr-orange-soft:#fff0e4;--mr-cyan:#2579b9;--mr-cyan-soft:#e7f4fb;--mr-green:#16865f;--mr-green-soft:#eaf8f1;--mr-amber:#a56c19;--mr-amber-soft:#fff5e7;--mr-red:#a33;--mr-red-soft:#fff0f0;--mr-run:#2869d8;--mr-run-soft:#edf4ff;--mr-shadow-sm:0 1px 2px rgba(15,20,25,.04);--mr-shadow-md:0 4px 12px rgba(15,20,25,.06);--mr-on-brand:#fff;--mr-tone:var(--mr-brand);--mr-tone-soft:var(--mr-brand-soft);display:grid;gap:18px;width:100%;min-width:0;color:var(--lwb-ink);font-size:var(--lwb-text-base,14px);line-height:1.55}
      .mr-page[data-tone="violet"]{--mr-tone:var(--mr-violet);--mr-tone-soft:var(--mr-violet-soft)}
      .mr-page[data-tone="orange"]{--mr-tone:var(--mr-orange);--mr-tone-soft:var(--mr-orange-soft)}
      .mr-page[data-tone="cyan"]{--mr-tone:var(--mr-cyan);--mr-tone-soft:var(--mr-cyan-soft)}
      body[data-ds-dark-theme] .mr-page{--mr-brand:#a5b4fc;--mr-brand-soft:#2a3150;--mr-violet:#c4a7ff;--mr-violet-soft:#31263f;--mr-orange:#f6bd7c;--mr-orange-soft:#3e3024;--mr-cyan:#7cc4ee;--mr-cyan-soft:#1d4058;--mr-green:#5bd0a0;--mr-green-soft:#173f34;--mr-amber:#f0b45b;--mr-amber-soft:#49351c;--mr-red:#e9b7b7;--mr-red-soft:#3b2525;--mr-run:#78adff;--mr-run-soft:#203f64;--mr-on-brand:#0f172a;--mr-shadow-sm:0 1px 2px rgba(0,0,0,.24);--mr-shadow-md:0 4px 12px rgba(0,0,0,.3)}
      .mr-page *{box-sizing:border-box}
      .mr-page h1,.mr-page h2,.mr-page h3,.mr-page p,.mr-page ul,.mr-page ol,.mr-page dl,.mr-page dd{margin:0}
      .mr-page ul,.mr-page ol{padding:0;list-style:none}
      .mr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;min-width:0;padding:0 0 14px;border-bottom:1px solid var(--lwb-line)}
      .mr-top-copy{min-width:0}
      .mr-kicker{display:flex;align-items:center;gap:6px;margin-bottom:5px;color:var(--mr-tone);font-size:11px;font-weight:800;letter-spacing:.12em}
      .mr-kicker i{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
      .mr-top h1{font-size:var(--lwb-text-heading,20px);line-height:1.3}
      .mr-top p{margin-top:3px}
      .mr-top-actions,.mr-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .mr-muted{color:var(--lwb-muted);font-size:var(--lwb-text-sm,13px)}
      .mr-num{color:var(--lwb-muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .mr-button,.mr-icon{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;border:1px solid var(--lwb-line);border-radius:6px;padding:5px 11px;background:var(--lwb-surface);color:var(--lwb-ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
      .mr-button:hover,.mr-icon:hover{border-color:var(--mr-brand);color:var(--mr-brand)}
      .mr-button.primary{border-color:var(--mr-brand);background:var(--mr-brand);color:var(--mr-on-brand)}
      .mr-button.primary:hover{filter:brightness(.94);color:var(--mr-on-brand)}
      .mr-button.emphasis{min-height:36px;padding:7px 14px;border-color:var(--mr-tone);background:var(--mr-tone-soft);color:var(--lwb-ink);font-weight:700;white-space:normal;text-align:center}
      .mr-button.emphasis:hover{border-color:var(--mr-tone);background:var(--lwb-surface);color:var(--lwb-ink);box-shadow:var(--mr-shadow-sm)}
      .mr-button.ghost{border-color:transparent;background:transparent;color:var(--lwb-muted)}
      .mr-button.ghost:hover{background:var(--lwb-page);color:var(--mr-brand)}
      .mr-button.danger{color:var(--mr-red)}
      .mr-button:disabled,.mr-icon:disabled{opacity:.48;cursor:not-allowed}
      .mr-icon{width:32px;padding:0;font-size:19px;line-height:1}
      .mr-input,.mr-select,.mr-textarea{width:100%;min-width:0;min-height:34px;border:1px solid var(--lwb-line);border-radius:6px;padding:6px 10px;background:var(--lwb-surface);color:var(--lwb-ink);font:inherit;font-size:13px;outline:0}
      .mr-textarea{min-height:200px;resize:vertical;line-height:1.65}
      .mr-input:focus,.mr-select:focus,.mr-textarea:focus{border-color:var(--mr-brand);box-shadow:0 0 0 3px var(--mr-brand-soft)}
      .mr-page :is(button,a,summary,input,select,textarea):focus-visible{outline:2px solid var(--mr-brand);outline-offset:2px}
      .mr-chip{display:inline-flex;align-items:center;max-width:100%;min-height:20px;padding:2px 7px;border-radius:4px;background:var(--lwb-blue-soft);color:var(--lwb-blue);font-size:11px;font-weight:700;white-space:nowrap}
      .mr-chip[data-tone="success"]{background:var(--mr-green-soft);color:var(--mr-green)}
      .mr-chip[data-tone="warning"]{background:var(--mr-amber-soft);color:var(--mr-amber)}
      .mr-chip[data-tone="info"]{background:var(--mr-run-soft);color:var(--mr-run)}
      .mr-chip[data-tone="danger"]{background:var(--mr-red-soft);color:var(--mr-red)}
      .mr-chip[data-tone="neutral"]{background:var(--lwb-page);color:var(--lwb-muted)}
      .mr-chip.soft{border-radius:999px;background:var(--mr-tone-soft);color:var(--mr-tone)}
      .mr-l1{border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--mr-shadow-sm)}
      .mr-l1-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:12px 16px;border-bottom:1px solid var(--lwb-line)}
      .mr-l1-body{display:grid;gap:12px;padding:14px 16px}
      .mr-sec-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;line-height:1.4}
      .mr-sec-title::before{content:"";width:3px;height:14px;flex:none;border-radius:2px;background:var(--mr-tone)}
      .mr-stat{display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px;padding:12px 16px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--mr-shadow-sm)}
      .mr-stat-item{display:grid;gap:1px;min-width:56px}
      .mr-stat-item b{font-size:16px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums}
      .mr-stat-item b[data-tone="tone"]{color:var(--mr-tone)}
      .mr-stat-item span{color:var(--lwb-muted);font-size:11px;font-weight:700;letter-spacing:.04em}
      .mr-toolbar{display:grid;gap:9px}
      .mr-toolbar-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
      .mr-toolbar-row .mr-input{flex:1 1 200px;max-width:320px}
      .mr-seg{display:inline-flex;flex:none;gap:2px;padding:2px;border:1px solid var(--lwb-line);border-radius:8px;background:var(--lwb-page)}
      .mr-seg button{min-height:26px;padding:0 10px;border:0;border-radius:6px;color:var(--lwb-muted);background:transparent;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
      .mr-seg button[data-on="true"]{color:var(--mr-brand);background:var(--lwb-surface);box-shadow:var(--mr-shadow-sm)}
      .mr-field{display:grid;gap:6px;font-size:13px;font-weight:700;min-width:0}
      .mr-field small{font-weight:400;color:var(--lwb-muted)}
      .mr-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .mr-empty{display:grid;gap:8px;place-items:center;min-height:170px;padding:26px;border:1px dashed var(--lwb-line);border-radius:10px;background:var(--lwb-surface);color:var(--lwb-muted);text-align:center}
      .mr-empty-glyph{display:grid;width:44px;height:44px;place-items:center;border-radius:12px;background:var(--mr-tone-soft);color:var(--mr-tone);font-size:20px}
      .mr-empty strong{color:var(--lwb-ink);font-size:15px}
      .mr-empty p{max-width:420px;font-size:13px;line-height:1.6}
      .mr-skeleton{display:grid;gap:9px;padding:4px}
      .mr-skeleton i{display:block;height:42px;border-radius:8px;background:linear-gradient(90deg,var(--lwb-page),var(--lwb-line),var(--lwb-page));background-size:200% 100%;animation:mr-shimmer 1.4s ease-in-out infinite}
      .mr-skeleton i:nth-child(2){width:82%}.mr-skeleton i:nth-child(3){width:64%}
      @keyframes mr-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      .mr-error{padding:9px 12px;border:1px solid #e6b5b5;border-radius:6px;background:#fff6f6;color:#a33;font-size:13px}
      .mr-notice{padding:9px 12px;border:1px solid #c7d9ef;border-radius:6px;background:var(--mr-brand-soft);color:var(--lwb-ink);font-size:13px}
      body[data-ds-dark-theme] .mr-error{background:#3b2525;color:#e9b7b7;border-color:#764747}
      .mr-drawer-backdrop{position:fixed;inset:0;z-index:90;background:rgba(17,31,45,.43)}
      .mr-drawer{position:fixed;inset:0 0 0 auto;z-index:91;display:flex;flex-direction:column;width:min(600px,100vw);background:var(--lwb-surface);box-shadow:-14px 0 36px rgba(0,0,0,.13)}
      .mr-drawer[data-wide="true"]{width:min(920px,100vw)}
      .mr-drawer-head,.mr-drawer-foot{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-bottom:1px solid var(--lwb-line)}
      .mr-drawer-head h2{font-size:17px;line-height:1.35;overflow-wrap:anywhere}
      .mr-drawer-head p{margin-top:3px}
      .mr-drawer-foot{justify-content:flex-end;flex-wrap:wrap;border-top:1px solid var(--lwb-line);border-bottom:0}
      .mr-danger-note{margin-right:auto;color:var(--mr-red);font-size:12px;line-height:1.5}
      .mr-drawer-body{display:grid;align-content:start;gap:14px;min-height:0;overflow:auto;padding:18px 22px}
      /* One layer above the drawer stack (90/91): starting a run must be answered
         even when the question drawer that handed the work over is still open. */
      .mr-confirm-backdrop{position:fixed;inset:0;z-index:100;background:rgba(17,31,45,.43)}
      .mr-confirm{position:fixed;inset:0;z-index:101;display:flex;flex-direction:column;gap:13px;width:min(520px,calc(100vw - 32px));height:fit-content;max-height:min(680px,calc(100dvh - 48px));margin:auto;overflow:auto;overscroll-behavior:contain;padding:20px;border:1px solid var(--lwb-line);border-radius:12px;background:var(--lwb-surface);box-shadow:0 24px 80px rgba(15,23,42,.28)}
      .mr-confirm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .mr-confirm-head h2{font-size:17px;line-height:1.4;overflow-wrap:anywhere}
      .mr-confirm-copy{color:var(--lwb-muted);font-size:14px;line-height:1.7}
      .mr-confirm-notice{padding:11px 12px;border:1px solid var(--mr-amber);border-radius:7px;background:var(--mr-amber-soft);color:var(--mr-amber);font-size:13px;line-height:1.65}
      .mr-confirm-summary{display:grid;gap:8px;padding:12px;border:1px solid var(--lwb-line);border-radius:7px;background:var(--lwb-page)}
      .mr-confirm-row{display:grid;grid-template-columns:52px minmax(0,1fr);align-items:start;gap:10px}
      .mr-confirm-row dt{color:var(--lwb-muted);font-size:12px}
      .mr-confirm-row dd{margin:0;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
      .mr-confirm-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:14px;border-top:1px solid var(--lwb-line)}
      .mr-picker{display:grid;gap:10px;min-width:0}
      /* 5 rows: 5 x 58 + 4 x 2 + 4 padding */
      .mr-picker-list{display:grid;align-content:start;gap:2px;max-height:302px;min-height:120px;grid-auto-rows:max-content;overflow:auto;padding:2px}
      .mr-drawer .mr-picker-list{max-height:none;min-height:0}
      .mr-qrow{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-height:58px;overflow:hidden;padding:7px 12px 7px 14px;border-radius:8px;background:transparent;color:var(--lwb-ink)}
      .mr-qrow:hover{background:var(--lwb-page)}
      .mr-qrow[data-active="true"]{background:var(--mr-tone-soft)}
      .mr-qrow[data-active="true"]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:8px 0 0 8px;background:var(--mr-tone)}
      .mr-qrow[data-active="true"] .mr-qrow-title strong{color:var(--mr-tone)}
      .mr-qrow-hit{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .mr-qrow-main{display:grid;gap:3px;min-width:0}
      .mr-qrow-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:650}
      .mr-qrow-title strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mr-qrow-sub{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;color:var(--lwb-muted);font-size:12px;white-space:nowrap;text-overflow:ellipsis}
      .mr-qrow-side{display:flex;flex:none;align-items:center;gap:8px}
      .mr-prompt-box{max-height:150px;min-width:0;overflow:auto;padding:12px;border:1px solid var(--lwb-line);border-radius:7px;background:var(--lwb-page)}
      .mr-drawer .mr-prompt-box{max-height:min(42vh,380px)}
      .mr-prompt{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.7}
      .mr-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
      .mr-label{display:block;margin-bottom:6px;color:var(--lwb-muted);font-size:11px;font-weight:800;letter-spacing:.06em}
      .mr-setup-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px;align-items:start}
      .mr-mgroups{display:grid;align-content:start;gap:6px;min-height:120px;grid-auto-rows:max-content;padding:1px}
      .mr-mgroup{border:1px solid var(--lwb-line);border-radius:8px;overflow:hidden}
      .mr-mgroup-head{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:5px 10px;border:0;background:var(--lwb-page);color:var(--lwb-ink);font:inherit;text-align:left;cursor:pointer}
      .mr-mgroup-head:hover{background:var(--mr-tone-soft)}
      .mr-mgroup-head b{font-size:13px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mr-mgroup-head i{width:0;height:0;flex:none;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:5px solid currentColor;color:var(--lwb-muted);transition:transform .14s ease}
      .mr-mgroup[data-open="true"] .mr-mgroup-head i{transform:rotate(90deg)}
      .mr-mgroup-body{display:grid;gap:1px;padding:3px}
      .mr-mrow{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;min-height:34px;overflow:hidden;padding:4px 9px 4px 10px;border-radius:7px;cursor:pointer}
      .mr-mrow:hover{background:var(--lwb-page)}
      .mr-mrow[data-on="true"]{background:var(--mr-brand-soft)}
      .mr-mrow[data-on="true"]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:7px 0 0 7px;background:var(--mr-brand)}
      .mr-mrow[data-on="true"] .mr-mrow-main strong{color:var(--mr-brand)}
      .mr-mrow input{margin:0;accent-color:var(--mr-brand)}
      .mr-mrow-main{display:flex;align-items:baseline;gap:8px;min-width:0}
      .mr-mrow-main strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650}
      .mr-mrow-main small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lwb-muted);font-size:11px}
      .mr-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--lwb-line)}
      .mr-dot[data-status="succeeded"]{background:var(--mr-green)}
      .mr-dot[data-status="failed"]{background:#c25f4a}
      .mr-dot[data-status="running"]{background:var(--mr-run);animation:mr-pulse 1.4s ease-in-out infinite}
      .mr-dot[data-status="queued"]{background:var(--lwb-muted)}
      .mr-dot[data-status="cancelled"]{background:var(--lwb-line)}
      @keyframes mr-pulse{0%,100%{opacity:1}50%{opacity:.35}}
      .mr-startbar{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:0;padding:10px 14px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:0 -2px 14px rgba(15,20,25,.07)}
      .mr-startbar-main{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
      .mr-startbar > .mr-actions{flex:none}
      .mr-startbar-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650}
      .mr-selpills{display:flex;align-items:center;gap:6px;min-width:0;max-height:96px;overflow:auto;padding:2px;flex-wrap:wrap}
      .mr-selpill{display:inline-flex;align-items:center;gap:6px;max-width:220px;min-height:24px;padding:2px 4px 2px 9px;border:1px solid var(--mr-brand);border-radius:999px;background:var(--mr-brand-soft);color:var(--lwb-ink);font-size:12px;font-weight:600}
      .mr-selpill span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mr-selpill button{display:grid;width:18px;height:18px;flex:none;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--lwb-muted);font:inherit;font-size:13px;line-height:1;cursor:pointer}
      .mr-selpill button:hover{background:var(--lwb-surface);color:var(--mr-red)}
      .mr-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--mr-shadow-sm)}
      .mr-summary-left{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
      .mr-summary-dots{display:flex;align-items:center;gap:4px}
      .mr-summary-text{color:var(--lwb-muted);font-size:12px;font-variant-numeric:tabular-nums}
      .mr-run-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:stretch}
      .mr-run-grid[data-count="1"]{grid-template-columns:minmax(0,1fr)}
      .mr-run{display:flex;position:relative;flex-direction:column;min-width:0;height:100%;overflow:hidden;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface)}
      .mr-run[data-active="true"]{border-color:var(--mr-brand);box-shadow:0 0 0 2px var(--mr-brand-soft)}
      .mr-run[data-status="failed"]{border-color:#e7c6c6}
      .mr-run-stripe{position:absolute;top:0;left:0;right:0;height:3px;background:var(--lwb-line)}
      .mr-run[data-status="running"] .mr-run-stripe{background:var(--mr-run);animation:mr-pulse 1.4s ease-in-out infinite}
      .mr-run[data-status="succeeded"] .mr-run-stripe{background:var(--mr-green)}
      .mr-run[data-status="failed"] .mr-run-stripe{background:#c25f4a}
      .mr-run-head{display:flex;align-items:center;gap:10px;min-width:0;padding:11px 13px 10px;border-bottom:1px solid var(--lwb-line)}
      .mr-run-letter{display:grid;width:24px;height:24px;flex:none;place-items:center;border-radius:6px;background:var(--mr-tone-soft);color:var(--mr-tone);font-size:11px;font-weight:800}
      .mr-run-letter[data-status="succeeded"]{background:var(--mr-green-soft);color:var(--mr-green)}
      .mr-run-letter[data-status="failed"]{background:var(--mr-red-soft);color:var(--mr-red)}
      .mr-run-title{display:grid;gap:1px;min-width:0;flex:1 1 auto}
      .mr-run-title strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:650}
      .mr-run-title span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lwb-muted);font-size:11px}
      .mr-run-meta{display:flex;flex:none;align-items:center;gap:7px}
      .mr-run-error{margin:0;padding:9px 13px;background:#fff4f4;color:#9b3131;font-size:13px;overflow-wrap:anywhere;border-bottom:1px solid #efcaca}
      body[data-ds-dark-theme] .mr-run-error{background:#3b2525;color:#e9b7b7;border-color:#764747}
      .mr-conversation{display:flex;position:relative;min-width:0;flex:1 1 auto;min-height:380px;max-height:min(480px,54vh);overflow:hidden}
      .mr-conversation > *{min-width:0;min-height:0;flex:1}
      .mr-conversation-state{display:grid;place-items:center;min-height:220px;flex:1 1 auto;padding:24px;color:var(--lwb-muted);text-align:center;font-size:13px}
      .mr-artifacts{display:grid;gap:5px;padding:11px 13px;border-top:1px solid var(--lwb-line);overflow-wrap:anywhere;font-size:13px}
      .mr-artifact{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:6px 9px;border:1px solid var(--lwb-line);border-radius:6px;background:var(--lwb-page)}
      .mr-artifact code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
      .mr-artifact span{flex:none;color:var(--lwb-muted);font-size:12px}
      .mr-compare{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(300px,1fr);gap:12px;min-width:0;overflow-x:auto;padding-bottom:4px}
      .mr-compare-col{display:grid;align-content:start;gap:9px;min-width:0;padding:12px;border:1px solid var(--lwb-line);border-radius:9px;background:var(--lwb-page)}
      .mr-compare-col[data-status="failed"]{border-color:#e7c6c6}
      .mr-compare-col header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
      .mr-compare-col header strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650}
      .mr-compare-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--lwb-muted);font-size:11px;font-variant-numeric:tabular-nums}
      .mr-compare-text{max-height:56vh;overflow:auto;padding:11px;border:1px solid var(--lwb-line);border-radius:7px;background:var(--lwb-surface);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7}
      .mr-compare-note{color:var(--lwb-muted);font-size:12px;line-height:1.6}
      /* 8 rows: 8 x 58 + 7 x 2 + 4 padding — that is the floor, not the ceiling.
         The floor is the whole-row window this page promises, and it is what a
         short window falls back to (the page then scrolls and the bar pins itself,
         exactly as before). The ceiling is whichever is larger: that window, or
         the leftover height of the host's scroll viewport, which useViewportFill
         measures into --mr-list-fill. min-height takes the same leftover so a page
         with only two tasks still ends its panel on the bottom of the window instead
         of hanging the report bar mid-air. Never below 300px, so the box keeps its
         shape while the data loads. */
      .mr-bank-list{--mr-list-floor:482px;display:grid;align-content:start;gap:2px;max-height:max(var(--mr-list-floor),var(--mr-list-fill,0px));min-height:max(300px,var(--mr-list-fill,0px));grid-auto-rows:max-content;overflow:auto;padding:2px}
      .mr-detail-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--lwb-muted);font-size:12px;font-variant-numeric:tabular-nums}
      /* The checkbox lives beside the row button, never inside it: a control nested
         in a button is invalid markup and its click toggles twice in Chromium. */
      .mr-hrow-wrap{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:9px}
      .mr-hrow-wrap[data-settled="false"] .mr-hrow{opacity:.72}
      .mr-hrow-wrap[data-on="true"] .mr-hrow{border-color:var(--mr-brand);background:var(--mr-brand-soft)}
      .mr-pick{width:16px;height:16px;margin:0;accent-color:var(--mr-brand);cursor:pointer}
      .mr-pick:disabled{cursor:not-allowed;opacity:.4}
      /* The bar is the only way into a report, so it never scrolls out of reach.
         Pinned exactly like the evaluation page's submit bar, which is the one
         arrangement already proven against every window size: the page keeps
         flowing and scrolling as it did, the bar stays at the bottom of the
         scrollport. Its shadow points up so a pinned bar reads as lifted off the
         rows behind it rather than as one more row.
         The page deliberately does NOT try to own the height of the host's scroll
         container instead. The pack page is mounted two levels down from
         .lwb-page-capability (the host wraps it in its own plain div), so a
         height:100% chain stops there: the list's row loses its definite height
         and collapses onto its floor, which is what left a squashed list with dead
         space under it. Paying for a shorter page with a shorter list is the wrong
         trade; the list keeps its whole-row window and the page scrolls. */
      .mr-pickbar{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 2px 2px;padding:10px 14px;border:1px solid var(--lwb-line);border-radius:9px;background:var(--lwb-surface);box-shadow:0 -2px 14px rgba(15,20,25,.07)}
      .mr-pickstats{display:flex;align-items:center;gap:18px;flex:none}
      .mr-pickhint{flex:1;min-width:180px;color:var(--lwb-muted);font-size:12px}
      .mr-report{position:fixed;inset:0;z-index:100;display:grid;grid-template-rows:auto minmax(0,1fr);background:rgba(15,20,25,.72);padding:22px}
      .mr-report-bar{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:9px 9px 0 0;background:var(--lwb-surface);border:1px solid var(--lwb-line);border-bottom:none}
      .mr-report-bar strong{font-size:14px;font-weight:650}
      .mr-report-bar .mr-button{margin-left:auto}
      .mr-report-frame{width:100%;height:100%;border:1px solid var(--lwb-line);border-radius:0 0 9px 9px;background:#fff}
      @media(max-width:700px){.mr-report{padding:0}.mr-report-bar{border-radius:0}.mr-report-frame{border-radius:0}}
      .mr-hrow{position:relative;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1.2fr) auto;align-items:center;gap:12px;width:100%;min-height:56px;padding:9px 14px 9px 15px;border:1px solid var(--lwb-line);border-radius:9px;background:var(--lwb-surface);color:var(--lwb-ink);font:inherit;text-align:left;cursor:pointer}
      .mr-hrow:hover{border-color:var(--mr-tone);box-shadow:var(--mr-shadow-md)}
      .mr-hrow[data-active="true"]{border-color:var(--mr-tone);background:var(--mr-tone-soft)}
      .mr-hrow[data-status="failed"]::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:2px;background:#c25f4a}
      .mr-hrow-main{display:grid;gap:3px;min-width:0}
      .mr-hrow-main strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:650}
      .mr-hrow-main span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lwb-muted);font-size:12px}
      .mr-hrow-models{display:flex;align-items:center;gap:5px;min-width:0}
      .mr-hrow-side{display:flex;flex:none;align-items:center;gap:10px}
      .mr-hrow-side .mr-num{font-size:12px}
      .mr-back{display:inline-flex;align-items:center;gap:6px}
      .mr-history-head{flex-wrap:wrap}
      .mr-history-head .mr-top-copy{flex:1 1 220px}
      .mr-history-head h2{font-size:17px;line-height:1.4;overflow-wrap:anywhere}
      .mr-filtercount{color:var(--lwb-muted);font-size:12px;font-variant-numeric:tabular-nums}
      @media(max-width:1200px){.mr-setup-grid{grid-template-columns:minmax(0,1fr)}.mr-mgroups{max-height:320px}}
      @media(max-width:1100px){.mr-bank-list{--mr-list-floor:422px}.mr-run-grid{grid-template-columns:minmax(0,1fr)!important}}
      @media(max-width:700px){.mr-compare{grid-auto-flow:row;grid-auto-columns:auto}.mr-top{align-items:flex-start;flex-wrap:wrap}.mr-pair{grid-template-columns:1fr}.mr-hrow{grid-template-columns:minmax(0,1fr) auto}.mr-hrow-models{display:none}.mr-stat{gap:10px 16px}}
      @media(max-width:520px){.mr-startbar{align-items:stretch;flex-direction:column}.mr-startbar .mr-button{width:100%}.mr-drawer-head,.mr-drawer-foot{padding:14px}.mr-drawer-body{padding:14px}.mr-confirm{padding:16px}.mr-confirm-actions .mr-button{flex:1}.mr-run-grid{grid-template-columns:minmax(0,1fr)!important}}
      @media(prefers-reduced-motion:reduce){.mr-page *{scroll-behavior:auto!important;animation:none!important}}
    `;

    const api = async (method, request) => {
      const response = await connection.rpc.call('/api', `modelReview/${method}`, { args: request === undefined ? {} : { request } });
      if (!response?.ok) throw new Error(response?.error?.message || '模型测评服务请求失败。');
      return response.value;
    };
    function useAsync(loader, deps) {
      const [state, setState] = React.useState({ busy: true, error: null, value: null });
      React.useEffect(() => {
        let live = true;
        setState({ busy: true, error: null, value: null });
        Promise.resolve().then(loader).then(value => {
          if (live) setState({ busy: false, error: null, value });
        }).catch(error => {
          if (live) setState({ busy: false, error: error.message, value: null });
        });
        return () => { live = false; };
      }, deps);
      return state;
    }
    /** A clock that only ticks while something on screen is still moving. */
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        if (!active) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, [active]);
      return now;
    }

    const emptyForm = () => ({ title: '', category: '', tags: '', prompt: '', description: '' });
    const stamp = value => value ? new Date(value).toLocaleString('zh-CN') : '';
    const statusText = status => ({ queued: '等待中', running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' })[status] || status;
    const statusTone = status => status === 'succeeded' ? 'success' : status === 'failed' ? 'danger' : status === 'cancelled' ? 'neutral' : 'warning';
    /** Tasks the host is still working on: the runs behind them have not all settled. */
    const liveTasks = tasks => (tasks || []).filter(task => ['running', 'queued'].includes(task.status));
    const bytesText = value => typeof value !== 'number' ? '' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
    const charText = count => count >= 1000 ? `${(count / 1000).toFixed(1)}k 字` : `${count} 字`;
    const shortStamp = value => {
      if (!value) return '';
      const date = new Date(value);
      const pad = number => String(number).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const relative = value => {
      const time = value ? new Date(value).getTime() : 0;
      if (!time) return '';
      const gap = Date.now() - time;
      if (gap < 60000) return '刚刚';
      if (gap < 3600000) return `${Math.floor(gap / 60000)} 分钟前`;
      if (gap < 86400000) return `${Math.floor(gap / 3600000)} 小时前`;
      if (gap < 2592000000) return `${Math.floor(gap / 86400000)} 天前`;
      return new Date(value).toLocaleDateString('zh-CN');
    };
    const durationText = ms => {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
      const seconds = Math.round(ms / 1000);
      if (seconds < 60) return `${seconds} 秒`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
      return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
    };
    /** A run's own wall clock: settled runs are fixed, a live run keeps counting. */
    const runDuration = (run, now) => {
      const started = run?.createdAt ? new Date(run.createdAt).getTime() : 0;
      if (!started) return null;
      if (run.completedAt) return new Date(run.completedAt).getTime() - started;
      if (['queued', 'running'].includes(run.status)) return Math.max(0, (now || Date.now()) - started);
      return null;
    };
    const runDurationText = (run, now) => {
      const value = runDuration(run, now);
      if (value === null) return '—';
      return `${run.completedAt ? '' : '已用 '}${durationText(value)}`;
    };
    /** The answer snapshot the store keeps for a settled run, as plain text. */
    const answerText = answer => {
      const content = answer?.message?.content ?? answer?.content ?? answer?.text;
      if (typeof content === 'string') return content.trim();
      if (!Array.isArray(content)) return '';
      return content.map(item => typeof item === 'string' ? item : item?.text || '').join('').trim();
    };
    const answerChars = answer => answerText(answer).length;
    const runModels = task => (task?.runs || []).map(run => run.model?.displayName || run.model?.model || '');
    const taskDuration = task => (task?.runs || []).reduce((max, run) => Math.max(max, runDuration(run) || 0), 0);
    const modelKey = (provider, model) => `${provider}:${model}`;

    /* ================================ 测评报告 ================================
     * The report is a plain, self-contained HTML document built here and either
     * downloaded or shown in place. It deliberately duplicates its own formatting
     * helpers: nothing from this page travels with it, and the exported file has to
     * render years later in a browser that has never seen the workbench.
     * ======================================================================== */

    /** One artifact may be inlined at most this large; bigger ones are only listed. */
    const REPORT_INLINE_LIMIT = 4 * 1024 * 1024;
    /** Response bodies are text; only markup can be rendered as a live preview. */
    const renderableArtifact = path => /\.html?$/iu.test(path);
    /**
     * Why a run has no figures, in the words the report has to use.
     *
     * "未记录" on its own is what made a restartable host look like data that was
     * gone for good: the reader could not tell that one of these is fixed by
     * restarting the workbench and the others only by running the evaluation again.
     * `short` goes in the cell, `long` and `advice` into the report's opening note.
     */
    const STATS_REASONS = {
      'no-session': { short: '无会话记录', long: '该运行早于独立会话的测评，没有会话记录', advice: '无法补齐，只能重跑这次测评。' },
      unsupported: { short: '宿主不支持', long: '当前工作台版本不支持读取会话投影', advice: '重启或升级工作台后重新生成报告即可补齐。' },
      missing: { short: '投影已不存在', long: '该会话的投影已被清理，读不到了', advice: '无法补齐，只能重跑这次测评。' },
      empty: { short: '投影不含这两项', long: '该会话的投影里没有耗时与 token', advice: '该会话没有记录这两项。' },
      failed: { short: '读取失败', long: '读取该会话的投影时失败', advice: '稍后重新生成报告即可再试一次。' },
    };
    const statsReasonText = reason => STATS_REASONS[reason] || { short: '未记录', long: '原因未知', advice: '重新生成报告即可再试一次。' };
    /**
     * The key one artifact is inlined under.
     *
     * A path alone is not unique: two runs of the same task both write
     * `pelican-bicycle.html`, and each is its own result. Every place that builds
     * or looks up an inlined body goes through here so the two sides cannot drift.
     */
    const artifactKey = (taskId, runId, path) => `${taskId}/${runId}/${path}`;

    /**
     * Base64 of a UTF-8 string, in chunks.
     *
     * `String.fromCharCode(...bytes)` on a 1.3 MB artifact exceeds the argument
     * limit and throws, so the conversion is chunked. Base64 is also what makes the
     * payload safe to embed: its alphabet cannot contain `<`, so no artifact can
     * terminate the enclosing script element.
     */
    const toBase64 = text => {
      const bytes = new TextEncoder().encode(text);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
      return btoa(binary);
    };

    const reportEscape = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const reportBytes = value => typeof value !== 'number' || !Number.isFinite(value) ? '' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(0)} KB` : `${(value / 1048576).toFixed(1)} MB`;
    const reportTokens = value => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);
    const reportPercent = value => typeof value !== 'number' || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
    const reportSeconds = value => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${Math.round(value)} 毫秒`;
    const reportDuration = value => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
      const seconds = Math.round(value / 1000);
      if (seconds < 60) return `${seconds} 秒`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
      return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
    };
    const reportStamp = value => { const date = new Date(value); const pad = number => String(number).padStart(2, '0'); return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`; };

    /**
     * Everything the report shows about one run, derived from the stored stats.
     *
     * The figures come from the host's projections and are never recomputed from
     * the answer text, so the report and the conversation's own footer agree by
     * construction. A run without stats reports nulls and the report prints `—`.
     */
    const runFacts = (run, now) => {
      const stats = run?.stats || null;
      const tokens = stats?.tokens || null;
      const billedInput = tokens ? tokens.uncachedInput + tokens.cacheRead + tokens.cacheWrite : 0;
      const context = stats?.context || null;
      const decodeSeconds = stats?.decodeMs ? stats.decodeMs / 1000 : 0;
      return {
        wallMs: runDuration(run, now),
        status: run?.status || 'queued',
        // The run settled once, then the conversation went on without it. The status
        // is the pack's own attempt; this says the figures and artifacts are not.
        continued: Boolean(run?.continued),
        error: run?.error || null,
        inline: (run?.artifacts || []).filter(item => renderableArtifact(item.path) && (item.bytes || 0) <= REPORT_INLINE_LIMIT),
        listed: (run?.artifacts || []).filter(item => !(renderableArtifact(item.path) && (item.bytes || 0) <= REPORT_INLINE_LIMIT)),
        answerChars: answerChars(run?.answer),
        hasStats: Boolean(stats),
        statsReason: stats ? null : run?.statsReason || run?.statsUnavailable || null,
        source: stats?.source || null,
        asOfSeq: stats?.asOfSeq ?? null,
        turns: stats?.turns ?? null,
        steps: stats?.steps ?? null,
        llmMs: stats?.llmMs ?? null,
        toolMs: stats?.toolMs ?? null,
        ttftAvg: stats?.ttftSteps ? stats.ttftMs / stats.ttftSteps : null,
        tps: decodeSeconds > 0 ? stats.decodeTokens / decodeSeconds : null,
        total: tokens ? billedInput + tokens.output : null,
        uncachedInput: tokens?.uncachedInput ?? null,
        cacheRead: tokens?.cacheRead ?? null,
        output: tokens?.output ?? null,
        cacheHit: billedInput > 0 ? tokens.cacheRead / billedInput : null,
        contextShare: context?.contextWindow > 0 ? context.pressureTokens / context.contextWindow : null,
      };
    };

    /**
     * Build the standalone report document.
     *
     * @param tasks - selected tasks, each with question snapshot, run snapshots and stats.
     * @param inlined - artifact key (`taskId/runId/path`) to base64 text, for the runs' HTML results.
     * @returns the complete HTML document as a string.
     */
    const reportDocument = (tasks, inlined) => {
      const now = Date.now();
      const report = tasks.map(task => ({
        id: task.id,
        createdAt: task.createdAt,
        question: task.question || {},
        runs: (task.runs || []).map(run => ({ id: run.id, model: run.model || {}, facts: runFacts(run, now) })),
      }));
      const runs = report.flatMap(item => item.runs);
      const models = [...new Set(runs.map(run => run.model.displayName || run.model.model || ''))].filter(Boolean);
      const inlinedBytes = Object.values(inlined).reduce((sum, value) => sum + Math.round(value.length * 0.75), 0);
      const listedCount = runs.reduce((sum, run) => sum + run.facts.listed.length, 0);
      const listedBytes = runs.reduce((sum, run) => sum + run.facts.listed.reduce((inner, item) => inner + (item.bytes || 0), 0), 0);
      const inlinedCount = report.reduce((sum, task) => sum + task.runs.reduce((inner, run) =>
        inner + run.facts.inline.filter(item => inlined[artifactKey(task.id, run.id, item.path)] !== undefined).length, 0), 0);
      // Why some runs have no figures, grouped. One explained line at the top beats
      // the same four characters repeated in every row, and it is where the reader
      // learns which of these a restart would fix.
      const withoutFigures = runs.filter(run => !run.facts.hasStats);
      const reasonCounts = new Map();
      for (const run of withoutFigures) {
        const reason = run.facts.statsReason || 'unknown';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
      const reasonNotes = [...reasonCounts.entries()].sort((left, right) => right[1] - left[1])
        .map(([reason, count]) => ({ count, ...statsReasonText(reason) }));

      // The matrix keeps the model order stable — the union of selected models in
      // first-seen order. It is never sorted by any figure: a faster model is not a
      // better one, and ordering by speed would make the report a ranking.
      const missing = report.reduce((sum, task) => sum + models.filter(name => !task.runs.some(run => (run.model.displayName || run.model.model || '') === name)).length, 0);
      const totals = models.map(name => {
        const own = runs.filter(run => (run.model.displayName || run.model.model || '') === name);
        return {
          name,
          wall: own.reduce((sum, run) => sum + (run.facts.wallMs || 0), 0),
          tokens: own.reduce((sum, run) => sum + (run.facts.total || 0), 0),
          steps: own.reduce((sum, run) => sum + (run.facts.steps || 0), 0),
          artifacts: own.reduce((sum, run) => sum + run.facts.inline.length + run.facts.listed.length, 0),
          failed: own.filter(run => run.facts.status !== 'succeeded').length,
        };
      });

      const matrixCell = run => {
        if (!run) return '<td class="mx-cell mx-missing">—</td>';
        const succeeded = run.facts.status === 'succeeded';
        return `<td class="mx-cell"><div class="mx-1"><i class="dot ${succeeded ? 'ok' : 'bad'}"></i>${reportDuration(run.facts.wallMs)}${run.facts.continued ? '<i class="tag" title="含中断后从卡片继续的部分">续</i>' : ''}</div>`
          + `<div class="mx-2">产物 ${run.facts.inline.length + run.facts.listed.length} · ${run.facts.steps === null ? '—' : `${run.facts.steps} 步`}</div>`
          + `<div class="mx-3">${reportTokens(run.facts.total)} token · ${run.facts.tps === null ? '—' : `${run.facts.tps.toFixed(0)} t/s`}</div></td>`;
      };
      const repeats = {};
      report.forEach(task => { const key = String(task.question.title || ''); repeats[key] = (repeats[key] || 0) + 1; });
      const seenRepeats = {};
      const matrixRows = report.map(task => {
        const key = String(task.question.title || '');
        seenRepeats[key] = (seenRepeats[key] || 0) + 1;
        const rerun = repeats[key] > 1 ? `<i class="rerun">第 ${seenRepeats[key]} 次</i>` : '';
        const tags = (task.question.tags || []).filter(tag => tag !== '系统预置');
        return `<tr><td class="mx-q"><strong>${reportEscape(String(task.question.title || '').replace(/\s*★\s*/u, ''))}</strong>${rerun}`
          + `<small>${reportEscape(task.question.category || '')}${tags.length ? ` · ${reportEscape(tags.join(' / '))}` : ''}</small></td>`
          + models.map(name => matrixCell(task.runs.find(run => (run.model.displayName || run.model.model || '') === name))).join('') + '</tr>';
      }).join('');

      const tabs = report.map((task, index) => {
        const ok = task.runs.filter(run => run.facts.status === 'succeeded').length;
        return `<button type="button" class="rtab" role="tab" data-tab="${index}" aria-selected="${index === 0}" aria-controls="rpanel-${index}">`
          + `<span class="rtab-i">${String(index + 1).padStart(2, '0')}</span>${reportEscape(String(task.question.title || '').replace(/\s*★\s*/u, ''))}<em>${ok}/${task.runs.length}</em></button>`;
      }).join('');

      const panels = report.map((task, index) => {
        const factRows = task.runs.map(run => {
          const facts = run.facts;
          const name = run.model.displayName || run.model.model || '';
          const status = facts.status === 'succeeded'
            ? '<span class="chip ok">已完成</span>'
            : `<span class="chip bad" title="${reportEscape(facts.error || '')}">失败</span>`;
          // A failed attempt that was continued by hand is not the same fact as one that
          // was abandoned. Say which, so a full artifact list under 失败 reads as the
          // continuation it is rather than as a contradiction.
          const continuedTag = facts.continued ? '<i class="tag" title="首次尝试中断后从卡片继续过，耗时与 token 含续跑部分">续</i>' : '';
          return `<tr><td class="c-model"><strong>${reportEscape(name)}</strong><small>${reportEscape(run.model.model || '')}</small></td>`
            + `<td>${status}${continuedTag}</td><td class="n strong">${reportDuration(facts.wallMs)}</td>`
            + `<td class="n">${reportSeconds(facts.llmMs)}</td><td class="n">${reportSeconds(facts.toolMs)}</td>`
            + `<td class="n">${facts.ttftAvg === null ? '—' : `${(facts.ttftAvg / 1000).toFixed(1)} 秒`}</td>`
            + `<td class="n"><b>${facts.tps === null ? '—' : facts.tps.toFixed(1)}</b></td>`
            + `<td class="n">${facts.steps === null ? '—' : `${facts.turns} 轮 ${facts.steps} 步`}</td>`
            + `<td class="n"><b>${reportTokens(facts.total)}</b><small class="buckets">${facts.hasStats ? `未缓存 ${reportTokens(facts.uncachedInput)} · 缓存读 ${reportTokens(facts.cacheRead)} · 输出 ${reportTokens(facts.output)}` : `未记录（${reportEscape(statsReasonText(facts.statsReason).short)}）`}</small></td>`
            + `<td class="n">${reportPercent(facts.cacheHit)}</td><td class="n">${reportPercent(facts.contextShare)}</td>`
            + `<td class="n small">${facts.asOfSeq === null ? '—' : `#${facts.asOfSeq}`}${facts.source === 'backfill' ? '<i class="tag">补</i>' : ''}</td></tr>`;
        }).join('');
        const cards = task.runs.map(run => {
          const name = run.model.displayName || run.model.model || '';
          const arts = run.facts.inline.filter(item => inlined[artifactKey(task.id, run.id, item.path)] !== undefined);
          // One stage per card, and only the first artifact gets it. A run can write
          // two pages (a shell and a scene, say); stacking both would make that one
          // card twice as tall and break the grid the comparison depends on, so the
          // rest stay reachable as preview buttons instead.
          const [first, ...extra] = arts;
          const stage = first
            ? `<article class="art" data-art="${reportEscape(artifactKey(task.id, run.id, first.path))}">`
              + `<header><code>${reportEscape(first.path)}</code><span class="mut small">${reportBytes(first.bytes)}</span>`
              + `<button type="button" class="btn sm preview" data-art="${reportEscape(artifactKey(task.id, run.id, first.path))}" data-name="${reportEscape(first.path)}" data-model="${reportEscape(name)}">弹窗预览</button></header>`
              + '<div class="art-stage"><div class="art-skel">滚动到此处即渲染</div></div></article>'
            : '';
          const more = extra.map(item => `<button type="button" class="file html preview" data-art="${reportEscape(artifactKey(task.id, run.id, item.path))}" data-name="${reportEscape(item.path)}" data-model="${reportEscape(name)}">${reportEscape(item.path)}<em>${reportBytes(item.bytes)}</em></button>`).join('');
          const listed = run.facts.listed.length
            ? `<div class="rb-rest"><span class="mut small">附带文件（不内联，仅登记）</span><div class="files">${run.facts.listed.map(item => `<span class="file">${reportEscape(item.path)}<em>${reportBytes(item.bytes)}</em></span>`).join('')}</div></div>`
            : '';
          const status = run.facts.status === 'succeeded' ? '<span class="chip ok">已完成</span>' : '<span class="chip bad">失败</span>'
            + (run.facts.continued ? '<i class="tag" title="首次尝试中断后从卡片继续过">续跑</i>' : '');
          return `<section class="runblock"><div class="rb-head"><strong>${reportEscape(name)}</strong>${status}`
            + `<span class="mut small">${reportDuration(run.facts.wallMs)} · ${run.facts.steps === null ? '—' : `${run.facts.steps} 步`} · ${reportTokens(run.facts.total)} token</span></div>`
            + (stage || `<p class="rb-empty mut small">这次运行没有可直接渲染的 HTML 产物。</p>`)
            + (more ? `<div class="files">${more}</div>` : '') + listed + '</section>';
        }).join('');
        return `<div class="rpanel" id="rpanel-${index}" role="tabpanel" data-panel="${index}"${index === 0 ? '' : ' hidden'}>`
          + `<div class="rubric"><b>判点</b>（题目快照原文）<p>${reportEscape(task.question.description || '这道题在保存时没有判读口径。')}</p></div>`
          + '<div class="scroll"><table class="facts"><thead><tr><th>模型</th><th>状态</th><th>总耗时</th><th>模型时间</th><th>工具时间</th><th>首 token</th><th>解码速度</th><th>轮 / 步</th><th>总 token</th><th>缓存命中</th><th>上下文占比</th><th>冻结位置</th></tr></thead>'
          + `<tbody>${factRows}</tbody></table></div>`
          + '<h4>产物 · 直接看效果</h4>'
          + '<p class="hint">产物已内联进本报告，离线也能运行。三个一行，一屏能同时看到多个模型的效果；只渲染视口内的，滚出去或切换题目即卸载。</p>'
          + `<div class="runblocks">${cards}</div></div>`;
      }).join('');

      const closed = '</' + 'script>';
      return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>测评报告 · ${report.length} 题 × ${models.length} 模型</title>
<style>
  :root{--page:#f5f6f8;--surface:#fff;--line:#e4e7ec;--ink:#1c2024;--mut:#6b7280;--cyan:#2579b9;--cyan-soft:#e7f4fb;
    --ok:#16865f;--ok-soft:#e6f5ee;--bad:#c25f4a;--bad-soft:#fbeceb;--sh:0 1px 2px rgba(15,20,25,.04)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1680px;margin:0 auto;padding:22px 28px 64px}
  .kicker{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.12em;color:var(--cyan)}
  .kicker i{width:6px;height:6px;border-radius:50%;background:var(--cyan)}
  h1{margin:6px 0 4px;font-size:20px;font-weight:700}
  .sub{color:var(--mut);font-size:13px}
  .top{border-bottom:1px solid var(--line);padding-bottom:14px}
  .notice{margin:16px 0 0;padding:11px 14px;border:1px solid var(--line);border-left:3px solid var(--cyan);border-radius:8px;background:var(--cyan-soft);font-size:12.5px;color:#243b4d}
  .l1{margin-top:18px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--sh)}
  .l1>h2{margin:0;padding:14px 16px 0;font-size:15px;font-weight:650;display:flex;align-items:center;gap:8px}
  .l1>h2::before{content:"";width:3px;height:15px;border-radius:2px;background:var(--cyan)}
  .body{padding:12px 16px 16px}
  .hint{color:var(--mut);font-size:12px;margin:2px 0 10px}
  .mut{color:var(--mut)} .small{font-size:11px}
  .scroll{overflow-x:auto}
  table{border-collapse:separate;border-spacing:0;font-size:13px;width:100%}
  th,td{text-align:left;padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}
  thead th{background:var(--surface);font-size:11px;letter-spacing:.05em;color:var(--mut);font-weight:700}
  td.n{font-variant-numeric:tabular-nums} td.n b{font-size:14px;font-weight:700} td.n small{color:var(--mut);font-weight:400}
  td.strong{font-weight:650} td.small{font-size:11px}
  td.c-model strong{display:block;font-size:13px;font-weight:650} td.c-model small{color:var(--mut);font-size:11px}
  .buckets{display:block;color:var(--mut);font-size:11px}
  .chip{display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:650}
  .chip.ok{background:var(--ok-soft);color:var(--ok)} .chip.bad{background:var(--bad-soft);color:var(--bad)}
  .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
  .dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)}
  .mx{table-layout:fixed}
  .mx th.mx-q,.mx td.mx-q{width:200px;white-space:normal} .mx th{width:auto}
  .mx td,.mx th{border-bottom:1px solid var(--line);border-right:1px solid #f0f1f3;padding:7px 9px}
  .mx td:last-child,.mx th:last-child{border-right:none}
  .mx .mx-cell{white-space:normal;font-variant-numeric:tabular-nums}
  .mx .mx-missing{color:#c8ccd2;text-align:center;background:#fcfcfd}
  .mx .mx-1{font-weight:650;font-size:12.5px} .mx .mx-2,.mx .mx-3{color:var(--mut);font-size:11px}
  .mx .mx-q strong{font-size:13px} .mx .mx-q small{display:block;color:var(--mut);font-size:11px}
  .rerun{font-style:normal;font-size:10px;font-weight:650;color:#8a6d1f;background:#fdf3d7;border-radius:4px;padding:1px 5px;margin-left:6px}
  .mx tr.mx-total td{background:#fafbfc;border-top:2px solid var(--line)} .mx tr.mx-total .mx-1{font-weight:700}
  .rtabs{display:flex;flex-wrap:wrap;gap:6px;padding:12px 16px 12px;border-bottom:1px solid var(--line)}
  .rtab{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--surface);border-radius:999px;
    padding:6px 12px;font-size:13px;cursor:pointer;color:var(--mut);white-space:nowrap}
  .rtab:hover{border-color:var(--cyan);color:var(--ink)}
  .rtab[aria-selected="true"]{background:var(--cyan);border-color:var(--cyan);color:#fff;font-weight:650}
  .rtab[aria-selected="true"] .rtab-i{background:rgba(255,255,255,.22);color:#fff}
  .rtab-i{font:700 10.5px/1 ui-monospace,Menlo,monospace;color:var(--cyan);background:var(--cyan-soft);border-radius:4px;padding:3px 5px}
  .rtab em{font-style:normal;font-size:10.5px;opacity:.8}
  .rpanel{padding:14px 16px 18px}
  .rpanel h4{margin:16px 0 4px;font-size:13px;font-weight:650}
  .rubric{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--page);font-size:12.5px;line-height:1.75;white-space:normal;margin-bottom:12px}
  .rubric p{margin:3px 0 0}
  /* Three per row so a question's models are read side by side; the comparison is the
     point, and a full-width stack never showed two results at once. align-items:start
     keeps a card without an artifact from being stretched to its neighbours' height. */
  .runblocks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start;margin-top:10px}
  @media(max-width:900px){.runblocks{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:620px){.runblocks{grid-template-columns:minmax(0,1fr)}}
  .runblock{border:1px solid var(--line);border-radius:9px;padding:10px 11px;background:var(--surface);min-width:0}
  .rb-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap} .rb-head strong{font-size:13px}
  .rb-empty{margin:4px 0 0;padding:16px 10px;color:var(--mut);font-size:11.5px;text-align:center}
  .art{margin-top:9px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--page)}
  .art header{display:flex;align-items:center;gap:9px;padding:7px 10px;background:var(--surface);border-bottom:1px solid var(--line);flex-wrap:wrap}
  .art header strong{font-size:12.5px}
  .art header code{font-size:11px;color:var(--mut);background:#f0f1f3;border-radius:4px;padding:1px 5px}
  .art header .preview{margin-left:auto}
  /* The stage follows the column instead of a fixed 430px: at a third of the width
     that height left most of the box empty, and the artifact is drawn to the width
     anyway, so the ratio is what keeps every card's picture the same shape. */
  .art-stage{position:relative;aspect-ratio:16/10;min-height:170px;background:#fff}
  .art-skel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#a3a8b0;font-size:12px}
  .art-frame{position:absolute;inset:0;width:100%;height:100%;border:0}
  .rb-rest{margin-top:9px;border-top:1px dashed var(--line);padding-top:8px}
  .files{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .file{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:7px;padding:4px 8px;font-size:11px;background:var(--surface);font-family:ui-monospace,Menlo,monospace;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .file em{font-style:normal;color:var(--mut);font-family:-apple-system,sans-serif}
  .file.html{cursor:pointer;color:var(--ink);font:inherit;font-size:11px;font-family:ui-monospace,Menlo,monospace}
  .file.html:hover{border-color:var(--cyan);box-shadow:0 2px 8px rgba(15,20,25,.08)}
  .btn{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;color:var(--ink)}
  .btn.sm{padding:3px 9px;font-size:11.5px;border-radius:6px}
  .btn:hover{border-color:var(--cyan)}
  #rmodal{position:fixed;inset:0;z-index:100;background:rgba(15,20,25,.72);display:none;align-items:center;justify-content:center;padding:26px}
  #rmodal.on{display:flex}
  #rmodal .box{background:var(--surface);border-radius:10px;width:min(1400px,95vw);height:min(900px,92vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.4)}
  #rmodal header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)}
  #rmodal header strong{font-size:13px}
  #rmodal header code{font-size:11.5px;color:var(--mut);background:#f0f1f3;border-radius:4px;padding:2px 6px}
  #rmodal .x{margin-left:auto;border:1px solid var(--line);background:var(--surface);border-radius:7px;padding:4px 11px;cursor:pointer;font-size:12px}
  #rmodal .stage{flex:1;position:relative;background:#fff}
  footer.foot{margin-top:22px;color:var(--mut);font-size:11.5px;line-height:1.9;border-top:1px solid var(--line);padding-top:14px}
  footer.foot b{color:var(--ink)}
  code.k{background:#f0f1f3;border-radius:4px;padding:1px 5px;font-size:11.5px}
  /* A one-character qualifier on a figure — 补 for a late read, 续 for a continued run.
     Deliberately small and quiet: it changes how a number is read, not what it says.
     A report is a self-contained light document, so this uses its own tokens. */
  i.tag{display:inline-block;margin-left:3px;padding:0 3px;border-radius:3px;background:var(--cyan-soft);color:var(--cyan);font-size:9.5px;font-style:normal;line-height:14px;vertical-align:1px;cursor:help}
  .reasons{margin-top:9px;padding-top:8px;border-top:1px dashed rgba(36,59,77,.25);font-size:12px}
  .reasons ul{margin:4px 0 0;padding-left:18px}
  .reasons li{margin:2px 0}
  .reasons .advice{color:#1f5c85;font-weight:650}
</style></head>
<body><div class="wrap">
  <div class="top">
    <div class="kicker"><i></i>测评档案 · 模型博主测评</div>
    <h1>测评报告 · ${report.length} 道题 × ${models.length} 个模型</h1>
    <div class="sub">${reportEscape(reportStamp(report[0]?.createdAt))} 起 · ${runs.length} 次运行 · 内联产物 ${inlinedCount} 个（${reportBytes(inlinedBytes)}）</div>
  </div>

  <div class="notice">
    <b>事实报告，不含评分与排名。</b>数字取自宿主 <code class="k">sessionStats</code> / <code class="k">tokenUsage</code> / <code class="k">contextPressure</code> 投影，冻结在每次运行结束时刻
    （<code class="k">asOfSeq</code>，标 <i class="tag">补</i> 的是旧任务事后补读的）。矩阵不排序、不做热力着色，颜色只表达成功/失败。<br>
    产物已内联进本文件，离线可运行；另有 ${listedCount} 个附带文件（${reportBytes(listedBytes)}）只登记名称与体积。<b>缺失格显示 —，不是失败。</b>
    ${reasonNotes.length ? `<div class="reasons">
      <b>有 ${withoutFigures.length} 次运行没有耗时与 token 记录</b>，原因和能不能补是两回事：
      <ul>${reasonNotes.map(note => `<li>${reportEscape(note.long)}（${note.count} 次）—— <span class="advice">${reportEscape(note.advice)}</span></li>`).join('')}</ul>
    </div>` : ''}
  </div>

  <section class="l1"><h2>总览矩阵 · ${report.length} 题 × ${models.length} 模型</h2><div class="body">
    <p class="hint">合计行只是把同一模型的事实相加，<b>不是得分，也不能用来排名</b>。模型集合不同的任务并排时，缺失格为 —${missing ? `（本报告共 ${missing} 个）` : ''}。</p>
    <div class="scroll"><table class="mx">
      <thead><tr><th class="mx-q">题目</th>${models.map(name => `<th>${reportEscape(name)}</th>`).join('')}</tr></thead>
      <tbody>${matrixRows}
      <tr class="mx-total"><td class="mx-q"><strong>${report.length} 题合计</strong><small>事实相加，不是得分</small></td>
      ${totals.map(item => `<td class="mx-cell"><div class="mx-1">${reportDuration(item.wall)}</div><div class="mx-2">产物 ${item.artifacts} · ${item.steps} 步</div><div class="mx-3">${reportTokens(item.tokens)} token${item.failed ? ` · 失败 ${item.failed}` : ''}</div></td>`).join('')}
      </tr></tbody>
    </table></div>
  </div></section>

  <section class="l1"><h2>分题明细</h2>
    <div class="rtabs" role="tablist">${tabs}</div>
    ${panels}
  </section>

  <footer class="foot">
    <b>口径</b><br>
    · <b>总耗时</b> = 运行开始 → 结束，含工具执行与排队，不等于模型思考时间。· <b>模型时间 / 工具时间</b> = <code class="k">sessionStats.llmMs / toolMs</code>。<br>
    · <b>首 token</b> = <code class="k">ttftMs / ttftSteps</code>。· <b>解码速度</b> = <code class="k">decodeTokens / decodeMs</code>，纯解码，不含排队、首 token 与工具。<br>
    · <b>轮 / 步</b> 数的是 <code class="k">step/end</code>，含失败与取消的步骤。· <b>总 token</b> = 未缓存输入 + 缓存读 + 缓存写 + 输出；<b>缓存命中</b>分母是前三个 prompt 桶之和。<br>
    · <b>上下文占比</b> = <code class="k">contextPressure.pressureTokens / contextWindow</code>，是最近一次请求的估算压力。· <b>冻结位置</b> = <code class="k">asOfSeq</code>。<br>
    · <b>续跑计入</b>：统计是整段会话的累计，含中断后从卡片继续的轮次（如首发响应被服务商限流后手动发「请继续」），带 <i class="tag">续</i> 标的运行即属此列。一次跑完的会话只有一个位置，续跑过的会跨越多个；<b>冻结位置</b>即这份数字读到的会话日志位置。续跑过的运行，回答快照仍是首次结束时的记录，可能短于统计覆盖的轮次。<br>
    · <b>状态</b>取首次尝试的回合结束原因：正常结束记「已完成」，被限流 / 报错 / 输出截断记「失败」（即使已产出部分文字也如此），用户主动停止记「已取消」。因此「失败 + 续」表示首次尝试失败、之后人工续跑完成，其耗时与 token 含续跑部分。<br>
    · <b>产物渲染</b>在沙箱 iframe 内（仅 <code class="k">allow-scripts</code>，不给 same-origin），产物之间互不可见，也访问不到本报告。
  </footer>
</div>

<div id="rmodal"><div class="box">
  <header><strong id="rm-model"></strong><code id="rm-name"></code><button class="x" type="button" id="rm-close">关闭</button></header>
  <div class="stage" id="rm-stage"></div>
</div></div>

<script type="application/json" id="rart">${JSON.stringify(inlined).replace(/</gu, '\\u003c')}</script>
<script>
(function () {
  var ART = JSON.parse(document.getElementById('rart').textContent);
  function decode(b64) {
    var bytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    return new TextDecoder('utf-8').decode(bytes);
  }
  function makeFrame(b64) {
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    f.className = 'art-frame';
    f.srcdoc = decode(b64);
    return f;
  }
  function mount(card) {
    if (card.querySelector('iframe')) return;
    var b64 = ART[card.dataset.art];
    if (!b64) return;
    var skel = card.querySelector('.art-skel');
    if (skel) skel.remove();
    card.querySelector('.art-stage').appendChild(makeFrame(b64));
  }
  function unmount(card) {
    var f = card.querySelector('iframe');
    if (f) f.remove();
    if (!card.querySelector('.art-skel')) {
      var s = document.createElement('div');
      s.className = 'art-skel';
      s.textContent = '已卸载（滚动到此处重新渲染）';
      card.querySelector('.art-stage').appendChild(s);
    }
  }
  function cards(panel) { return [].slice.call(panel.querySelectorAll('.art')); }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var card = entry.target, panel = card.closest('.rpanel');
      if (!panel || panel.hidden) return;
      if (entry.isIntersecting) mount(card); else unmount(card);
    });
  // A third of the width means three artifacts are on screen at once, so the margin
  // only has to cover the row about to scroll in — not a whole extra screen of them.
  }, { rootMargin: '120px 0px' });
  [].forEach.call(document.querySelectorAll('.art'), function (card) { io.observe(card); });

  var tabs = [].slice.call(document.querySelectorAll('.rtab'));
  function select(index) {
    tabs.forEach(function (tab, at) { tab.setAttribute('aria-selected', String(at === index)); });
    [].forEach.call(document.querySelectorAll('.rpanel'), function (panel, at) {
      if (at === index) panel.hidden = false;
      else { panel.hidden = true; cards(panel).forEach(unmount); }
    });
    cards(document.getElementById('rpanel-' + index)).forEach(function (card) {
      var box = card.getBoundingClientRect();
      if (box.top < window.innerHeight + 250 && box.bottom > -250) mount(card);
    });
  }
  tabs.forEach(function (tab) { tab.addEventListener('click', function () { select(Number(tab.dataset.tab)); }); });
  var rail = document.querySelector('.rtabs');
  rail.addEventListener('keydown', function (event) {
    var at = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { select((at + 1) % tabs.length); tabs[(at + 1) % tabs.length].focus(); event.preventDefault(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { select((at - 1 + tabs.length) % tabs.length); tabs[(at - 1 + tabs.length) % tabs.length].focus(); event.preventDefault(); }
  });

  var modal = document.getElementById('rmodal');
  function openModal(b64, name, model) {
    document.getElementById('rm-name').textContent = name;
    document.getElementById('rm-model').textContent = model;
    var stage = document.getElementById('rm-stage');
    stage.innerHTML = '';
    stage.appendChild(makeFrame(b64));
    modal.classList.add('on');
  }
  function closeModal() { modal.classList.remove('on'); document.getElementById('rm-stage').innerHTML = ''; }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('.preview');
    if (button) { openModal(ART[button.dataset.art], button.dataset.name, button.dataset.model); return; }
    if (event.target === modal || event.target.id === 'rm-close') closeModal();
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && modal.classList.contains('on')) closeModal(); });
})();
${closed}
</body></html>`;
    };
    /**
     * Route id to display name.
     *
     * A run snapshot freezes only the route id, and the catalog is the only
     * authority on how that route is called, so the name is learned whenever the
     * evaluation page reads the catalog and remembered for the session. A cold
     * start straight into the history page shows the raw route id instead of a
     * name that may since have been renamed — the stored snapshot is not a claim
     * about the current catalog.
     */
    const providerLabels = {};
    const providerLabel = id => providerLabels[id] || id;
    const rememberProviders = groups => {
      for (const group of groups || []) if (group?.id && group.name) providerLabels[group.id] = group.name;
    };
    /** Per-question usage across the saved tasks: count and most recent run. */
    const usageOf = tasks => {
      const map = new Map();
      for (const task of tasks || []) {
        const id = task?.question?.id;
        if (!id) continue;
        const entry = map.get(id) || { count: 0, lastAt: '' };
        entry.count += 1;
        if (String(task.createdAt || '') > entry.lastAt) entry.lastAt = task.createdAt;
        map.set(id, entry);
      }
      return map;
    };
    /**
     * A question chosen on another page, handed to the evaluation page.
     *
     * The shell owns navigation between pack menus, so this pack cannot jump
     * pages by itself; the pages only agree on "the next evaluation should start
     * from this question (and these models)". It lives at module scope because
     * the shell remounts every page on each menu switch.
     */
    const pending = { questionId: '', models: null, source: '' };
    const setPending = (questionId, models, source) => {
      pending.questionId = questionId || '';
      pending.models = Array.isArray(models) && models.length ? models : null;
      pending.source = source || '';
    };

    function Notice({ error }) { return error ? h('p', { className: 'mr-error', role: 'alert' }, error) : null; }
    function Chip({ children, tone }) { return h('span', { className: 'mr-chip', 'data-tone': tone }, children); }
    function Empty({ glyph, title, copy, action }) {
      return h('div', { className: 'mr-empty' },
        glyph ? h('span', { className: 'mr-empty-glyph', 'aria-hidden': 'true' }, glyph) : null,
        title ? h('strong', null, title) : null,
        copy ? h('p', null, copy) : null,
        action || null);
    }
    function Loading({ rows = 3 }) {
      return h('div', { className: 'mr-skeleton', role: 'status', 'aria-label': '正在读取数据' },
        Array.from({ length: rows }, (_, index) => h('i', { key: index })));
    }
    function StatBar({ items }) {
      return h('div', { className: 'mr-stat' }, items.filter(Boolean).map(item => h('div', { key: item.label, className: 'mr-stat-item' },
        h('b', item.tone ? { 'data-tone': item.tone } : null, item.value),
        h('span', null, item.label))));
    }
    function Segment({ value, options, onChange, label }) {
      return h('div', { className: 'mr-seg', role: 'group', 'aria-label': label }, options.map(option =>
        h('button', { key: option.value, type: 'button', 'data-on': value === option.value ? 'true' : 'false', onClick: () => onChange(option.value) }, option.label)));
    }
    function Frame({ tone, kicker, title, subtitle, actions, rootRef, children }) {
      return h('div', { className: 'mr-page', 'data-tone': tone, ref: rootRef }, h('style', null, css),
        h('header', { className: 'mr-top' },
          h('div', { className: 'mr-top-copy' },
            kicker ? h('p', { className: 'mr-kicker' }, h('i', { 'aria-hidden': 'true' }), kicker) : null,
            h('h1', null, title),
            subtitle ? h('p', { className: 'mr-muted' }, subtitle) : null),
          actions ? h('div', { className: 'mr-top-actions' }, actions) : null),
        children);
    }
    function Drawer({ title, subtitle, wide, onClose, children, footer }) {
      React.useEffect(() => {
        const onKey = event => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h(React.Fragment, null,
        h('div', { className: 'mr-drawer-backdrop', onClick: onClose, 'aria-hidden': true }),
        h('aside', { className: 'mr-drawer', 'data-wide': wide ? 'true' : 'false', role: 'dialog', 'aria-modal': true, 'aria-label': title },
          h('div', { className: 'mr-drawer-head' },
            h('div', { className: 'mr-top-copy' }, h('h2', null, title), subtitle ? h('p', { className: 'mr-muted' }, subtitle) : null),
            h('button', { className: 'mr-icon', title: '关闭', 'aria-label': '关闭', onClick: onClose }, '×')),
          h('div', { className: 'mr-drawer-body' }, children),
          footer ? h('div', { className: 'mr-drawer-foot' }, footer) : null));
    }

    /**
     * Asking once before work that cannot be taken back.
     *
     * Starting an evaluation calls every selected model and records usage, and it
     * never interrupts a task that is already running: the models answer anyway.
     * That makes the click the last point at which the page can still ask, so the
     * dialog repeats what will be sent, and — when the host is still working on an
     * earlier task — says so in the same breath, in the shape the AI arena uses.
     *
     * Escape, the × and 取消 are the ways out; a click on the backdrop is not one.
     * The backdrop covers the very button that opened this, so the second click of
     * a double click would otherwise open and then instantly dismiss the question.
     */
    function ConfirmDialog({ title, description, notice, summary, confirmLabel, onResult, opener }) {
      const card = React.useRef(null);
      React.useEffect(() => {
        const element = card.current;
        if (element?.focus) element.focus();
        return () => { if (opener?.focus) opener.focus(); };
      }, []);
      React.useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') { onResult(false); return; }
          if (event.key !== 'Tab') return;
          // Tab stays inside the dialog: the page behind it is not part of this
          // answer, and focus wandering there would silently drop the question.
          // The dialog itself takes focus when it opens, so that starting point
          // is part of the cycle rather than something Tab can leave from.
          const stops = card.current ? [...card.current.querySelectorAll('button:not(:disabled)')] : [];
          const first = stops[0], last = stops.at(-1);
          if (!first || !last) return;
          const at = stops.indexOf(document.activeElement);
          event.preventDefault();
          if (event.shiftKey) (at <= 0 ? last : stops[at - 1]).focus();
          else (at === -1 || at === stops.length - 1 ? first : stops[at + 1]).focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onResult]);
      return h(React.Fragment, null,
        h('div', { className: 'mr-confirm-backdrop', 'aria-hidden': true }),
        h('div', { className: 'mr-confirm', role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref: card },
          h('div', { className: 'mr-confirm-head' },
            h('h2', null, title),
            h('button', { className: 'mr-icon', type: 'button', title: '取消', 'aria-label': '取消', onClick: () => onResult(false) }, '×')),
          h('p', { className: 'mr-confirm-copy' }, description),
          notice ? h('p', { className: 'mr-confirm-notice', role: 'status' }, notice) : null,
          summary?.length ? h('dl', { className: 'mr-confirm-summary' }, summary.map((row, index) =>
            h('div', { key: index, className: 'mr-confirm-row' }, h('dt', null, row.label), h('dd', null, row.value)))) : null,
          h('div', { className: 'mr-confirm-actions' },
            h('button', { className: 'mr-button', type: 'button', onClick: () => onResult(false) }, '取消'),
            h('button', { className: 'mr-button primary', type: 'button', onClick: () => onResult(true) }, confirmLabel))));
    }

    /**
     * `confirm(options)` is a promise the caller awaits; the node goes wherever the
     * page already renders its overlays. A second request while one is pending is
     * answered `false` instead of stacking a second dialog.
     */
    function useConfirm() {
      const [request, setRequest] = React.useState(null);
      const pending = React.useRef(null);
      React.useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
      const confirm = options => {
        if (pending.current) return Promise.resolve(false);
        return new Promise(resolve => { pending.current = resolve; setRequest({ ...options, opener: document.activeElement }); });
      };
      const finish = result => { const resolve = pending.current; pending.current = null; setRequest(null); resolve?.(result); };
      return [confirm, request ? h(ConfirmDialog, { ...request, onResult: finish }) : null];
    }

    /**
     * One question, as a pick row or as a bank row: same shape, one component.
     *
     * The row carries no actions of its own: a row is a way into the question,
     * and every action on it lives in the drawer that clicking it opens.
     */
    function QuestionRow({ question, active, usage, mode, onSelect }) {
      const info = usage?.get(question.id);
      const tags = (question.tags || []).filter(tag => tag && tag !== '系统预置' && tag !== question.category);
      const sub = [question.category || '未分类', ...(mode === 'bank' ? tags.slice(0, 2) : [])].filter(Boolean);
      return h('div', { className: 'mr-qrow', 'data-active': active ? 'true' : 'false' },
        h('button', { className: 'mr-qrow-hit', type: 'button', 'aria-pressed': active ? 'true' : 'false',
          onClick: () => onSelect?.(question) },
          h('div', { className: 'mr-qrow-main' },
            h('div', { className: 'mr-qrow-title' }, h('strong', null, question.title),
              question.status === 'archived' ? h(Chip, { tone: 'neutral' }, '已归档') : null,
              mode === 'bank' && tags.length > 2 ? h(Chip, { tone: 'neutral' }, `+${tags.length - 2}`) : null),
            h('div', { className: 'mr-qrow-sub' },
              sub.map(item => h('span', { key: item }, item)),
              mode === 'bank' ? h('span', null, `v${question.version}`) : null)),
          h('div', { className: 'mr-qrow-side' },
            h('span', { className: 'mr-num' }, info?.count ? `使用 ${info.count} 次` : '未使用'),
            h('span', { className: 'mr-num' }, relative(info?.lastAt || question.updatedAt)))));
    }

    /**
     * The question filters, on one line.
     *
     * Search and status are the two that decide which questions exist for the
     * reader; anything a page wants beside them (the bank's sort order) is
     * passed as a child so the line never grows a second row.
     */
    function QuestionFilters({ query, setQuery, status, setStatus, statusOptions, children }) {
      return h('div', { className: 'mr-toolbar-row' },
        h('input', { className: 'mr-input', 'aria-label': '搜索题目', placeholder: '搜索标题、标签或提示词', value: query, onChange: event => setQuery(event.target.value) }),
        statusOptions ? h(Segment, { value: status, options: statusOptions, onChange: setStatus, label: '题目状态' }) : null,
        children);
    }

    /** The question side of the setup panel: search, list, prompt. */
    function QuestionPicker({ questions, usage, value, onChange, onEdit, onOpenBank }) {
      const [query, setQuery] = React.useState('');
      const filtered = questions.filter(question =>
        !query.trim() || [question.title, question.prompt, question.description, ...(question.tags || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
      const shown = filtered.slice(0, 8);
      const current = questions.find(question => question.id === value);
      return h('div', { className: 'mr-picker' },
        h(QuestionFilters, { query, setQuery }),
        shown.length
          ? h('div', { className: 'mr-picker-list', role: 'listbox', 'aria-label': '题目列表' }, shown.map(question =>
            h(QuestionRow, { key: question.id, question, active: question.id === value, usage, mode: 'pick', onSelect: () => onChange(question.id) })))
          : h('p', { className: 'mr-muted' }, '当前筛选条件下没有题目。'),
        onOpenBank && questions.length > 8 ? h('div', null,
          h('button', { className: 'mr-button emphasis', type: 'button', onClick: onOpenBank }, `查看更多题目（${questions.length}）→`)) : null,
        current
          ? h('div', null,
            h('div', { className: 'mr-row-head' },
              h('span', { className: 'mr-label', style: { marginBottom: 0 } }, '本次发送的提示词'),
              h('div', { className: 'mr-actions' },
                h('button', { className: 'mr-button ghost', type: 'button', onClick: () => void navigator.clipboard?.writeText(current.prompt || '').catch(() => {}) }, '复制'),
                onEdit ? h('button', { className: 'mr-button ghost', type: 'button', onClick: () => onEdit(current) }, '编辑') : null)),
            h('div', { className: 'mr-prompt-box' }, h('div', { className: 'mr-prompt' }, current.prompt)))
          : h('p', { className: 'mr-muted' }, '请选择一道题目。'));
    }

    /** Every question, filtered — the escape hatch once a bank outgrows the picker. */
    function QuestionDrawer({ questions, usage, value, onPick, onClose }) {
      const [query, setQuery] = React.useState('');
      const [status, setStatus] = React.useState('active');
      const filtered = questions.filter(question => (status === 'all' || question.status === status) &&
        (!query.trim() || [question.title, question.prompt, question.description, ...(question.tags || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
      return h(Drawer, { title: '全部题目', subtitle: `共 ${filtered.length} 道`, onClose,
        footer: h('button', { className: 'mr-button', onClick: onClose }, '关闭') },
        h(QuestionFilters, { query, setQuery, status, setStatus,
          statusOptions: [{ value: 'active', label: '启用中' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }] }),
        filtered.length
          ? h('div', { className: 'mr-picker-list', role: 'listbox', 'aria-label': '全部题目' }, filtered.map(question =>
            h(QuestionRow, { key: question.id, question, active: question.id === value, usage, mode: 'pick', onSelect: () => { onPick(question.id); onClose(); } })))
          : h(Empty, { glyph: '题', title: '没有符合条件的题目', copy: '换个关键词或状态试试。' }));
    }

    /**
     * One question's detail, in the drawer a row click opens.
     *
     * The bank page is a list and nothing else; everything that can be done with
     * a question — start from it, edit it, archive it, delete it — is here, next
     * to the full prompt it applies to.
     */
    function QuestionDetailDrawer({ question, usage, busy, deleting, confirming, error, onClose, onEdit, onStart, onArchive, onRestore, onAskDelete, onCancelDelete, onDelete }) {
      const info = usage?.get(question.id);
      const tags = (question.tags || []).filter(tag => tag && tag !== '系统预置' && tag !== question.category);
      const prompt = question.prompt || '';
      const archived = question.status !== 'active';
      const footer = confirming
        ? [
          h('span', { key: 'warn', className: 'mr-danger-note' }, '删除后无法恢复；已保存的历史任务不受影响。'),
          h('button', { key: 'cancel', className: 'mr-button', disabled: deleting, onClick: onCancelDelete }, '取消'),
          h('button', { key: 'delete', className: 'mr-button danger', disabled: deleting, onClick: onDelete }, deleting ? '删除中…' : '确认删除'),
        ]
        : [
          h('button', { key: 'start', className: 'mr-button primary', onClick: onStart }, '以此题开始测评 →'),
          h('button', { key: 'edit', className: 'mr-button', onClick: onEdit }, '编辑题目'),
          archived
            ? h('button', { key: 'restore', className: 'mr-button', disabled: busy, onClick: onRestore }, busy ? '恢复中…' : '恢复题目')
            : h('button', { key: 'archive', className: 'mr-button', disabled: busy, onClick: onArchive }, busy ? '归档中…' : '归档题目'),
          h('button', { key: 'remove', className: 'mr-button danger', disabled: busy, onClick: onAskDelete }, '删除题目'),
        ];
      return h(Drawer, { title: question.title, subtitle: archived ? '已归档题目：不会再出现在开始测评的候选题里' : '启用中题目：可以在开始测评里直接使用', onClose, footer },
        h(Notice, { error }),
        h('div', { className: 'mr-detail-meta' },
          h(Chip, { tone: archived ? 'neutral' : 'success' }, archived ? '已归档' : '启用中'),
          h('span', null, question.category || '未分类'),
          h('span', null, `版本 v${question.version}`),
          h('span', null, info?.count ? `使用 ${info.count} 次` : '尚未使用'),
          h('span', null, `更新于 ${relative(question.updatedAt)}`)),
        tags.length ? h('div', { className: 'mr-actions' }, tags.map(tag => h(Chip, { key: tag, tone: 'neutral' }, tag))) : null,
        question.description ? h('p', { className: 'mr-muted' }, question.description) : null,
        h('div', null,
          h('div', { className: 'mr-row-head' },
            h('span', { className: 'mr-label', style: { marginBottom: 0 } }, '完整提示词'),
            h('div', { className: 'mr-actions' },
              h('span', { className: 'mr-num' }, `${prompt.length} 字`),
              h('button', { className: 'mr-button ghost', onClick: () => void navigator.clipboard?.writeText(prompt).catch(() => {}) }, '复制'))),
          h('div', { className: 'mr-prompt-box' }, h('div', { className: 'mr-prompt' }, prompt))));
    }

    /**
     * Model selection, grouped by the route the host reports.
     *
     * The API already answers per provider; flattening that into one grid lost
     * the group boundary, the availability of a route and the per-group count.
     * Rows are 34px so twenty models stay a panel, not a wall.
     */
    function ModelPicker({ groups, selected, onToggle, onClear }) {
      const total = groups.reduce((count, group) => count + (group.models || []).length, 0);
      const [query, setQuery] = React.useState('');
      const firstOpen = groups[0]?.id || '';
      const [open, setOpen] = React.useState(() => new Set(firstOpen ? [firstOpen] : []));
      const searching = query.trim().length > 0;
      const term = query.trim().toLowerCase();
      const chosen = new Set(selected.map(item => modelKey(item.provider, item.model)));
      const isOpen = id => searching || open.has(id);
      const toggleGroup = id => setOpen(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      const rows = group => (group.models || []).filter(model => !searching ||
        [model.name, model.id, group.name, group.id].filter(Boolean).join(' ').toLowerCase().includes(term));
      const visible = groups.filter(group => searching ? rows(group).length > 0 : true);
      return h('div', { className: 'mr-picker' },
        h('div', { className: 'mr-toolbar-row', style: { justifyContent: 'space-between' } },
          h('span', { className: 'mr-muted' }, `已选 ${selected.length} 个模型`),
          h('div', { className: 'mr-actions' },
            total > 12 ? h('input', { className: 'mr-input', style: { maxWidth: '190px' }, 'aria-label': '搜索模型', placeholder: '搜索模型', value: query, onChange: event => setQuery(event.target.value) }) : null,
            h('button', { className: 'mr-button ghost', type: 'button', disabled: !selected.length, onClick: onClear }, '清空'))),
        visible.length
          ? h('div', { className: 'mr-mgroups' }, visible.map(group => {
            const models = rows(group);
            const members = (group.models || []).length;
            const picked = (group.models || []).filter(model => chosen.has(modelKey(group.id, model.id))).length;
            return h('section', { key: group.id, className: 'mr-mgroup', 'data-open': isOpen(group.id) ? 'true' : 'false' },
              h('button', { className: 'mr-mgroup-head', type: 'button', 'aria-expanded': isOpen(group.id) ? 'true' : 'false', onClick: () => toggleGroup(group.id) },
                h('i', { 'aria-hidden': 'true' }),
                h('b', { title: group.name || group.id }, group.name || group.id),
                h('span', { className: 'mr-num' }, `${members} 个${picked ? ` · 已选 ${picked}` : ''}`)),
              isOpen(group.id) ? h('div', { className: 'mr-mgroup-body' }, models.map(model => {
                const key = modelKey(group.id, model.id);
                const on = chosen.has(key);
                return h('label', { key, className: 'mr-mrow', 'data-on': on ? 'true' : 'false' },
                  h('input', { type: 'checkbox', checked: on, onChange: () => onToggle(model, group) }),
                  h('span', { className: 'mr-mrow-main' },
                    h('strong', { title: model.name || model.id }, model.name || model.id),
                    model.name && model.name !== model.id ? h('small', null, model.id) : null),
                  on ? h(Chip, { tone: 'info' }, '已选') : null);
              })) : null);
          }))
          : h(Empty, { glyph: '模', title: '没有匹配的模型', copy: '换个关键词，或在「设置 → 模型」中检查模型服务配置。' }));
    }

    /** Per-run comparison: state, cost in time, answer size and the saved snapshot. */
    function RunSummaryBar({ task, onCompare }) {
      const runs = task?.runs || [];
      const succeeded = runs.filter(run => run.status === 'succeeded').length;
      const failed = runs.filter(run => run.status === 'failed').length;
      const live = runs.some(run => ['queued', 'running'].includes(run.status));
      const now = useNow(live);
      const comparable = runs.some(run => answerChars(run.answer) > 0);
      return h('div', { className: 'mr-summary' },
        h('div', { className: 'mr-summary-left' },
          h('div', { className: 'mr-summary-dots' }, runs.map(run => h('i', { key: run.id, className: 'mr-dot', 'data-status': run.status,
            title: `${run.model.displayName || run.model.model} · ${statusText(run.status)}` }))),
          h('span', { className: 'mr-summary-text' },
            `${runs.length} 个模型 · 已完成 ${succeeded}/${runs.length}${failed ? ` · ${failed} 个失败` : ''} · 总用时 ${durationText(taskDuration(task))}${live ? '（进行中）' : ''}`)),
        h('button', { className: 'mr-button', type: 'button', disabled: !comparable, onClick: onCompare },
          comparable ? '并排对比回答快照' : '暂无回答快照'));
    }

    function AnswerCompareDrawer({ task, onClose }) {
      const runs = task?.runs || [];
      return h(Drawer, { wide: true, title: `回答快照对比 · ${task?.question?.title || ''}`,
        subtitle: '运行结束时的记录，用于并排阅读；会话本身仍在各自的卡片里',
        onClose, footer: h('button', { className: 'mr-button', onClick: onClose }, '关闭') },
        h('div', { className: 'mr-compare' }, runs.map(run => {
          const text = answerText(run.answer);
          return h('article', { key: run.id, className: 'mr-compare-col', 'data-status': run.status },
            h('header', null,
              h('strong', { title: run.model.displayName || run.model.model }, run.model.displayName || run.model.model),
              h(Chip, { tone: statusTone(run.status) }, statusText(run.status))),
            h('div', { className: 'mr-compare-meta' },
              h('span', null, run.completedAt ? `耗时 ${durationText(runDuration(run))}` : `已用 ${durationText(runDuration(run))}`),
              h('span', null, text ? charText(text.length) : '无回答'),
              h('span', null, `产物 ${(run.artifacts || []).length}`)),
            text ? h('div', { className: 'mr-compare-text' }, text) : h('p', { className: 'mr-muted' }, '本次运行没有保存回答快照。'),
            run.error ? h('p', { className: 'mr-run-error' }, run.error) : null);
        })),
        h('p', { className: 'mr-compare-note' }, '快照是运行结束时的记录；之后在卡片里继续对话不会再更新这份快照。点卡片可回到该模型的会话。'));
    }

    /**
     * One model's result: the official conversation for its own Session — real
     * answer, tool calls, file chips and composer — plus this Session's run
     * record. Focusing the card points the frame at that Session, so the
     * official right Sidebar (artifacts, files, terminal, plugins, shortcuts)
     * follows whichever model the user is working in.
     *
     * Each Session has one editor. The host keeps the frame's main Conversation
     * content unmounted while these cards are present, without changing the
     * main panel selection that the official right Sidebar follows.
     */
    function RunCard({ task, run, renderConversation, focusSession, onFocus, active }) {
      const recorded = run.artifacts || [];
      const index = task.runs.indexOf(run);
      const letter = index >= 0 ? (index < 26 ? String.fromCharCode(65 + index) : String(index + 1)) : '·';
      const live = ['queued', 'running'].includes(run.status);
      const now = useNow(live);
      const chars = answerChars(run.answer);
      const focus = (event) => {
        if (!run.sessionId) return;
        onFocus?.(run.id);
        // Host controls select their Session when executing the requested action.
        if (event?.target?.closest?.('[data-lwb-session-control]')) return;
        focusSession?.(run.sessionId);
      };
      return h('article', {
        className: 'mr-run', 'data-status': run.status, 'data-active': active ? 'true' : 'false',
        onPointerDownCapture: focus, onFocusCapture: focus,
      },
        h('i', { className: 'mr-run-stripe', 'aria-hidden': 'true' }),
        h('div', { className: 'mr-run-head' },
          h('span', { className: 'mr-run-letter', 'data-status': run.status, 'aria-hidden': 'true' }, letter),
          h('div', { className: 'mr-run-title' },
            h('strong', { title: run.model.displayName || run.model.model }, run.model.displayName || run.model.model),
            h('span', null, [providerLabel(run.model.provider), run.model.model].filter(Boolean).join(' · '))),
          h('div', { className: 'mr-run-meta' },
            recorded.length > 0 && h(Chip, { tone: 'neutral' }, `记录 ${recorded.length} 个产物`),
            chars > 0 && h('span', { className: 'mr-num' }, charText(chars)),
            h('span', { className: 'mr-num' }, runDurationText(run, now)),
            h(Chip, { tone: statusTone(run.status) }, statusText(run.status)))),
        run.error && h('p', { className: 'mr-run-error', role: 'alert' }, run.error),
        run.sessionId && renderConversation
          ? h('div', { className: 'mr-conversation' }, renderConversation({ sessionId: run.sessionId }))
          : h('div', { className: 'mr-conversation-state' },
            run.status === 'failed' ? '本次会话没有启动成功。'
              : run.status === 'succeeded' ? '这条历史任务没有保存会话标识，无法回看对话过程。'
                : '正在创建会话…'),
        !run.sessionId && recorded.length > 0 && h('div', { className: 'mr-artifacts' }, recorded.map(item => h('div', { className: 'mr-artifact', key: item.path },
          h('code', { title: item.path }, item.path), h('span', null, bytesText(item.bytes))))));
    }
    function RunGrid({ task, renderConversation, focusSession, autoFocusRunId }) {
      const [activeRunId, setActiveRunId] = React.useState('');
      React.useEffect(() => {
        if (autoFocusRunId) setActiveRunId(previous => previous || autoFocusRunId);
      }, [autoFocusRunId]);
      const count = task.runs.length || 1;
      return h('div', { className: 'mr-run-grid', 'data-count': String(count) },
        task.runs.map(run => h(RunCard, {
          key: run.id, task, run, renderConversation, focusSession,
          active: activeRunId === run.id,
          onFocus: setActiveRunId,
        })));
    }
    /** Point the frame at the first run that has a Session, once per task. */
    function useAutoFocus(task, focusSession) {
      const focused = React.useRef('');
      const [runId, setRunId] = React.useState('');
      React.useEffect(() => {
        if (!task || focused.current === task.id || !focusSession) return;
        const run = task.runs.find(item => item.sessionId);
        if (!run) return;
        focused.current = task.id;
        setRunId(run.id);
        focusSession(run.sessionId);
      }, [task, focusSession]);
      return runId;
    }
    /** The nearest ancestor that scrolls — where a page's leftover height lives. */
    function scrollViewport(element) {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
      }
      return null;
    }
    /**
     * Hand a scrolling list whatever height the host's scroll viewport has left.
     *
     * The shell gives a capability page exactly one scroll container (its overlay body:
     * flex:1, min-height:0, overflow:auto) and mounts the page inside a plain wrapper div
     * of its own. The shell's page container is stretched to that viewport, but the page's
     * own box inside the wrapper stays content-sized and no percentage or flex chain
     * reaches it — which is why the leftover here is measured and not inherited. Only the
     * list's ceiling and floor move: the page keeps flowing and scrolling exactly as it
     * did, and the panel ends on the bottom of the window instead of leaving the rest of
     * it blank.
     *
     * The measurement is an *addition* to the whole-row window, never a replacement.
     * `--mr-list-floor` still holds those 8 rows (482px, 422px when narrow) and the
     * stylesheet takes the larger of the two, so a window too short for either still
     * scrolls the page and pins the bar to the bottom.
     *
     * The scroll container is found by walking up for `overflow:auto|scroll` and never
     * by a host class name: the chrome above the list differs between the desktop
     * shell and the web shell, and this number must come from the box that actually
     * scrolls.
     *
     * @param listRef - the list that grows; its `--mr-list-fill` is what gets set.
     * @param pageRef - the page's own root box, whose bottom edge is the thing that has
     *   to reach the bottom of the viewport.
     * @param listKey - changes when the list mounts or unmounts (the page starts on a
     *   loading skeleton, and an empty filter has no rows at all), so the resize watcher
     *   is attached to a list that actually exists.
     */
    function useViewportFill(listRef, pageRef, listKey) {
      // Before paint when the host's React has it: a list that grows after the frame has
      // been painted reads as a jump. The render harness shims `useEffect` only, and a
      // serialized render has nothing to measure anyway.
      const useLayoutOrEffect = React.useLayoutEffect || React.useEffect;
      const measure = () => {
        const list = listRef.current;
        const page = pageRef.current;
        const viewport = list && scrollViewport(list);
        if (!list || !page || !viewport) return;
        // The shell keeps a capability page mounted while another page is on screen
        // (`display:none`), where every box measures as zero. There is nothing to hand
        // out there; the resize watcher re-measures the moment the page is shown again.
        if (!viewport.clientHeight || !page.offsetHeight) return;
        const current = parseFloat(list.style.getPropertyValue('--mr-list-fill')) || 0;
        // How far the page's own bottom edge sits above the bottom of the box that
        // scrolls — measured from the elements, so a scrolled page, a viewport that
        // changed height and a page container that the shell stretched to the viewport
        // (`min-height:100%` does resolve there) all come out right. `scrollHeight`
        // cannot answer this: it never reports less than the viewport, so a page that is
        // too short and one that fits exactly look identical.
        const viewportBox = viewport.getBoundingClientRect();
        const pageBox = page.getBoundingClientRect();
        const leftover = viewport.clientHeight - (pageBox.bottom - viewportBox.top + viewport.scrollTop);
        // The list takes that leftover on top of the height it already has. Floored,
        // never rounded up: a page half a pixel taller than its viewport would grow a
        // scrollbar that reveals nothing.
        const fill = Math.max(0, Math.floor(list.offsetHeight + leftover));
        if (fill !== current) list.style.setProperty('--mr-list-fill', `${fill}px`);
      };
      // After every render: filtering, a notice line, a refresh or a finished task all
      // move the page, and the fill has to follow without a state of its own.
      useLayoutOrEffect(measure);
      // A window resize does not re-render the page, so the scroll viewport is watched.
      // Resizing the page never resizes the viewport, so this cannot feed itself. The
      // observer follows the list: the page opens on a loading skeleton, and an empty
      // filter has no rows at all.
      React.useEffect(() => {
        const list = listRef.current;
        const viewport = list && scrollViewport(list);
        if (!viewport) return undefined;
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(viewport);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [listKey]);
    }

    function QuestionBank() {
      const [tick, setTick] = React.useState(0);
      const data = useAsync(() => Promise.all([api('questions'), api('tasks')]).then(([questions, tasks]) => ({ questions, tasks })), [tick]);
      const [query, setQuery] = React.useState('');
      const [status, setStatus] = React.useState('active');
      const [sort, setSort] = React.useState('updated');
      const [selectedId, setSelectedId] = React.useState('');
      // '' | 'detail' | 'edit': one drawer at a time, so a row click and
      // 「新建题目」 can never stack two panels on top of each other.
      const [drawer, setDrawer] = React.useState('');
      const [editing, setEditing] = React.useState(null);
      const [form, setForm] = React.useState(emptyForm);
      const [saving, setSaving] = React.useState(false);
      const [deleting, setDeleting] = React.useState(false);
      const [confirming, setConfirming] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [actionId, setActionId] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const all = data.value?.questions || [];
      const tasks = data.value?.tasks || [];
      const usage = usageOf(tasks);
      const categories = [...new Set(all.map(question => question.category || '未分类'))].sort()
        .map(name => ({ name, count: all.filter(question => (question.category || '未分类') === name).length }));
      const sorters = {
        updated: (left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)),
        created: (left, right) => String(right.createdAt).localeCompare(String(left.createdAt)),
        title: (left, right) => String(left.title).localeCompare(String(right.title), 'zh-CN'),
        usage: (left, right) => (usage.get(right.id)?.count || 0) - (usage.get(left.id)?.count || 0),
      };
      const filtered = all.filter(question => (status === 'all' || question.status === status) &&
        (!query.trim() || [question.title, question.prompt, question.description, ...(question.tags || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
        .sort(sorters[sort] || sorters.updated);
      // The open question is looked up in the whole bank, not in the filtered
      // view: changing a filter under an open drawer must not blank it.
      const selected = all.find(question => question.id === selectedId) || null;
      const openDetail = question => {
        setSelectedId(question.id); setEditing(null); setError(null); setConfirming(false); setDrawer('detail');
      };
      const openForm = question => {
        setEditing(question || null);
        setForm(question ? { ...question, tags: (question.tags || []).join(',') } : emptyForm());
        setError(null); setConfirming(false); setDrawer('edit');
      };
      const close = () => { if (saving || deleting) return; setDrawer(''); setConfirming(false); };
      /** Leaving the form returns to the question's detail when it came from one. */
      const leaveForm = () => { if (saving) return; if (editing) setDrawer('detail'); else setDrawer(''); };
      const save = async event => {
        event.preventDefault();
        setSaving(true); setError(null);
        try {
          const result = await api('saveQuestion', { ...form, id: editing?.id, tags: form.tags.split(/[,，]/).map(item => item.trim()).filter(Boolean) });
          setStatus(result.status); setQuery('');
          setNotice(editing ? `已保存「${result.title}」的修改。` : `已加入题库：「${result.title}」。`);
          setDrawer(''); setTick(value => value + 1);
        } catch (failure) { setError(failure.message); }
        finally { setSaving(false); }
      };
      const archive = async question => {
        setActionId(question.id); setError(null); setNotice('');
        try {
          await api('archiveQuestion', { id: question.id });
          setDrawer(''); setNotice(`已归档「${question.title}」，可在「已归档」中恢复。`); setTick(value => value + 1);
        } catch (failure) { setError(failure.message); }
        finally { setActionId(null); }
      };
      const restore = async question => {
        setActionId(question.id); setError(null); setNotice('');
        try {
          await api('saveQuestion', { id: question.id, title: question.title, category: question.category, tags: question.tags, prompt: question.prompt, description: question.description, status: 'active' });
          setDrawer(''); setNotice(`已恢复「${question.title}」。`); setTick(value => value + 1);
        } catch (failure) { setError(failure.message); }
        finally { setActionId(null); }
      };
      /** Deleting is irreversible, so it takes a second click once the drawer asks. */
      const remove = async question => {
        setDeleting(true); setError(null); setNotice('');
        try {
          await api('deleteQuestion', { id: question.id });
          setDrawer(''); setConfirming(false); setNotice(`已删除「${question.title}」。`);
          setTick(value => value + 1);
        } catch (failure) { setError(failure.message); }
        finally { setDeleting(false); }
      };
      const startWith = question => {
        setPending(question.id, null, '题库');
        setDrawer('');
        setNotice(`已设为下次测评题目：「${question.title}」。打开左侧「开始测评」即会预选它。`);
      };
      const counts = {
        total: all.length,
        active: all.filter(question => question.status === 'active').length,
        archived: all.filter(question => question.status === 'archived').length,
        categories: categories.length,
      };
      return h(Frame, { tone: 'violet', kicker: '题目资产 · 模型博主测评', title: '题库', subtitle: '整理常用测试题目与提示词，测评时直接复用', actions: [
        h('button', { key: 'refresh', className: 'mr-button', onClick: () => setTick(value => value + 1) }, '刷新'),
        h('button', { key: 'new', className: 'mr-button primary', onClick: () => openForm(null) }, '＋ 新建题目'),
      ] },
        h(StatBar, { items: [
          { label: '题目', value: counts.total, tone: 'tone' },
          { label: '启用中', value: counts.active },
          { label: '已归档', value: counts.archived },
          { label: '分类', value: counts.categories },
        ] }),
        // One full-width list: the bank is a list, and a question's drawer is
        // where it is read and acted on. No master-detail split.
        h('section', { className: 'mr-l1' },
          h('div', { className: 'mr-l1-head' },
            h('h2', { className: 'mr-sec-title' }, '题目列表'),
            h('span', { className: 'mr-filtercount' }, `共 ${filtered.length} 道`)),
          h('div', { className: 'mr-l1-body' },
            h(QuestionFilters, { query, setQuery, status, setStatus,
              statusOptions: [{ value: 'active', label: '启用中' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }] },
              h('select', { className: 'mr-select', style: { maxWidth: '150px' }, 'aria-label': '排序', value: sort, onChange: event => setSort(event.target.value) },
                h('option', { value: 'updated' }, '最近更新'),
                h('option', { value: 'created' }, '最近创建'),
                h('option', { value: 'usage' }, '使用次数'),
                h('option', { value: 'title' }, '标题'))),
            h(Notice, { error: data.error || (!drawer && error) }),
            notice ? h('p', { className: 'mr-notice', role: 'status' }, notice) : null),
          data.busy
            ? h('div', { className: 'mr-l1-body' }, h(Loading, { rows: 4 }))
            : h('div', { className: 'mr-l1-body' }, filtered.length
              ? h('div', { className: 'mr-bank-list' }, filtered.map(question => h(QuestionRow, {
                key: question.id, question, usage, mode: 'bank', active: question.id === selectedId, onSelect: openDetail })))
              : h(Empty, { glyph: '题', title: '没有符合条件的题目', copy: '换个关键词或状态试试。',
                action: h('button', { className: 'mr-button primary', onClick: () => openForm(null) }, '＋ 新建题目') }))),
        drawer === 'detail' && selected
          ? h(QuestionDetailDrawer, {
            question: selected, usage, busy: actionId === selected.id, deleting, confirming, error,
            onClose: close,
            onEdit: () => openForm(selected),
            onStart: () => startWith(selected),
            onArchive: () => void archive(selected),
            onRestore: () => void restore(selected),
            onAskDelete: () => { setError(null); setConfirming(true); },
            onCancelDelete: () => setConfirming(false),
            onDelete: () => void remove(selected),
          })
          : null,
        drawer === 'edit' ? h(Drawer, { title: editing ? '编辑题目' : '新建题目', subtitle: '提示词会原样发送给每个模型',
          onClose: leaveForm, footer: [
            h('button', { key: 'cancel', className: 'mr-button', disabled: saving, onClick: leaveForm }, '取消'),
            h('button', { key: 'save', className: 'mr-button primary', type: 'submit', form: 'mr-question-form', disabled: saving || !form.title.trim() || !form.prompt.trim() }, saving ? '保存中…' : editing ? '保存修改' : '加入题库'),
          ] },
          h('form', { id: 'mr-question-form', style: { display: 'grid', gap: '14px' }, onSubmit: event => void save(event) },
            h(Notice, { error }),
            h('label', { className: 'mr-field' }, '题目标题', h('input', { className: 'mr-input', value: form.title, maxLength: 120, required: true, autoFocus: true, onChange: event => setForm({ ...form, title: event.target.value }) })),
            h('div', { className: 'mr-pair' },
              h('label', { className: 'mr-field' }, '分类', h('input', { className: 'mr-input', value: form.category, maxLength: 60, placeholder: '可选', list: 'mr-category-options', onChange: event => setForm({ ...form, category: event.target.value }) }),
                h('datalist', { id: 'mr-category-options' }, categories.map(item => h('option', { key: item.name, value: item.name })))),
              h('label', { className: 'mr-field' }, '标签', h('input', { className: 'mr-input', value: form.tags, placeholder: '用逗号分隔', onChange: event => setForm({ ...form, tags: event.target.value }) }))),
            h('label', { className: 'mr-field' }, '提示词', h('textarea', { className: 'mr-textarea', value: form.prompt, required: true, maxLength: 20000, onChange: event => setForm({ ...form, prompt: event.target.value }) }),
              h('small', null, `${(form.prompt || '').length} / 20000 字`)),
            h('label', { className: 'mr-field' }, '题目说明', h('textarea', { className: 'mr-textarea', style: { minHeight: 84 }, value: form.description, maxLength: 500, placeholder: '可选：这道题在考什么、怎么判读', onChange: event => setForm({ ...form, description: event.target.value }) })))) : null);
    }

    function Evaluation({ renderConversation, focusSession }) {
      const [tick, setTick] = React.useState(0);
      const data = useAsync(() => Promise.all([api('questions'), api('models'), api('tasks')]).then(([questions, models, tasks]) => {
        rememberProviders(models);
        return { questions, models, tasks };
      }), [tick]);
      const [questionId, setQuestionId] = React.useState('');
      const [selected, setSelected] = React.useState([]);
      const [task, setTask] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [starting, setStarting] = React.useState(false);
      const [drawer, setDrawer] = React.useState(false);
      const [compare, setCompare] = React.useState(false);
      const [confirm, confirmation] = useConfirm();
      const all = data.value?.questions || [];
      const active = all.filter(question => question.status === 'active');
      const usage = usageOf(data.value?.tasks);
      // DSH account routes return no models until signed in; API routes carry
      // selectable=false when their configured credential is unavailable.
      const groups = (data.value?.models || []).filter(group => group.selectable !== false && group.models?.length > 0);
      // One flat view of the catalog, for validating and restoring a selection
      // handed over from another page. Rendering always uses the grouped form.
      const options = groups.flatMap(group => (group.models || []).map(model => ({
        ...model, provider: group.id,
        selectable: group.selectable, unavailableReason: group.unavailableReason,
      })));
      const handedOver = React.useRef(false);
      // The bank can hand this page a question (and the models a task used); the
      // shell remounts pages, so this is applied once, after the catalog and the
      // bank have arrived — never on the first empty render, which would consume
      // the handoff before there is anything to select.
      React.useEffect(() => {
        if (!pending.questionId && !pending.models) return;
        if (!data.value) return;
        const wanted = active.find(question => question.id === pending.questionId);
        const offered = pending.models || [];
        const source = pending.source;
        pending.questionId = '';
        pending.models = null;
        pending.source = '';
        const parts = [];
        if (wanted) {
          handedOver.current = true;
          setQuestionId(wanted.id);
          parts.push(`已从${source || '题库'}预选题目「${wanted.title}」`);
        }
        if (offered.length) {
          const allowed = new Set(options.filter(model => model.selectable !== false).map(model => modelKey(model.provider, model.id)));
          const usable = offered.filter(model => allowed.has(modelKey(model.provider, model.model)));
          if (usable.length) {
            setSelected(usable);
            parts.push(`预选 ${usable.length} 个模型`);
            if (usable.length < offered.length) parts.push(`${offered.length - usable.length} 个模型当前不可用，已跳过`);
          } else {
            parts.push('原选的模型当前都不可用，请重新选择');
          }
        }
        if (parts.length) setNotice(`${parts.join('，')}。`);
      }, [data.value]);
      // Default to the question used most recently, not the first in the list.
      React.useEffect(() => {
        if (handedOver.current || !active.length || active.some(question => question.id === questionId)) return;
        const recent = [...active].sort((left, right) => String(usage.get(right.id)?.lastAt || '').localeCompare(String(usage.get(left.id)?.lastAt || '')))[0];
        setQuestionId((recent || active[0]).id);
      }, [data.value, questionId]);
      React.useEffect(() => {
        if (!data.value) return;
        const allowed = new Set(options.filter(model => model.selectable !== false).map(model => modelKey(model.provider, model.id)));
        setSelected(previous => previous.filter(model => allowed.has(modelKey(model.provider, model.model))));
      }, [data.value]);
      // Every run keeps its own Session on the host; the page only follows their
      // state so each card can show its conversation as soon as it exists.
      React.useEffect(() => {
        if (!task || !['running', 'queued'].includes(task.status)) return undefined;
        let live = true;
        const timer = setInterval(() => {
          api('task', { id: task.id }).then(next => { if (live) setTask(next); })
            .catch(failure => { if (live) setError(failure.message); });
        }, 1500);
        return () => { live = false; clearInterval(timer); };
      }, [task?.id, task?.status]);
      // The host remounts this page per menu key, so a task started here is gone
      // from view the moment the user visits another module. The task itself never
      // left the host: take the newest one still executing back into the page, and
      // the cards, their Sessions and the polling effect above follow from it.
      React.useEffect(() => {
        let live = true;
        api('tasks').then(list => {
          const running = (list || []).find(item => ['running', 'queued'].includes(item.status));
          if (!live || !running) return;
          // Never overwrite a task the user just started while this was in flight.
          setTask(previous => previous || running);
          setNotice(previous => previous || `已接回正在执行的测评任务：${running.question.title} · ${running.runs.length} 个模型。`);
        }).catch(() => {});
        return () => { live = false; };
      }, []);
      const question = active.find(item => item.id === questionId);
      const autoFocusRunId = useAutoFocus(task, focusSession);
      const toggle = (model, group) => {
        if (group.selectable === false) return;
        setSelected(previous => {
          const on = previous.some(item => modelKey(item.provider, item.model) === modelKey(group.id, model.id));
          if (on) return previous.filter(item => modelKey(item.provider, item.model) !== modelKey(group.id, model.id));
          return [...previous, { provider: group.id, model: model.id, displayName: model.name || model.id }];
        });
      };
      const start = async () => {
        if (!question || !selected.length) return;
        // Read the task list again: this page only polls the task it is showing,
        // so its own copy can still count a task that has just settled — or miss
        // one started from elsewhere. A failed read never blocks the question.
        let known = data.value?.tasks || [];
        try { known = (await api('tasks')) || known; } catch (failure) { /* ask with the list this page already has */ }
        const live = liveTasks(known);
        const watching = task && live.some(item => item.id === task.id);
        const names = selected.map(item => item.displayName || item.model);
        const answered = await confirm({
          title: '开始这次测评？',
          description: `确认后将按「${question.title}」的原样提示词并行调用 ${selected.length} 个模型，各自建立独立会话与独立工作目录，并记录用量与产物。本次测评显示在本页，之前的任务可在「历史任务」中查看。`,
          notice: live.length
            ? `已有 ${live.length} 个测评任务进行中${watching ? '（含本页正在查看的这个）' : ''}。继续开始将并行运行一次新测评，它们不会被打断。`
            : null,
          summary: [
            { label: '题目', value: question.title },
            { label: '模型', value: names.length > 4 ? `${names.slice(0, 4).join('、')} 等 ${names.length} 个` : names.join('、') },
          ],
          confirmLabel: '确认开始',
        });
        if (!answered) return;
        setStarting(true); setError(null); setNotice('');
        try {
          const created = await api('start', { questionId, models: selected });
          setTask(created);
          setNotice(`已启动 ${created.runs.length} 个模型：下面是各自的对话卡片，可直接在卡片里继续对话；官方右侧栏（产物、文件等）跟随你正在操作的那张卡片。${live.length ? '正在进行的任务在后台继续，可在「历史任务」中查看。' : ''}`);
        } catch (failure) { setError(failure.message); }
        finally { setStarting(false); }
      };
      const blocked = !question ? '请先选择题目' : !selected.length ? '请至少选择一个模型' : '';
      return h(Frame, { tone: 'orange', kicker: '并行测评 · 模型博主测评', title: '开始测评',
        subtitle: '同一题目并行对比多个可用模型，每个模型拥有独立会话与独立工作目录',
        actions: h('button', { className: 'mr-button', onClick: () => setTick(value => value + 1) }, '刷新题目与模型') },
        h('section', { className: 'mr-l1' },
          h('div', { className: 'mr-l1-head' },
            h('h2', { className: 'mr-sec-title' }, '测评设置'),
            h('span', { className: 'mr-muted' }, '文本题目 · 原始回答 · 独立产物')),
          h('div', { className: 'mr-l1-body' },
            h(Notice, { error: data.error || error }),
            data.busy ? h(Loading, { rows: 3 }) : h('div', { className: 'mr-setup-grid' },
              h('div', { className: 'mr-picker' },
                h('span', { className: 'mr-label' }, '① 选择题目'),
                active.length
                  ? h(QuestionPicker, { questions: active, usage, value: questionId, onChange: setQuestionId, onOpenBank: () => setDrawer(true) })
                  : h(Empty, { glyph: '题', title: '还没有可用题目', copy: '题库里没有启用中的题目，先去建一道。' })),
              h('div', { className: 'mr-picker' },
                h('span', { className: 'mr-label' }, '② 选择模型'),
                groups.length
                  ? h(ModelPicker, { groups, selected, onToggle: toggle, onClear: () => setSelected([]) })
                  : h(Empty, { glyph: '模', title: '没有可用模型', copy: '请在「设置 → 模型」中完成模型服务配置后刷新。' })))),
          h('div', { className: 'mr-startbar' },
            h('div', { className: 'mr-startbar-main' },
              h('span', { className: 'mr-startbar-title' }, question ? `「${question.title}」` : '尚未选择题目'),
              selected.length
                ? h(React.Fragment, null,
                  h('span', { className: 'mr-muted' }, '·'),
                  h('div', { className: 'mr-selpills' }, selected.map(item => h('span', { key: modelKey(item.provider, item.model), className: 'mr-selpill' },
                    h('span', { title: item.displayName }, item.displayName),
                    h('button', { type: 'button', title: `移除 ${item.displayName}`, 'aria-label': `移除 ${item.displayName}`,
                      onClick: () => setSelected(previous => previous.filter(model => modelKey(model.provider, model.model) !== modelKey(item.provider, item.model))) }, '×')))))
                : null),
            h('div', { className: 'mr-actions' },
              h('span', { className: 'mr-muted' }, blocked || `${selected.length} 个模型 · 可开始`),
              h('button', { className: 'mr-button primary', disabled: starting || !question || !selected.length || data.busy, onClick: () => void start() },
                starting ? '正在创建任务…' : '开始测评 →')))),
        h('section', { className: 'mr-l1' },
          h('div', { className: 'mr-l1-head' },
            h('h2', { className: 'mr-sec-title' }, '本次测评'),
            task ? h('span', { className: 'mr-muted' }, `${task.runs.length} 个模型`) : null),
          h('div', { className: 'mr-l1-body' },
            notice ? h('p', { className: 'mr-notice', role: 'status' }, notice) : null,
            task
              ? h(React.Fragment, null,
                h(RunSummaryBar, { task, onCompare: () => setCompare(true) }),
                h('p', { className: 'mr-muted' }, '点任意一张卡片即在其中继续对话；官方右侧栏（产物、文件、终端等）跟随你正在操作的那张卡片。'),
                h(RunGrid, { task, renderConversation, focusSession, autoFocusRunId }))
              : h(Empty, { glyph: '测', title: '还没有本次测评', copy: '选择题目与模型后点「开始测评」；每个模型会出现一张自己的对话卡片，产物在官方右侧栏查看。' }))),
        drawer ? h(QuestionDrawer, { questions: all, usage, value: questionId, onPick: setQuestionId, onClose: () => setDrawer(false) }) : null,
        compare && task ? h(AnswerCompareDrawer, { task, onClose: () => setCompare(false) }) : null,
        confirmation);
    }

    /**
     * The generated report, shown in place.
     *
     * It is the identical document the export writes, loaded from a blob URL, so
     * there is one layout and one behaviour to maintain — and what the user reviews
     * here is byte-for-byte what they would save.
     */
    function ReportOverlay({ report, onClose }) {
      React.useEffect(() => {
        const onKey = event => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', { className: 'mr-report', role: 'dialog', 'aria-modal': 'true', 'aria-label': '测评报告' },
        h('div', { className: 'mr-report-bar' },
          h('strong', null, '测评报告'),
          h('span', { className: 'mr-num' }, `${report.tasks} 道题 · ${report.models} 个模型 · ${bytesText(report.bytes)}`),
          h('button', { className: 'mr-button', type: 'button', onClick: onClose }, '关闭')),
        h('iframe', { className: 'mr-report-frame', title: '测评报告', src: report.url }));
    }

    function History({ renderConversation, focusSession }) {
      const [tick, setTick] = React.useState(0);
      const data = useAsync(() => api('tasks'), [tick]);
      const [query, setQuery] = React.useState('');
      const [status, setStatus] = React.useState('all');
      const [questionId, setQuestionId] = React.useState('');
      const [range, setRange] = React.useState('all');
      const [sort, setSort] = React.useState('newest');
      const [selectedId, setSelectedId] = React.useState('');
      const [detail, setDetail] = React.useState(null);
      const [detailError, setDetailError] = React.useState(null);
      const [detailTick, setDetailTick] = React.useState(0);
      const [compare, setCompare] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const all = data.value || [];
      const questions = [...new Map(all.filter(task => task.question?.id).map(task => [task.question.id, task.question.title])).entries()]
        .map(([id, title]) => ({ id, title }));
      const since = range === 'all' ? 0 : Date.now() - (range === '7' ? 7 : 30) * 86400000;
      const sorters = {
        newest: (left, right) => String(right.createdAt).localeCompare(String(left.createdAt)),
        oldest: (left, right) => String(left.createdAt).localeCompare(String(right.createdAt)),
        slowest: (left, right) => taskDuration(right) - taskDuration(left),
        models: (left, right) => right.runs.length - left.runs.length,
      };
      const filtered = all.filter(task => (status === 'all' || task.status === status) &&
        (!questionId || task.question?.id === questionId) &&
        (!since || new Date(task.createdAt).getTime() >= since) &&
        (!query.trim() || [task.question?.title, ...runModels(task)].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
        .sort(sorters[sort] || sorters.newest);
      /**
       * Which settled tasks the next report covers.
       *
       * Only settled tasks are selectable — a run still in flight would be frozen
       * mid-way and the report would state a duration that had not finished. A task
       * with a failed run stays selectable: "4 成功 1 失败" is exactly the task worth
       * reporting on, and the task-level status alone cannot tell the two apart.
       */
      const [picked, setPicked] = React.useState(() => new Set());
      const [reportBusy, setReportBusy] = React.useState(false);
      const [reportView, setReportView] = React.useState(null);
      // The list is the one box that can absorb the height the task list does not use: see
      // `useViewportFill`. The empty and loading states have no rows to grow, so they keep
      // their own height and the page stays short.
      const listRef = React.useRef(null);
      const pageRef = React.useRef(null);
      useViewportFill(listRef, pageRef, (data.busy || !filtered.length) ? 'no-list' : 'list');
      const settledTask = task => (task.runs || []).every(run => ['succeeded', 'failed', 'cancelled'].includes(run.status));
      const pickedTasks = all.filter(task => picked.has(task.id));
      const pickedModels = [...new Set(pickedTasks.flatMap(task => runModels(task)))];
      const togglePick = id => setPicked(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      /** Gather one report's inputs: the tasks, plus every renderable artifact inlined. */
      const collectReport = async chosen => {
        const tasks = [];
        const inlined = {};
        for (const id of chosen) {
          const stored = await api('task', { id });
          const runs = [];
          for (const run of stored.runs || []) {
            // The figures, or the reason there are none. The host is asked for every
            // settled run, not only the ones with nothing on record: a run whose first
            // attempt was cut short — a 429, most often — can still be continued from
            // its card, and those later turns belong to the same total. The host
            // re-reads only when the conversation has actually moved past the record,
            // so asking each time is idempotent. A permanent reason comes back as-is
            // and is never re-read; anything newer is what the report must show.
            let stats = run.stats || null;
            let statsReason = run.statsUnavailable || null;
            if (!statsReason) {
              const answer = await api('stats', { taskId: id, runId: run.id }).catch(() => null);
              stats = answer?.stats ?? stats;
              statsReason = answer ? answer.reason ?? null : (stats ? null : 'failed');
            }
            for (const artifact of run.artifacts || []) {
              if (!renderableArtifact(artifact.path) || (artifact.bytes || 0) > REPORT_INLINE_LIMIT) continue;
              const file = await api('artifact', { taskId: id, runId: run.id, path: artifact.path }).catch(() => null);
              if (file) inlined[artifactKey(id, run.id, artifact.path)] = toBase64(file.text);
            }
            // The wall clock has to end where the figures now end. The task was read
            // before the host refreshed the run, so a continued conversation would
            // otherwise report less time than the model spent inside it.
            const lastActivityAt = stats?.lastActivityAt || null;
            const refreshedEnd = lastActivityAt && (!run.completedAt || new Date(lastActivityAt) > new Date(run.completedAt))
              ? lastActivityAt : run.completedAt;
            // A copy, never a patch: the fetched task is the host's record, and this
            // page must not write back into a value it does not own.
            runs.push({ ...run, completedAt: refreshedEnd, stats, statsReason });
          }
          tasks.push({ ...stored, runs });
        }
        return { tasks, inlined };
      };
      const buildReport = async () => {
        const chosen = all.filter(task => picked.has(task.id)).map(task => task.id);
        if (!chosen.length) throw new Error('请先勾选至少一个已结束的任务。');
        const collected = await collectReport(chosen);
        const html = reportDocument(collected.tasks, collected.inlined);
        return { html, bytes: new Blob([html]).size, tasks: collected.tasks.length, models: [...new Set(collected.tasks.flatMap(task => runModels(task)))].length };
      };
      const exportReport = async () => {
        setReportBusy(true); setNotice('');
        try {
          const report = await buildReport();
          const url = URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = `model-review-report-${new Date().toISOString().slice(0, 10)}.html`;
          link.click();
          // The download claims the blob synchronously on click, so the URL is only
          // released on the next tick — never on a long timer, which would hold the
          // document (and in a test runner, the whole process) alive for nothing.
          setTimeout(() => URL.revokeObjectURL(url), 0);
          setNotice(`已导出 ${report.tasks} 道题 × ${report.models} 个模型的报告（${bytesText(report.bytes)}）。`);
        } catch (error) { setNotice(error.message); } finally { setReportBusy(false); }
      };
      /** The same document, shown in place instead of saved: one code path, one layout. */
      const viewReport = async () => {
        setReportBusy(true); setNotice('');
        try {
          const report = await buildReport();
          setReportView({ url: URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' })), bytes: report.bytes, tasks: report.tasks, models: report.models });
        } catch (error) { setNotice(error.message); } finally { setReportBusy(false); }
      };
      const closeReportView = () => setReportView(current => { if (current) URL.revokeObjectURL(current.url); return null; });
      const currentId = filtered.some(task => task.id === selectedId) ? selectedId : '';
      const autoFocusRunId = useAutoFocus(detail, focusSession);
      React.useEffect(() => {
        if (!currentId) { setDetail(null); return undefined; }
        let live = true;
        setDetailError(null);
        api('task', { id: currentId }).then(value => { if (live) setDetail(value); })
          .catch(error => { if (live) setDetailError(error.message); });
        return () => { live = false; };
      }, [currentId, detailTick]);
      React.useEffect(() => {
        if (!detail || !['running', 'queued'].includes(detail.status)) return undefined;
        let live = true;
        const timer = setInterval(() => api('task', { id: detail.id }).then(next => { if (live) setDetail(next); })
          .catch(error => { if (live) setDetailError(error.message); }), 1500);
        return () => { live = false; clearInterval(timer); };
      }, [detail?.id, detail?.status]);
      const rerun = task => {
        pending.questionId = task.question?.id || '';
        pending.models = (task.runs || []).map(run => ({ provider: run.model.provider, model: run.model.model, displayName: run.model.displayName || run.model.model }));
        pending.source = '历史任务';
        setNotice(`已把「${task.question?.title}」与 ${pending.models.length} 个模型设为下次测评，打开左侧「开始测评」即会预选。`);
      };
      const exportTask = task => {
        const lines = [
          `# ${task.question?.title || '测评任务'}`,
          '',
          `- 状态：${statusText(task.status)}`,
          `- 时间：${stamp(task.createdAt)}`,
          `- 总用时：${durationText(taskDuration(task))}`,
          `- 模型：${runModels(task).join('、')}`,
          '',
          '## 提示词',
          '',
          task.question?.prompt || '',
          '',
        ];
        for (const run of task.runs || []) {
          lines.push(`## ${run.model.displayName || run.model.model}`, '', `- 状态：${statusText(run.status)}`, `- 耗时：${runDurationText(run)}`,
            `- 产物：${(run.artifacts || []).map(item => item.path).join('、') || '无'}`, '', run.error ? `错误：${run.error}` : (answerText(run.answer) || '（没有保存回答快照）'), '');
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `model-review-${task.id.slice(0, 8)}.md`;
        link.click();
        URL.revokeObjectURL(url);
        setNotice('已导出这次测评的 Markdown 记录。');
      };
      const statBar = h(StatBar, { items: [
        { label: '测评', value: all.length, tone: 'tone' },
        { label: '已完成', value: all.filter(task => task.status === 'succeeded').length },
        { label: '失败', value: all.filter(task => task.status === 'failed').length },
        { label: '进行中', value: all.filter(task => ['running', 'queued'].includes(task.status)).length },
      ] });
      const noticeLine = notice ? h('p', { className: 'mr-notice', role: 'status' }, notice) : null;
      const rows = filtered.map(task => h('div', {
        key: task.id, className: 'mr-hrow-wrap', 'data-on': picked.has(task.id) ? 'true' : 'false',
        'data-settled': settledTask(task) ? 'true' : 'false' },
        // The checkbox sits beside the row button, never inside it: a control nested
        // in a button is invalid markup and its click toggles twice.
        h('input', {
          type: 'checkbox', className: 'mr-pick', checked: picked.has(task.id), disabled: !settledTask(task),
          'aria-label': `选择「${task.question.title}」用于报告`,
          title: settledTask(task) ? '加入报告' : '任务尚未结束，暂不可选',
          onChange: () => togglePick(task.id),
        }),
        h('button', {
          className: 'mr-hrow', 'data-status': task.status,
          onClick: () => { setSelectedId(task.id); setNotice(''); } },
          h('div', { className: 'mr-hrow-main' },
            h('strong', null, task.question.title),
            h('span', { title: stamp(task.createdAt) },
              `${shortStamp(task.createdAt)} · ${runModels(task).slice(0, 2).join('、')}${task.runs.length > 2 ? ` 等 ${task.runs.length} 个` : ''}`)),
          h('div', { className: 'mr-hrow-models' }, task.runs.map(run => h('i', { key: run.id, className: 'mr-dot', 'data-status': run.status,
            title: `${run.model.displayName || run.model.model} · ${statusText(run.status)}` }))),
          h('div', { className: 'mr-hrow-side' },
            h(Chip, { tone: statusTone(task.status) }, statusText(task.status)),
            h('span', { className: 'mr-num' }, `${task.runs.length} 个模型`),
            h('span', { className: 'mr-num' }, `用时 ${durationText(taskDuration(task))}`),
            task.runs.some(run => answerChars(run.answer) > 0)
              ? h('span', { className: 'mr-num' }, `回答 ${charText(task.runs.reduce((sum, run) => sum + answerChars(run.answer), 0))}`)
              : h('span', { className: 'mr-num' }, '无快照')))));
      /** The one place the report is asked for; it stays visible while the list scrolls. */
      const pickBar = all.length ? h('div', { className: 'mr-pickbar' },
        h('div', { className: 'mr-pickstats' },
          h('div', { className: 'mr-stat' }, h('b', null, pickedTasks.length), h('span', null, '已选任务')),
          h('div', { className: 'mr-stat' }, h('b', null, pickedModels.length), h('span', null, '模型并集'))),
        h('span', { className: 'mr-pickhint' }, pickedTasks.length
          ? `报告将覆盖 ${pickedTasks.length} 道题；产物会内联进 HTML。`
          : '勾选「已结束」的任务即可生成报告；含失败模型的任务也可以选。'),
        h('div', { className: 'mr-actions' },
          h('button', {
            className: 'mr-button ghost', type: 'button', disabled: !pickedTasks.length || reportBusy,
            onClick: () => setPicked(new Set(all.filter(task => settledTask(task)).map(task => task.id))),
          }, '选中全部可勾选'),
          h('button', { className: 'mr-button ghost', type: 'button', disabled: !pickedTasks.length || reportBusy, onClick: () => setPicked(new Set()) }, '清空'),
          h('button', { className: 'mr-button', type: 'button', disabled: !pickedTasks.length || reportBusy, onClick: viewReport }, reportBusy ? '生成中…' : '在工作台内查看'),
          h('button', { className: 'mr-button primary', type: 'button', disabled: !pickedTasks.length || reportBusy, onClick: exportReport }, reportBusy ? '生成中…' : '导出测评报告'))) : null;
      const listPanel = h('section', { className: 'mr-l1' },
        h('div', { className: 'mr-l1-head' },
          h('h2', { className: 'mr-sec-title' }, '任务记录'),
          h('span', { className: 'mr-filtercount' }, `共 ${filtered.length} 项`)),
        h('div', { className: 'mr-l1-body' },
          h('div', { className: 'mr-toolbar' },
            h('div', { className: 'mr-toolbar-row' },
              h('input', { className: 'mr-input', 'aria-label': '搜索历史任务', placeholder: '搜索题目或模型', value: query, onChange: event => setQuery(event.target.value) }),
              h(Segment, { value: status, options: [{ value: 'all', label: '全部' }, { value: 'running', label: '进行中' }, { value: 'succeeded', label: '已完成' }, { value: 'failed', label: '失败' }], onChange: setStatus, label: '任务状态' })),
            h('div', { className: 'mr-toolbar-row' },
              h('select', { className: 'mr-select', style: { maxWidth: '220px' }, 'aria-label': '按题目筛选', value: questionId, onChange: event => setQuestionId(event.target.value) },
                h('option', { value: '' }, '全部题目'),
                questions.map(item => h('option', { key: item.id, value: item.id }, item.title))),
              h(Segment, { value: range, options: [{ value: 'all', label: '全部时间' }, { value: '30', label: '30 天' }, { value: '7', label: '7 天' }], onChange: setRange, label: '时间范围' }),
              h('select', { className: 'mr-select', style: { maxWidth: '150px' }, 'aria-label': '排序', value: sort, onChange: event => setSort(event.target.value) },
                h('option', { value: 'newest' }, '最新优先'),
                h('option', { value: 'oldest' }, '最早优先'),
                h('option', { value: 'slowest' }, '耗时最长'),
                h('option', { value: 'models' }, '模型最多')))),
          h(Notice, { error: data.error || detailError })),
        data.busy
          ? h('div', { className: 'mr-l1-body' }, h(Loading, { rows: 4 }))
          : h('div', { className: 'mr-l1-body' }, filtered.length
            ? h('div', { className: 'mr-bank-list', ref: listRef }, rows)
            : h(Empty, { glyph: '史', title: '没有符合条件的历史任务', copy: '换个关键词、状态或时间范围试试；也可以先去「开始测评」跑一次。' })),
        pickBar);
      const detailPanel = !detail ? null : h(React.Fragment, null,
        h('section', { className: 'mr-l1' },
          h('div', { className: 'mr-l1-head mr-history-head' },
            h('div', { className: 'mr-top-copy' },
              h('button', { className: 'mr-button emphasis mr-back', onClick: () => { setSelectedId(''); setNotice(''); } }, '← 返回历史任务'),
              h('h2', { style: { marginTop: '6px' } }, detail.question.title)),
            h('div', { className: 'mr-actions' },
              h(Chip, { tone: statusTone(detail.status) }, statusText(detail.status)),
              h('button', { className: 'mr-button', onClick: () => rerun(detail) }, '重跑这次测评'),
              h('button', { className: 'mr-button', onClick: () => exportTask(detail) }, '导出记录'))),
          h('div', { className: 'mr-l1-body' },
            h('div', { className: 'mr-detail-meta' },
              h('span', null, stamp(detail.createdAt)),
              h('span', null, `${detail.runs.length} 个模型`),
              h('span', null, `总用时 ${durationText(taskDuration(detail))}`),
              detail.runs.some(run => run.status === 'failed') ? h('span', null, `${detail.runs.filter(run => run.status === 'failed').length} 个模型失败`) : null),
            noticeLine,
            detail.artifactsUnavailable ? h('p', { className: 'mr-notice' }, '该任务创建于独立工作目录引入之前，产物无法归属到具体模型；对话仍可回看。') : null,
            h(Notice, { error: detailError }),
            h(RunSummaryBar, { task: detail, onCompare: () => setCompare(true) }),
            h('p', { className: 'mr-muted' }, '点任意一张卡片即在其中继续对话；官方右侧栏（产物、文件、终端等）跟随你正在操作的那张卡片。'),
            h(RunGrid, { task: detail, renderConversation, focusSession, autoFocusRunId }))),
        compare ? h(AnswerCompareDrawer, { task: detail, onClose: () => setCompare(false) }) : null);
      return h(Frame, { tone: 'cyan', kicker: '测评档案 · 模型博主测评', title: '历史任务',
        subtitle: '回看每次测评的模型、耗时与各自产出，或勾选任务生成事实报告',
        rootRef: pageRef,
        actions: h('button', { className: 'mr-button', onClick: () => { setTick(value => value + 1); setDetailTick(value => value + 1); } }, '刷新') },
        currentId && detail?.id === currentId ? detailPanel : h(React.Fragment, null, statBar, listPanel, noticeLine),
        reportView ? h(ReportOverlay, { report: reportView, onClose: closeReportView }) : null);
    }

    function apply(ctx) {
      connection = ctx.get('connection');
      ctx.effect(() => ctx.lwbPackClient.register({
        packId: 'model-review',
        pages: { 'question-bank': QuestionBank, evaluation: Evaluation, history: History },
      }), 'model-review: register capability pages');
    }
    exports.inject = ['connection', 'lwbPackClient'];
    exports.apply = apply;
    return module.exports;
  },
});
