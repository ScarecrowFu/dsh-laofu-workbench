/**
 * 离线回放的浏览器运行时入口。
 * 只把 presentation.mjs 里纯字符串生成的棋盘/文案函数暴露到 window，
 * 保证离线回放画的棋盘与工作台内观战、视频模板完全同源。
 *
 * 票型三件套（票型条文案 / 配色档 / 出局死因标记）也走这里：离线播放器是浏览器里的
 * 一份独立渲染，不从这里取就会变成第四处各写一套措辞。
 *
 * 由 build-replay.mjs 打包成 replay/runtime.js（IIFE，无 import，可内联进单文件 HTML）。
 */
import { boardSvg, actionLabel, playerSide, gameName, isCompactTurn, werewolfVoteLine, werewolfVoteTone, werewolfDeathMark } from '../presentation.mjs'

globalThis.ArenaScene = { boardSvg, actionLabel, playerSide, gameName, isCompactTurn, werewolfVoteLine, werewolfVoteTone, werewolfDeathMark }