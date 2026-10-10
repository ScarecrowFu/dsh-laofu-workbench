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
.ar-form{display:grid;gap:16px;padding:0 0 16px}.ar-form-head{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}.ar-participants{display:grid;grid-template-columns:1fr 1fr;gap:24px}
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
/* 终局徽标：胜方「胜」、和棋两边「和」，落点朝记分板中央，两边对称。 */
.ar-player-badge{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:999px;background:var(--ar-green);color:#fff;font-size:11px;font-weight:800;font-style:normal}
.ar-player-badge[data-badge="和"]{background:var(--lwb-page);color:var(--lwb-muted);border:1px solid var(--lwb-line)}
.ar-stone{display:block;flex:none;width:19px;height:19px;border-radius:50%;background:#252b28;border:1px solid #a9b5ac;box-shadow:0 1px 2px #0001}
.ar-stone[data-player="1"]{background:#fff}.ar-vs{text-align:center;color:var(--lwb-muted);font-size:11px;font-weight:700}
.ar-player[data-game="xiangqi"] .ar-stone,.ar-participant[data-game="xiangqi"] .ar-stone{background:#b83c2e;border-color:#f0c999}
.ar-player[data-game="xiangqi"] .ar-stone[data-player="1"],.ar-participant[data-game="xiangqi"] .ar-stone[data-player="1"]{background:#252b28}
.ar-board{width:calc(100% - 32px);max-width:520px;aspect-ratio:1;margin:16px auto;position:relative;overflow:hidden;border:1px solid #9a6336;border-radius:9px;background:#c58a4d;box-shadow:0 10px 22px rgba(82,45,20,.18),inset 0 1px 0 rgba(255,245,210,.3)}
.ar-match-view[data-game="xiangqi"] .ar-board,.ar-match[data-game="xiangqi"] .ar-board{aspect-ratio:508/562}
.ar-board > svg{display:block;width:100%;height:100%}
.ar-participants[data-game="werewolf"]{grid-template-columns:repeat(3,minmax(0,1fr))}
/* 狼人杀席位舞台：安全区契约 ------------------------------------------------------
   舞台是固定 16:9 的画幅，从上到下依次是抬头、主持人播报（终局换成胜负卡）、场景留白、
   本手台词、席位条带。每一段都参与布局流，不再有 top:20% / bottom:43.5% 这类只对 6 人局
   成立的绝对定位数值：席位条带高度由行数（--ar-cast-band）决定，席卡高度由行高决定、
   立绘按原比例居中，所以 8 / 9 人是「卡片变小一档」，不是「把 8 张卡撑出画幅、裁掉第一排」。
   条带可收缩（flex:0 1 auto）：窄窗口下文字先保住可读下限，缺的高度由席卡让出来，
   任何人数都不会再把抬头、台词或胜负卡挤出画面。 */
.ar-stage{--ar-cast-band:40%;--ar-cast-cols:6;--ar-cast-rows:1;
  position:relative;container-type:inline-size;width:calc(100% - 24px);aspect-ratio:16/9;margin:12px auto;overflow:hidden;border-radius:12px;background:#0B1119;box-shadow:0 16px 36px rgba(8,12,20,.35);
  display:flex;flex-direction:column;padding:2.8% 3% 1.9%}
/* 行数由人数决定（presentation.werewolfCastLayout）：8 / 9 人折成两行，条带多让一档高度。 */
.ar-stage[data-rows="2"]{--ar-cast-band:48%}
.ar-stage[data-rows="3"]{--ar-cast-band:52%}
.ar-stage-scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 32%}
.ar-stage-mask{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,10,16,.72),rgba(6,10,16,.12) 26%,rgba(6,10,16,.2) 50%,rgba(6,10,16,.88)),radial-gradient(120% 78% at 50% 46%,rgba(0,0,0,0) 38%,rgba(4,7,12,.66))}
.ar-stage[data-scene="day"] .ar-stage-mask{background:linear-gradient(180deg,rgba(12,18,26,.46),rgba(12,18,26,.04) 26%,rgba(12,18,26,.14) 50%,rgba(10,16,24,.84)),radial-gradient(120% 78% at 50% 46%,rgba(0,0,0,0) 44%,rgba(20,26,18,.4))}
.ar-stage-head{position:relative;z-index:2;flex:none;display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.ar-stage-day{display:inline-flex;align-items:center;height:20px;padding:0 9px;border-radius:999px;background:rgba(9,13,20,.55);border:1px solid rgba(255,255,255,.22);color:#E8EEF6;font-size:11px;font-size:clamp(9px,.92cqw,11px);font-weight:700;letter-spacing:.04em}
.ar-stage-phase{font-size:clamp(14px,2.25cqw,27px);font-weight:800;line-height:1.1;color:#fff;text-shadow:0 3px 16px rgba(0,0,0,.75)}
.ar-stage[data-scene="day"] .ar-stage-phase{color:#FFF7E6}
.ar-stage[data-act="death"] .ar-stage-phase{color:#FFD9D3}
.ar-stage-host{position:relative;z-index:2;flex:none;margin-top:4%;max-width:64%;display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.ar-host-badge{display:inline-flex;align-items:center;height:18px;padding:0 9px;border-radius:999px;background:rgba(224,163,46,.18);border:1px solid rgba(224,163,46,.55);color:#F2DCA8;font-size:10px;font-size:clamp(8px,.84cqw,10px);font-weight:800;font-style:normal;letter-spacing:.14em}
/* 台词最多两行（line-clamp）：整句仍在 DOM 与 title 里，画面上不会把席位条带顶下去。 */
.ar-stage-host p{margin:0;padding:5px 13px;border-radius:9px;background:rgba(8,12,18,.74);border:1px solid rgba(255,255,255,.14);color:#F6F1E4;font-size:13px;font-size:clamp(10px,1.08cqw,13px);font-weight:700;line-height:1.45;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
/* 票型条：谁几票、这一轮是怎么裁的。它回答的是「为什么出局」，所以与主持人播报分两格 ——
   主持人说的是阶段与出局名单，这里说的是票数。一行放不下时省略号收尾，整句在 title 里；
   谁投了谁由席卡里的「→N」回答，不塞进这一行（9 人局 9 个投票人必然溢出）。
   选择器带 .ar-stage 前缀，压过页面基线的 .ar-page p{margin:0}（(0,2,1) > (0,1,1)）。 */
.ar-stage .ar-stage-vote{position:relative;z-index:2;flex:none;margin:2.4% 0 0 5%;max-width:64%;display:flex;align-items:center;gap:6px}
.ar-vote-badge{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 9px;border-radius:999px;background:rgba(55,138,221,.2);border:1px solid rgba(55,138,221,.55);color:#CFE3FA;font-size:10px;font-size:clamp(8px,.84cqw,10px);font-weight:800;font-style:normal;letter-spacing:.14em}
.ar-stage .ar-stage-vote p{margin:0;min-width:0;padding:5px 13px;border-radius:9px;background:rgba(8,12,18,.74);border:1px solid rgba(255,255,255,.14);color:#F6F1E4;font-size:13px;font-size:clamp(10px,1.08cqw,13px);font-weight:700;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 平票用琥珀、出结果用红：与「进入复投 / 被放逐」两种裁决一一对应，颜色不再兼两义。 */
.ar-stage .ar-stage-vote[data-tone="tie"] .ar-vote-badge{background:rgba(224,163,46,.2);border-color:rgba(224,163,46,.55);color:#F4DFAE}
.ar-stage .ar-stage-vote[data-tone="result"] .ar-vote-badge{background:rgba(180,52,42,.26);border-color:rgba(224,110,96,.6);color:#FFD9D3}
/* 场景留白：唯一可伸缩的一段。抬头、台词与席位条带都是 flex:none，谁也挤不掉谁。 */
.ar-stage-center{position:relative;z-index:1;flex:1 1 auto;min-height:0}
/* 席位条带：高度按行数取（可被压缩），列数 / 行数来自内联的 --ar-cast-cols / --ar-cast-rows。
   上边距给第一排的席位号徽标（top:-8px）留位，终局没有台词时也不会压到胜负卡上。 */
.ar-stage-cast{position:relative;z-index:2;flex:0 1 auto;min-height:0;height:var(--ar-cast-band);margin-top:1.6%;display:grid;grid-template-columns:repeat(var(--ar-cast-cols,6),minmax(0,1fr));grid-template-rows:repeat(var(--ar-cast-rows,1),minmax(0,1fr));column-gap:1.1%;row-gap:5%}
.ar-cast{position:relative;margin:0;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;min-height:0}
.ar-cast-no{position:absolute;left:50%;top:-8px;transform:translateX(-50%);z-index:2;display:flex;width:17px;height:17px;align-items:center;justify-content:center;border-radius:50%;background:rgba(10,14,22,.86);border:1px solid rgba(255,255,255,.34);color:#F2F6FB;font-size:10px;font-weight:800}
/* 席卡高度由行高决定、宽度填满单元格：立绘按 2:3 居中留边。8 / 9 人是卡片变小，
   画面预算（抬头 + 台词 + 条带）因此与人数无关，不需要为每个档位写一套魔数。 */
.ar-cast-face{position:relative;display:block;width:100%;flex:1 1 auto;min-height:0;border-radius:9px;overflow:hidden;background:linear-gradient(180deg,rgba(24,34,48,.5),rgba(10,15,22,.72));border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 22px rgba(3,6,12,.5);transition:border-color .25s ease,box-shadow .25s ease}
.ar-cast-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;transition:filter .3s ease,transform .25s ease}
.ar-cast-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,10,16,0) 48%,rgba(6,10,16,.6))}
.ar-cast[data-active="true"] .ar-cast-face{border-color:#E0A32E;box-shadow:0 0 0 2px rgba(224,163,46,.5),0 12px 26px rgba(3,6,12,.6)}
.ar-cast[data-active="true"] .ar-cast-face img{transform:translateY(-4px) scale(1.04)}
.ar-cast[data-alive="false"] .ar-cast-face{border-color:rgba(180,52,42,.6)}
.ar-cast[data-alive="false"] .ar-cast-face img{filter:grayscale(1) brightness(.46) contrast(1.05)}
/* 终局：胜方阵营的席卡加金框，口径与离线回放的 data-win 一致；死掉的胜方仍保留灰化。 */
.ar-cast[data-win="true"] .ar-cast-face{border-color:#E0A32E;box-shadow:0 0 0 2px rgba(224,163,46,.5),0 10px 22px rgba(3,6,12,.55)}
.ar-cast-out{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);padding:1px 7px;border-radius:999px;background:#B4342A;color:#fff;font-size:9px;font-weight:800;letter-spacing:.14em;white-space:nowrap}
/* 本轮票型：箭头挂在投出票的那张卡上（→N），票数挂在被投的那张卡上（N 票）。
   两块都在立绘框内，席卡高度一个像素都不变 —— 8 / 9 人局加不起任何常驻行。
   颜色只给「最高票」：单一领先用红（与出局同一语义），平票用琥珀（与复投同一语义）。 */
.ar-cast-vote,.ar-cast-tally{position:absolute;top:3px;z-index:2;display:inline-flex;align-items:center;height:15px;padding:0 5px;border-radius:5px;background:rgba(10,14,22,.86);border:1px solid rgba(255,255,255,.42);color:#F3F7FC;font-size:9px;font-weight:800;font-style:normal;line-height:1;white-space:nowrap;box-shadow:0 2px 8px rgba(3,6,12,.55)}
.ar-cast-vote{right:3px}
.ar-cast-tally{left:3px}
.ar-cast-tally[data-lead="one"]{background:#B4342A;border-color:#FFB4A8;color:#fff}
.ar-cast-tally[data-lead="tie"]{background:#B98418;border-color:#FFDF9E;color:#fff}
.ar-cast figcaption{display:flex;align-items:center;justify-content:center;gap:4px;max-width:100%;flex:none}
.ar-cast figcaption b{font-size:10px;font-weight:700;color:#F3F7FC;text-shadow:0 1px 4px rgba(0,0,0,.85);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 窄舞台（窗口本身也窄）：两行席位每排只剩几十像素高，署名让位给立绘——姓名、身份、
   席号在右侧「选手发言」表头与回合记录里都有，不靠这张小图。用 height:0 + overflow:hidden
   而不是 display:none：文本留在 DOM 里，读屏与测试仍读得到。 */
@container (max-width:600px){.ar-cast figcaption{height:0;overflow:hidden}}
.ar-cast-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;border-radius:5px;background:var(--ar-green);color:#fff;font-size:9px;font-weight:800;font-style:normal;flex:none}
.ar-cast-badge[data-badge="负"]{background:rgba(255,255,255,.22);color:#EAF0F7}
.ar-role-mark{display:inline-flex;width:15px;height:15px;flex:none;align-items:center;justify-content:center;border-radius:4px;background:rgba(255,255,255,.86);color:#1B232C;font-size:9px;font-weight:800;font-style:normal}
.ar-role-mark[data-role="werewolf"]{background:#D9534A;color:#fff}
.ar-role-mark[data-role="seer"]{background:#5B93E0;color:#fff}
.ar-role-mark[data-role="witch"]{background:#9A6BD6;color:#fff}
.ar-role-mark[data-role="hunter"]{background:#E0A32E;color:#3A2A08}
/* 本手台词：坐在席位条带正上方（不再是写死的 bottom:43.5%，那个数值只对 6 人局成立）。
   选择器必须带 .ar-stage 前缀：页面基线的 .ar-page p{margin:0} 是 (0,1,1)，
   单写 .ar-stage-line 只有 (0,1,0)，左右留白会被它清成 0。 */
.ar-stage .ar-stage-line{position:relative;z-index:2;flex:none;margin:0 5%;padding:5px 12px;border-radius:8px;background:rgba(8,12,18,.72);color:#f4efe4;text-align:center;font-size:13px;font-size:clamp(10px,1.08cqw,13px);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 终局卡：占主持人那一格，不再飘在画面正中压住席卡；条带因此永远在它下面。 */
.ar-stage-win{position:relative;z-index:2;flex:none;align-self:center;max-width:82%;margin:2% 0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 24px;border-radius:14px;background:rgba(8,12,19,.74);border:1px solid rgba(224,163,46,.6);box-shadow:0 20px 50px rgba(2,5,10,.6);text-align:center}
.ar-stage-win b{font-size:clamp(16px,2cqw,28px);font-weight:900;letter-spacing:.06em;color:#E0A32E}
.ar-stage-win[data-side="wolf"] b{color:#FF7A6E}
.ar-stage-win span{font-size:11px;font-size:clamp(10px,.92cqw,12px);font-weight:600;color:#EAF0F7;max-width:520px;line-height:1.5}
/* 最后一手的入场动画必须用 :last-of-type 而不是 :last-child：胜局图层会在棋子之后
   追加 <circle class="winring">，象棋本来也在棋子之后画最后一手圈，:last-child 会静默失效。 */
.ar-board svg g:last-of-type{animation:ar-place .25s ease-out}
/* 胜局图层：金带铺底 + 五颗连子点亮，与离线回放同构（观战版动效更短、不做逐颗延迟）。 */
.ar-board svg line.winband{animation:ar-band .5s ease-out both}
.ar-board svg circle.winring{transform-box:fill-box;transform-origin:center;animation:ar-winring .46s cubic-bezier(.2,.8,.3,1) both}
/* 终局那颗子会同时拿到「最后一手」圈与金色连子环，橙红与金相邻会糊成一圈：
   照离线回放的做法把最后一手圈改成品牌色（蓝在内、金在外）。 */
.ar-board[data-win="true"] svg circle[stroke="#e45d3c"]{stroke:var(--ar-cyan)}
.ar-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--lwb-line);background:var(--lwb-surface)}
.ar-toolbar input[type=range]{flex:1;min-width:76px;accent-color:var(--ar-brand);margin:0 4px}
.ar-toolbar .ar-select{width:64px;height:34px;padding:0 6px}
.ar-counter{font-variant-numeric:tabular-nums;font-size:12px;min-width:48px;text-align:center;color:var(--lwb-muted)}
.ar-live{color:var(--ar-brand);border-color:var(--ar-brand);background:var(--ar-brand-soft)}
.ar-commentary{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;max-height:690px;border:1px solid var(--lwb-line);border-radius:10px;background:var(--lwb-surface);box-shadow:var(--ar-shadow);overflow:hidden}
.ar-commentary-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:66px;padding:15px 18px;border-bottom:1px solid var(--lwb-line)}
.ar-commentary-head .ar-chip{margin-left:auto;color:var(--ar-cyan);background:var(--ar-cyan-soft);white-space:nowrap}
/* 终局胶囊：文案与配色档位来自 presentation.finaleInfo，和离线回放的 heroTag 同源。 */
.ar-pill{display:inline-flex;align-items:center;min-height:23px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid transparent;color:var(--lwb-muted);background:var(--lwb-page);border-color:var(--lwb-line)}
.ar-pill[data-tone=win]{color:#fff;background:var(--ar-green);border-color:var(--ar-green)}
.ar-pill[data-tone=warn]{color:var(--ar-amber);background:var(--ar-amber-soft);border-color:var(--ar-amber)}
.ar-speaking{margin:0;padding:20px 18px;border-bottom:1px solid var(--lwb-line);min-height:180px;flex:none;background:var(--lwb-surface);display:flex;align-items:flex-start;gap:16px}
.ar-speaking-body{flex:1;min-width:0}
/* 观战页的模型形象：与离线回放/视频同源（只有人物、没有底板，logo 贴人物左上角）。
   尺寸用 cqw 跟随窗口收缩——观战页是响应式窗口，而导出侧是固定画布（66×86）。 */
.ar-speaking-figure{position:relative;flex:none;width:clamp(44px,5.4cqw,66px);aspect-ratio:66/86}
.ar-speaking-face{position:absolute;left:0;bottom:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 6px 13px rgba(20,24,26,.26))}
.ar-speaking-mark{position:absolute;left:-4px;top:-4px;width:clamp(20px,2.3cqw,28px);aspect-ratio:1;border-radius:50%;background:#fff;box-shadow:0 2px 7px rgba(20,24,26,.28);outline:1.5px solid #fff}
/* 本手没有发言：这一格里只有 logo，它就是主标（不画人，但盒子仍占位，高度不跳） */
.ar-speaking-figure[data-quiet=true] .ar-speaking-mark{left:0;bottom:0;top:auto;width:clamp(34px,4.3cqw,52px);outline-width:0;box-shadow:0 2px 8px rgba(20,24,26,.16)}
.ar-speaking-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650;overflow-wrap:anywhere}
.ar-speaking-name svg{width:16px;height:16px;flex:none;color:var(--ar-tone)}
.ar-speaking p{font-size:18px;font-weight:600;line-height:1.75;margin:12px 0;overflow-wrap:anywhere}.ar-speaking small{font-size:12px;color:var(--lwb-muted)}
.ar-speaking[data-thinking=true] p{color:var(--lwb-muted);font-weight:400}
.ar-generation{display:grid;gap:8px}.ar-generation > div{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.ar-generation small:last-child{font-variant-numeric:tabular-nums}
.ar-result{display:flex;align-items:center;gap:9px;margin:0;padding:12px 18px;color:var(--ar-green);background:var(--ar-green-soft);font-size:13px;font-weight:600;overflow-wrap:anywhere;flex:none}.ar-result svg{width:17px;height:17px;flex:none}
/* 和棋、判负、取消都不是胜利：不能沿用胜利绿 + 奖杯。 */
.ar-result[data-tone=draw],.ar-result[data-tone=plain]{color:var(--lwb-muted);background:var(--lwb-page)}
.ar-result[data-tone=warn]{color:var(--ar-amber);background:var(--ar-amber-soft)}
/* 判罚明细：判负裁决的是协议遵守度，不是棋力，所以要写清「第几手、连续几次、每次为什么」。
   配色沿用警告琥珀，与终局胶囊的 data-tone=warn 同源，不借胜利绿。 */
.ar-forfeit{display:grid;gap:8px;padding:12px 18px;border-bottom:1px solid var(--lwb-line);background:var(--ar-amber-soft);color:var(--ar-amber);font-size:12px;flex:none}
.ar-forfeit-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ar-forfeit-head strong{font-size:13px;font-weight:650}
.ar-forfeit-head span{color:var(--lwb-muted);font-size:11px;font-variant-numeric:tabular-nums}
.ar-forfeit-list{display:grid;gap:5px;margin:0;padding:0;list-style:none}
.ar-forfeit-list li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
.ar-forfeit-list i{font-style:normal;color:var(--lwb-muted);font-size:11px;white-space:nowrap}
.ar-forfeit-list span{color:var(--lwb-ink);overflow-wrap:anywhere}
.ar-forfeit .ar-raw{padding-top:8px}
.ar-forfeit-raw pre{max-height:150px;margin-top:8px;padding:10px;font-size:11px}
/* 被判负的那一手在回合记录里占位：它没有落子、发言也从未生效，样式必须和可点的发言分开。 */
.ar-speech[data-invalid=true]{cursor:default}
.ar-speech[data-invalid=true]:hover{color:var(--lwb-ink)}
.ar-speech[data-invalid=true] .ar-speech-num{background:var(--ar-amber-soft);color:var(--ar-amber)}
.ar-speech[data-invalid=true] small{color:var(--ar-amber)}
.ar-transcript-title{display:flex;justify-content:space-between;gap:8px;padding:12px 18px 4px;color:var(--lwb-muted);font-size:11px;flex:none}
.ar-transcript{flex:1;min-height:120px;overflow:auto;padding:0 18px 8px;display:grid;grid-auto-rows:max-content;align-content:start;overscroll-behavior:contain}
.ar-speech{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--lwb-line);background:transparent;color:var(--lwb-ink);padding:12px 0;cursor:pointer}
.ar-speech:last-child{border-bottom:0}.ar-speech:hover{color:var(--ar-brand)}
.ar-speech-head{display:flex;align-items:center;gap:8px;min-width:0}
.ar-speech-num{display:grid;place-items:center;width:24px;height:24px;flex:none;border-radius:6px;background:var(--lwb-page);color:var(--lwb-muted);font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
.ar-speech strong{min-width:0;overflow-wrap:anywhere;font-size:12px;font-weight:600}.ar-speech small{margin-left:auto;color:var(--lwb-muted);font-size:11px;white-space:nowrap}
.ar-speech p{margin:6px 0 0 32px;font-size:13px;line-height:1.65;overflow-wrap:anywhere}
/* 席位与身份：狼人杀的发言署名与回合记录直接回答「几号、什么身份」。
   从前只有模型名，观众得自己把名字对到舞台席卡上，而同供应商的不同模型经常同名。
   村民在舞台上是白底深字（画在暗场景里），浅色侧栏照搬会看不见，所以这里自带一套
   浅色配色，深色主题另给一档亮一点的文字色。两个元素都 flex:none：模型名可以被压行，
   席号与身份不能被压掉。棋类不渲染它们。 */
.ar-seat{flex:none;color:var(--lwb-muted);font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
.ar-speech .ar-seat{margin-right:-2px}
.ar-role{display:inline-flex;align-items:center;gap:5px;flex:none;margin-left:-2px;font-size:11px;font-weight:700;font-style:normal;color:var(--ar-role-ink,#4A555F)}
.ar-role i{display:inline-flex;width:15px;height:15px;align-items:center;justify-content:center;border-radius:4px;background:var(--ar-role-fill,#6B7684);color:var(--ar-role-on,#fff);font-size:9px;font-weight:800;font-style:normal}
.ar-role[data-role=werewolf]{--ar-role-fill:#D9534A;--ar-role-ink:#A93127}
.ar-role[data-role=seer]{--ar-role-fill:#5B93E0;--ar-role-ink:#2C5FA8}
.ar-role[data-role=witch]{--ar-role-fill:#9A6BD6;--ar-role-ink:#6B44A3}
/* 琥珀底配白字看不清：猎人徽记与舞台席卡一样用深字。 */
.ar-role[data-role=hunter]{--ar-role-fill:#E0A32E;--ar-role-on:#3A2A08;--ar-role-ink:#8A610F}
.ar-role[data-role=villager]{--ar-role-fill:#6B7684;--ar-role-ink:#4A555F}
body[data-ds-dark-theme] .ar-page .ar-role[data-role=werewolf]{--ar-role-ink:#F0A29B}
body[data-ds-dark-theme] .ar-page .ar-role[data-role=seer]{--ar-role-ink:#A8C8F2}
body[data-ds-dark-theme] .ar-page .ar-role[data-role=witch]{--ar-role-ink:#C6ABEC}
body[data-ds-dark-theme] .ar-page .ar-role[data-role=hunter]{--ar-role-ink:#EBC77E}
body[data-ds-dark-theme] .ar-page .ar-role[data-role=villager]{--ar-role-ink:#C3CCD6}
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
.ar-history-columns,.ar-row{display:grid;grid-template-columns:minmax(0,1fr) 140px 70px 150px 110px 26px;gap:16px;align-items:center;min-width:0;padding:13px 16px}
.ar-history-columns{color:var(--lwb-muted);font-size:12px;background:var(--lwb-page);border-bottom:1px solid var(--lwb-line)}
.ar-row{width:100%;min-height:80px;border:0;border-bottom:1px solid var(--lwb-line);background:var(--lwb-surface);color:var(--lwb-ink);text-align:left;cursor:pointer}.ar-row:hover{background:var(--ar-brand-soft)}
.ar-row-title{display:grid;gap:5px;min-width:0}.ar-row strong{font-size:14px;font-weight:650;overflow-wrap:anywhere}
.ar-row small,.ar-row-date,.ar-row-count{font-size:12px;color:var(--lwb-muted);font-variant-numeric:tabular-nums}.ar-row > svg{width:16px;height:16px;color:var(--lwb-muted)}.ar-row > .ar-tag{justify-self:start}
/* 结果列：未裁决显示占位符，列宽不随内容跳动；长模型名截断，完整裁决话术交给 title。 */
.ar-outcome{justify-self:start;min-width:0;max-width:100%;font-size:12px;font-weight:650;color:var(--lwb-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-outcome[data-outcome=win]{color:var(--ar-green)}
/* 游戏库卡片 --------------------------------------------------------------
   封面锁 16:10，媒体由带尺寸的包裹层（.ar-game-board）承载；
   卡片是 flex 列，页脚 margin-top:auto，三张卡等高且 CTA 对齐。 */
.ar-game-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:18px;max-width:1440px;margin:0 auto}
.ar-game{--ar-game-accent:var(--ar-brand);--ar-game-soft:var(--ar-brand-soft);--ar-game-cover:linear-gradient(140deg,#eef1f5,#dde3ea);display:flex;flex-direction:column;min-width:0;border:1px solid var(--lwb-line);border-radius:12px;background:var(--lwb-surface);box-shadow:var(--ar-shadow);overflow:hidden;transition:border-color .18s ease,box-shadow .18s ease}
.ar-game:hover{border-color:color-mix(in srgb,var(--ar-game-accent) 42%,var(--lwb-line));box-shadow:0 12px 30px color-mix(in srgb,var(--ar-game-accent) 16%,transparent)}
.ar-game[data-game=gomoku]{--ar-game-accent:#b97016;--ar-game-soft:#fff5e7;--ar-game-cover:radial-gradient(120% 92% at 50% 4%,#fffaef,#f2ddbe 46%,#ddc094)}
.ar-game[data-game=xiangqi]{--ar-game-accent:#b83c2e;--ar-game-soft:#fdeeeb;--ar-game-cover:radial-gradient(120% 92% at 50% 4%,#fff7f2,#f2d5c6 46%,#dcb19c)}
.ar-game[data-game=werewolf]{--ar-game-accent:#2f4b7c;--ar-game-soft:#eaf0fa;--ar-game-cover:linear-gradient(150deg,#16202f,#0b1119)}
body[data-ds-dark-theme] .ar-page .ar-game[data-game=gomoku]{--ar-game-accent:#f0b45b;--ar-game-soft:#3e3024;--ar-game-cover:radial-gradient(120% 92% at 50% 4%,#3b2c1d,#251a12 55%,#15100a)}
body[data-ds-dark-theme] .ar-page .ar-game[data-game=xiangqi]{--ar-game-accent:#f08b78;--ar-game-soft:#3b2525;--ar-game-cover:radial-gradient(120% 92% at 50% 4%,#301f1b,#221513 55%,#140c0b)}
body[data-ds-dark-theme] .ar-page .ar-game[data-game=werewolf]{--ar-game-accent:#8fb0ea;--ar-game-soft:#20304f;--ar-game-cover:linear-gradient(150deg,#111a27,#080d14)}
.ar-game-cover{position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--ar-game-cover);border-bottom:1px solid var(--lwb-line)}
.ar-game-cover::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(8,12,18,0) 56%,rgba(8,12,18,.42))}
.ar-game-cover-art{position:absolute;inset:0;display:grid;place-items:center;padding:14px}
.ar-game-board{display:grid;place-items:center;height:100%;min-height:0}
.ar-game-board > svg{display:block;width:auto;height:100%;max-width:100%;border-radius:8px;box-shadow:0 12px 26px rgba(60,32,10,.28)}
.ar-game-poster{display:grid;place-items:center;width:100%;height:100%}
.ar-game-poster span{font-size:64px;font-weight:800;color:color-mix(in srgb,var(--ar-game-accent) 55%,transparent)}
.ar-game-cover-badge{position:absolute;left:12px;top:12px;z-index:3;display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;background:rgba(255,255,255,.84);color:#1D2733;font-size:11px;font-weight:800;letter-spacing:.08em;box-shadow:0 2px 8px rgba(10,14,20,.16)}
.ar-game-cover-note{position:absolute;right:13px;bottom:11px;z-index:3;color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 8px rgba(0,0,0,.72)}
.ar-wf{position:absolute;inset:0;padding:0}
.ar-wf-scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%}
.ar-wf-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,10,16,.70),rgba(6,10,16,.14) 26%,rgba(6,10,16,.30) 48%,rgba(6,10,16,.90))}
.ar-wf-head{position:absolute;left:14px;top:44px;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
.ar-wf-head span{display:inline-flex;align-items:center;height:19px;padding:0 8px;border-radius:999px;background:rgba(9,13,20,.6);border:1px solid rgba(255,255,255,.22);color:#E8EEF6;font-size:10px;font-weight:750;letter-spacing:.05em}
.ar-wf-head strong{color:#fff;font-size:15px;font-weight:800;text-shadow:0 3px 14px rgba(0,0,0,.8)}
.ar-wf-cast{position:absolute;left:12px;right:12px;bottom:32px;z-index:3;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;align-items:end}
.ar-wf-seat{position:relative;margin:0;aspect-ratio:3/4;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:linear-gradient(180deg,rgba(24,34,48,.6),rgba(10,15,22,.8));box-shadow:0 8px 18px rgba(3,6,12,.5)}
.ar-wf-seat::after{content:"";position:absolute;inset:0;border-radius:7px;background:linear-gradient(180deg,rgba(6,10,16,0) 46%,rgba(6,10,16,.72))}
.ar-wf-seat > img{position:absolute;inset:0;width:100%;height:100%;border-radius:7px;object-fit:cover;object-position:center 10%}
.ar-wf-seat[data-active=true]{border-color:#E0A32E;box-shadow:0 0 0 2px rgba(224,163,46,.55),0 10px 22px rgba(3,6,12,.6)}
.ar-wf-no{position:absolute;left:50%;top:-7px;z-index:4;display:grid;place-items:center;width:16px;height:16px;transform:translateX(-50%);border-radius:50%;background:rgba(10,14,22,.88);border:1px solid rgba(255,255,255,.34);color:#F2F6FB;font-size:9px;font-weight:800}
.ar-wf-mark{position:absolute;left:50%;bottom:4px;z-index:4;display:grid;place-items:center;width:17px;height:17px;transform:translateX(-50%);border-radius:5px;font-size:10px;font-weight:800;font-style:normal}
.ar-wf-mark[data-role=werewolf]{background:#D9534A;color:#fff}
.ar-wf-mark[data-role=seer]{background:#5B93E0;color:#fff}
.ar-wf-mark[data-role=witch]{background:#9A6BD6;color:#fff}
.ar-wf-mark[data-role=hunter]{background:#E0A32E;color:#3A2A08}
.ar-wf-mark[data-role=villager]{background:rgba(255,255,255,.88);color:#1B232C}
.ar-game-body{display:flex;flex:1;flex-direction:column;gap:12px;padding:16px 18px 18px}
.ar-game-title{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ar-game h2{font-size:18px;font-weight:700}
.ar-game-title .ar-chip[data-tone=page]{color:var(--ar-game-accent);background:var(--ar-game-soft);border:1px solid color-mix(in srgb,var(--ar-game-accent) 26%,transparent)}
.ar-game-rule{font-size:13px;line-height:1.7;color:var(--lwb-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ar-game-facts{display:flex;gap:6px;flex-wrap:wrap}
.ar-game-footer{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:14px;border-top:1px solid var(--lwb-line)}
.ar-game-footer > span{font-size:12px;color:var(--lwb-muted)}
.ar-game-live{color:var(--ar-game-accent);font-weight:750}
.ar-game .ar-primary{border-color:var(--ar-game-accent);background:var(--ar-game-accent);color:var(--ar-on-brand);box-shadow:0 4px 12px color-mix(in srgb,var(--ar-game-accent) 26%,transparent)}
.ar-game .ar-primary:hover{border-color:var(--ar-game-accent);color:var(--ar-on-brand);filter:brightness(.95)}
.ar-video{display:block;width:100%;max-height:600px;background:#111;border-radius:8px}
@keyframes ar-place{from{opacity:.25}to{opacity:1}}@keyframes ar-pulse{50%{opacity:.35}}
@keyframes ar-band{from{opacity:0}to{opacity:.55}}
@keyframes ar-winring{from{opacity:0;transform:scale(.45)}to{opacity:1;transform:scale(1)}}
@media(max-width:1100px){.ar-match{grid-template-columns:minmax(0,1.1fr) minmax(290px,.9fr)}.ar-toolbar{gap:5px;padding:10px}.ar-toolbar input[type=range]{flex-basis:110px}.ar-history-columns,.ar-row{grid-template-columns:minmax(0,1fr) 115px 50px 120px 95px 20px;gap:12px}}
@media(max-width:820px){.ar-match{grid-template-columns:minmax(0,1fr)}.ar-commentary{height:490px;max-height:none}.ar-speaking{min-height:150px}.ar-top{flex-wrap:wrap}.ar-top h1{font-size:22px}.ar-history-columns,.ar-row{grid-template-columns:minmax(0,1fr) 120px 80px 20px}.ar-history-columns > :nth-child(2),.ar-history-columns > :nth-child(3),.ar-row-date,.ar-row-count{display:none}/* 窄屏结果列是唯一结果入口：允许换行，别把长模型名截掉。 */.ar-outcome{white-space:normal;overflow-wrap:anywhere}}
@media(max-width:520px){.ar-page{gap:14px}.ar-top h1{font-size:20px}.ar-top-actions{width:100%}.ar-participants{grid-template-columns:1fr;gap:16px}.ar-submit{align-items:flex-start}.ar-submit .ar-muted{max-width:220px}.ar-scoreboard{padding:12px;gap:6px}.ar-player{gap:7px}.ar-player strong{font-size:12px}.ar-player small{font-size:10px}.ar-board{width:calc(100% - 20px);margin:10px auto}.ar-toolbar{gap:5px}.ar-toolbar input[type=range]{min-width:60px}.ar-commentary-head{min-height:54px;padding:12px 14px}.ar-speaking{padding:16px 14px}.ar-speaking p{font-size:16px}.ar-transcript{padding:0 14px 8px}.ar-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 0}.ar-stat:nth-child(3){border-left:0}.ar-stat strong{font-size:18px}.ar-stat{padding:0 12px}.ar-export .ar-actions{width:100%}.ar-history-toolbar .ar-search{max-width:none;flex:1}.ar-history-toolbar .ar-select{width:125px}.ar-history-columns,.ar-row{gap:8px;padding:12px 10px}.ar-row strong{font-size:13px}.ar-match-head{align-items:flex-start}.ar-match-head .ar-actions{justify-content:flex-end}.ar-tag{font-size:10px}.ar-outcome{font-size:10px}.ar-game-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.ar-page *{animation:none!important;transition:none!important}}
/* 窄屏：狼人杀的 8 / 9 人档位也走单列，三列模型选择在手机上放不下。 */
@media(max-width:520px){.ar-participants[data-game="werewolf"]{grid-template-columns:1fr}}
`
