/**
 * 离线回放的浏览器运行时入口。
 * 只把 presentation.mjs 里纯字符串生成的棋盘/文案函数暴露到 window，
 * 保证离线回放画的棋盘与工作台内观战、视频模板完全同源。
 *
 * 票型三件套（票型条文案 / 配色档 / 出局死因标记）也走这里：离线播放器是浏览器里的
 * 一份独立渲染，不从这里取就会变成第四处各写一套措辞。
 *
 * 棋类的「哪一方」（`sideIdentity`）同样走这里：方名与徽记必须与观战页、视频侧同源，
 * 否则「黑方 / 白方」会在三处各写一遍。
 *
 * 象棋的无进展倒计时（`noProgressClock`）也走这里：离线播放器逐手查
 * `__ARENA_DATA__.noProgress.clocks`，但「距判和还有 N 手 / 停滞待判和」的措辞只此一份，
 * 不在 app.js 里另写一遍。
 *
 * 由 build-replay.mjs 打包成 replay/runtime.js（IIFE，无 import，可内联进单文件 HTML）。
 */
import { boardSvg, actionLabel, playerSide, sideIdentity, gameName, isCompactTurn, werewolfVoteLine, werewolfVoteTone, werewolfDeathMark, noProgressClock } from '../presentation.mjs'

globalThis.ArenaScene = { boardSvg, actionLabel, playerSide, sideIdentity, gameName, isCompactTurn, werewolfVoteLine, werewolfVoteTone, werewolfDeathMark, noProgressClock }