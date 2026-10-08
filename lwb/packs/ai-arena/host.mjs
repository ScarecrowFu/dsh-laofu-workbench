import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { decisionPrompt } from './decision-prompt.mjs'
import { executeSessionTurn } from './dsh-session.mjs'

const now = () => new Date().toISOString()
export const MAX_CONTINUATIONS = 2
const bounded = (value, fallback, min, max, label) => {
  const number = value ?? fallback
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}必须是 ${min}—${max} 范围内的整数。`)
  return number
}
export const SYSTEM = '你正在参加一场真实规则的 AI 竞技。只依据收到的局面决策。你没有任何工具。只输出一个 JSON 对象：{"action":{"row":整数,"col":整数},"speech":"一句面向观众的简短选手发言"}。speech 使用中文，最多 80 字，表达你这一手的意图或判断，不要叙述完整内部推理，不要伪造对手发言。坐标从 1 开始。不得输出代码围栏或其他文字。'
export const XIANGQI_SYSTEM = '你正在参加一场真实规则的中国象棋 AI 竞技。只依据收到的局面决策。你没有任何工具。只输出一个 JSON 对象：{"action":{"from":{"row":整数,"col":整数},"to":{"row":整数,"col":整数}},"speech":"一句面向观众的简短选手发言"}。speech 使用中文，最多 80 字，表达这一手的意图或判断，不要叙述完整内部推理，不要伪造对手发言。坐标从 1 开始，行从黑方顶端到红方底端为 1—10，列从左到右为 1—9。只能走合法着法，必须应将，不得让己方将帅被攻击。不得输出代码围栏或其他文字。裁决规则：吃将、将死、困毙均获胜；唯一的和棋是连续 120 半回合既没有吃子也没有兵卒向前推进；局面重复本身不判和，也不会结束比赛。局面字段：recentMoves 是最近若干手的紧凑记法，格式为「手数+走子方+棋子+起点行,列>终点行,列」，x 表示吃子、+ 表示将军，例如 12黑馬8,8>7,6；positionRepeats 是当前局面此前已出现过的次数；legalMoves 每项的 repeats 是走完该着法后新局面此前已出现过的次数；noProgressPlies 是距上一次吃子或兵卒向前推进的半回合数，noProgressLimit 是判和阈值。'
export function parseDecision(text, gameId = 'gomoku') {
  const value = JSON.parse(text.trim())
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.speech !== 'string' || !value.speech.trim() || value.speech.length > 80 || !value.action) throw new Error('回复必须包含合法的 action 和 1—80 字的 speech。')
  const action = gameId === 'xiangqi'
    ? { from: { row: value.action.from?.row, col: value.action.from?.col }, to: { row: value.action.to?.row, col: value.action.to?.col } }
    : { row: value.action.row, col: value.action.col }
  return { action, speech: value.speech.trim() }
}
export function tokenCount(usage) {
  if (!usage) return null
  const total = usage.totalTokens ?? ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].reduce((sum, key) => sum + (usage[key] || 0), 0)
  return Number.isFinite(total) && total >= 0 ? total : null
}

function mergeUsage(total, next) {
  if (!next || typeof next !== 'object') return total || null
  if (!total || typeof total !== 'object') return { ...next }
  const merged = { ...total, ...next }
  for (const key of new Set([...Object.keys(total), ...Object.keys(next)])) {
    const left = total[key], right = next[key]
    if (Number.isFinite(left) || Number.isFinite(right)) merged[key] = (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0)
  }
  return merged
}

export class ArenaHost {
  constructor({ store, games, scope, turnDelayMs = 250 }) {
    if (!scope?.sessions?.create || !scope.sessions.resume) throw new Error('竞技台需要 DSH 会话服务。')
    Object.assign(this, { store, games, scope, turnDelayMs })
    this.running = new Map()
    this.progress = new Map()
    this.sessions = new Map()
    scope.onStop(() => { for (const job of this.running.values()) job.controller.abort(new Error('能力包停止。')) })
  }
  async start(request) {
    const game = this.games.get(request.gameId || 'gomoku')
    if (!Array.isArray(request.players) || request.players.length !== game.players) throw new Error(`本游戏需要 ${game.players} 名选手。`)
    const catalog = await this.scope.models.list()
    const players = request.players.map((input, index) => {
      const route = catalog.find(item => item.id === input.provider)
      const model = route?.models?.find(item => item.id === input.model)
      if (!model || route.selectable === false) throw new Error(route?.unavailableReason || '请选择可用的参赛模型。')
      if (input.reasoningEffort && !model.reasoning?.efforts?.some(item => item.id === input.reasoningEffort)) throw new Error('所选模型不支持该推理强度。')
      return { id: index, provider: route.id, providerName: route.name || route.id, model: model.id, name: model.name || model.id, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) }
    })
    if (request.pace !== undefined && request.pace !== 'native') throw new Error('比赛模式已移除，请刷新页面后创建比赛。')
    const config = {
      pace: 'native',
      invalidRetries: bounded(request.invalidRetries, 1, 0, 2, '违规重试次数'),
      speechVisibility: 'spectator', system: game.id === 'xiangqi' ? XIANGQI_SYSTEM : SYSTEM,
      contextMode: 'current-position',
    }
    const match = await this.store.create({ title: `${players[0].name} vs ${players[1].name}`, game: { id: game.id, name: game.name, version: game.version, description: game.description }, players, config, state: game.create() })
    this.launch(match.id)
    return match
  }
  launch(id) {
    if (this.running.has(id)) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.scope.signal])
    const job = { controller, work: null }
    this.running.set(id, job)
    job.work = this.run(id, signal).finally(async () => {
      await this.releaseSessions(id)
      this.progress.delete(id)
      if (this.running.get(id) === job) this.running.delete(id)
    })
    this.scope.background(job.work)
  }
  async get(id) {
    const match = await this.store.get(id), progress = this.progress.get(id)
    if (progress?.turnId === match.activeTurn?.turnId) match.activeTurn = { ...match.activeTurn, ...progress }
    return match
  }
  async control({ id, action, pace }) {
    if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('比赛操作无效。')
    if (pace !== undefined) {
      if (action !== 'resume') throw new Error('比赛模式只能在继续比赛时调整。')
      if (pace !== 'native') throw new Error('比赛模式已移除，请刷新页面后继续比赛。')
    }
    const match = await this.store.update(id, value => {
      if (action === 'resume') {
        if (value.status !== 'paused') throw new Error('只有暂停的比赛可以继续。')
        if (this.running.has(id)) throw new Error('上一回合正在结算，请稍后继续。')
        if (this.games.get(value.game.id).version !== value.game.version) throw new Error('游戏规则版本已变化，请保留本场记录并创建新比赛。')
        // Migrate only resumed matches; finished historical results stay intact.
        const previous = {}
        for (const key of ['maxMoves', 'maxCalls', 'maxTokens', 'maxTokensLimit', 'tokenBudget', 'timeoutSeconds']) {
          if (Object.hasOwn(value.config, key)) {
            previous[key] = value.config[key]
            delete value.config[key]
          }
        }
        if (Object.keys(previous).length) value.events.push({ type: 'config-updated', at: now(), previous, next: {}, reason: 'dsh-session-defaults' })
        if (value.config.pace !== 'native') {
          value.events.push({ type: 'config-updated', at: now(), previous: { pace: value.config.pace || 'deep' }, next: { pace: 'native' } })
          value.config.pace = 'native'
        }
        if (value.config.contextMode !== 'current-position') {
          value.events.push({ type: 'config-updated', at: now(), previous: { contextMode: value.config.contextMode || 'player-history' }, next: { contextMode: 'current-position' } })
          value.config.contextMode = 'current-position'
        }
        value.status = 'running'
      } else if (action === 'pause') {
        if (value.status !== 'running') throw new Error('比赛当前不可暂停。')
        value.status = 'pausing'
      } else {
        if (!['running', 'pausing', 'paused'].includes(value.status)) throw new Error('比赛已经结束。')
        value.status = 'cancelled'; value.activeTurn = null; value.result = { kind: 'cancelled', winner: null, message: '比赛已取消。' }
        value.events.push({ type: 'cancelled', at: now() })
      }
    })
    if (action === 'resume') this.launch(id)
    if (action === 'cancel') this.running.get(id)?.controller.abort(new Error('比赛已取消。'))
    if (action === 'pause' && !this.running.has(id)) return this.store.update(id, value => { value.status = 'paused' })
    return match
  }
  async finish(id, result) {
    return this.store.update(id, match => {
      if (match.status === 'cancelled') return
      match.status = 'finished'; match.result = result; match.activeTurn = null; match.pending = null
      match.events.push({ type: 'finished', at: now(), ...result })
    })
  }

  sessionKey(id, player) { return `${id}:${player}` }

  async playerSession(match, player, signal) {
    const key = this.sessionKey(match.id, player)
    const model = match.players[player]
    const options = { provider: model.provider, model: model.model, maxTokens: null, tools: 'none', system: match.config.system, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) }
    const current = this.sessions.get(key)
    if (current) return current
    const storedId = typeof model.sessionId === 'string' && model.sessionId.trim() ? model.sessionId.trim() : null
    let session
    if (storedId) {
      try {
        session = await this.scope.sessions.resume(storedId, options)
      } catch (error) {
        // A stale session can occur after a DSH restart. Starting a replacement
        // keeps the match recoverable while preserving the old session in audit.
        if (signal.aborted) throw error
        session = await this.scope.sessions.create(options)
      }
    } else {
      session = await this.scope.sessions.create(options)
    }
    if (signal.aborted) {
      await session.dispose?.()
      signal.throwIfAborted()
    }
    this.sessions.set(key, session)
    return session
  }

  async executeDecisionTurn(session, prompt, { afterSeq, signal, progress, id, turnId, player, gameId = 'gomoku', system = SYSTEM } = {}) {
    let currentPrompt = prompt
    let cursor = Number.isSafeInteger(afterSeq) ? afterSeq : -1
    let usage = null
    let continuations = 0
    let response
    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
      try {
        response = await executeSessionTurn(session, currentPrompt, { afterSeq: cursor, signal, progress })
      } catch (error) {
        if (usage && !error.result) error.result = { ...(response || {}), usage }
        throw error
      }
      usage = mergeUsage(usage, response.usage)
      let parseError = null
      try { parseDecision(response.text, gameId) } catch (error) { parseError = error }
      const complete = response.finish?.kind === 'stop' && !parseError
      if (complete || attempt === MAX_CONTINUATIONS || response.finish?.kind === 'cancelled') break
      continuations += 1
      await this.store.update(id, value => {
        value.events.push({ type: 'continuation', at: now(), turnId, player, attempt: continuations,
          reason: response.finish?.kind === 'length' ? 'length' : 'invalid-json', sessionId: session.id,
          sessionSeq: response.sessionSeq, error: parseError?.message || null })
      })
      cursor = Number.isSafeInteger(response.sessionSeq) ? response.sessionSeq : cursor
      currentPrompt = `上一条回复未完成或格式不合法。请立即完成当前回合，不要重复分析。${system}`
    }
    if (usage) response = { ...response, usage }
    if (continuations) response = { ...response, continuationCount: continuations }
    return response
  }

  async releaseSessions(id) {
    const prefix = `${id}:`
    const handles = [...this.sessions.entries()].filter(([key]) => key.startsWith(prefix))
    for (const [key, session] of handles) {
      this.sessions.delete(key)
      try { await session.dispose?.() } catch {}
    }
  }
  async commitPending(id) {
    return this.store.update(id, match => {
      if (!match.pending || match.status === 'cancelled') return
      const pending = match.pending
      let decision, next
      try {
        decision = parseDecision(pending.response.text, match.game.id)
        next = this.games.get(match.game.id).apply(match.state, decision.action, pending.player)
      } catch (error) {
        match.events.push({ type: 'invalid', at: now(), turnId: pending.turnId, player: pending.player, attempt: pending.attempt, error: error.message, raw: pending.response.text })
        match.activeTurn = { player: pending.player, attempt: pending.attempt + 1, error: error.message }
        match.pending = null
        return
      }
      match.state = next; match.pending = null; match.activeTurn = null
      match.events.push({ type: 'move', at: now(), turnId: pending.turnId, player: pending.player, moveNumber: next.moves.length, action: decision.action, speech: decision.speech, elapsedMs: pending.elapsedMs })
    })
  }
  async run(id, signal) {
    try {
      while (true) {
        signal.throwIfAborted()
        let match = await this.store.get(id)
        if (!['running', 'pausing'].includes(match.status)) return
        if (match.pending) { await this.commitPending(id); continue }
        if (match.state.winner !== null || match.state.draw) {
          await this.finish(id, { kind: match.state.draw ? 'draw' : 'win', winner: match.state.winner, message: match.state.draw ? (match.game.id === 'xiangqi' ? `中国象棋和棋（${match.state.terminalReason || '规则判定'}）。` : '棋盘已满，平局。') : `${match.players[match.state.winner].name} ${match.game.id === 'xiangqi' ? `获胜（${match.state.terminalReason || '将死或困毙'}）` : '连成五子，获胜'}。` }); return
        }
        if (match.status === 'pausing') { await this.store.update(id, value => { value.status = 'paused' }); return }
        const attempt = match.activeTurn?.attempt || 0
        if (attempt > match.config.invalidRetries) {
          await this.finish(id, { kind: 'forfeit', winner: 1 - match.state.nextPlayer, message: `${match.players[match.state.nextPlayer].name} 连续违规，判负。` }); return
        }
        const player = match.state.nextPlayer, model = match.players[player], turnId = randomUUID()
        const prompt = decisionPrompt(this.games.get(match.game.id), match.state, player, match.activeTurn?.error)
        match = await this.store.update(id, value => {
          if (value.status !== 'running') return
          value.calls += 1; value.activeTurn = { turnId, player, attempt, startedAt: now() }
          value.events.push({ type: 'request', at: value.activeTurn.startedAt, turnId, player, attempt, moveNumber: value.state.moves.length + 1, system: value.config.system, prompt, model, pace: 'native' })
        })
        if (match.activeTurn?.turnId !== turnId) continue
        const started = Date.now()
        const callSignal = signal
        let response, session
        this.progress.set(id, { turnId, phase: 'waiting', bytesReceived: 0 })
        const progress = update => {
          if (callSignal.aborted || this.progress.get(id)?.turnId !== turnId) return
          const previous = this.progress.get(id)
          const phase = update.phase === 'receiving' ? previous.phase : update.phase
          this.progress.set(id, { ...previous, ...update, phase, firstOutputAt: previous.firstOutputAt || now(), lastOutputAt: now() })
        }
        try {
          session = await this.playerSession(match, player, callSignal)
          await this.store.update(id, value => {
            const request = value.events.find(event => event.type === 'request' && event.turnId === turnId)
            if (request) { request.sessionId = session.id; request.contextMode = 'current-position' }
            if (value.activeTurn?.turnId === turnId) value.activeTurn.sessionId = session.id
            value.players[player].sessionId = session.id
          })
          callSignal.throwIfAborted()
          response = await this.executeDecisionTurn(session, prompt, {
            afterSeq: match.players[player].sessionSeq,
            signal: callSignal,
            progress,
            id,
            turnId,
            player,
            gameId: match.game.id,
            system: match.config.system,
          })
          response = { ...response, sessionId: session.id }
          if (response.finish?.kind !== 'stop' && !(response.finish?.kind === 'cancelled' && signal.aborted)) {
            const error = new Error(response.finish?.kind === 'length' ? '模型或服务商的输出边界截断了回复，补全后仍未完成，比赛已暂停。' : `DSH 会话未正常结束（${response.finish?.kind || 'unknown'}），比赛已暂停。`)
            error.code = response.finish?.kind === 'length' ? 'ARENA_OUTPUT_LIMIT' : 'ARENA_SESSION_FINISH'
            error.result = response
            throw error
          }
          await this.store.update(id, value => {
            const selected = value.players[player]
            if (selected) {
              selected.sessionId = session.id
              if (Number.isSafeInteger(response.sessionSeq)) selected.sessionSeq = response.sessionSeq
            }
          })
        }
        catch (error) {
          await this.store.update(id, value => {
            const partial = error.result ? { ...error.result, ...(session ? { sessionId: session.id } : {}) } : null
            if (Number.isSafeInteger(partial?.sessionSeq)) value.players[player].sessionSeq = partial.sessionSeq
            const tokens = tokenCount(partial?.usage)
            if (tokens === null) value.usageUnknown = true; else value.tokens += tokens
            value.events.push({ type: 'error', at: now(), turnId, player, elapsedMs: Date.now() - started,
              sessionId: session?.id || null, code: error.code || null,
              error: String(error.message).replace(/Bearer\s+\S+/giu, 'Bearer [hidden]').slice(0, 1000), response: partial })
            value.activeTurn = null
            if (value.status !== 'cancelled') value.status = 'paused'
          })
          return
        }
        await this.store.update(id, value => {
          const tokens = tokenCount(response.usage)
          if (tokens === null) value.usageUnknown = true; else value.tokens += tokens
          const elapsedMs = Date.now() - started
          const progress = this.progress.get(id)
          value.events.push({ type: 'response', at: now(), turnId, player, elapsedMs, ...response,
            ...(progress?.firstOutputAt ? { firstOutputAt: progress.firstOutputAt, firstOutputMs: Math.max(0, Date.parse(progress.firstOutputAt) - started) } : {}) })
          if (value.status !== 'cancelled') value.pending = { turnId, player, attempt, response, elapsedMs }
        })
        await this.commitPending(id)
        await delay(this.turnDelayMs, undefined, { signal })
      }
    } catch (error) {
      await this.store.update(id, match => {
        if (!['running', 'pausing'].includes(match.status)) return
        match.status = 'paused'; match.activeTurn = null
        match.events.push({ type: 'interrupted', at: now(), message: signal.aborted ? '比赛执行已停止。' : error.message })
      })
    }
  }
}
