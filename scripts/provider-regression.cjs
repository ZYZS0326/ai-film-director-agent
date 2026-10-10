// Isolated contract tests; no real keys, external calls or user settings.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.AIFD_TEST_MODE = '1'
process.env.AI_FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aifd-provider-test-'))
const config = require('../server/config')
const llm = require('../server/agent/llm')
let calls = []
let empty = false
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body)
  calls.push({ url, headers: opts.headers, body })
  if (body.stream) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '连通' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  return new Response(JSON.stringify({ choices: [{ message: { content: empty ? '' : '连通' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })
}
async function main() {
  for (const preset of config.PRESETS) {
    config.saveSettings({ ...preset, presetId: preset.id, apiKey: preset.id === 'ollama' ? '' : '  mock-key  ' })
    assert.equal(llm.isConfigured(), true)
    assert.equal((await llm.testConnection()).ok, true, preset.id)
    assert.equal(await llm.chatStream([{ role: 'user', content: 'test' }], () => {}), '连通', preset.id)
    const last = calls.at(-1)
    assert.ok(last.url.endsWith('/chat/completions'))
    if (preset.id === 'moonshot') {
      assert.equal(last.body.temperature, undefined)
      assert.equal(last.body.thinking.type, 'disabled')
    }
    if (preset.id === 'ollama') assert.equal(last.headers.Authorization, undefined)
    else assert.equal(last.headers.Authorization, 'Bearer mock-key')
    console.log('PASS ' + preset.id + ': connection + streaming contract')
  }
  config.saveSettings({ ...config.PRESETS[0], apiKey: 'mock-key' })
  const count = calls.length
  assert.equal((await llm.testConnection({ baseUrl: config.PRESETS[2].baseUrl })).ok, false)
  assert.equal(calls.length, count, 'never send a saved key to another origin')
  config.saveSettings({ baseUrl: config.PRESETS[2].baseUrl })
  assert.equal(config.loadSettings().apiKey, '')
  assert.equal(llm.isConfigured(), false)
  config.saveSettings({ ...config.PRESETS[0], model: 'deepseek-chat', apiKey: 'mock-key' })
  assert.equal(config.loadSettings().model, 'deepseek-flash')
  empty = true
  assert.equal((await llm.testConnection()).ok, false)
  console.log('PASS key isolation, retired-model migration, empty-response rejection')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
