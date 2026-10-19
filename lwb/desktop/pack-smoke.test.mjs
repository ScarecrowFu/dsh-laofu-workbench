import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { acceptanceBudgets, requestPackagedHost } from './pack-smoke.mjs'

test('packaged host requests bypass global download agents and preserve cookies and JSON', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.cookie, 'host-session=acceptance')
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { method: 'lwbPacks/list' })
      res.setHeader('set-cookie', 'host-session=next; HttpOnly')
      res.end(JSON.stringify({ result: { ok: true } }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const original = http.globalAgent
  http.globalAgent = new http.Agent()
  http.globalAgent.addRequest = () => { throw new Error('The download agent must not receive a loopback request') }
  try {
    const response = await requestPackagedHost(`http://127.0.0.1:${server.address().port}/api/lwbPacks/list`, {
      method: 'POST', headers: { cookie: 'host-session=acceptance', 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'lwbPacks/list' }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers['set-cookie'][0], 'host-session=next; HttpOnly')
    assert.deepEqual(JSON.parse(response.text), { result: { ok: true } })
    assert.throws(() => requestPackagedHost('https://example.com'), /AssertionError/)
  } finally {
    http.globalAgent.destroy()
    http.globalAgent = original
    await new Promise(resolve => server.close(resolve))
  }
})

test('an unresponsive acceptance endpoint is aborted at its deadline', async () => {
  const server = http.createServer(() => {})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await assert.rejects(requestPackagedHost(`http://127.0.0.1:${server.address().port}`, { timeout: 50 }), { name: 'AbortError' })
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('cross-architecture acceptance widens the first-launch budgets', () => {
  const native = acceptanceBudgets({ platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'arm64' })
  assert.equal(native.crossArch, false)
  assert.equal(native.start, 30_000)

  const rosetta = acceptanceBudgets({ platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' })
  assert.equal(rosetta.crossArch, true)
  assert.ok(rosetta.start >= 120_000, 'a first Rosetta launch must not be mistaken for a hung host')
  assert.ok(rosetta.ready >= native.ready)

  assert.equal(acceptanceBudgets(undefined).crossArch, false, 'an unknown target keeps the native budgets')
})
