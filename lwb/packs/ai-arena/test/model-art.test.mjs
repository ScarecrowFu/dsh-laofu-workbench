/**
 * 模型形象素材契约（跨游戏共用）。
 *
 * 形象是「一个模型 = 一个 logo + 一个音色 + 一个形象」里的形象部分，跟着家族走，
 * 五子棋 / 中国象棋 / 狼人杀共用同一套。守卫三件事：
 *   1. model-art.mjs 与 assets/models 严格同步（改了素材必须重新 arena:build）；
 *   2. 素材真的是**带 alpha 的 WebP**——「只有人物、没有底板」这条版式口径的前提，
 *      退回不带 alpha 的 JPEG 就会在白侧栏上露出一块黑底；
 *   3. 变体数常量与随包素材对齐，且每个家族两档都齐全（foll 给席卡与标准档、bust 给紧凑档）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_PORTRAIT_VARIANTS } from '../presentation.mjs'
import { FALLBACK_FAMILIES } from '../models.mjs'
import { MODEL_ART } from '../model-art.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '..', 'assets', 'models')

const names = async tier => (await readdir(join(ASSETS, tier)))
  .filter(name => /\.(jpe?g|png|webp)$/iu.test(name)).map(name => name.replace(/\.[^.]+$/u, '')).sort()

/** 家族家族（含 generic）与每家族的档位命名：`<家族>`、`<家族>-2` … `<家族>-N`、`<家族>-dead`。 */
const families = ['chatgpt', 'claude', 'deepseek', 'doubao', 'kimi', 'mimo', 'minimax', 'qwen', 'zhipu', 'generic']
const living = families.flatMap(key => [
  key, ...Array.from({ length: MODEL_PORTRAIT_VARIANTS - 1 }, (_, index) => `${key}-${index + 2}`),
])

test('model-art.mjs 与 assets/models 保持同步（改了素材必须重新 arena:build）', async () => {
  assert.deepEqual(Object.keys(MODEL_ART.full).sort(), await names('full'))
  assert.deepEqual(Object.keys(MODEL_ART.bust).sort(), await names('bust'))
  /* full 覆盖全部（含出局档），bust 只覆盖在场档：出局档只服务狼人杀席卡，不需要胸像。 */
  assert.deepEqual(Object.keys(MODEL_ART.full).sort(), [...living, ...families.map(key => `${key}-dead`)].sort())
  assert.deepEqual(Object.keys(MODEL_ART.bust).sort(), [...living].sort())
})

test('形象素材是带 alpha 的 WebP：退回 JPEG 就会在白侧栏上露出黑底', async () => {
  for (const url of [...Object.values(MODEL_ART.full), ...Object.values(MODEL_ART.bust)]) {
    assert.match(url, /^data:image\/webp;base64,UklGR/u, '形象必须是 WebP（JPEG 没有 alpha 通道）')
  }
  /* 真验一次 alpha：解一段 WebP 的帧头不够，这里直接看文件而不是 data URL。 */
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const python = process.env.LWB_PYTHON || 'python3'
  const { stdout } = await run(python, ['-c', `
from PIL import Image
import os, sys
root = sys.argv[1]
bad = []
for tier, expect in (("full", (320, 480)), ("bust", (320, 320))):
    for name in sorted(os.listdir(os.path.join(root, tier))):
        im = Image.open(os.path.join(root, tier, name))
        if im.mode != "RGBA" or im.size != expect: bad.append((tier, name, im.mode, im.size))
        if im.getchannel("A").getextrema()[0] != 0: bad.append((tier, name, "no transparent pixel", ""))
print(bad)
`, ASSETS])
  assert.equal(stdout.trim(), '[]', `形象素材必须是 RGBA 且含透明像素：${stdout.trim()}`)
})

test('兜底轮转顺序与变体数常量都钉住：改顺序会让历史对局的形象整体错位', () => {
  assert.equal(MODEL_PORTRAIT_VARIANTS, 3)
  assert.deepEqual([...FALLBACK_FAMILIES], families)
})