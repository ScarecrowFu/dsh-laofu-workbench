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
    if (k.kind === 'win' || k.kind === 'check' || k.kind === 'death') return true
    if (k.kind !== 'capture') return false
    return keyMode === 'all' || (keyMode === 'major' && MAJOR.has(k.piece))
  }
  const activeKeys = () => D.keys.filter(k => isKey(k.n))

  const $ = id => document.getElementById(id)
  const stage = $('stage')
  const boardCard = $('boardCard')
  const board = $('board')
  const heroEl = document.querySelector('.hero')
  const heroLbl = $('heroLbl')
  const heroNum = $('heroNum')
  const heroTot = $('heroTot')
  const heroTag = $('heroTag')
  const turnEl = $('turn')
  const turnFigure = $('turnFigure')
  const turnKicker = $('turnKicker')
  const turnName = $('turnName')
  const turnMove = $('turnMove')
  const turnTag = $('turnTag')
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

  /* ---------------- 当前执行者卡（与 replay/markup.mjs 同源） ----------------
     整场画面里「谁在执行」的唯一大号常驻元素。视频侧由 markup 算成内联样式，
     这里只换文本与状态，入场节奏交给 scene.css 的 .stage.animate 关键帧。 */
  /* 形象口径与 replay/markup.mjs 同构：只有人物、没有底板；logo 贴在人物左上角；
     本手有发言才画人，没有发言时这一格里只留 logo（同高占位，侧栏不跳）。
     离线侧不做内联样式，入场节奏交给 scene.css 的 .stage.animate 关键帧。 */
  function renderTurn({ player = null, kicker, name, meta = '', tag = '', phase = 'move', speaks = false, compact = false }) {
    turnEl.dataset.phase = phase
    if (compact) turnEl.dataset.compact = 'true'; else delete turnEl.dataset.compact
    turnKicker.textContent = kicker
    turnName.textContent = name
    turnMove.innerHTML = meta
    turnTag.innerHTML = tag
    const art = globalThis.__ARENA_ART__ || { portraits: {}, busts: {} }
    const key = player && player.portrait
    /* 紧凑档用胸像（46×58 的框里半身缩下去脸就没了），与 markup.mjs 的 artBust 同一口径。 */
    const face = speaks && key
      ? (compact ? (art.busts?.[key] || art.portraits?.[key]) : art.portraits?.[key])
      : ''
    if (face) { turnFigure.dataset.quiet = 'false' } else { turnFigure.dataset.quiet = 'true' }
    turnFigure.innerHTML =
      (face ? `<img class="turn-face" src="${face}" alt="">` : '') +
      (player && player.logo ? `<img class="turn-mark" src="${player.logo}" alt="">` : '')
  }

  /* ---------------- 狼人杀：六席舞台 ---------------- */
  const WOLF = D.game.id === 'werewolf'
  const WOLF_SEATS = (D.werewolf && D.werewolf.seats) || []
  const WOLF_STEPS = (D.werewolf && D.werewolf.steps) || []
  /* 席位与身份：与观战页同一个口径（席号 + 徽记 + 中文名），身份取 data.werewolf.seats 里
     已经投影好的那一份（replay/data.mjs 用 presentation 的 ROLE_MARK / ROLE_NAME 生成）。
     棋类没有 seats，两个函数都返回空串，署名与回合记录与从前一字不变。 */
  const wolfSeatNo = i => WOLF_SEATS[i] ? `<span class="sseat">${WOLF_SEATS[i].seat} 号</span>` : ''
  const wolfRoleTag = i => WOLF_SEATS[i] && WOLF_SEATS[i].mark ? `<em class="srole" data-role="${esc(WOLF_SEATS[i].role)}"><i>${esc(WOLF_SEATS[i].mark)}</i>${esc(WOLF_SEATS[i].roleName || '')}</em>` : ''
  const ART = globalThis.__ARENA_ART__ || { scenes: {}, portraits: {} }
  const artPortrait = key => ART.portraits[key] || ART.portraits.generic || ''
  const seatFace = (seat, alive) => alive ? artPortrait(seat.portrait) : (ART.portraits[`${seat.portrait}-dead`] || artPortrait(seat.portrait))
  const wolfStep = index => (index >= 1 && index <= M ? WOLF_STEPS[index - 1] || null : null)
  const wolfFrame = index => {
    const step = wolfStep(index)
    const last = WOLF_STEPS[WOLF_STEPS.length - 1] || null
    const isFinale = index === M + 1
    const initial = WOLF_SEATS.map(s => s.seat)
    const phase = (step && step.phase) || (D.moves[index - 1] && D.moves[index - 1].phase) || 'night-wolf'
    const fallbackScene = String(phase).indexOf('day') === 0 ? 'day' : 'night'
    return {
      step,
      alive: new Set(isFinale ? (((D.werewolf && D.werewolf.finalAlive) || (last && last.alive)) || initial) : (step ? step.alive : initial)),
      deaths: step ? step.deaths : (isFinale ? ((D.werewolf && D.werewolf.finalDeaths) || []) : []),
      active: step ? step.seat : null,
      scene: step ? step.scene : fallbackScene,
      day: isFinale ? ((last && last.day) || 1) : ((step && step.day) || 1),
      label: step ? step.label : (index >= 1 ? '结算' : '天黑请闭眼'),
    }
  }
  function buildWolf() {
    /* 列数按人数与画幅取向写进 CSS 变量：横竖屏切换时不用重建 DOM。 */
    const cols = (D.werewolf && D.werewolf.columns) || {}
    stage.style.setProperty('--ww-cols', String(cols.landscape || Math.min(WOLF_SEATS.length, 6)))
    stage.style.setProperty('--ww-cols-portrait', String(cols.portrait || 3))
    stage.dataset.seats = String(WOLF_SEATS.length)
    /* 版面与 markup.mjs 逐段对齐：抬头 → 主持人播报 / 终局胜负卡（两者互斥，占同一格）
       → 席位条带。全部参与布局流，胜负卡不可能再压到席卡上。 */
    boardCard.innerHTML =
      '<div class="ww-scene">' +
      ['night', 'day'].map(scene => `<img class="ww-bg" data-scene="${scene}" src="${ART.scenes[scene] || ''}" alt="">`).join('') +
      '<div class="ww-mask"></div>' +
      '<header class="ww-head"><span class="ww-day" id="wwDay"></span><b class="ww-phase" id="wwPhase"></b></header>' +
      '<div class="ww-host" id="wwHost" hidden><em>主持人</em><p id="wwHostText"></p></div>' +
      '<div class="ww-win" id="wwWin" hidden></div>' +
      '<div class="ww-cast" id="wwCast">' + WOLF_SEATS.map((seat, i) =>
        `<figure class="ww-seat" data-i="${i}" data-seat="${seat.seat}" style="--ww-i:${i}">` +
        `<span class="ww-no">${seat.seat}</span>` +
        `<span class="ww-face"><img src="${seatFace(seat, true)}" alt=""><i class="ww-veil"></i></span>` +
        `<figcaption><b class="ww-name">${esc(seat.name)}</b><em class="ww-role" data-role="${esc(seat.role)}">${esc(seat.mark || '·')}</em></figcaption>` +
        `</figure>`).join('') +
      '</div></div>'
  }
  const wolfSeatNodes = () => (WOLF ? [...$('wwCast').querySelectorAll('.ww-seat')] : [])
  function wolfPill(index, frame) {
    const key = index >= 1 ? D.keys.find(k => k.n === index) : null
    if (key && key.kind === 'death') return `<span class="pill cap">出局 ${key.seats.map(s => `${s} 号`).join('、')}</span>`
    if (index >= 1) return `<span class="pill chk">${esc(frame.label)}</span>`
    return ''
  }
  function renderWolf(index, animate) {
    const isFinale = index === FINALE
    const frame = wolfFrame(index)
    /* 本手必须在**函数顶部**取：外层播放器有一个同名的时间戳 `last`，
       晚声明会被它顶替，`last.s` 静默变成 undefined —— 形象就永远画不出来（且不报错）。 */
    const last = index >= 1 ? D.moves[index - 1] : null
    const winnerSide = (D.result && D.result.side) || null
    const scene = isFinale ? (winnerSide === 'wolf' ? 'night' : 'day') : frame.scene
    const label = isFinale ? '终局' : frame.label

    stage.dataset.scene = scene
    stage.dataset.act = isFinale ? 'finale' : (frame.deaths.length ? 'death' : 'move')

    $('wwDay').textContent = isFinale ? `共 ${M} 步 · ${frame.day} 天` : `第 ${frame.day} 天 · ${scene === 'day' ? '白天' : '夜间'}`
    $('wwPhase').textContent = label

    boardCard.querySelectorAll('.ww-bg').forEach(img => { img.style.opacity = img.dataset.scene === scene ? '1' : '0' })

    wolfSeatNodes().forEach(node => {
      const seat = WOLF_SEATS[Number(node.dataset.i)]
      const alive = frame.alive.has(seat.seat)
      const active = !isFinale && seat.seat === frame.active
      const winning = isFinale && winnerSide && seat.role && (seat.role === 'werewolf' ? 'wolf' : 'village') === winnerSide
      node.dataset.alive = String(alive)
      node.dataset.active = String(active)
      if (winning) node.dataset.win = 'true'; else delete node.dataset.win
      const img = node.querySelector('.ww-face img')
      if (img.getAttribute('src') !== seatFace(seat, alive)) img.setAttribute('src', seatFace(seat, alive))
      const face = node.querySelector('.ww-face')
      const strike = face.querySelector('.ww-strike')
      const dying = frame.deaths.indexOf(seat.seat) >= 0
      if (dying && animate && !strike) {
        const mark = document.createElement('span')
        mark.className = 'ww-strike'
        face.insertBefore(mark, face.querySelector('.ww-out'))
      } else if (!dying && strike) strike.remove()
      if (!alive && !face.querySelector('.ww-out')) {
        const out = document.createElement('span')
        out.className = 'ww-out'
        out.textContent = '出局'
        face.appendChild(out)
      } else if (alive) {
        const out = face.querySelector('.ww-out')
        if (out) out.remove()
      }
    })

    /* 主持人播报：出局与阶段由它一起说出，不再单独挂一条出局横幅。
       终局那一格整格让给胜负卡：最后一条结算播报就是它的正文（与 markup.mjs 同源）。 */
    const hostLine = isFinale
      ? ''
      : ((frame.step && frame.step.host) || (index === 0 ? (D.werewolf && D.werewolf.host) || '' : ''))
    const host = $('wwHost')
    host.hidden = !hostLine
    if (hostLine) $('wwHostText').textContent = hostLine

    const win = $('wwWin')
    win.hidden = !isFinale
    if (isFinale) {
      win.dataset.side = winnerSide || 'draw'
      const body = (D.werewolf && D.werewolf.finaleBody) || (D.result && D.result.message) || ''
      win.innerHTML = `<b>${winnerSide === 'wolf' ? '狼人获胜' : winnerSide ? '好人获胜' : '比赛结束'}</b><span>${esc(body)}</span>`
    }

    /* 执行者卡接管「谁在执行」：狼人杀没有棋盘，侧栏的 hero 行整块让给它
       （天数与阶段在舞台抬头里已经有了，不再重复一遍）。 */
    heroEl.hidden = true
    const actor = !isFinale && index >= 1 ? (D.players[D.moves[index - 1].p] || null) : null
    /* 逐手条件：本手有发言才画人；终局与开局都没有「本手发言」，只留同高占位的 logo。 */
    const wolfSpeaks = Boolean(String((last && last.s) || '').trim()) && Boolean(actor)
    const wolfCompact = S.isCompactTurn(D.game.id, stage.dataset.layout)
    renderTurn(isFinale
      ? {
          kicker: '终局', name: winnerSide ? (winnerSide === 'wolf' ? '狼人阵营' : '好人阵营') : '比赛结束',
          meta: `共 <b>${M}</b> 步`, tag: `<span class="pill win">${winnerSide === 'wolf' ? '狼人获胜' : '好人获胜'}</span>`, phase: 'finale', compact: wolfCompact,
        }
      : actor
        ? { player: actor, kicker: '本手执行', name: actor.name || '', speaks: wolfSpeaks, compact: wolfCompact, meta: `<b>${index}</b> / ${M} 步`, tag: wolfPill(index, frame) }
        : { kicker: '开局', name: '天黑请闭眼', meta: `<b>0</b> / ${M} 步`, compact: wolfCompact })

    score.querySelectorAll('.pcard').forEach(card => {
      const i = Number(card.dataset.i)
      const seat = WOLF_SEATS[i]
      const alive = frame.alive.has(seat.seat)
      const active = !isFinale && seat.seat === frame.active
      card.dataset.active = String(active)
      card.dataset.alive = String(alive)
      card.querySelector('.bd').textContent = isFinale
        ? (winnerSide && (seat.role === 'werewolf' ? 'wolf' : 'village') === winnerSide ? '胜' : D.result ? '负' : '')
        : (alive ? '' : '出局')
    })

    /* 叙事区与进度（与棋类共用同一套侧栏元素）；`last` 已在函数顶部取好。 */
    if (isFinale) {
      fmessage.textContent = (D.result && D.result.message) || '比赛已结束。'
      finale.dataset.kind = 'win'
      finale.querySelector('small').textContent = `终局 · ${winnerSide === 'wolf' ? '狼人阵营' : '好人阵营'}`
    } else if (last) {
      who.innerHTML = `<img class="logo" src="${(WOLF_SEATS[last.p] || {}).logo || ''}" alt="">${wolfSeatNo(last.p)}<b class="sn">${esc(D.players[last.p].name)}</b>${wolfRoleTag(last.p)}<em class="stag">本手发言</em>`
      /* 动作标签里的「发言」与署名上的「本手发言」胶囊重复：让位给模型名与身份。
         夜刀 / 查验 / 投票这些带目标的标签仍然要显示。 */
      const label = S.actionLabel(last.a, D.game)
      coord.textContent = label
      coord.hidden = WOLF && label === '发言'
      text.textContent = last.s
      text.style.fontSize = stepSize(last.s.length) + 'px'
    } else {
      who.innerHTML = '<b class="sn">开局</b>'
      coord.hidden = true
      text.textContent = '天黑请闭眼。'
      text.style.fontSize = stepSize(6) + 'px'
    }
    /* 回合记录 3 条 → 2 条：形象进执行者卡后卡片从 79px 长到 112px，这是让位的那一笔（与 markup.mjs 同口径）。 */
    const entries = visibleMoves(index).slice(-3, -1).reverse()
    recentEl.hidden = isFinale || entries.length === 0
    rlist.innerHTML = entries
      .map(m => `<div class="rentry"><b>${m.n} · ${wolfSeatNo(m.p)}${esc(D.players[m.p].name)}${wolfRoleTag(m.p)}</b><span>${esc(m.s)}</span></div>`).join('')
    const pct = (index / FINALE) * 100
    fill.style.width = `${pct}%`
    cursorEl.style.left = `calc(${pct}% - ${(pct * 0.065).toFixed(2)}px)`
    pcount.innerHTML = isFinale ? `共 <b>${M}</b> 手 · 终局` : `第 <b>${index}</b> / ${M} 手`
    ptime.innerHTML = `出局 / 终局 <b>${activeKeys().length}</b> 处`
    drawTicks()
  }
  const duration = i => {
    if (i === FINALE) {
      /* 终局卡那一手可能带最后一条结算播报（见 replay/data.mjs）：卡本身固定 4 秒，但要放得下这一句。 */
      const closing = Number(D.werewolf && D.werewolf.finaleAudioSec) || 0
      return closing > 0 ? Math.max(FINALE_MS, closing * 1000 + AUDIO_TAIL_MS) : FINALE_MS
    }
    const spoken = i >= 1 ? Number(D.moves[i - 1]?.audioSec) : 0
    return Number.isFinite(spoken) && spoken > 0 ? Math.max(STEP_MS, spoken * 1000 + AUDIO_TAIL_MS) : STEP_MS
  }
  const isPortrait = () => stage.dataset.layout === 'portrait'

  /* ---------------- 记分板（常驻，只切状态） ---------------- */
  function stoneClass(i) {
    if (D.game.id === 'xiangqi') return i ? 'xq-black' : 'xq-red'
    return i ? 'white' : 'black'
  }
  score.innerHTML = WOLF
    ? WOLF_SEATS.map((seat, i) => `
    <div class="pcard" data-i="${i}" data-role="${esc(seat.role)}">
      <img class="logo" src="${seat.logo || ''}" alt="">
      <i class="stone ww-chip" data-role="${esc(seat.role)}">${esc(seat.mark || '·')}</i>
      <span class="nm">${esc(seat.name)}</span>
      <span class="sd">${esc(seat.roleName || '')}</span>
      <em class="bd"></em>
    </div>`).join('')
    : D.players.map((p, i) => `
    <div class="pcard" data-i="${i}">
      <img class="logo" src="${p.logo || ''}" alt="">
      <i class="stone ${stoneClass(i)}"></i>
      <span class="nm">${esc(p.name)}</span>
      <span class="sd">${side(i)} · ${i === 0 ? '先手' : '后手'}</span>
      <em class="bd"></em>
    </div>`).join('')

  /* 狼人杀没有棋盘：主画面改由六席舞台接管 */
  if (WOLF) buildWolf()

  /* ---------------- 进度条锚点（关键手） ---------------- */
  /* 分母兜底：没有任何落子的比赛（例如开局即取消）不能除以 0 */
  const DEN = M || 1
  function drawTicks() {
    tickLayer.innerHTML = activeKeys().map(k => {
      const cls = k.kind === 'check' ? 'chk' : k.kind === 'win' ? 'win' : k.kind === 'death' ? 'death' : 'cap'
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
    /* 狼人杀用 result.side 表示阵营，不能因为 winner 不是数字就当成和棋。 */
    const isDraw = !!D.result && winner === null && !D.result.side

    stage.dataset.phase = isFinale ? 'finale' : 'move'
    stage.dataset.game = D.game.id || ''
    stage.dataset.fx = animate && key ? key.kind : ''
    stage.classList.remove('animate')
    stage.classList.toggle('ww-enter', WOLF && index <= 1)
    boardCard.classList.remove('push')
    board.classList.remove('shake')

    if (WOLF) {
      renderWolf(index, animate)
      if (animate) { void stage.offsetWidth; stage.classList.add('animate') }
      return
    }

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

    /* 手数：降级为执行者卡下的元数据行；关键手标签仍挂在这里 */
    heroEl.hidden = false
    heroLbl.textContent = isFinale ? '终局' : '当前手数'
    heroNum.textContent = isFinale ? M : index
    heroTot.textContent = `/ ${M} 手`
    heroTag.innerHTML = tagHtml(key, isFinale, isDraw)

    /* 当前执行者卡：开局指先手、逐手指本手、终局指胜方（与 replay/markup.mjs 同一口径）。
       右侧标出席位，让观众能把「这个模型」对上盘上的颜色。 */
    const active = isFinale ? -1 : (last ? last.p : 0)
    const seat = isFinale ? winner : active
    const turnPlayer = seat === null || seat < 0 ? null : (D.players[seat] || null)
    renderTurn({
      player: turnPlayer,
      name: turnPlayer ? (turnPlayer.name || '') : (isFinale ? (isDraw ? '和棋' : '比赛结束') : ''),
      meta: turnPlayer ? `${esc(side(seat))} · ${seat === 0 ? '先手' : '后手'}` : '',
      kicker: isFinale ? (isDraw ? '终局' : '胜方') : (index >= 1 ? '本手执行' : '先手'),
      phase: isFinale ? 'finale' : 'move',
      /* 开局与终局都没有「本手发言」，因此不画形象。 */
      speaks: Boolean(turnPlayer) && Boolean(String((last && last.s) || '').trim()),
      compact: S.isCompactTurn(D.game.id, stage.dataset.layout),
    })

    /* 记分板：执行者卡之下的常驻名册（active 已在上面算过） */
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
      who.innerHTML = `<img class="logo" src="${D.players[last.p].logo || ''}" alt=""><b class="sn">${esc(D.players[last.p].name)}</b><em class="stag">本手发言</em>`
      coord.textContent = S.actionLabel(last.a, D.game)
      coord.hidden = false
      text.textContent = last.s
      text.style.fontSize = stepSize(last.s.length) + 'px'
    } else {
      who.innerHTML = '<b class="sn">开局</b>'
      coord.hidden = true
      text.textContent = '比赛开始'
      text.style.fontSize = stepSize(4) + 'px'
    }

    /* 回合记录：当前手之前的最近 4 手，压低对比。
       取 4 而非 5：侧栏顶部让给了执行者卡（84px），记录块是可收缩的一方，
       本手发言永远优先保留完整高度；超出由 .rlist 的 overflow 从最旧一条裁。
       第 0 手没有历史就整块收起。 */
    const entries = visibleMoves(index).slice(-5, -1).reverse()
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
  /* 一手可以先主持人后选手：两个播放器 + 一个定时器，把选手发言排在主持人那一段之后。 */
  const voice = document.createElement('audio')
  const hostVoice = document.createElement('audio')
  voice.preload = 'auto'
  hostVoice.preload = 'auto'
  /* 挂在文档里：脱离文档的音频元素可能被浏览器回收，播放状态也不便于观察。 */
  voice.hidden = true
  hostVoice.hidden = true
  document.body.append(hostVoice, voice)
  let speechTimer = null
  function stopAudio() {
    clearTimeout(speechTimer)
    speechTimer = null
    for (const element of [hostVoice, voice]) { element.pause(); element.removeAttribute('src') }
  }
  function playClip(element, src) {
    if (!src) return
    element.src = src
    element.currentTime = 0
    if (playing) element.play().catch(() => {})
  }
  function speak(step) {
    stopAudio()
    const move = step >= 1 && step <= M ? D.moves[step - 1] : null
    /* 终局卡没有选手发言，只有最后一条结算播报（见 replay/data.mjs 的 hostNarrationLines）。 */
    if (!move) {
      if (step === FINALE) playClip(hostVoice, (D.werewolf && D.werewolf.finaleAudio) || '')
      return
    }
    playClip(hostVoice, move.hostAudio)
    if (!move.audio) return
    const delay = Math.max(0, Number(move.hostAudioSec || 0) * 1000)
    if (delay) speechTimer = setTimeout(() => playClip(voice, move.audio), delay)
    else playClip(voice, move.audio)
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
    stopAudio()
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

  /* 关键手强调档位（便于 A/B 对比）。狼人杀没有吃子/将军，档位改成出局与终局。 */
  const keySelect = $('keyMode')
  if (WOLF) {
    keySelect.closest('label').firstChild.textContent = '出局强调'
    keySelect.innerHTML = '<option value="major">出局 / 终局</option><option value="check">仅终局</option><option value="off">关闭</option>'
  }
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
