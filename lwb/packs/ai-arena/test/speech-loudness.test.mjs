/**
 * 响度对齐。旧实现用「真峰值 - 3 dB」估语音的综合响度，而语音的波峰因数常在 15 dB 上下，
 * 于是增益算出来是反的：波峰因数超过 16.5 dB 的句子会被压到 -30 LUFS 附近，
 * 听感上就是「有些地方声音特别小」。这里守住两条边界：
 *   1. 输出贴近 -16 LUFS，不因为真峰值上限就把增益砍回去（旧实现偏离 14 dB）；
 *   2. 同一句话只是整体音量不同时，对齐后的响度必须一致。
 * 素材用 lavfi 现场合成，不依赖随包音频；只用 sine / volume / adelay / amix 四个滤镜，
 * 连精简构建也跑得动。
 */
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeLoudness } from '../speech.mjs'

const exec = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'arena-speech-'))
after(() => rm(root, { recursive: true, force: true }))

/* 部分 FFmpeg 构建（例如 Remotion 随包那份）裁掉了 alimiter，对齐会退回两遍 loudnorm：
   那条路只贴到真峰值上限为止，高波峰因数的句子会低 2–3 LU，所以边界要分档。 */
const limiterAvailable = await (async () => {
  try {
    const { stdout = '' } = await exec('ffmpeg', ['-hide_banner', '-h', 'filter=alimiter'])
    return /lookahead limiter/u.test(stdout)
  } catch { return false }
})()

let counter = 0

/** 现场合成一句「语音」：一段中等电平的底子 + 一根短促的高峰，波峰因数落在 16–18 dB。 */
async function speechLike({ bodyDb, spikeDb }) {
  const file = join(root, `fixture-${bodyDb}-${spikeDb}.mp3`)
  await exec('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=180:duration=2.4:sample_rate=44100',
    '-f', 'lavfi', '-i', 'sine=frequency=1600:duration=0.04:sample_rate=44100',
    '-filter_complex', `[0:a]volume=${bodyDb}dB[body];[1:a]volume=${spikeDb}dB,adelay=1200|1200[spike];[body][spike]amix=inputs=2:normalize=0:duration=first[a]`,
    '-map', '[a]', '-ar', '44100', '-q:a', '4', file])
  return readFile(file)
}

async function measure(bytes) {
  counter += 1
  const file = join(root, `measure-${counter}.mp3`)
  await writeFile(file, bytes)
  const { stderr = '' } = await exec('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
  return {
    integrated: Number(String(stderr).match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)/u)?.[1]),
    peak: Number(String(stderr).match(/True peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?)/u)?.[1]),
  }
}

test('波峰因数 17 dB 的句子不再被压小，真峰值仍在硬上限之内', async () => {
  const source = await speechLike({ bodyDb: -2, spikeDb: 12 })
  const before = await measure(source)
  assert.ok(before.peak - before.integrated > 16.5, `素材必须落在触发旧 bug 的波峰因数区间（实测 ${(before.peak - before.integrated).toFixed(1)} dB）`)
  const after = await measure(await normalizeLoudness(source, {}))
  /* 旧实现把同一份素材压到 -29.9 LUFS / -12.9 dBTP。 */
  const floor = limiterAvailable ? -17.5 : -19.5
  assert.ok(after.integrated >= floor, `对齐后不能比 ${floor} LUFS 更小（实测 ${after.integrated}）`)
  assert.ok(after.integrated <= -14.5, `对齐后不能冲过目标（实测 ${after.integrated}）`)
  assert.ok(after.peak <= -1, `真峰值不能越过 -1 dBTP（实测 ${after.peak}）`)
})

test('同一句只是整体音量不同时，对齐后的响度一致', async () => {
  const loud = await measure(await normalizeLoudness(await speechLike({ bodyDb: -2, spikeDb: 12 }), {}))
  const quiet = await measure(await normalizeLoudness(await speechLike({ bodyDb: -10, spikeDb: 4 }), {}))
  assert.ok(Math.abs(loud.integrated - quiet.integrated) <= 1, `相差 8 dB 的两份素材应对齐到同一响度（实测 ${loud.integrated} / ${quiet.integrated}）`)
})

test('高波峰因数的句子贴到 -16 LUFS（需要 FFmpeg 的 alimiter）', { skip: limiterAvailable ? false : '此环境的 FFmpeg 没有 alimiter，只能验证 loudnorm 兜底' }, async () => {
  const after = await measure(await normalizeLoudness(await speechLike({ bodyDb: -2, spikeDb: 12 }), {}))
  assert.ok(Math.abs(after.integrated + 16) <= 1.5, `应贴住 -16 LUFS（实测 ${after.integrated}）`)
})