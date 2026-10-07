window.__ModuleLoader__.load({id:"@scitiger-ai/lwb-ai-arena",inject:["@scitiger-ai/lwb-dsh-bundle"],external:["react"],factory(require){const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lwb/packs/ai-arena/client-source.mjs
var client_source_exports = {};
__export(client_source_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_source_exports);
var import_react4 = __toESM(require("react"), 1);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = require("react");

// node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// node_modules/lucide-react/dist/esm/Icon.js
var import_react = require("react");

// node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// node_modules/lucide-react/dist/esm/Icon.js
var Icon = (0, import_react.forwardRef)(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return (0, import_react.createElement)(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => (0, import_react.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = (0, import_react2.forwardRef)(
    ({ className, ...props }, ref) => (0, import_react2.createElement)(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};

// node_modules/lucide-react/dist/esm/icons/arrow-left.js
var ArrowLeft = createLucideIcon("ArrowLeft", [
  ["path", { d: "m12 19-7-7 7-7", key: "1l729n" }],
  ["path", { d: "M19 12H5", key: "x3x0zl" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-down.js
var ChevronDown = createLucideIcon("ChevronDown", [
  ["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-left.js
var ChevronLeft = createLucideIcon("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// node_modules/lucide-react/dist/esm/icons/download.js
var Download = createLucideIcon("Download", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "7 10 12 15 17 10", key: "2ggqvy" }],
  ["line", { x1: "12", x2: "12", y1: "15", y2: "3", key: "1vk2je" }]
]);

// node_modules/lucide-react/dist/esm/icons/eye.js
var Eye = createLucideIcon("Eye", [
  [
    "path",
    {
      d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      key: "1nclc0"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);

// node_modules/lucide-react/dist/esm/icons/file-text.js
var FileText = createLucideIcon("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);

// node_modules/lucide-react/dist/esm/icons/film.js
var Film = createLucideIcon("Film", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M7 3v18", key: "bbkbws" }],
  ["path", { d: "M3 7.5h4", key: "zfgn84" }],
  ["path", { d: "M3 12h18", key: "1i2n21" }],
  ["path", { d: "M3 16.5h4", key: "1230mu" }],
  ["path", { d: "M17 3v18", key: "in4fa5" }],
  ["path", { d: "M17 7.5h4", key: "myr1c1" }],
  ["path", { d: "M17 16.5h4", key: "go4c1d" }]
]);

// node_modules/lucide-react/dist/esm/icons/message-circle.js
var MessageCircle = createLucideIcon("MessageCircle", [
  ["path", { d: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z", key: "vv11sd" }]
]);

// node_modules/lucide-react/dist/esm/icons/pause.js
var Pause = createLucideIcon("Pause", [
  ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1", key: "zuxfzm" }],
  ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1", key: "1okwgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/radio.js
var Radio = createLucideIcon("Radio", [
  ["path", { d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9", key: "1vaf9d" }],
  ["path", { d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", key: "u1ii0m" }],
  ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }],
  ["path", { d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", key: "1j5fej" }],
  ["path", { d: "M19.1 4.9C23 8.8 23 15.1 19.1 19", key: "10b0cb" }]
]);

// node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var RefreshCw = createLucideIcon("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
]);

// node_modules/lucide-react/dist/esm/icons/settings-2.js
var Settings2 = createLucideIcon("Settings2", [
  ["path", { d: "M20 7h-9", key: "3s1dr2" }],
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
]);

// node_modules/lucide-react/dist/esm/icons/skip-back.js
var SkipBack = createLucideIcon("SkipBack", [
  ["polygon", { points: "19 20 9 12 19 4 19 20", key: "o2sva" }],
  ["line", { x1: "5", x2: "5", y1: "19", y2: "5", key: "1ocqjk" }]
]);

// node_modules/lucide-react/dist/esm/icons/square.js
var Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);

// node_modules/lucide-react/dist/esm/icons/trophy.js
var Trophy = createLucideIcon("Trophy", [
  ["path", { d: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6", key: "17hqa7" }],
  ["path", { d: "M18 9h1.5a2.5 2.5 0 0 0 0-5H18", key: "lmptdp" }],
  ["path", { d: "M4 22h16", key: "57wxv0" }],
  ["path", { d: "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22", key: "1nw9bq" }],
  ["path", { d: "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22", key: "1np0yb" }],
  ["path", { d: "M18 2H6v7a6 6 0 0 0 12 0V2Z", key: "u46fv3" }]
]);

// node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// lwb/packs/ai-arena/presentation.mjs
var movesOf = (match) => (match.events || []).filter((event) => event.type === "move");
var gameName = (game) => game?.name || (game?.id === "xiangqi" ? "\u4E2D\u56FD\u8C61\u68CB" : "\u4E94\u5B50\u68CB");
var playerSide = (game, player) => game?.id === "xiangqi" ? player ? "\u9ED1\u65B9" : "\u7EA2\u65B9" : player ? "\u767D\u65B9" : "\u9ED1\u65B9";
var actionLabel = (action, game) => game?.id === "xiangqi" || action?.from && action?.to ? Number.isInteger(action?.from?.row) && Number.isInteger(action?.from?.col) && Number.isInteger(action?.to?.row) && Number.isInteger(action?.to?.col) ? `${action.from.row}\u884C${action.from.col}\u5217 \u2192 ${action.to.row}\u884C${action.to.col}\u5217` : "\u7B49\u5F85\u8D70\u5B50" : Number.isInteger(action?.row) && Number.isInteger(action?.col) ? `${action.row} \u884C ${action.col} \u5217` : "\u7B49\u5F85\u843D\u5B50";
function frameAt(match, step) {
  const events = movesOf(match).slice(0, step);
  return { moves: events.map((event) => ({ ...event.action, player: event.player })), current: events.at(-1) || null, speech: events.slice(-6).reverse(), result: step >= movesOf(match).length ? match.result : null };
}
var XIANGQI_PIECES = Object.freeze({
  r: ["\u8F66", "red"],
  n: ["\u9A6C", "red"],
  b: ["\u76F8", "red"],
  a: ["\u4ED5", "red"],
  k: ["\u5E05", "red"],
  c: ["\u70AE", "red"],
  p: ["\u5175", "red"],
  R: ["\u8ECA", "black"],
  N: ["\u99AC", "black"],
  B: ["\u8C61", "black"],
  A: ["\u58EB", "black"],
  K: ["\u5C06", "black"],
  C: ["\u7832", "black"],
  P: ["\u5352", "black"]
});
var XIANGQI_INITIAL = [
  ["R", "N", "B", "A", "K", "A", "B", "N", "R"],
  [null, null, null, null, null, null, null, null, null],
  [null, "C", null, null, null, null, null, "C", null],
  ["P", null, "P", null, "P", null, "P", null, "P"],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ["p", null, "p", null, "p", null, "p", null, "p"],
  [null, "c", null, null, null, null, null, "c", null],
  [null, null, null, null, null, null, null, null, null],
  ["r", "n", "b", "a", "k", "a", "b", "n", "r"]
];
var isXiangqiMove = (move) => !!move && move.from && move.to;
var coordinate = (value) => {
  if (!value || !Number.isInteger(value.row) || !Number.isInteger(value.col) || value.row < 1 || value.row > 10 || value.col < 1 || value.col > 9) return null;
  return { row: value.row - 1, col: value.col - 1 };
};
function xiangqiPosition(moves = []) {
  const board = XIANGQI_INITIAL.map((row) => [...row]);
  for (const move of moves) {
    const from = coordinate(move.from), to = coordinate(move.to);
    if (!from || !to) continue;
    const code = board[from.row][from.col];
    if (!code) continue;
    board[from.row][from.col] = null;
    board[to.row][to.col] = code;
  }
  return board;
}
function xiangqiBoardSvg(moves = [], { opacity = 1 } = {}) {
  const margin = 38, gap = 54, width = margin * 2 + gap * 8, height = margin * 2 + gap * 9;
  const board = xiangqiPosition(moves);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="\u4E2D\u56FD\u8C61\u68CB\u68CB\u76D8\uFF0C${moves.length} \u624B"><defs><linearGradient id="ar-xq-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0b16b"/><stop offset=".5" stop-color="#c99251"/><stop offset="1" stop-color="#b9793f"/></linearGradient><filter id="ar-xq-shadow"><feDropShadow dx="1.5" dy="2" stdDeviation="1.5" flood-color="#4b2d15" flood-opacity=".35"/></filter></defs><rect width="${width}" height="${height}" rx="6" fill="url(#ar-xq-wood)"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="4" fill="none" stroke="#754a26" stroke-opacity=".55" stroke-width="1.5"/>`];
  const x = (col) => margin + col * gap, y = (row) => margin + row * gap;
  for (let row = 0; row < 10; row++) parts.push(`<path d="M ${x(0)} ${y(row)} H ${x(8)}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/><text x="18" y="${y(row) + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${row + 1}</text>`);
  for (let col = 0; col < 9; col++) {
    const path = col === 0 || col === 8 ? `M ${x(col)} ${y(0)} V ${y(9)}` : `M ${x(col)} ${y(0)} V ${y(4)} M ${x(col)} ${y(5)} V ${y(9)}`;
    parts.push(`<path d="${path}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/>`);
    parts.push(`<text x="${x(col)}" y="${height - 10}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${col + 1}</text>`);
  }
  parts.push(`<rect x="${x(0)}" y="${y(4)}" width="${gap * 8}" height="${gap}" fill="#edd095" fill-opacity=".36"/><text x="${width / 2 - 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">\u695A\u6CB3</text><text x="${width / 2 + 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">\u6C49\u754C</text>`);
  for (const [fromCol, fromRow, toCol, toRow] of [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]]) parts.push(`<path d="M ${x(fromCol)} ${y(fromRow)} L ${x(toCol)} ${y(toRow)}" stroke="#674622" stroke-width="1.1"/>`);
  for (const [row, col] of [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]]) parts.push(`<path d="M ${x(col) - 5} ${y(row) - 5} h 4 v -4 M ${x(col) + 5} ${y(row) - 5} h -4 v -4 M ${x(col) - 5} ${y(row) + 5} h 4 v 4 M ${x(col) + 5} ${y(row) + 5} h -4 v 4" fill="none" stroke="#674622" stroke-width="1"/>`);
  board.forEach((line, row) => line.forEach((code, col) => {
    if (!code || !XIANGQI_PIECES[code]) return;
    const [label, side] = XIANGQI_PIECES[code], fill = side === "red" ? "#b83c2e" : "#202723", stroke = side === "red" ? "#79231c" : "#101512";
    parts.push(`<g opacity="${opacity}" filter="url(#ar-xq-shadow)"><circle cx="${x(col)}" cy="${y(row)}" r="20" fill="#f4e4bd" stroke="${stroke}" stroke-width="1.5"/><circle cx="${x(col)}" cy="${y(row)}" r="16.5" fill="none" stroke="${fill}" stroke-opacity=".55" stroke-width="1"/><text x="${x(col)}" y="${y(row) + 7}" text-anchor="middle" fill="${fill}" font-family="serif" font-size="22" font-weight="700">${label}</text></g>`);
  }));
  const last = moves.at(-1), lastTo = coordinate(last?.to);
  if (lastTo) parts.push(`<circle cx="${x(lastTo.col)}" cy="${y(lastTo.row)}" r="24" fill="none" stroke="#e45d3c" stroke-width="2.4"/>`);
  return `${parts.join("")}</svg>`;
}
function boardSvg(moves, { size = 15, opacity = 1, gameId = "" } = {}) {
  if (gameId === "xiangqi" || moves?.some(isXiangqiMove)) return xiangqiBoardSvg(moves, { opacity });
  const margin = 34, gap = 32, end = margin + gap * (size - 1), extent = end + margin;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="\u4E94\u5B50\u68CB\u68CB\u76D8\uFF0C${moves.length} \u624B"><defs><linearGradient id="ar-board-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7a866"/><stop offset=".5" stop-color="#c6904e"/><stop offset="1" stop-color="#b9793f"/></linearGradient><radialGradient id="ar-stone-black" cx="30%" cy="25%"><stop offset="0" stop-color="#4a514c"/><stop offset=".55" stop-color="#1c2521"/><stop offset="1" stop-color="#0d1310"/></radialGradient><radialGradient id="ar-stone-white" cx="30%" cy="25%"><stop offset="0" stop-color="#fffdf7"/><stop offset=".65" stop-color="#e8e5dc"/><stop offset="1" stop-color="#bdb8ad"/></radialGradient></defs><rect width="${extent}" height="${extent}" rx="6" fill="url(#ar-board-wood)"/><path d="M 0 48 H ${extent} M 0 128 H ${extent} M 0 214 H ${extent} M 0 302 H ${extent} M 0 384 H ${extent}" stroke="#fff1c4" stroke-opacity=".12" stroke-width="2"/>`];
  for (let i = 0; i < size; i++) {
    const p = margin + i * gap;
    parts.push(`<path d="M ${margin} ${p} H ${end} M ${p} ${margin} V ${end}" stroke="#674622" stroke-opacity=".84" stroke-width="1.15"/><text x="${p}" y="18" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text><text x="15" y="${p + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text>`);
  }
  for (const row of [4, 8, 12]) for (const col of [4, 8, 12]) parts.push(`<circle cx="${margin + (col - 1) * gap}" cy="${margin + (row - 1) * gap}" r="2.8" fill="#5a3a1b"/>`);
  moves.forEach((move, index) => {
    const x = margin + (move.col - 1) * gap, y = margin + (move.row - 1) * gap, last = index === moves.length - 1;
    const fill = move.player === 0 ? "url(#ar-stone-black)" : "url(#ar-stone-white)", stroke = move.player === 0 ? "#0b100d" : "#a59e91", text = move.player === 0 ? "#fff8df" : "#3b2b1a";
    parts.push(`<g opacity="${last ? opacity : 1}"><circle cx="${x + 2}" cy="${y + 3}" r="13.5" fill="#4b2d15" opacity=".32"/><circle cx="${x}" cy="${y}" r="12.5" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/><circle cx="${x - 4}" cy="${y - 4}" r="3.2" fill="#fff" opacity="${move.player === 0 ? ".16" : ".42"}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${text}">${index + 1}</text>${last ? `<circle cx="${x}" cy="${y}" r="15.5" fill="none" stroke="#e45d3c" stroke-width="2.2"/>` : ""}</g>`);
  });
  return `${parts.join("")}</svg>`;
}

// lwb/packs/ai-arena/styles.mjs
var CSS = `
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
`;

// lwb/packs/ai-arena/confirmation.mjs
var import_react3 = __toESM(require("react"), 1);
var h = import_react3.default.createElement;
var activeMatchCount = (matches) => matches.filter((match) => ["running", "pausing"].includes(match.status)).length;
function Confirmation({ title, description, notice, players, playerLabels, confirmLabel, onResult, opener }) {
  const dialog = import_react3.default.useRef(null), titleId = import_react3.default.useId(), descriptionId = import_react3.default.useId();
  import_react3.default.useEffect(() => {
    const element = dialog.current;
    element.showModal();
    element.querySelector(".ar-confirm-actions button").focus();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const trapFocus = (event) => {
    if (event.key !== "Tab") return;
    const buttons = [...dialog.current.querySelectorAll("button:not(:disabled)")];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return h(
    "dialog",
    { ref: dialog, className: "ar-confirm", "aria-labelledby": titleId, "aria-describedby": descriptionId, onKeyDown: trapFocus, onCancel: (event) => {
      event.preventDefault();
      onResult(false);
    } },
    h("div", { className: "ar-confirm-head" }, h("span", { className: "ar-confirm-mark" }, h(Play)), h("button", { className: "ar-icon", type: "button", "aria-label": "\u5173\u95ED\u786E\u8BA4\u6846", onClick: () => onResult(false) }, h(X))),
    h("h2", { id: titleId }, title),
    h("p", { id: descriptionId, className: "ar-confirm-copy" }, description),
    notice && h("p", { className: "ar-confirm-notice" }, notice),
    players && h("div", { className: "ar-confirm-players" }, players.map((name, index) => h("div", { key: index }, h("small", null, playerLabels?.[index] || (index ? "\u767D\u65B9 \xB7 \u540E\u624B" : "\u9ED1\u65B9 \xB7 \u5148\u624B")), h("strong", null, name)))),
    h("div", { className: "ar-confirm-actions" }, h("button", { type: "button", className: "ar-button", onClick: () => onResult(false) }, "\u53D6\u6D88"), h("button", { type: "button", className: "ar-button ar-primary", onClick: () => onResult(true) }, confirmLabel))
  );
}
function useConfirmation() {
  const [options, setOptions] = import_react3.default.useState(null), pending = import_react3.default.useRef(null);
  import_react3.default.useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);
  const confirm = (options2) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setOptions({ ...options2, opener: document.activeElement });
    });
  };
  const finish = (result) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(result);
  };
  return [confirm, options ? h(Confirmation, { ...options, onResult: finish }) : null];
}

// lwb/packs/ai-arena/turn-records.mjs
function turnRecords(match) {
  const outcomes = new Map(match.events.filter((event) => ["response", "error"].includes(event.type)).map((event) => [event.turnId, event]));
  let moveNumber = 1;
  return match.events.flatMap((event) => {
    if (event.type === "move") moveNumber = event.moveNumber + 1;
    if (event.type !== "request") return [];
    const outcome = outcomes.get(event.turnId);
    const response = outcome?.type === "error" ? outcome.response : outcome;
    return [{
      request: event,
      response,
      error: outcome?.type === "error" ? outcome.error : null,
      moveNumber: event.moveNumber ?? moveNumber,
      sessionId: event.sessionId || response?.sessionId || outcome?.sessionId || null
    }];
  });
}
function turnUsage(usage) {
  if (!usage) return null;
  const cache = (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
  return {
    input: usage.inputTokens === void 0 ? null : usage.inputTokens + cache,
    cacheRead: usage.cacheReadTokens ?? 0,
    output: usage.outputTokens ?? null,
    total: usage.totalTokens ?? (usage.inputTokens === void 0 || usage.outputTokens === void 0 ? null : usage.inputTokens + cache + usage.outputTokens)
  };
}

// lwb/packs/ai-arena/client-source.mjs
var h2 = import_react4.default.createElement;
var connection;
var rememberedId = null;
var rememberedGameId = "gomoku";
var arenaEntryMode = "resume";
var statusLabel = { running: "\u6BD4\u8D5B\u4E2D", pausing: "\u56DE\u5408\u7ED3\u7B97\u540E\u6682\u505C", paused: "\u5DF2\u6682\u505C", finished: "\u5DF2\u7ED3\u675F", cancelled: "\u5DF2\u53D6\u6D88" };
var gameLabel = (id) => id === "xiangqi" ? "\u4E2D\u56FD\u8C61\u68CB" : "\u4E94\u5B50\u68CB";
var gameMeta = (id) => id === "xiangqi" ? { board: "9 \xD7 10", facts: "\u4E5D\u8DEF\u5341\u7EBF \xB7 \u695A\u6CB3\u6C49\u754C \xB7 \u7EA2\u65B9\u5148\u624B", shortRule: "\u4E5D\u8DEF\u5341\u7EBF\u4E2D\u56FD\u8C61\u68CB \xB7 \u7EA2\u65B9\u5148\u624B \xB7 \u5C06\u6B7B\u6216\u56F0\u6BD9\u83B7\u80DC" } : { board: "15 \xD7 15", facts: "15 \xD7 15 \xB7 \u9ED1\u65B9\u5148\u624B", shortRule: "15 \xD7 15 \u81EA\u7531\u4E94\u5B50\u68CB \xB7 \u9ED1\u65B9\u5148\u624B \xB7 \u8FDE\u4E94\u53CA\u4EE5\u4E0A\u83B7\u80DC" };
var sideLabel = (gameId, index) => `${playerSide({ id: gameId }, index)} \xB7 ${index ? "\u540E\u624B" : "\u5148\u624B"}`;
var api = async (method, request) => {
  const result = await connection.rpc.call("/api", `aiArena/${method}`, { args: request === void 0 ? {} : { request } });
  if (!result?.ok) throw new Error(result?.error?.message || "\u7ADE\u6280\u53F0\u670D\u52A1\u8BF7\u6C42\u5931\u8D25\u3002");
  return result.value;
};
function IconButton({ icon, title, onClick, disabled, ...rest }) {
  return h2("button", { type: "button", className: "ar-icon", title, "aria-label": title, onClick, disabled, ...rest }, h2(icon));
}
function Button({ icon, children, primary, className, ...rest }) {
  return h2("button", { type: "button", className: ["ar-button", primary && "ar-primary", className].filter(Boolean).join(" "), ...rest }, icon && h2(icon), children);
}
function Status({ status }) {
  return h2("span", { className: "ar-tag", "data-status": status }, h2("i"), statusLabel[status] || status);
}
function Frame({ tone, kicker, title, subtitle, actions, children }) {
  return h2(
    "main",
    { className: "ar-page", "data-tone": tone },
    h2("header", { className: "ar-top" }, h2("div", { className: "ar-top-copy" }, h2("p", { className: "ar-kicker" }, h2("i"), kicker), h2("h1", null, title), subtitle && h2("p", null, subtitle)), actions && h2("div", { className: "ar-top-actions" }, actions)),
    children
  );
}
function StatBar({ items }) {
  return h2("div", { className: "ar-stats" }, items.map((item) => h2("div", { key: item.label, className: "ar-stat" }, h2("span", null, item.label), h2("strong", { "data-tone": item.tone }, item.value), item.detail && h2("small", null, item.detail))));
}
function useQuery(method, request, dependency = "") {
  const [value, setValue] = import_react4.default.useState(null), [error, setError] = import_react4.default.useState("");
  const live = import_react4.default.useRef(false), sequence = import_react4.default.useRef(0);
  const refresh = import_react4.default.useCallback(() => {
    const ticket = ++sequence.current;
    return api(method, request).then((next) => {
      if (live.current && ticket === sequence.current) {
        setValue(next);
        setError("");
      }
    }).catch((err) => {
      if (live.current && ticket === sequence.current) setError(err.message);
    });
  }, [method, dependency]);
  import_react4.default.useEffect(() => {
    live.current = true;
    refresh();
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, [refresh]);
  return { value, error, refresh, setValue };
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function Field({ label, children }) {
  return h2("label", { className: "ar-field" }, h2("span", null, label), children);
}
function Setup({ onStarted, open, onOpenChange, activeCount = 0, gameId = rememberedGameId, onGameChange }) {
  const [confirm, confirmation] = useConfirmation();
  const catalog = useQuery("models"), gamesData = useQuery("games"), [selected, setSelected] = import_react4.default.useState(["", ""]);
  const [selectedGame, setSelectedGame] = import_react4.default.useState(gameId || "gomoku");
  const [effort, setEffort] = import_react4.default.useState(["", ""]), [busy, setBusy] = import_react4.default.useState(false), [error, setError] = import_react4.default.useState("");
  const routes = catalog.value || [];
  const availableRoutes = routes.filter((route) => route.selectable !== false).map((route) => ({ ...route, models: (route.models || []).filter((model) => model.selectable !== false) })).filter((route) => route.models.length > 0);
  const models = availableRoutes.flatMap((route) => route.models.map((model) => ({ ...model, provider: route.id, providerName: route.name, selectable: true, reason: null, key: JSON.stringify([route.id, model.id]) })));
  import_react4.default.useEffect(() => {
    if (!catalog.value) return;
    const allowed = new Set(models.map((model) => model.key));
    setSelected((previous) => {
      const next = previous.map((key) => allowed.has(key) ? key : "");
      return next.every((key, index) => key === previous[index]) ? previous : next;
    });
    setEffort((previous) => previous.map((value, index) => allowed.has(selected[index]) ? value : ""));
  }, [catalog.value]);
  const pick = (index, value) => {
    setSelected((previous) => previous.map((item, i) => i === index ? value : item));
    setEffort((previous) => previous.map((item, i) => i === index ? "" : item));
  };
  async function start(event) {
    event.preventDefault();
    if (busy) return;
    const game = gamesData.value?.find((item) => item.id === selectedGame), label = game?.name || gameLabel(selectedGame);
    if (!await confirm({ title: `\u5F00\u59CB\u65B0\u7684${label}\u6BD4\u8D5B\uFF1F`, description: "\u786E\u8BA4\u540E\u5C06\u8C03\u7528\u53C2\u8D5B\u6A21\u578B\u5E76\u8BB0\u5F55\u7528\u91CF\u3002\u7ADE\u6280\u53F0\u5C55\u793A\u8FD9\u573A\u65B0\u6BD4\u8D5B\uFF0C\u5176\u4ED6\u6BD4\u8D5B\u53EF\u5728\u6BD4\u8D5B\u8BB0\u5F55\u4E2D\u67E5\u770B\u3002", notice: activeCount > 0 ? `\u5DF2\u6709 ${activeCount} \u573A\u6BD4\u8D5B\u8FDB\u884C\u4E2D\u3002\u7EE7\u7EED\u5F00\u59CB\u5C06\u5E76\u884C\u8FD0\u884C\u4E00\u573A\u65B0\u6BD4\u8D5B\u3002` : null, playerLabels: [0, 1].map((index) => sideLabel(selectedGame, index)), players: selected.map((key) => {
      const model = models.find((item) => item.key === key);
      return model?.name || model?.id;
    }), confirmLabel: "\u786E\u8BA4\u5F00\u59CB" })) return;
    setBusy(true);
    setError("");
    try {
      const players = selected.map((key, i) => {
        const model = models.find((item) => item.key === key);
        return { provider: model.provider, model: model.id, ...effort[i] ? { reasoningEffort: effort[i] } : {} };
      });
      rememberedGameId = selectedGame;
      onStarted(await api("start", { gameId: selectedGame, players }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return h2("details", { className: "ar-setup", open, onToggle: (event) => onOpenChange(event.currentTarget.open) }, h2("summary", null, h2("span", { className: "ar-setup-title" }, h2(Settings2), "\u53C2\u8D5B\u914D\u7F6E"), h2(ChevronDown, { className: "ar-setup-chevron" })), h2(
    "form",
    { className: "ar-form", onSubmit: start },
    gamesData.value?.length ? h2(Field, { label: "\u7ADE\u6280\u6E38\u620F" }, h2("select", { value: selectedGame, onChange: (event) => {
      setSelectedGame(event.target.value);
      rememberedGameId = event.target.value;
      onGameChange?.(event.target.value);
    }, "aria-label": "\u7ADE\u6280\u6E38\u620F" }, gamesData.value.map((game) => h2("option", { key: game.id, value: game.id }, game.name)))) : null,
    h2("div", { className: "ar-participants" }, [0, 1].map((index) => {
      const model = models.find((item) => item.key === selected[index]);
      const groups = availableRoutes.map((route) => h2("optgroup", { key: route.id, label: route.name || route.id }, route.models.map((item) => h2("option", { key: item.id, value: JSON.stringify([route.id, item.id]) }, item.name || item.id))));
      return h2(
        "div",
        { key: index, className: "ar-participant", "data-game": selectedGame },
        h2("div", { className: "ar-participant-head" }, h2("i", { className: "ar-stone", "data-player": index }), `${playerSide({ id: selectedGame }, index)}\u9009\u624B`, h2("small", null, index ? "\u540E\u624B" : "\u5148\u624B")),
        h2(Field, { label: "\u53C2\u8D5B\u6A21\u578B" }, h2("select", { "aria-label": `${playerSide({ id: selectedGame }, index)}\u6A21\u578B`, value: selected[index], onChange: (event) => pick(index, event.target.value), required: true }, h2("option", { value: "" }, "\u9009\u62E9\u6A21\u578B"), groups)),
        model?.reasoning?.efforts?.length ? h2(Field, { label: "\u63A8\u7406\u5F3A\u5EA6" }, h2("select", { value: effort[index], onChange: (event) => setEffort((previous) => previous.map((item, i) => i === index ? event.target.value : item)) }, h2("option", { value: "" }, "\u6A21\u578B\u9ED8\u8BA4"), model.reasoning.efforts.map((item) => h2("option", { key: item.id, value: item.id }, item.label || item.id)))) : null
      );
    })),
    h2("div", { className: "ar-submit" }, h2("span", { className: "ar-muted" }, "\u6309\u68CB\u89C4\u5224\u5B9A\u80DC\u8D1F \xB7 \u8FDD\u89C4\u91CD\u8BD5\u4E00\u6B21\u540E\u5224\u8D1F"), h2("button", { className: "ar-button ar-primary", type: "submit", disabled: busy || selected.some((key) => !models.some((model) => model.key === key && model.selectable !== false)) }, h2(Play, { size: 16 }), busy ? "\u51C6\u5907\u6BD4\u8D5B\u2026" : "\u5F00\u59CB\u6BD4\u8D5B")),
    (error || catalog.error) && h2("div", { className: "ar-error", role: "alert" }, error || catalog.error)
  ), confirmation);
}
function Conversation({ match, turnId, renderConversation, focusSession }) {
  const [player, setPlayer] = import_react4.default.useState(null), [selected, setSelected] = import_react4.default.useState(null);
  import_react4.default.useEffect(() => {
    setPlayer(null);
    setSelected(null);
  }, [turnId]);
  const turns = turnRecords(match);
  const following = turns.find((turn) => turn.request.turnId === turnId) || turns.at(-1);
  const currentPlayer = player ?? following?.request.player ?? 0;
  const choices = turns.filter((turn) => turn.request.player === currentPlayer);
  const current = choices.find((turn) => turn.request.turnId === selected) || (following?.request.player === currentPlayer ? following : choices.at(-1));
  const usage = turnUsage(current?.response?.usage);
  const count = (value) => value === null || value === void 0 ? "\u2014" : value.toLocaleString();
  const focus = () => {
    if (current?.sessionId) focusSession?.(current.sessionId);
  };
  return h2(
    "section",
    { className: "ar-conversation", "aria-label": "DSH \u5B98\u65B9\u5BF9\u8BDD", onPointerDownCapture: focus, onFocusCapture: focus },
    h2("div", { className: "ar-conversation-head" }, h2("h2", { className: "ar-section-title" }, "DSH \u5B98\u65B9\u5BF9\u8BDD"), h2("span", { className: "ar-chip" }, "\u6BD4\u8D5B\u4F1A\u8BDD \xB7 \u53EA\u8BFB")),
    h2(
      "div",
      { className: "ar-actions" },
      [0, 1].map((index) => h2("button", { key: index, type: "button", className: `ar-button${currentPlayer === index ? " ar-live" : ""}`, "aria-pressed": currentPlayer === index, onClick: () => {
        setPlayer(index);
        setSelected(null);
      } }, `${playerSide(match.game, index)} \xB7 ${match.players[index].name}`)),
      h2("select", { className: "ar-select ar-turn-select", "aria-label": "\u67E5\u770B\u51B3\u7B56\u4F1A\u8BDD", value: current?.request.turnId || "", onChange: (event) => setSelected(event.target.value) }, choices.map((turn) => h2("option", { key: turn.request.turnId, value: turn.request.turnId }, `\u7B2C ${turn.moveNumber} \u624B${turn.request.attempt ? ` \xB7 \u91CD\u8BD5 ${turn.request.attempt}` : ""}${turn.error ? " \xB7 \u672A\u5B8C\u6210" : ""}`)))
    ),
    h2("p", { className: "ar-muted" }, current?.request.contextMode === "current-position" || match.config.contextMode === "current-position" && !current ? "\u6BCF\u6B21\u53D1\u9001\u5F53\u524D\u68CB\u76D8\u4E0E\u89C4\u5219\uFF0C\u9009\u624B\u5728\u5404\u81EA\u7684\u8FDE\u7EED\u4F1A\u8BDD\u4E2D\u51B3\u7B56\u3002" : "\u5386\u53F2\u6BD4\u8D5B\u6CBF\u7528\u9009\u624B\u4F1A\u8BDD\uFF0C\u53EF\u67E5\u770B\u5176\u4E2D\u7684\u591A\u8F6E\u8BB0\u5F55\u3002"),
    h2(StatBar, { items: [{ label: "\u672C\u6B21\u8F93\u5165 Token", value: count(usage?.input), detail: "\u542B\u7F13\u5B58\u8F93\u5165" }, { label: "\u7F13\u5B58\u547D\u4E2D Token", value: count(usage?.cacheRead), detail: "\u5DF2\u8BA1\u5165\u8F93\u5165" }, { label: "\u672C\u6B21\u8F93\u51FA Token", value: count(usage?.output), detail: "\u542B\u6A21\u578B\u4E0A\u62A5\u7684\u63A8\u7406\u7528\u91CF" }, { label: "\u672C\u6B21\u603B Token", value: count(usage?.total), detail: current?.response ? usage ? "\u670D\u52A1\u5546\u4E0A\u62A5\u7528\u91CF" : "\u670D\u52A1\u5546\u672A\u8FD4\u56DE\u7528\u91CF" : current?.error ? "\u7528\u91CF\u672A\u8FD4\u56DE" : "\u7B49\u5F85\u672C\u6B21\u7528\u91CF" }] }),
    current?.sessionId && renderConversation ? renderConversation({ sessionId: current.sessionId, readOnly: true }) : h2("div", { className: "ar-empty" }, current ? "\u6B63\u5728\u51C6\u5907\u4F1A\u8BDD\uFF0C\u6216\u8BE5\u5386\u53F2\u8BB0\u5F55\u6CA1\u6709\u4F1A\u8BDD\u7F16\u53F7\u3002" : "\u9996\u4E2A\u51B3\u7B56\u5F00\u59CB\u540E\u663E\u793A\u5B98\u65B9\u5BF9\u8BDD\u3002"),
    h2("details", { className: "ar-raw" }, h2("summary", null, "\u5B9E\u9645\u8BF7\u6C42\u53C2\u6570\u4E0E\u539F\u59CB\u7ED3\u679C"), h2("pre", null, JSON.stringify(current || {}, null, 2)))
  );
}
function speechGate(account) {
  if (!account || account.phase === "loading") return { enabled: false, reason: "\u6B63\u5728\u8BFB\u53D6 LWB \u8D26\u53F7\u2026" };
  if (account.phase !== "authenticated" || !account.user) return { enabled: false, reason: "\u767B\u5F55 LWB \u540E\u53EF\u751F\u6210\u53D1\u8A00\u8BED\u97F3", login: true };
  const service = account.catalog?.services?.tts;
  if (account.serviceError) return { enabled: false, reason: account.serviceError };
  if (!service?.available) return { enabled: false, reason: service?.reason || "LWB \u8BED\u97F3\u670D\u52A1\u6682\u4E0D\u53EF\u7528\u3002" };
  const points = Number(account.points?.availablePoints);
  const minimum = Number(service.minimumPoints || 0);
  if (Number.isFinite(points) && points < minimum) return { enabled: false, reason: "\u79EF\u5206\u4E0D\u8DB3\uFF0C\u8BF7\u8D2D\u4E70\u79EF\u5206\u540E\u91CD\u8BD5\u3002", login: true };
  return { enabled: true, reason: "\u6309\u6BCF\u624B\u53D1\u8A00\u8C03\u7528\u8BED\u97F3\u670D\u52A1\uFF0C\u4EE5\u5B9E\u9645\u6263\u8D39\u4E3A\u51C6\u3002\u79EF\u5206\u5728\u5408\u6210\u8FC7\u7A0B\u4E2D\u8017\u5C3D\u4F1A\u4E2D\u6B62\u3002" };
}
function MatchView({ id, initial, onChange, renderConversation, focusSession, activeCount = 0, lwbAccount }) {
  const [confirm, confirmation] = useConfirmation();
  const data = useQuery("match", { id }, id), match = data.value || initial;
  const [step, setStep] = import_react4.default.useState(null), [playing, setPlaying] = import_react4.default.useState(false), [speed, setSpeed] = import_react4.default.useState("1");
  const [busy, setBusy] = import_react4.default.useState(""), [error, setError] = import_react4.default.useState(""), [notice, setNotice] = import_react4.default.useState("");
  const [orientation, setOrientation] = import_react4.default.useState("landscape"), [videoUrl, setVideoUrl] = import_react4.default.useState(null), [withAudio, setWithAudio] = import_react4.default.useState(false);
  const account = lwbAccount?.useAccount?.() || null;
  const gate = speechGate(account);
  const [clock, setClock] = import_react4.default.useState(Date.now());
  const moves = match ? movesOf(match) : [], currentStep = Math.min(step ?? moves.length, moves.length);
  const frame = match ? frameAt(match, currentStep) : null;
  const lastError = match?.events.at(-1)?.type === "error" ? match.events.at(-1) : null;
  import_react4.default.useEffect(() => {
    setStep(null);
    setPlaying(false);
    setError("");
    setNotice("");
    setVideoUrl(null);
  }, [id]);
  import_react4.default.useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);
  import_react4.default.useEffect(() => {
    if (!match || !["running", "pausing"].includes(match.status) && match.export?.status !== "running") return;
    const timer = setInterval(data.refresh, 1e3);
    return () => clearInterval(timer);
  }, [id, match?.status, match?.export?.status, data.refresh]);
  import_react4.default.useEffect(() => {
    if (!match?.activeTurn?.turnId) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [id, match?.activeTurn?.turnId]);
  import_react4.default.useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((previous) => {
      const next = Math.min(moves.length, (previous ?? 0) + 1);
      if (next === moves.length) setPlaying(false);
      return next;
    }), 2500 / Number(speed));
    return () => clearInterval(timer);
  }, [playing, moves.length, speed]);
  async function run(label, operation) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
      data.refresh();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }
  async function downloadRecord(format) {
    const result = await api("exportRecord", { id, format });
    saveBlob(new Blob([result.text], { type: `${result.type};charset=utf-8` }), `ai-arena-${id.slice(0, 8)}.${result.extension}`);
    setNotice("\u6BD4\u8D5B\u8BB0\u5F55\u5DF2\u5BFC\u51FA\u3002");
  }
  async function downloadExport(preview) {
    const chunks = [];
    let offset = 0;
    while (true) {
      const part2 = await api("videoChunk", { id, exportId: match.export.id, offset });
      chunks.push(Uint8Array.from(atob(part2.data), (char) => char.charCodeAt(0)));
      if (part2.done) break;
      if (part2.nextOffset <= offset) throw new Error("\u89C6\u9891\u4E0B\u8F7D\u4E2D\u65AD\u3002");
      offset = part2.nextOffset;
      setNotice(`\u6B63\u5728\u8BFB\u53D6\u89C6\u9891 ${Math.floor(offset / part2.bytes * 100)}%`);
    }
    const html = match.export.kind === "html";
    const blob = new Blob(chunks, { type: html ? "text/html" : "video/mp4" });
    if (preview && !html) setVideoUrl(URL.createObjectURL(blob));
    else saveBlob(blob, html ? `ai-arena-${id.slice(0, 8)}-replay.html` : `ai-arena-${id.slice(0, 8)}-${match.export.orientation}.mp4`);
    const size = html ? `\uFF0C\u7EA6 ${Math.max(1, Math.round(part.bytes / 1024))} KB` : "";
    setNotice(html ? `\u79BB\u7EBF\u56DE\u653E\u5DF2\u5BFC\u51FA\uFF0C\u542B\u9009\u624B\u53D1\u8A00\u8BED\u97F3${size}\u3002` : "");
  }
  const seek = (value) => {
    setPlaying(false);
    setStep(value);
  };
  if (!match) return h2("div", { className: "ar-empty" }, data.error || "\u6B63\u5728\u8BFB\u53D6\u6BD4\u8D5B\u2026");
  const live = step === null && ["running", "pausing"].includes(match.status), thinking = live && match.activeTurn?.turnId;
  const currentPlayer = thinking ? match.activeTurn.player : frame.current?.player ?? 0;
  const elapsedSeconds = thinking ? Math.max(0, (clock - Date.parse(match.activeTurn.startedAt)) / 1e3) : 0;
  const phaseLabel = { waiting: "\u7B49\u5F85\u6A21\u578B\u54CD\u5E94", reasoning: "\u601D\u8003\u4E2D", answering: "\u6B63\u5728\u751F\u6210\u843D\u5B50\u4E0E\u53D1\u8A00" }[match.activeTurn?.phase] || "\u7B49\u5F85\u6A21\u578B\u54CD\u5E94";
  return h2(
    "section",
    { className: "ar-match-view", "data-ar-match": id, "data-game": match.game?.id },
    h2("div", { className: "ar-match-head" }, h2("div", null, h2("div", { className: "ar-match-title" }, h2("h2", { className: "ar-section-title" }, gameName(match.game)), h2("span", { className: "ar-match-count" }, `${activeCount} \u573A\u8FDB\u884C\u4E2D`)), h2("p", null, `${new Date(match.createdAt).toLocaleString("zh-CN")} \xB7 ${id.slice(0, 8)}`)), h2(
      "div",
      { className: "ar-actions" },
      match.config.pace === "fast" && h2("span", { className: "ar-chip" }, "\u5386\u53F2\u5FEB\u68CB\u5BF9\u5C40"),
      h2(Status, { status: match.status }),
      match.status === "running" && h2(IconButton, { icon: Pause, title: "\u56DE\u5408\u7ED3\u675F\u540E\u6682\u505C", disabled: !!busy, onClick: () => run("pause", () => api("control", { id, action: "pause" })) }),
      ["running", "pausing", "paused"].includes(match.status) && h2(IconButton, { icon: Square, title: "\u53D6\u6D88\u6BD4\u8D5B", disabled: !!busy, onClick: async () => {
        if (await confirm({ title: "\u53D6\u6D88\u8FD9\u573A\u6BD4\u8D5B\uFF1F", description: "\u53D6\u6D88\u540E\u505C\u6B62\u7EE7\u7EED\u843D\u5B50\uFF0C\u5DF2\u5B8C\u6210\u7684\u843D\u5B50\u3001\u9009\u624B\u53D1\u8A00\u548C\u7528\u91CF\u8BB0\u5F55\u4F1A\u4FDD\u7559\u3002", confirmLabel: "\u786E\u8BA4\u53D6\u6D88\u6BD4\u8D5B" })) run("cancel", () => api("control", { id, action: "cancel" }));
      } })
    )),
    match.status === "paused" && h2(Button, { primary: true, icon: Play, disabled: !!busy, onClick: () => run("resume", () => api("control", { id, action: "resume" })) }, "\u7EE7\u7EED\u6BD4\u8D5B"),
    h2(
      "div",
      { className: "ar-match" },
      h2(
        "div",
        { className: "ar-board-col" },
        h2("div", { className: "ar-scoreboard" }, h2(Player, { player: match.players[0], index: 0, gameId: match.game?.id }), h2("span", { className: "ar-vs" }, "VS"), h2(Player, { player: match.players[1], index: 1, gameId: match.game?.id })),
        h2("div", { className: "ar-board", key: currentStep, dangerouslySetInnerHTML: { __html: boardSvg(frame.moves, { gameId: match.game?.id }) } }),
        h2(
          "div",
          { className: "ar-toolbar" },
          h2(IconButton, { icon: SkipBack, title: "\u56DE\u5230\u5F00\u5C40", onClick: () => seek(0) }),
          h2(IconButton, { icon: ChevronLeft, title: "\u4E0A\u4E00\u6B65", onClick: () => seek(Math.max(0, currentStep - 1)), disabled: currentStep === 0 }),
          h2(IconButton, { icon: playing ? Pause : Play, title: playing ? "\u6682\u505C\u56DE\u653E" : "\u64AD\u653E\u56DE\u653E", disabled: !moves.length, onClick: () => {
            if (playing) setPlaying(false);
            else {
              if (step === null || currentStep >= moves.length) setStep(0);
              setPlaying(true);
            }
          } }),
          h2(IconButton, { icon: ChevronRight, title: "\u4E0B\u4E00\u6B65", onClick: () => seek(Math.min(moves.length, currentStep + 1)), disabled: currentStep === moves.length }),
          h2("input", { type: "range", "aria-label": "\u6BD4\u8D5B\u56DE\u653E\u8FDB\u5EA6", min: 0, max: moves.length, value: currentStep, onChange: (event) => seek(Number(event.target.value)) }),
          h2("span", { className: "ar-counter" }, `${currentStep} / ${moves.length}`),
          h2("select", { className: "ar-select", style: { width: 60 }, value: speed, "aria-label": "\u56DE\u653E\u901F\u5EA6", onChange: (event) => setSpeed(event.target.value) }, ["0.5", "1", "2", "4"].map((value) => h2("option", { key: value, value }, `${value}\xD7`))),
          h2(IconButton, { icon: Radio, title: "\u8DDF\u968F\u6700\u65B0\u56DE\u5408", onClick: () => {
            setPlaying(false);
            setStep(null);
          }, className: `ar-icon${step === null ? " ar-live" : ""}` })
        )
      ),
      h2(
        "aside",
        { className: "ar-commentary" },
        h2("div", { className: "ar-commentary-head" }, h2("h2", { className: "ar-section-title" }, "\u9009\u624B\u53D1\u8A00"), h2("span", { className: "ar-chip" }, thinking ? "\u51B3\u7B56\u4E2D" : `\u7B2C ${currentStep} \u624B`)),
        h2("div", { className: "ar-speaking", "data-thinking": !!thinking }, h2("div", { className: "ar-speaking-name" }, h2(MessageCircle), match.players[currentPlayer].name), h2("p", { role: thinking ? "status" : void 0 }, thinking ? phaseLabel : frame.current?.speech || "\u7B49\u5F85\u7B2C\u4E00\u6B65\u8D70\u5B50"), thinking ? h2("div", { className: "ar-generation" }, h2("div", null, h2("small", null, match.players[currentPlayer].reasoningEffort ? `\u63A8\u7406\u5F3A\u5EA6\uFF1A${match.players[currentPlayer].reasoningEffort}` : "\u6A21\u578B\u9ED8\u8BA4\u63A8\u7406"), h2("small", null, `\u5DF2\u7528 ${elapsedSeconds.toFixed(1)} \u79D2`))) : frame.current && h2("small", null, `${actionLabel(frame.current.action, match.game)} \xB7 ${(frame.current.elapsedMs / 1e3).toFixed(1)} \u79D2`)),
        frame.result && h2("div", { className: "ar-result" }, h2(Trophy), frame.result.message),
        h2("div", { className: "ar-transcript-title" }, h2("span", null, "\u56DE\u5408\u8BB0\u5F55"), h2("span", null, `${frame.speech.length} \u6761`)),
        h2("div", { className: "ar-transcript" }, frame.speech.length ? frame.speech.map((event) => h2("button", { key: event.turnId, className: "ar-speech", onClick: () => seek(event.moveNumber), "aria-label": `\u67E5\u770B\u7B2C ${event.moveNumber} \u624B` }, h2("div", { className: "ar-speech-head" }, h2("span", { className: "ar-speech-num" }, event.moveNumber), h2("strong", null, match.players[event.player].name), h2("small", null, actionLabel(event.action, match.game))), h2("p", null, event.speech))) : h2("div", { className: "ar-empty" }, "\u6682\u65E0\u56DE\u5408\u8BB0\u5F55"))
      )
    ),
    h2(StatBar, { items: [{ label: "\u5DF2\u5B8C\u6210\u8D70\u5B50", value: moves.length, tone: "brand" }, { label: "\u51B3\u7B56\u56DE\u5408", value: match.calls, detail: "\u542B\u8FDD\u89C4\u91CD\u8BD5\u4E0E\u672A\u5B8C\u6210\u56DE\u5408" }, { label: "\u7D2F\u8BA1 Token", value: match.tokens.toLocaleString(), detail: match.usageUnknown ? "\u7528\u91CF\u4E0D\u5B8C\u6574" : "\u670D\u52A1\u5546\u4E0A\u62A5\u7528\u91CF" }, { label: "\u6BD4\u8D5B\u72B6\u6001", value: statusLabel[match.status] || match.status, tone: match.status === "finished" ? "green" : void 0 }] }),
    (error || data.error) && h2("p", { className: "ar-error", role: "alert" }, error || data.error),
    lastError && h2("p", { className: "ar-error", role: "alert" }, lastError.error),
    h2(
      "div",
      { className: "ar-export" },
      h2("div", { className: "ar-actions" }, h2(Button, { icon: FileText, disabled: !!busy, onClick: () => run("report", () => downloadRecord("markdown")) }, "\u6218\u62A5"), h2(Button, { icon: Download, disabled: !!busy, onClick: () => run("json", () => downloadRecord("json")) }, "\u5B8C\u6574\u8BB0\u5F55"), h2(Button, { icon: Play, disabled: !!busy || match.export?.status === "running", onClick: () => run("html", () => withAudio ? api("exportReplay", { id }) : downloadRecord("html")) }, match.export?.kind === "html" && match.export?.status === "running" ? `\u5408\u6210\u8BED\u97F3 ${match.export.speechDone || 0}/${match.export.speechTotal || "\u2026"}\u2026` : withAudio ? "\u79BB\u7EBF\u56DE\u653E\uFF08\u6709\u58F0\uFF09" : "\u79BB\u7EBF\u56DE\u653E"), match.export?.kind === "html" && match.export?.status === "succeeded" && h2(IconButton, { icon: Download, title: "\u4E0B\u8F7D\u6709\u58F0\u56DE\u653E", disabled: !!busy, onClick: () => run("replay", () => downloadExport(false)) })),
      h2("div", { className: "ar-actions" }, h2("label", null, "\u89C6\u9891", h2("select", { className: "ar-select", value: orientation, "aria-label": "\u89C6\u9891\u753B\u5E45", onChange: (event) => setOrientation(event.target.value) }, h2("option", { value: "landscape" }, "\u6A2A\u5C4F 16:9"), h2("option", { value: "portrait" }, "\u7AD6\u5C4F 9:16"))), h2("label", { className: "ar-audio" }, h2("input", { type: "checkbox", checked: withAudio && gate.enabled, disabled: !gate.enabled || !!busy, onChange: (event) => setWithAudio(event.target.checked) }), `\u751F\u6210\u58F0\u97F3${moves.filter((event) => String(event.speech || "").trim()).length ? `\uFF08${moves.filter((event) => String(event.speech || "").trim()).length} \u53E5\uFF09` : ""}`), gate.login && h2("button", { type: "button", className: "ar-button", onClick: () => lwbAccount?.openSettings?.() }, "\u767B\u5F55 LWB"), h2(Button, { icon: Film, disabled: !!busy || match.export?.status === "running" || !["finished", "cancelled"].includes(match.status) || !moves.length, onClick: () => run("render", () => api("exportVideo", { id, orientation, withAudio: withAudio && gate.enabled })) }, match.export?.status === "running" ? match.export.phase === "speech" ? `\u5408\u6210\u8BED\u97F3 ${match.export.speechDone || 0}/${match.export.speechTotal || "\u2026"}\u2026` : "\u6E32\u67D3\u4E2D\u2026" : withAudio && gate.enabled ? "\u5BFC\u51FA\u6709\u58F0 MP4" : "\u5BFC\u51FA MP4"), match.export?.status === "succeeded" && h2(import_react4.default.Fragment, null, h2(IconButton, { icon: Eye, title: "\u9884\u89C8\u6210\u7247", disabled: !!busy, onClick: () => run("preview", () => downloadExport(true)) }), h2(IconButton, { icon: Download, title: "\u4E0B\u8F7D MP4", disabled: !!busy, onClick: () => run("video", () => downloadExport(false)) })))
    ),
    h2("p", { className: gate.enabled ? "ar-muted" : "ar-notice", role: "status" }, lwbAccount ? gate.reason : "\u751F\u6210\u58F0\u97F3\u9700\u8981\u5728\u6BD4\u8D5B\u8BB0\u5F55\u4E2D\u5BFC\u51FA\u3002"),
    match.export?.status === "failed" && h2("p", { className: "ar-error" }, match.export.error),
    notice && h2("p", { className: "ar-notice", role: "status" }, notice),
    videoUrl && h2("video", { className: "ar-video", src: videoUrl, controls: true }),
    h2(Conversation, { match, turnId: step === null ? match.events.findLast((event) => event.type === "request")?.turnId : frame.current?.turnId, renderConversation, focusSession }),
    confirmation
  );
}
function Player({ player, index, gameId = "gomoku" }) {
  return h2("div", { className: "ar-player", "data-game": gameId }, h2("i", { className: "ar-stone", "data-player": index }), h2("div", null, h2("strong", null, player.name), h2("small", null, `${sideLabel(gameId, index)} / ${player.providerName}`)));
}
function Arena({ renderConversation, focusSession }) {
  const [freshEntry] = import_react4.default.useState(() => arenaEntryMode === "fresh");
  const [selectedGame, setSelectedGame] = import_react4.default.useState(rememberedGameId);
  const [id, setId] = import_react4.default.useState(null), [initial, setInitial] = import_react4.default.useState(null), [setup, setSetup] = import_react4.default.useState(freshEntry);
  const matchesData = useQuery("matches"), matches = matchesData.value || [], activeCount = activeMatchCount(matches);
  import_react4.default.useEffect(() => {
    if (freshEntry || id) return;
    if (!matches.length) {
      setSetup(true);
      return;
    }
    const latest = matches[0];
    setId(latest.id);
    rememberedId = latest.id;
    setSetup(false);
  }, [freshEntry, id, matches]);
  import_react4.default.useEffect(() => {
    const timer = setInterval(matchesData.refresh, 2e3);
    return () => clearInterval(timer);
  }, [matchesData.refresh]);
  import_react4.default.useEffect(() => {
    if (freshEntry) arenaEntryMode = "resume";
  }, [freshEntry]);
  const displayedActiveCount = initial && ["running", "pausing"].includes(initial.status) && !matches.some((match) => match.id === initial.id) ? activeCount + 1 : activeCount;
  return h2(
    Frame,
    { tone: "orange", kicker: "\u6A21\u578B\u5BF9\u6218", title: "AI\u7ADE\u6280\u53F0", subtitle: "\u4E94\u5B50\u68CB / \u4E2D\u56FD\u8C61\u68CB \xB7 \u6A21\u578B\u81EA\u4E3B\u51B3\u7B56 \xB7 \u9010\u624B\u56DE\u653E", actions: h2(Button, { primary: true, className: "ar-config-button", icon: Settings2, onClick: () => setSetup((previous) => !previous) }, "\u53C2\u8D5B\u914D\u7F6E") },
    h2(Setup, { gameId: selectedGame, onGameChange: setSelectedGame, open: setup, onOpenChange: setSetup, activeCount, onStarted: (match) => {
      setInitial(match);
      setId(match.id);
      rememberedId = match.id;
      setSetup(false);
      matchesData.refresh();
    } }),
    id ? h2(MatchView, { key: id, id, initial, activeCount: displayedActiveCount, renderConversation, focusSession }) : h2("div", { className: "ar-match", "data-game": selectedGame }, h2("div", { className: "ar-board-col" }, h2("div", { className: "ar-scoreboard" }, h2(Player, { index: 0, gameId: selectedGame, player: { name: "\u5F85\u9009\u6A21\u578B", providerName: "\u672A\u53C2\u8D5B" } }), h2("span", { className: "ar-vs" }, "VS"), h2(Player, { index: 1, gameId: selectedGame, player: { name: "\u5F85\u9009\u6A21\u578B", providerName: "\u672A\u53C2\u8D5B" } })), h2("div", { className: "ar-board", dangerouslySetInnerHTML: { __html: boardSvg([], { gameId: selectedGame }) } })), h2("aside", { className: "ar-commentary" }, h2("div", { className: "ar-commentary-head" }, h2("h2", { className: "ar-section-title" }, "\u9009\u624B\u53D1\u8A00"), h2("span", { className: "ar-chip" }, "\u672A\u5F00\u59CB")), h2("div", { className: "ar-speaking", "data-thinking": true }, h2("div", { className: "ar-speaking-name" }, h2(MessageCircle), "\u7B49\u5F85\u53C2\u8D5B\u9009\u624B"), h2("p", null, "\u6BD4\u8D5B\u5C1A\u672A\u5F00\u59CB")), h2("div", { className: "ar-transcript-title" }, "\u56DE\u5408\u8BB0\u5F55"), h2("div", { className: "ar-empty" }, activeCount ? `\u5DF2\u6709 ${activeCount} \u573A\u6BD4\u8D5B\u8FDB\u884C\u4E2D\uFF0C\u53EF\u5728\u6BD4\u8D5B\u8BB0\u5F55\u4E2D\u67E5\u770B\u3002` : "\u6682\u65E0\u56DE\u5408\u8BB0\u5F55")))
  );
}
function History({ renderConversation, focusSession, lwbAccount }) {
  const list = useQuery("matches"), [id, setId] = import_react4.default.useState(null), [search, setSearch] = import_react4.default.useState(""), [status, setStatus] = import_react4.default.useState("");
  import_react4.default.useEffect(() => {
    const timer = setInterval(list.refresh, 2e3);
    return () => clearInterval(timer);
  }, [list.refresh]);
  const matches = list.value || [], filtered = matches.filter((match) => (!status || match.status === status) && `${match.title} ${gameName(match.game)} ${match.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (id) return h2(Frame, { tone: "cyan", kicker: "\u6BD4\u8D5B\u8BB0\u5F55", title: "\u6BD4\u8D5B\u56DE\u653E", subtitle: matches.find((match) => match.id === id)?.title, actions: h2(Button, { primary: true, className: "ar-back-button", icon: ArrowLeft, onClick: () => setId(null) }, "\u8FD4\u56DE\u8BB0\u5F55") }, h2(MatchView, { key: id, id, activeCount: activeMatchCount(matches), onChange: list.refresh, renderConversation, focusSession, lwbAccount }));
  return h2(
    Frame,
    { tone: "cyan", kicker: "\u5BF9\u6218\u6863\u6848", title: "\u6BD4\u8D5B\u8BB0\u5F55", subtitle: "\u4E94\u5B50\u68CB / \u4E2D\u56FD\u8C61\u68CB", actions: h2(IconButton, { icon: RefreshCw, title: "\u5237\u65B0\u6BD4\u8D5B\u8BB0\u5F55", onClick: list.refresh }) },
    list.error && h2("p", { className: "ar-error" }, list.error),
    h2(StatBar, { items: [{ label: "\u5168\u90E8\u6BD4\u8D5B", value: matches.length, tone: "brand" }, { label: "\u6B63\u5728\u6BD4\u8D5B", value: activeMatchCount(matches) }, { label: "\u5DF2\u7ED3\u675F", value: matches.filter((match) => match.status === "finished").length, tone: "green" }, { label: "\u7D2F\u8BA1\u843D\u5B50", value: matches.reduce((total, match) => total + match.moves, 0) }] }),
    h2("div", { className: "ar-history-toolbar" }, h2("h2", { className: "ar-section-title" }, "\u5BF9\u6218\u8BB0\u5F55"), h2("div", { className: "ar-actions" }, h2("input", { className: "ar-search", type: "search", placeholder: "\u641C\u7D22\u6A21\u578B\u6216\u6BD4\u8D5B\u7F16\u53F7", "aria-label": "\u641C\u7D22\u6BD4\u8D5B", value: search, onChange: (event) => setSearch(event.target.value) }), h2("select", { className: "ar-select", "aria-label": "\u6BD4\u8D5B\u72B6\u6001\u7B5B\u9009", value: status, onChange: (event) => setStatus(event.target.value) }, h2("option", { value: "" }, "\u5168\u90E8\u72B6\u6001"), Object.entries(statusLabel).map(([value, label]) => h2("option", { key: value, value }, label))))),
    filtered.length ? h2("nav", { className: "ar-history-list", "aria-label": "\u5386\u53F2\u6BD4\u8D5B" }, h2("div", { className: "ar-history-columns", "aria-hidden": true }, h2("span", null, "\u53C2\u8D5B\u9009\u624B"), h2("span", null, "\u6BD4\u8D5B\u65F6\u95F4"), h2("span", null, "\u843D\u5B50"), h2("span", null, "\u72B6\u6001"), h2("span")), filtered.map((match) => h2("button", { key: match.id, className: "ar-row", onClick: () => setId(match.id), "aria-label": `\u56DE\u653E ${match.title} \xB7 ${match.moves} \u624B` }, h2("span", { className: "ar-row-title" }, h2("strong", null, match.title), h2("small", null, `${gameName(match.game)} \xB7 ${match.id.slice(0, 8)}`)), h2("span", { className: "ar-row-date" }, new Date(match.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })), h2("span", { className: "ar-row-count" }, `${match.moves} \u624B`), h2(Status, { status: match.status }), h2(ChevronRight)))) : h2("div", { className: "ar-empty" }, h2(Trophy), list.value ? search || status ? "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6BD4\u8D5B" : "\u6682\u65E0\u6BD4\u8D5B\u8BB0\u5F55" : "\u6B63\u5728\u8BFB\u53D6\u6BD4\u8D5B\u8BB0\u5F55\u2026")
  );
}
function Games({ openPackMenu }) {
  const [confirm, confirmation] = useConfirmation();
  const games = useQuery("games"), matches = useQuery("matches"), activeCount = activeMatchCount(matches.value || []);
  import_react4.default.useEffect(() => {
    const timer = setInterval(matches.refresh, 2e3);
    return () => clearInterval(timer);
  }, [matches.refresh]);
  const example = [{ row: 8, col: 8, player: 0 }, { row: 8, col: 9, player: 1 }, { row: 7, col: 8, player: 0 }, { row: 9, col: 8, player: 1 }, { row: 6, col: 8, player: 0 }];
  const enterArena = async (game) => {
    if (!await confirm({ title: `\u51C6\u5907\u4E00\u573A\u65B0\u7684${game.name}\u6BD4\u8D5B\uFF1F`, description: "\u786E\u8BA4\u540E\u8FDB\u5165\u5168\u65B0\u68CB\u76D8\uFF0C\u518D\u9009\u62E9\u53C2\u8D5B\u6A21\u578B\u548C\u6BD4\u8D5B\u914D\u7F6E\u3002\u5386\u53F2\u6BD4\u8D5B\u4FDD\u7559\u5728\u6BD4\u8D5B\u8BB0\u5F55\u4E2D\u3002", notice: activeCount > 0 ? `\u5DF2\u6709 ${activeCount} \u573A\u6BD4\u8D5B\u8FDB\u884C\u4E2D\uFF0C\u8FDB\u5165\u65B0\u68CB\u76D8\u4E0D\u4F1A\u4E2D\u65AD\u8FD9\u4E9B\u6BD4\u8D5B\u3002` : null, confirmLabel: "\u8FDB\u5165\u7ADE\u6280\u53F0" })) return;
    rememberedId = null;
    rememberedGameId = game.id;
    arenaEntryMode = "fresh";
    openPackMenu?.("arena");
  };
  return h2(Frame, { tone: "violet", kicker: "\u7ADE\u6280\u6E38\u620F", title: "\u6E38\u620F\u5E93", subtitle: `${games.value?.length || 0} \u6B3E\u6E38\u620F` }, games.error && h2("p", { className: "ar-error" }, games.error), h2("div", { className: "ar-game-grid" }, (games.value || []).map((game) => h2("article", { key: game.id, className: "ar-game" }, h2("div", { className: "ar-game-preview", dangerouslySetInnerHTML: { __html: boardSvg(game.id === "xiangqi" ? [] : example, { gameId: game.id }) } }), h2("div", { className: "ar-game-body" }, h2("div", { className: "ar-game-title" }, h2("h2", null, game.name), h2("span", { className: "ar-chip", "data-tone": "page" }, "\u53EF\u7ADE\u6280")), h2("p", { className: "ar-game-rule" }, game.description), h2("div", { className: "ar-game-facts" }, h2("span", { className: "ar-chip" }, gameMeta(game.id).board), h2("span", { className: "ar-chip" }, `${game.players} \u4F4D\u9009\u624B`), h2("span", { className: "ar-chip" }, game.id === "xiangqi" ? "\u7EA2\u65B9\u5148\u624B" : "\u9ED1\u65B9\u5148\u624B")), h2("div", { className: "ar-game-footer" }, h2("span", null, `\u89C4\u5219\u7248\u672C ${game.version}`), h2(Button, { primary: true, icon: Play, onClick: () => enterArena(game) }, "\u5F00\u59CB\u6BD4\u8D5B")))))), confirmation);
}
function apply(ctx) {
  connection = ctx.connection;
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@scitiger-ai/lwb-ai-arena";
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  }, "ai-arena: styles");
  ctx.effect(() => ctx.lwbPackClient.register({ packId: "ai-arena", pages: { games: Games, arena: Arena, history: History } }), "ai-arena: pages");
}
var inject = ["lwbPackClient", "connection"];
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils.js:
lucide-react/dist/esm/defaultAttributes.js:
lucide-react/dist/esm/Icon.js:
lucide-react/dist/esm/createLucideIcon.js:
lucide-react/dist/esm/icons/arrow-left.js:
lucide-react/dist/esm/icons/chevron-down.js:
lucide-react/dist/esm/icons/chevron-left.js:
lucide-react/dist/esm/icons/chevron-right.js:
lucide-react/dist/esm/icons/download.js:
lucide-react/dist/esm/icons/eye.js:
lucide-react/dist/esm/icons/file-text.js:
lucide-react/dist/esm/icons/film.js:
lucide-react/dist/esm/icons/message-circle.js:
lucide-react/dist/esm/icons/pause.js:
lucide-react/dist/esm/icons/play.js:
lucide-react/dist/esm/icons/radio.js:
lucide-react/dist/esm/icons/refresh-cw.js:
lucide-react/dist/esm/icons/settings-2.js:
lucide-react/dist/esm/icons/skip-back.js:
lucide-react/dist/esm/icons/square.js:
lucide-react/dist/esm/icons/trophy.js:
lucide-react/dist/esm/icons/x.js:
lucide-react/dist/esm/lucide-react.js:
  (**
   * @license lucide-react v0.468.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
return module.exports;}});
