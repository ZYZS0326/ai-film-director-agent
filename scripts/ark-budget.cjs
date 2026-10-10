// Fully isolated mocks: no network, real credentials, or user settings.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
process.env.AIFD_TEST_MODE = '1'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-ark-budget-'))
process.env.AI_FILM_DATA_DIR = dir
for (const k of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER', 'ARK_BASE_URL']) delete process.env[k]
const config = require('../server/config'), policy = require('../server/agent/model-policy'), llm = require('../server/agent/llm')
const fake = 'mock-' + require('node:crypto').randomBytes(12).toString('hex')
const msgs = [{ role: 'user', content: 'OK' }]
let count = 0, calls = [], respond
const ok = (text = 'OK', finish = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 4, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
global.fetch = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers }); return respond ? respond(body, calls.length) : ok() }
function check(name, fn) { fn(); count++; console.log('PASS ' + name) }
async function main() {
  process.env.ARK_API_KEY = fake
  check('only ARK_API_KEY selects Ark/default/base', () => {
    const s = config.loadSettings(); assert.equal(s.provider, 'ark'); assert.equal(s.baseUrl, config.providerOf('ark').baseUrl); assert.equal(s.model, config.providerOf('ark').model); assert.equal(s.apiKey, fake)
  })
  config.saveSettings({ provider: 'ark', apiKey: fake, model: 'ep-original-2026', contextWindow: 32768 })
  process.env.ARK_BASE_URL = 'https://unused.example/v3'
  check('explicit configuration beats environment', () => assert.equal(config.loadSettings().baseUrl, config.providerOf('ark').baseUrl))
  for (const id of ['doubao-unregistered-version', 'deepseek-unchanged-version', 'kimi-custom', 'glm-custom', 'ep-original-2026', 'unknown-future-model']) {
    config.saveSettings({ model: id }); calls = []; await llm.chatOnceRaw(msgs)
    check('unchanged ID: ' + id, () => { assert.equal(calls[0].body.model, id); assert.equal(calls[0].body.max_tokens, 4096); assert.equal(calls[0].body.thinking, undefined) })
  }
  const catalog = config.modelCatalog()
  catalog.providers.find(p => p.id === 'ark').models.push({ id: 'ep-test-capabilities', enabled: true, context_window: 4096, max_output_tokens: 700, supports_temperature: false, supports_thinking: true, supports_json: true, output_parameter: 'max_completion_tokens' })
  fs.writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify(catalog))
  config.saveSettings({ model: 'ep-test-capabilities', contextWindow: 32768 })
  calls = []; await llm.chatOnceRaw(msgs, { desiredOutputTokens: 1000000, json: true })
  check('config-only registration, known cap, optional parameters', () => { const b = calls[0].body; assert.equal(b.max_completion_tokens, 700); assert.equal(b.max_tokens, undefined); assert.equal(b.temperature, undefined); assert.equal(b.thinking.type, 'disabled'); assert.equal(b.response_format.type, 'json_object') })
  check('remaining context participates in budget', () => {
    const b = policy.effectiveBudget([{ role: 'user', content: '字'.repeat(4900) }], { desiredOutputTokens: 1000000 }); assert.ok(b.effective < 700); assert.ok(b.estimatedInput + b.margin + b.effective <= b.window)
  })
  calls = []
  await assert.rejects(llm.chatOnceRaw([{ role: 'user', content: '字'.repeat(10000) }]), /CONTEXT_LIMIT/)
  check('critical input not silently deleted', () => assert.equal(calls.length, 0))
  config.saveSettings({ model: 'ep-learned-output', fallbackModels: [] })
  calls = []; respond = (b, n) => n === 1 ? new Response(JSON.stringify({ error: { message: 'max_tokens too large; maximum allowed: 900' } }), { status: 400 }) : ok()
  await llm.chatOnceRaw(msgs, { desiredOutputTokens: 50000 })
  check('one output correction uses reliable bound', () => assert.deepEqual(calls.map(x => x.body.max_tokens), [4096, 900]))
  calls = []; respond = null; await llm.chatOnceRaw(msgs)
  check('learned model cap reused', () => assert.equal(calls[0].body.max_tokens, 900))
  config.saveSettings({ model: 'ep-conservative' }); calls = []; respond = () => new Response('invalid max_tokens', { status: 400 })
  await assert.rejects(llm.chatOnceRaw(msgs), /OUTPUT_LIMIT/)
  check('unknown upper bound: one conservative correction only', () => assert.deepEqual(calls.map(x => x.body.max_tokens), [4096, 2048]))
  config.saveSettings({ model: 'ep-context' }); calls = []; respond = (b, n) => n === 1 ? new Response('maximum context length: 5000; context length exceeded', { status: 400 }) : ok()
  await llm.chatOnceRaw(msgs)
  check('context errors learn window separately', () => { assert.equal(calls.length, 2); assert.equal(policy.effectiveBudget(msgs).window, 5000) })
  respond = () => ok('{"issues":[]}', 'length'); calls = []
  await assert.rejects(llm.chat(msgs, { structured: true, role: 'reviewer' }), e => e.generation_truncated === true)
  check('truncated structured output repaired once, never successful', () => assert.equal(calls.length, 2))
  let result; calls = []; await llm.chat(msgs, { maxContinuations: 0, onGenerationResult: r => result = r })
  check('long-form exposes truncation metadata', () => assert.equal(result.generation_truncated, true))
  respond = null; config.saveSettings({ provider: 'openai', apiKey: fake, model: 'primary-other' })
  config.saveSettings({ provider: 'ark', model: 'primary-ark', apiKey: fake, roleModels: { planner: { provider: 'openai', model: 'ep-role-custom' }, reviewer: { provider: 'ark', model: 'review-model' } } })
  check('provider profiles preserved and roles resolve independently', () => { assert.equal(config.resolveModel({ role: 'planner' }).model, 'ep-role-custom'); assert.equal(config.resolveModel({ role: 'planner' }).provider, 'openai'); assert.equal(config.resolveModel({ role: 'reviewer' }).model, 'review-model'); assert.equal(config.resolveModel().model, 'primary-ark') })
  calls = []; await llm.chatOnceRaw(msgs, { role: 'planner' })
  check('role selection reaches payload and endpoint', () => { assert.equal(calls[0].body.model, 'ep-role-custom'); assert.ok(calls[0].url.startsWith(config.providerOf('openai').baseUrl)); assert.equal(calls[0].body.max_tokens, 1200) })
  calls = []; await llm.chatOnceRaw(msgs, { baseUrl: 'https://custom.example/v1' })
  check('explicit other origin cannot inherit key', () => assert.equal(calls[0].headers.Authorization, undefined))
  const cases = [[401, 'bad key', 'AUTH'], [404, 'model not found', 'MODEL_NOT_FOUND'], [403, 'model unavailable', 'MODEL_NOT_AVAILABLE'], [429, 'rate limit', 'RATE_LIMIT'], [429, 'quota exhausted', 'QUOTA'], [400, 'content safety', 'SAFE_MODE'], [400, 'context length exceeded', 'CONTEXT_LIMIT'], [400, 'max_tokens too large', 'OUTPUT_LIMIT'], [400, 'bad temperature', 'INVALID_PARAMETER'], [0, 'request timeout', 'TIMEOUT'], [0, 'ECONNRESET', 'NETWORK'], [0, 'unexpected response', 'UNKNOWN']]
  check('all 12 error categories', () => { for (const [status, message, category] of cases) assert.equal(policy.classify(status, message), category) })
  check('429 token throttling is never an output correction', () => assert.equal(policy.classify(429, 'token limit exceeded'), 'RATE_LIMIT'))
  config.saveSettings({ roleModels: {}, model: config.providerOf('ark').model, fallbackModels: config.providerOf('ark').fallbackModels })
  calls = []; respond = () => new Response(JSON.stringify({ error: { message: `Unauthorized request Authorization: Bearer ${fake}; api_key=${fake}` } }), { status: 401 })
  let error; try { await llm.chat(msgs) } catch (e) { error = e }
  const test = await llm.testConnection({ apiKey: fake })
  check('auth not retried; exception/UI/public settings redact keys', () => { assert.equal(calls.length, 2); assert.ok(error); assert.ok(!JSON.stringify([error.message, error, test, config.publicSettings()]).includes(fake)); assert.equal(error.cause, undefined) })
  respond = () => new Response('quota exhausted', { status: 429 }); calls = []; let switched
  respond = (b, n) => n === 1 ? new Response('quota exhausted', { status: 429 }) : ok()
  await llm.chat(msgs, { onModelSwitch: event => switched = event })
  check('quota fallback without retry, from/to/reason', () => { assert.equal(calls.length, 2); assert.ok(switched.from && switched.to && switched.reason.includes('QUOTA')); assert.ok(!JSON.stringify(switched).includes(fake)) })
  calls = []; respond = () => ok('not valid JSON')
  await llm.chat(msgs, { structured: true })
  check('quality/JSON format never switches model', () => assert.equal(calls.length, 1))
  console.log(`专项结果：${count} 项通过`)
}
main().catch(e => { console.error(policy.redact(e.stack, [fake])); process.exitCode = 1 }).finally(() => fs.rmSync(dir, { recursive: true, force: true }))
