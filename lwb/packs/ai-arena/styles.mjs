export const CSS = `
/* Match the existing module canvas and keep page, action and status colours distinct. */
.lwb-page-capability:has(.ar-page) > .lwb-page-intro{display:none}
.ar-page{
  --ar-brand:#4f46e5;--ar-brand-soft:#eef2ff;--ar-on-brand:#fff;
  --ar-violet:#8b5cc4;--ar-violet-soft:#f2ebfb;--ar-orange:#cf762b;--ar-orange-soft:#fff0e4;
  --ar-cyan:#2579b9;--ar-cyan-soft:#e7f4fb;--ar-green:#16865f;--ar-green-soft:#eaf8f1;
  --ar-red:#a33;--ar-red-soft:#fff0f0;--ar-amber:#a56c19;--ar-amber-soft:#fff5e7;
  --ar-tone:var(--ar-orange);--ar-tone-soft:var(--ar-orange-soft);--ar-shadow:0 1px 2px rgba(15,20,25,.04);
  display:grid;gap:16px;width:100%;min-width:0;margin:0;color:var(--lwb-ink);
  font-size:var(--lwb-text-base,14px);line-height:1.55;letter-spacing:0;
}
.ar-page[data-tone=violet]{--ar-tone:var(--ar-violet);--ar-tone-soft:var(--ar-violet-soft)}
.ar-page[data-tone=cyan]{--ar-tone:var(--ar-cyan);--ar-tone-soft:var(--ar-cyan-soft)}
body[data-ds-dark-theme] .ar-page{
  --ar-brand:#a5b4fc;--ar-brand-soft:#2a3150;--ar-on-brand:#0f172a;
  --ar-violet:#c4a7ff;--ar-violet-soft:#31263f;--ar-orange:#f6bd7c;--ar-orange-soft:#3e3024;
  --ar-cyan:#7cc4ee;--ar-cyan-soft:#1d4058;--ar-green:#5bd0a0;--ar-green-soft:#173f34;
  --ar-red:#e9b7b7;--ar-red-soft:#3b2525;--ar-amber:#f0b45b;--ar-amber-soft:#49351c;
  --ar-shadow:0 1px 2px rgba(0,0,0,.24);
}
.ar-page *{box-sizing:border-box;letter-spacing:0}
.ar-page > *,.ar-page section,.ar-page aside{min-width:0}
.ar-page h1,.ar-page h2,.ar-page h3,.ar-page p{margin:0}
.ar-page button,.ar-page input,.ar-page select{font:inherit}
.ar-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--lwb-line)}
.ar-top-copy{min-width:0}
.ar-kicker{display:flex;align-items:center;gap:7px;margin-bottom:7px!important;color:var(--ar-tone);font-size:12px;font-weight:700}
.ar-kicker i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.ar-top h1{font-size:24px;line-height:1.35;font-weight:700}
.ar-top-copy > p:last-child:not(.ar-kicker){margin-top:6px;color:var(--lwb-muted);font-size:14px}
.ar-top-actions,.ar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ar-top-actions{flex:none}.ar-muted{color:var(--lwb-muted);font-size:13px}
.ar-button,.ar-icon{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;border:1px solid var(--lwb-line);border-radius:6px;padding:6px 12px;background:var(--lwb-surface);color:var(--lwb-ink);font-size:13px!important;font-weight:600!important;cursor:pointer}
.ar-button svg,.ar-icon svg{width:16px;height:16px;flex:none}.ar-icon{width:34px;height:34px;padding:0;flex:none}
.ar-button:hover,.ar-icon:hover{border-color:var(--ar-brand);color:var(--ar-brand)}
.ar-primary{border-color:var(--ar-brand);background:var(--ar-brand);color:var(--ar-on-brand)}
.ar-primary:hover{filter:brightness(.95);color:var(--ar-on-brand)}
.ar-config-button,.ar-back-button{min-height:40px;padding:8px 15px;box-shadow:0 4px 12px color-mix(in srgb,var(--ar-brand) 22%,transparent);font-weight:700!important}
.ar-config-button svg,.ar-back-button svg{width:17px;height:17px}
.ar-button:disabled,.ar-icon:disabled{opacity:.45;cursor:not-allowed;filter:none}
.ar-confirm{position:fixed;inset:0;margin:auto;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:24px;border:1px solid var(--lwb-line);border-radius:16px;background:var(--lwb-surface);color:var(--lwb-ink);font:inherit;box-shadow:0 24px 80px rgba(15,23,42,.28);overflow:auto;overscroll-behavior:contain}
.ar-confirm::backdrop{background:rgba(15,23,42,.48);backdrop-filter:blur(4px)}
.ar-confirm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.ar-confirm-mark{display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:var(--ar-brand-soft);color:var(--ar-brand)}
.ar-confirm-mark svg{width:23px;height:23px}
.ar-confirm h2{color:var(--lwb-ink);font-size:20px;line-height:1.4}
.ar-confirm-copy{margin-top:10px!important;color:var(--lwb-muted);font-size:14px;line-height:1.7}
.ar-confirm-notice{margin-top:16px!important;padding:12px;border:1px solid var(--ar-amber);border-radius:8px;background:var(--ar-amber-soft);color:var(--ar-amber);font-size:13px;line-height:1.65}
.ar-confirm-players{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px;padding:14px;border:1px solid var(--lwb-line);border-radius:8px;background:var(--lwb-page)}
.ar-confirm-players small{display:block;color:var(--lwb-muted);font-size:12px}.ar-confirm-players strong{display:block;margin-top:5px;color:var(--lwb-ink);font-size:14px;overflow-wrap:anywhere}
.ar-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:18px;border-top:1px solid var(--lwb-line)}
.ar-confirm-actions button{min-height:40px;padding:8px 16px}
@media(max-width:480px){.ar-confirm{padding:20px}.ar-confirm h2{font-size:18px}.ar-confirm-actions button{flex:1}}
.ar-page :is(button,input,select,summary):focus-visible{outline:2px solid var(--ar-brand);outline-offset:3px}
.ar-tag,.ar-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:23px;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:650;line-height:1.4;color:var(--lwb-muted);background:var(--lwb-page)}
.ar-tag i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ar-tag[data-status=running]{color:var(--ar-cyan);background:var(--ar-cyan-soft)}
.ar-tag[data-status=running] i{animation:ar-pulse 1.6s ease-in-out infinite}
.ar-tag[data-status=paused],.ar-tag[data-status=pausing]{color:var(--ar-amber);background:var(--ar-amber-soft)}
.ar-tag[data-status=finished]{color:var(--ar-green);background:var(--ar-green-soft)}
.ar-chip[data-tone=page]{color:var(--ar-tone);background:var(--ar-tone-soft)}
.ar-error,.ar-notice{margin:0;padding:10px 12px;border:1px solid var(--lwb-line);border-radius:7px;font-size:13px;overflow-wrap:anywhere}
.ar-error{color:var(--ar-red);background:var(--ar-red-soft)}.ar-notice{color:var(--ar-cyan);background:var(--ar-cyan-soft)}
.ar-section-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;line-height:1.4}
.ar-section-title::before{content:"";width:3px;height:14px;flex:none;border-radius:2px;background:var(--ar-tone)}
.ar-setup{border-bottom:1px solid var(--lwb-line)}
.ar-setup > summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:0 0 12px;cursor:pointer;list-style:none}
.ar-setup > summary::-webkit-details-marker{display:none}
.ar-setup-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650}
.ar-setup-title svg{width:16px;height:16px;color:var(--ar-tone)}
.ar-setup-chevron{width:15px;height:15px;color:var(--lwb-muted);transform:rotate(-90deg);transition:transform .15s}
.ar-setup[open] .ar-setup-chevron{transform:none}
.ar-form{display:grid;gap:16px;padding:0 0 16px}.ar-participants{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.ar-participant{display:grid;align-content:start;gap:10px;min-width:0}
.ar-participant-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650}
.ar-participant-head small{margin-left:auto;color:var(--lwb-muted);font-size:12px;font-weight:400}
.ar-field{display:grid;gap:6px;min-width:0}.ar-field > span{font-size:12px;color:var(--lwb-muted)}
.ar-field input,.ar-field select,.ar-select,.ar-search{width:100%;min-width:0;height:36px;padding:0 10px;border:1px solid var(--lwb-line);border-radius:6px;color:var(--lwb-ink);background:var(--lwb-surface);font-size:13px}
.ar-field input:focus,.ar-field select:focus,.ar-search:focus{border-color:var(--ar-brand);box-shadow:0 0 0 2px var(--ar-brand-soft)}
.ar-submit{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ar-submit .ar-muted{font-size:12px}
.ar-config-empty{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--ar-amber);border-radius:7px;color:var(--ar-amber);background:var(--ar-amber-soft);font-size:13px}.ar-config-empty strong{display:block;color:var(--lwb-ink);font-weight:650}.ar-config-empty ul{display:grid;gap:3px;margin:5px 0 0 16px;padding:0;color:var(--lwb-muted);font-size:12px}.ar-config-empty li{padding-left:2px}.ar-config-empty b{color:var(--lwb-ink);font-weight:600}.ar-config-empty p{margin:5px 0 0;color:var(--lwb-muted);font-size:12px}
.ar-conversation{display:grid;gap:12px;min-width:0;padding:16px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface)}
.ar-conversation-head{display:flex;justify-content:space-between;gap:12px;align-items:center}
.ar-turn-select{width:auto;min-width:150px;max-width:100%}
.ar-conversation .lwb-embedded-conversation-shell{height:540px;min-height:300px}
.ar-conversation .lwb-embedded-conversation-main{flex:1;min-height:0;display:flex;flex-direction:column}
.ar-match-view{display:grid;gap:16px}.ar-match-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ar-match-head p{margin-top:4px;color:var(--lwb-muted);font-size:12px}.ar-match-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ar-match-count{display:inline-flex;align-items:center;min-height:24px;padding:3px 9px;border:1px solid var(--ar-orange);border-radius:999px;color:var(--ar-orange);background:var(--ar-orange-soft);font-size:12px;font-weight:700;white-space:nowrap}
.ar-match{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.85fr);gap:16px;align-items:stretch}
.ar-board-col{display:grid;align-content:start;gap:0;min-width:0;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--ar-shadow);overflow:hidden}
.ar-scoreboard{display:grid;grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr);align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid var(--lwb-line)}
.ar-player{display:flex;align-items:center;gap:9px;min-width:0}.ar-player:last-child{flex-direction:row-reverse;text-align:right}
.ar-player strong{display:block;font-size:13px;font-weight:650;overflow-wrap:anywhere}
.ar-player small{display:block;margin-top:3px;font-size:11px;color:var(--lwb-muted);overflow-wrap:anywhere}
.ar-stone{display:block;flex:none;width:19px;height:19px;border-radius:50%;background:#252b28;border:1px solid #a9b5ac;box-shadow:0 1px 2px #0001}
.ar-stone[data-player="1"]{background:#fff}.ar-vs{text-align:center;color:var(--lwb-muted);font-size:11px;font-weight:700}
.ar-player[data-game="xiangqi"] .ar-stone,.ar-participant[data-game="xiangqi"] .ar-stone{background:#b83c2e;border-color:#f0c999}
.ar-player[data-game="xiangqi"] .ar-stone[data-player="1"],.ar-participant[data-game="xiangqi"] .ar-stone[data-player="1"]{background:#252b28}
.ar-board{width:calc(100% - 32px);max-width:520px;aspect-ratio:1;margin:16px auto;position:relative;overflow:hidden;border:1px solid #9a6336;border-radius:9px;background:#c58a4d;box-shadow:0 10px 22px rgba(82,45,20,.18),inset 0 1px 0 rgba(255,245,210,.3)}
.ar-match-view[data-game="xiangqi"] .ar-board,.ar-match[data-game="xiangqi"] .ar-board{aspect-ratio:508/562}
.ar-board > svg{display:block;width:100%;height:100%}
.ar-board svg g:last-child{animation:ar-place .25s ease-out}
.ar-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--lwb-line);background:var(--lwb-surface)}
.ar-toolbar input[type=range]{flex:1;min-width:76px;accent-color:var(--ar-brand);margin:0 4px}
.ar-toolbar .ar-select{width:64px;height:34px;padding:0 6px}
.ar-counter{font-variant-numeric:tabular-nums;font-size:12px;min-width:48px;text-align:center;color:var(--lwb-muted)}
.ar-live{color:var(--ar-brand);border-color:var(--ar-brand);background:var(--ar-brand-soft)}
.ar-commentary{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;max-height:690px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--ar-shadow);overflow:hidden}
.ar-commentary-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:66px;padding:15px 18px;border-bottom:1px solid var(--lwb-line)}
.ar-commentary-head .ar-chip{color:var(--ar-cyan);background:var(--ar-cyan-soft);white-space:nowrap}
.ar-speaking{margin:0;padding:20px 18px;border-bottom:1px solid var(--lwb-line);min-height:180px;flex:none;background:var(--lwb-surface)}
.ar-speaking-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650;overflow-wrap:anywhere}
.ar-speaking-name svg{width:16px;height:16px;flex:none;color:var(--ar-tone)}
.ar-speaking p{font-size:18px;font-weight:600;line-height:1.75;margin:12px 0;overflow-wrap:anywhere}.ar-speaking small{font-size:12px;color:var(--lwb-muted)}
.ar-speaking[data-thinking=true] p{color:var(--lwb-muted);font-weight:400}
.ar-generation{display:grid;gap:8px}.ar-generation > div{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.ar-generation small:last-child{font-variant-numeric:tabular-nums}
.ar-result{display:flex;align-items:center;gap:9px;margin:0;padding:12px 18px;color:var(--ar-green);background:var(--ar-green-soft);font-size:13px;font-weight:600;overflow-wrap:anywhere;flex:none}.ar-result svg{width:17px;height:17px;flex:none}
.ar-transcript-title{display:flex;justify-content:space-between;gap:8px;padding:12px 18px 4px;color:var(--lwb-muted);font-size:11px;flex:none}
.ar-transcript{flex:1;min-height:120px;overflow:auto;padding:0 18px 8px;display:grid;grid-auto-rows:max-content;align-content:start;overscroll-behavior:contain}
.ar-speech{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--lwb-line);background:transparent;color:var(--lwb-ink);padding:12px 0;cursor:pointer}
.ar-speech:last-child{border-bottom:0}.ar-speech:hover{color:var(--ar-brand)}
.ar-speech-head{display:flex;align-items:center;gap:8px;min-width:0}
.ar-speech-num{display:grid;place-items:center;width:24px;height:24px;flex:none;border-radius:6px;background:var(--lwb-page);color:var(--lwb-muted);font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
.ar-speech strong{min-width:0;overflow-wrap:anywhere;font-size:12px;font-weight:600}.ar-speech small{margin-left:auto;color:var(--lwb-muted);font-size:11px;white-space:nowrap}
.ar-speech p{margin:6px 0 0 32px;font-size:13px;line-height:1.65;overflow-wrap:anywhere}
.ar-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:14px 4px;border-top:1px solid var(--lwb-line);border-bottom:1px solid var(--lwb-line)}
.ar-stat{display:grid;gap:5px;min-width:0;padding:0 16px;border-left:1px solid var(--lwb-line)}.ar-stat:first-child{border-left:0}
.ar-stat span{color:var(--lwb-muted);font-size:12px}.ar-stat strong{font-size:20px;line-height:1.3;font-weight:650;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.ar-stat strong[data-tone=brand]{color:var(--ar-brand)}.ar-stat strong[data-tone=green]{color:var(--ar-green)}.ar-stat small{font-size:11px;color:var(--lwb-muted);font-weight:400}
.ar-export{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--lwb-line);padding-top:16px}
.ar-export label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--lwb-muted)}.ar-export select{width:auto;height:34px}.ar-audio input{width:16px;height:16px}
.ar-raw{border-top:1px solid var(--lwb-line);padding-top:12px}.ar-raw summary{cursor:pointer;font-size:12px;color:var(--lwb-muted)}
.ar-raw pre{font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;margin:12px 0 0;padding:16px;background:var(--lwb-surface);border:1px solid var(--lwb-line);border-radius:8px}
.ar-empty{display:grid;justify-items:center;align-content:center;gap:10px;min-height:180px;padding:28px;color:var(--lwb-muted);font-size:13px;text-align:center}
.ar-empty > svg{width:28px;height:28px;color:var(--ar-tone)}.ar-empty strong{color:var(--lwb-ink);font-size:15px}
.ar-history-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ar-history-toolbar .ar-actions{flex:1;min-width:0}
.ar-history-toolbar .ar-search{max-width:320px}.ar-history-toolbar .ar-select{width:140px}.ar-history-list{display:grid;border-top:1px solid var(--lwb-line)}
.ar-history-columns,.ar-row{display:grid;grid-template-columns:minmax(0,1fr) 160px 80px 110px 26px;gap:16px;align-items:center;min-width:0;padding:13px 16px}
.ar-history-columns{color:var(--lwb-muted);font-size:12px;background:var(--lwb-page);border-bottom:1px solid var(--lwb-line)}
.ar-row{width:100%;min-height:80px;border:0;border-bottom:1px solid var(--lwb-line);background:var(--lwb-surface);color:var(--lwb-ink);text-align:left;cursor:pointer}.ar-row:hover{background:var(--ar-brand-soft)}
.ar-row-title{display:grid;gap:5px;min-width:0}.ar-row strong{font-size:14px;font-weight:650;overflow-wrap:anywhere}
.ar-row small,.ar-row-date,.ar-row-count{font-size:12px;color:var(--lwb-muted);font-variant-numeric:tabular-nums}.ar-row > svg{width:16px;height:16px;color:var(--lwb-muted)}.ar-row > .ar-tag{justify-self:start}
.ar-game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:16px;align-items:start}
.ar-game{min-width:0;max-width:460px;border:1px solid var(--lwb-line);background:var(--lwb-surface);border-radius:10px;box-shadow:var(--ar-shadow);overflow:hidden}
.ar-game-preview{display:flex;align-items:center;justify-content:center;min-height:228px;padding:16px;border-bottom:1px solid var(--lwb-line);background:linear-gradient(135deg,#f6ead8,#ead0ad)}
.ar-game-preview > svg{display:block;width:220px;height:220px;border-radius:6px}.ar-game-body{display:grid;gap:14px;padding:18px}
.ar-game-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.ar-game h2{font-size:18px;font-weight:650}
.ar-game-rule{font-size:13px;line-height:1.7;color:var(--lwb-muted)}.ar-game-facts{display:flex;gap:6px;flex-wrap:wrap}
.ar-game-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:14px;border-top:1px solid var(--lwb-line)}.ar-game-footer > span{font-size:12px;color:var(--lwb-muted)}
.ar-video{display:block;width:100%;max-height:600px;background:#111;border-radius:8px}
@keyframes ar-place{from{opacity:.25}to{opacity:1}}@keyframes ar-pulse{50%{opacity:.35}}
@media(max-width:1100px){.ar-match{grid-template-columns:minmax(0,1.1fr) minmax(290px,.9fr)}.ar-toolbar{gap:5px;padding:10px}.ar-toolbar input[type=range]{flex-basis:110px}.ar-history-columns,.ar-row{grid-template-columns:minmax(0,1fr) 130px 55px 95px 20px;gap:12px}}
@media(max-width:820px){.ar-match{grid-template-columns:minmax(0,1fr)}.ar-commentary{height:490px;max-height:none}.ar-speaking{min-height:150px}.ar-top{flex-wrap:wrap}.ar-top h1{font-size:22px}.ar-history-columns,.ar-row{grid-template-columns:minmax(0,1fr) 90px 20px}.ar-history-columns > :nth-child(2),.ar-history-columns > :nth-child(3),.ar-row-date,.ar-row-count{display:none}}
@media(max-width:520px){.ar-page{gap:14px}.ar-top h1{font-size:20px}.ar-top-actions{width:100%}.ar-participants{grid-template-columns:1fr;gap:16px}.ar-submit{align-items:flex-start}.ar-submit .ar-muted{max-width:220px}.ar-scoreboard{padding:12px;gap:6px}.ar-player{gap:7px}.ar-player strong{font-size:12px}.ar-player small{font-size:10px}.ar-board{width:calc(100% - 20px);margin:10px auto}.ar-toolbar{gap:5px}.ar-toolbar input[type=range]{min-width:60px}.ar-commentary-head{min-height:54px;padding:12px 14px}.ar-speaking{padding:16px 14px}.ar-speaking p{font-size:16px}.ar-transcript{padding:0 14px 8px}.ar-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 0}.ar-stat:nth-child(3){border-left:0}.ar-stat strong{font-size:18px}.ar-stat{padding:0 12px}.ar-export .ar-actions{width:100%}.ar-history-toolbar .ar-search{max-width:none;flex:1}.ar-history-toolbar .ar-select{width:125px}.ar-history-columns,.ar-row{gap:8px;padding:12px 10px}.ar-row strong{font-size:13px}.ar-match-head{align-items:flex-start}.ar-match-head .ar-actions{justify-content:flex-end}.ar-tag{font-size:10px}.ar-game-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.ar-page *{animation:none!important;transition:none!important}}
`
