import { createServer } from 'node:http'

/** 本地狼人杀协议模型。按私有局面回合法 JSON，不注册进发行包。 */
const server = createServer(async (request, response) => {
  try {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    let view
    for (const message of [...(input.messages || [])].reverse()) {
      const content = typeof message.content === 'string' ? message.content : ''
      for (const line of content.split('\n')) {
        if (!line.startsWith('{')) continue
        try {
          const candidate = JSON.parse(line)
          if (candidate.phase && Number.isInteger(candidate.seat)) view = candidate
        } catch { /* 不是局面。 */ }
      }
      if (view) break
    }
    if (!view) throw new Error('没有狼人杀局面。')
    const alive = view.alive || []
    const other = alive.find(seat => seat !== view.seat) || alive[0]
    let action
    if (view.phase === 'night-wolf') action = { type: 'kill', target: view.day === 1 ? (alive.includes(3) ? 3 : other) : (alive.includes(1) ? 1 : other) }
    else if (view.phase === 'night-seer') action = { type: 'check', target: other }
    else if (view.phase === 'night-witch') action = { type: 'potion', potion: 'pass' }
    else if (view.phase === 'hunter') action = { type: 'shoot', target: alive.includes(2) ? 2 : other }
    else if (view.phase === 'day-speech') action = { type: 'speak' }
    else action = { type: 'vote', target: view.seat === 2 ? (alive.includes(1) ? 1 : other) : (alive.includes(2) ? 2 : other) }
    const text = JSON.stringify({ action, speech: `${view.seat}号按局面行动。` })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = value => response.write(`data: ${JSON.stringify({ id: 'werewolf-fixture', object: 'chat.completion.chunk', created: 1, model: input.model, ...value })}\n\n`)
    emit({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    emit({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
    emit({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    emit({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } })
    response.end('data: [DONE]\n\n')
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: error.message } }))
  }
})
const port = Number(process.env.WEREWOLF_PORT || 4217)
server.listen(port, '127.0.0.1', () => console.log(`werewolf fixture http://127.0.0.1:${port}/v1`))
