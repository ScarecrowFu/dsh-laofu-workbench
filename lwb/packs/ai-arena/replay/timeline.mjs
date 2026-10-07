/**
 * 视频时间轴：离线 HTML、MP4 与测试共用同一套时长口径。
 * 不依赖 React，Node 侧也能直接 import（Remotion 组件另有 video.mjs）。
 */

/** 终局卡时长（秒），与离线 HTML 的 FINALE_MS 一致。 */
export const FINALE_SECONDS = 4

/** 有配音时，这一手至少比音频长这么多，避免尾音被切掉。 */
export const AUDIO_TAIL_SECONDS = 0.35

/**
 * 每一步的时长（秒）。index 0 是开局，1..moveCount 是落子，moveCount+1 是终局卡。
 * 没有音频时长表时，每手仍是 secondsPerMove，和旧回放一致。
 */
export function stepSeconds(index, moveCount, secondsPerMove, durations = null) {
  if (index >= moveCount + 1) return FINALE_SECONDS
  const spoken = index >= 1 ? Number(durations?.[index - 1]) : 0
  if (Number.isFinite(spoken) && spoken > 0) return Math.max(secondsPerMove, spoken + AUDIO_TAIL_SECONDS)
  return secondsPerMove
}

/** 每一步的起始秒。长度为 moveCount + 2（含终局卡）。 */
export function stepStarts(moveCount, secondsPerMove, durations = null) {
  const starts = [0]
  for (let index = 0; index <= moveCount + 1; index++) starts.push(starts[index] + stepSeconds(index, moveCount, secondsPerMove, durations))
  return starts
}

/** 视频固定用「吃大子 / 将军」档：38 处关键手里有 11 处是吃兵卒士象的常规兑换，
    而「仅将军」会丢掉第 17–20 手连续吃车吃炮的兑子高潮。 */
export const VIDEO_KEY_MODE = 'major'

/** 本帧属于哪一步、这一步已播了多少秒。 */
export function frameToStep(frame, fps, moveCount, secondsPerMove, durations = null) {
  const starts = stepStarts(moveCount, secondsPerMove, durations)
  const seconds = frame / fps
  let index = moveCount + 1
  for (let step = 0; step <= moveCount; step++) {
    if (seconds < starts[step + 1]) { index = step; break }
  }
  return { index, t: Math.max(0, seconds - starts[index]) }
}

/** 每手 secondsPerMove 秒（有配音时按音频拉长）、终局卡 FINALE_SECONDS 秒。 */
export function totalFrames(moveCount, fps, secondsPerMove, durations = null) {
  const starts = stepStarts(moveCount, secondsPerMove, durations)
  return Math.round(starts[starts.length - 1] * fps)
}