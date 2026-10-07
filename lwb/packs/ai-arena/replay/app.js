/* 棋盘优先版播放器：满幅出血棋盘 + 降调信息栏 + 关键手分级动效。 */
(function () {
  const S = globalThis.ArenaScene
  const D = globalThis.__ARENA_DATA__
  const M = D.moves.length
  const FINALE = M + 1
  const STEP_MS = 3000
  const FINALE_MS = 4000
  const AUDIO_TAIL_MS = 350
  const MAJOR = new Set(['chariot', 'cannon', 'horse'])
  const PIECE_CN = { chariot: '车', cannon: '炮', horse: '马', soldier: '兵', elephant: '相', adviser: '士' }
  const SVGNS = 'http://www.w3.org/2000/svg'

  /* 关键手模式：major=吃大子/将军，all=吃子/将军，check=仅将军，off=关闭。
   默认 major：all 的 38 处里有 11 处是吃兵卒士象的常规兑换，且有一段连推 4 手；
   check 只有 17 处且全部孤立，但会丢掉第 17–20 手连续吃车吃炮的兑子高潮。 */
  let keyMode = 'major'
  const isKey = i => {
    if (keyMode === 'off') return false
    const k = D.keys.find(x => x.n === i)
    if (!k) return false
    if (k.kind === 'win' || k.kind === 'check') return true
    if (k.kind !== 'capture') return false
    return keyMode === 'all' || (keyMode === 'major' && MAJOR.has(k.piece))
  }
  const activeKeys = () => D.keys.filter(k => isKey(k.n))

  const $ = id => document.getElementById(id)
  const stage = $('stage')
  const boardCard = $('boardCard')
  const board = $('board')
  const heroLbl = $('heroLbl')
  const heroNum = $('heroNum')
  const heroTot = $('heroTot')
  const heroTag = $('heroTag')
  const score = $('score')
  const who = $('who')
  const coord = $('coord')
  const text = $('text')
  const recentEl = $('recent')
  const rlist = $('rlist')
  const finale = $('finale')
  const fmessage = $('fmessage')
  const fill = $('fill')
  const tickLayer = $('tickLayer')
  const cursorEl = $('cursorEl')
  const pcount = $('pcount')
  const ptime = $('ptime')
  const clock = $('clock')
  const scrub = $('scrub')

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const side = i => S.playerSide(D.game, i)
  const visibleMoves = index => D.moves.slice(0, index)
  const duration = i => {
    if (i === FINALE) return FINALE_MS
    const spoken = i >= 1 ? Number(D.moves[i - 1]?.audioSec) : 0
    return Number.isFinite(spoken) && spoken > 0 ? Math.max(STEP_MS, spoken * 1000 + AUDIO_TAIL_MS) : STEP_MS
  }
  const isPortrait = () => stage.dataset.layout === 'portrait'

  /* ---------------- 记分板（常驻，只切状态） ---------------- */
  function stoneClass(i) {
    if (D.game.id === 'xiangqi') return i ? 'xq-black' : 'xq-red'
    return i ? 'white' : 'black'
  }
  score.innerHTML = D.players.map((p, i) => `
    <div class="pcard" data-i="${i}">
      <img class="logo" src="${p.logo || ''}" alt="">
      <i class="stone ${stoneClass(i)}"></i>
      <span class="nm">${esc(p.name)}</span>
      <span class="sd">${side(i)} · ${i === 0 ? '先手' : '后手'}</span>
      <em class="bd"></em>
    </div>`).join('')

  /* ---------------- 进度条锚点（关键手） ---------------- */
  /* 分母兜底：没有任何落子的比赛（例如开局即取消）不能除以 0 */
  const DEN = M || 1
  function drawTicks() {
    tickLayer.innerHTML = activeKeys().map(k => {
      const cls = k.kind === 'check' ? 'chk' : k.kind === 'win' ? 'win' : 'cap'
      return `<i class="tick ${cls}" style="left:${(k.n / DEN) * 100}%"></i>`
    }).join('')
  }
  drawTicks()

  /* ---------------- 棋盘 ---------------- */
  const boardMove = m => ({ ...m.a, player: m.p })
  function boardMarkup(index) {
    const moves = visibleMoves(index).map(boardMove)
    return { svg: S.boardSvg(moves, { gameId: D.game?.id }), moves }
  }
  /* 五子棋终局：金带铺底 + 五颗连子依次点亮。
     带子必须比木纹亮一档，否则金压金看不见。 */
  function winBand(svgEl) {
    if (!D.winRun || D.winRun.length < 5) return
    const margin = 34, gap = 32
    const pt = c => ({ x: margin + (c.col - 1) * gap, y: margin + (c.row - 1) * gap })
    const a = pt(D.winRun[0]), b = pt(D.winRun[D.winRun.length - 1])
    const line = document.createElementNS(SVGNS, 'line')
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y)
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y)
    line.setAttribute('stroke', '#F0B429')
    line.setAttribute('stroke-width', '44')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('opacity', '.55')
    line.setAttribute('class', 'winband')
    const firstStone = svgEl.querySelector('g')
    if (firstStone) svgEl.insertBefore(line, firstStone); else svgEl.appendChild(line)
    D.winRun.forEach((c, i) => {
      const p = pt(c)
      const ring = document.createElementNS(SVGNS, 'circle')
      ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y)
      ring.setAttribute('r', '16')
      ring.setAttribute('fill', 'none')
      ring.setAttribute('stroke', '#F0B429')
      ring.setAttribute('stroke-width', '2.4')
      ring.setAttribute('class', 'winring')
      ring.style.animationDelay = `${120 + i * 80}ms`
      svgEl.appendChild(ring)
    })
  }

  /* 棋子索引：以「圆心坐标」为键。识别被吃子不需要复刻规则——
     同一格在新局面里换了字，原来那颗就是被吃的。 */
  function pieceMap(svgEl) {
    const m = new Map()
    if (!svgEl) return m
    for (const g of svgEl.querySelectorAll('g')) {
      if (g.classList.contains('ghost')) continue
      const t = g.querySelector('text'), c = g.querySelector('circle')
      if (!t || !c) continue
      m.set(`${c.getAttribute('cx')}|${c.getAttribute('cy')}`, { g, glyph: t.textContent })
    }
    return m
  }
  let prevPieces = null

  function detectCapture(prev, next) {
    if (!prev) return null
    for (const [k, v] of prev) {
      const n = next.get(k)
      if (n && n.glyph !== v.glyph) return v
    }
    return null
  }
  /* 本手落点：**不能**取「DOM 里最后一个 g」。
     boardSvg 是按当前局面整体重绘的，象棋的 g 顺序是位置序而非落子序，
     最后一个 g 永远是底排某颗没动过的子 —— 实测前 8 手一直是右下角「车」，
     第 17 手起变成「相」，于是那颗子每一手都要闪一下（用户报的正是这个）。
     改用坐标差判定落点：新出现的坐标 = 落点；同格换了字 = 吃子，换上去的也是落点。 */
  function findMovedPiece(prev, next) {
    if (!prev) return null
    for (const [k, v] of next) {
      const p = prev.get(k)
      if (!p || p.glyph !== v.glyph) return v
    }
    return null
  }
  function markKing(svgEl, glyph) {
    for (const g of svgEl.querySelectorAll('g')) {
      const t = g.querySelector('text')
      if (!t || t.textContent !== glyph) continue
      g.classList.add('is-ck')
      const c = g.querySelector('circle')
      if (!c) return
      const ring = document.createElementNS(SVGNS, 'circle')
      ring.setAttribute('cx', c.getAttribute('cx'))
      ring.setAttribute('cy', c.getAttribute('cy'))
      ring.setAttribute('r', '21')
      ring.setAttribute('fill', 'none')
      ring.setAttribute('stroke', '#E24B4A')
      ring.setAttribute('stroke-width', '3')
      ring.setAttribute('class', 'pulse')
      svgEl.appendChild(ring)
      return
    }
  }
  function addGhost(svgEl, cap) {
    const node = cap.g.cloneNode(true)
    node.setAttribute('class', 'ghost')
    svgEl.appendChild(node)
  }

  const tagHtml = (key, isFinale, isDraw) => {
    if (isFinale) return isDraw ? '<span class="pill plain">和棋</span>' : '<span class="pill win">胜局</span>'
    if (!key) return ''
    if (key.kind === 'check') return '<span class="pill chk">将军</span>'
    if (key.kind === 'win') return '<span class="pill win">胜局</span>'
    if (key.kind === 'capture') return `<span class="pill cap">吃${PIECE_CN[key.piece] || '子'}</span>`
    return ''
  }

  /* 发言字号阶梯：长局里既不缩到看不清，也不撑爆字幕区 */
  function stepSize(n) {
    const p = isPortrait()
    if (n <= 24) return p ? 26 : 30
    if (n <= 40) return p ? 23 : 26
    return p ? 21 : 23
  }

  /* ---------------- 渲染 ---------------- */
  let current = -1
  function render(index, animate) {
    if (index < 0) index = 0
    if (index > FINALE) index = FINALE
    const isFinale = index === FINALE
    current = index

    const key = !isFinale && index >= 1 ? D.keys.find(k => k.n === index) : null
    const last = index >= 1 ? D.moves[index - 1] : null
    const winner = D.result && typeof D.result.winner === 'number' ? D.result.winner : null
    const isDraw = !!D.result && winner === null

    stage.dataset.phase = isFinale ? 'finale' : 'move'
    stage.dataset.game = D.game.id || ''
    stage.dataset.fx = animate && key ? key.kind : ''
    stage.classList.remove('animate')
    boardCard.classList.remove('push')
    board.classList.remove('shake')

    /* 棋盘 */
    const built = boardMarkup(index)
    board.innerHTML = built.svg
    const svgEl = board.querySelector('svg')
    if (isFinale && D.winRun) winBand(svgEl)
    const nextPieces = pieceMap(svgEl)
    if (animate && last) {
      const moved = findMovedPiece(prevPieces, nextPieces)
      if (moved) moved.g.classList.add('is-new')
      if (key && key.kind === 'capture') {
        const cap = detectCapture(prevPieces, nextPieces)
        if (cap) addGhost(svgEl, cap)
      }
      if (key && key.kind === 'check') markKing(svgEl, last.p === 0 ? '将' : '帅')
    }
    prevPieces = nextPieces

    /* 手数（状态，放大为主角之一）+ 关键手标签 */
    heroLbl.textContent = isFinale ? '终局' : '当前手数'
    heroNum.textContent = isFinale ? M : index
    heroTot.textContent = `/ ${M} 手`
    heroTag.innerHTML = tagHtml(key, isFinale, isDraw)

    /* 记分板 */
    const active = isFinale ? -1 : (last ? last.p : 0)
    score.querySelectorAll('.pcard').forEach(card => {
      const i = Number(card.dataset.i)
      card.dataset.active = String(i === active)
      card.querySelector('.bd').textContent = isFinale ? (winner === i ? '胜' : isDraw ? '和' : '') : ''
    })

    /* 叙事区 / 终局卡 */
    if (isFinale) {
      fmessage.textContent = (D.result && D.result.message) || '比赛已结束。'
      finale.dataset.kind = isDraw ? 'draw' : 'win'
    } else if (last) {
      who.innerHTML = `<img class="logo" src="${D.players[last.p].logo || ''}" alt="">${esc(D.players[last.p].name)} · 本手发言`
      coord.textContent = S.actionLabel(last.a, D.game)
      coord.hidden = false
      text.textContent = last.s
      text.style.fontSize = stepSize(last.s.length) + 'px'
    } else {
      who.textContent = '开局'
      coord.hidden = true
      text.textContent = '比赛开始'
      text.style.fontSize = stepSize(4) + 'px'
    }

    /* 回合记录：当前手之前的最近 5 手，压低对比。
       取 5 而非 3：横屏叙事区高 387px，3 条时本手发言与记录之间空出 124~169px
       （比发言块本身还高），5 条把空隙压到 46~91px；6 条在最长发言下会溢出。
       第 0 手没有历史就整块收起。 */
    const entries = visibleMoves(index).slice(-6, -1).reverse()
    recentEl.hidden = entries.length === 0
    rlist.innerHTML = entries
      .map(m => `<div class="rentry"><b>${m.n} · ${esc(D.players[m.p].name)}</b><span>${esc(m.s)}</span></div>`).join('')

    /* 进度 */
    const pct = (index / FINALE) * 100
    fill.style.width = `${pct}%`
    /* 指针半径 6.5px：按比例回缩，避免走到 100% 时探出轨道 */
    cursorEl.style.left = `calc(${pct}% - ${(pct * 0.065).toFixed(2)}px)`
    pcount.innerHTML = isFinale ? `共 <b>${M}</b> 手 · 终局` : `第 <b>${index}</b> / ${M} 手`
    ptime.innerHTML = `关键手 <b>${activeKeys().length}</b> 处`

    /* 动效 */
    if (animate) {
      void stage.offsetWidth
      stage.classList.add('animate')
      if (!isFinale && index >= 1 && isKey(index)) boardCard.classList.add('push')
      if (key && key.kind === 'capture') board.classList.add('shake')
    }
  }

  /* ---------------- 播放器 ---------------- */
  let playing = false, index = 0, t = 0, last = 0
  function elapsedTotal() {
    let sum = 0
    for (let i = 0; i < index; i++) sum += duration(i)
    return sum + t
  }
  const total = () => {
    let sum = 0
    for (let i = 0; i <= FINALE; i++) sum += duration(i)
    return sum
  }
  const voice = document.createElement('audio')
  voice.preload = 'auto'
  function speak(step) {
    voice.pause()
    const clip = step >= 1 && step <= M ? D.moves[step - 1]?.audio : ''
    if (!clip) { voice.removeAttribute('src'); return }
    voice.src = clip
    voice.currentTime = 0
    if (playing) voice.play().catch(() => {})
  }
  const fmt = ms => {
    const s = Math.max(0, Math.round(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  function tickClock() {
    clock.textContent = `${fmt(elapsedTotal())} / ${fmt(total())}`
    scrub.value = String(index)
  }
  function loop(now) {
    if (!playing) return
    const dt = now - last
    last = now
    t += dt
    if (t >= duration(index)) {
      if (index >= FINALE) {
        playing = false
        t = duration(FINALE)
        render(FINALE, false)
        syncPlayButton()
        tickClock()
        return
      }
      t = 0
      index += 1
      render(index, true)
      speak(index)
    }
    tickClock()
    requestAnimationFrame(loop)
  }
  function play() {
    if (index >= FINALE && t >= duration(FINALE)) { index = 0; t = 0; render(0, false) }
    playing = true
    stage.classList.remove('paused')
    speak(index)
    last = performance.now()
    syncPlayButton()
    requestAnimationFrame(loop)
  }
  function pause() {
    playing = false
    voice.pause()
    stage.classList.add('paused')
    syncPlayButton()
  }
  function goto(i, animate) {
    index = Math.max(0, Math.min(FINALE, i))
    t = 0
    stage.classList.remove('paused')
    render(index, !!animate)
    speak(index)
    tickClock()
  }
  const playBtn = $('play')
  function syncPlayButton() {
    playBtn.textContent = playing ? '❚❚ 暂停' : '▶ 播放'
    playBtn.dataset.on = String(playing)
  }
  playBtn.onclick = () => (playing ? pause() : play())
  $('prev').onclick = () => { pause(); goto(index - 1, false) }
  /* 下一步按“播放推进”处理，这样单步也能看到落子与关键手动效 */
  $('next').onclick = () => { pause(); goto(index + 1, true) }
  scrub.max = String(FINALE)
  scrub.oninput = () => { pause(); goto(Number(scrub.value), false) }
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); goto(index - 1, false) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); goto(index + 1, false) }
    else if (e.key === ' ') { e.preventDefault(); playing ? pause() : play() }
  })

  /* 画幅切换 */
  const layoutBtns = [...document.querySelectorAll('[data-layout-btn]')]
  function setLayout(name) {
    stage.dataset.layout = name
    layoutBtns.forEach(b => { b.dataset.on = String(b.dataset.layoutBtn === name) })
    fit()
    /* 字号阶梯与栅格随画幅变，需要重排当前帧 */
    if (current >= 0) render(current, false)
  }
  layoutBtns.forEach(b => { b.onclick = () => setLayout(b.dataset.layoutBtn) })

  /* 关键手强调档位（便于 A/B 对比） */
  const keySelect = $('keyMode')
  keySelect.value = keyMode
  keySelect.onchange = () => {
    keyMode = keySelect.value
    drawTicks()
    if (current >= 0) render(current, true)
  }

  $('pure').onclick = () => {
    const base = location.href.split('#')[0]
    open(`${base}#video/${stage.dataset.layout}`, '_blank')
  }

  /* 等比缩放适配 */
  function fit() {
    const stageW = isPortrait() ? 720 : 1280
    const stageH = isPortrait() ? 1280 : 720
    const vp = document.querySelector('.viewport').getBoundingClientRect()
    const s = Math.min(vp.width / stageW, vp.height / stageH, 1.25)
    const box = $('stagebox')
    box.style.width = `${stageW * s}px`
    box.style.height = `${stageH * s}px`
    stage.style.transform = `scale(${s})`
  }
  window.addEventListener('resize', fit)

  /* 纯画面模式：#video[/landscape|portrait][/INDEX] */
  const hash = location.hash.replace(/^#/, '')
  const parts = hash.split('/').filter(Boolean)
  if (parts[0] === 'video') {
    document.documentElement.dataset.mode = 'video'
    setLayout(parts[1] === 'portrait' ? 'portrait' : 'landscape')
    const start = Number(parts[2])
    goto(Number.isFinite(start) ? start : 0, false)
    fit()
    if (!Number.isFinite(start)) { play() } else { pause() }
  } else {
    setLayout('landscape')
    goto(0, false)
    tickClock()
  }
  syncPlayButton()
})()
