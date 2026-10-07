import React from 'react'
import { Composition, registerRoot, useCurrentFrame, useVideoConfig } from 'remotion'
import { stageHtml } from './replay/markup.mjs'
import { SCENE_CSS } from './replay/styles.mjs'
import { VIDEO_KEY_MODE, frameToStep } from './replay/timeline.mjs'

const h = React.createElement

function ArenaVideo({ data, layout, secondsPerMove, durations = null }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { index, t } = frameToStep(frame, fps, data.moves.length, secondsPerMove, durations)
  const html = stageHtml(data, index, { layout, t, keyMode: VIDEO_KEY_MODE })
  return h(React.Fragment, null,
    /* Remotion 逐帧截图，浏览器时钟不随帧号推进：所有 CSS 动画/过渡都必须关掉，
       否则同一帧会因为截图时刻不同而得到不同画面。时间相关的量一律由 markup 内联。 */
    h('style', null, `${SCENE_CSS}\nhtml,body{margin:0;background:#F4F5F3}\n*,*::before,*::after{animation:none!important;transition:none!important}`),
    h('div', { style: { width: '100%', height: '100%' }, dangerouslySetInnerHTML: { __html: html } }))
}

function Root() {
  return h(Composition, { id: 'Arena', component: ArenaVideo, width: 1280, height: 720, fps: 30, durationInFrames: 300 })
}

registerRoot(Root)