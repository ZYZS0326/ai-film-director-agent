// Deterministic provider failures; no user keys or paid requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
process.env.AIFD_TEST_MODE = '1'
process.env.AI_FILM_DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aifd-failover-'))
const config = require('../server/config')
const llm = require('../server/agent/llm')
const models = ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428']
const messages = [{ role: 'user', content: 'test' }]
let calls = [], scenario = '', keyCounter = 0
const json = text => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }))
const sse = text => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
function reset(mode) {
  scenario = mode; calls = []
  config.saveSettings({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: `mock-${++keyCounter}`, model: models[0], fallbackModels: models.slice(1) })
}
global.fetch = async (url, init) => {
  const b = JSON.parse(init.body)
  calls.push({ model: b.model, url, key: init.headers.Authorization })
  assert.equal(b.thinking.type, 'disabled')
  if (scenario === 'auth') return new Response('{"error":{"message":"bad key"}}', { status: 401 })
  if (scenario === 'all') return new Response('rate limit', { status: 429 })
  if (b.model === models[0]) {
    if (scenario === 'quota') return new Response('rate limit', { status: 429 })
    if (scenario === 'unavailable') return new Response('model unavailable', { status: 404 })
    if (scenario === 'heartbeat') {
      return new Response(new ReadableStream({ start(controller) {
        const timer = setInterval(() => controller.enqueue(new TextEncoder().encode(': heartbeat\n\ndata: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n')), 5)
        init.signal.addEventListener('abort', () => { clearInterval(timer); controller.error(new DOMException('aborted', 'AbortError')) }, { once: true })
      } }))
    }
    if (scenario === 'partial') return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已输出内容"}}]}\n\n'))
      setTimeout(() => controller.error(new Error('broken stream')), 5)
    } }))
  }
  return b.stream ? sse('备用正文') : json('备用正文')
}
async function main() {
  reset('normal')
  const originalTimer = global.setTimeout, timers = []
  try {
    global.setTimeout = (fn, ms, ...args) => { timers.push(ms); return originalTimer(fn, ms, ...args) }
    await llm.chat(messages, { structured: true, timeout: 120000 })
    assert.ok(timers.includes(120000))
    assert.ok(!timers.includes(45000), 'non-streaming JSON must not inherit the first-token deadline')
  } finally { global.setTimeout = originalTimer }
  console.log('PASS long non-streaming JSON respects its total deadline, not streaming first-token gate')
  for (const mode of ['quota', 'unavailable']) {
    reset(mode)
    assert.equal(await llm.chat(messages, { maxContinuations: 0, retryDelay: 1 }), '备用正文')
    assert.deepEqual(calls.map(x => x.model), mode === 'quota' ? [models[0], models[0], models[1]] : models.slice(0, 2))
    assert.equal(new Set(calls.map(x => x.url)).size, 1)
    assert.equal(new Set(calls.map(x => x.key)).size, 1)
    calls = []
    await llm.chat(messages, { maxContinuations: 0 })
    assert.deepEqual(calls.map(x => x.model), [models[1]], 'cooldown skips unhealthy model')
    console.log('PASS ' + mode + ': failover and cooldown')
  }
  reset('heartbeat')
  let emitted = '', switched = 0
  assert.equal(await llm.chatStream(messages, d => emitted += d, { firstContentTimeout: 30, timeout: 500, maxContinuations: 0, onModelSwitch: () => switched++ }), '备用正文')
  assert.equal(emitted, '备用正文'); assert.equal(switched, 1)
  assert.deepEqual(calls.map(x => x.model), models.slice(0, 2))
  console.log('PASS heartbeats/reasoning cannot prolong first-content deadline')
  reset('partial')
  emitted = ''
  await llm.chatStream(messages, d => emitted += d, { maxContinuations: 0 })
  assert.equal(emitted, '已输出内容'); assert.equal(calls.length, 1)
  console.log('PASS partial output preserved without duplicate model output')
  reset('auth')
  await assert.rejects(llm.chat(messages), /401/)
  assert.equal(calls.length, 1)
  console.log('PASS authentication errors stop immediately')
  reset('all')
  await assert.rejects(llm.chat(messages, { retryDelay: 1 }), /主模型和备用模型均/)
  assert.equal(calls.length, 6)
  console.log('PASS sustained rate limits get one backoff per model, bounded to six calls')
  reset('json-stream')
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body).model)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON正文' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
  }
  emitted = ''
  assert.equal(await llm.chatStream(messages, d => emitted += d), 'JSON正文')
  assert.equal(emitted, 'JSON正文'); assert.equal(calls.length, 1)
  global.fetch = originalFetch
  console.log('PASS buffered JSON response reused without extra requests')
  reset('quota')
  const result = await llm.testConnection()
  assert.equal(result.ok, false)
  assert.ok(calls.every(x => x.model === models[0]), 'connection test must verify chosen model only')
  console.log('PASS connection test never hides primary failure with fallback')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
