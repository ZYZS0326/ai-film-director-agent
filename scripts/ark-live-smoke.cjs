// Opt-in paid smoke test. Credentials stay in memory and never enter fixtures/reports.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-ark-live-'))
const saved = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'AI 电影导演工作站', 'data', 'settings.json'), 'utf8'))
const key = process.env.ARK_API_KEY || saved.apiKey
if (!key) throw new Error('缺少方舟 API Key')
process.env.AI_FILM_DATA_DIR = dir
process.env.AIFD_TEST_MODE = '1'
process.env.ARK_API_KEY = key
for (const name of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER', 'ARK_BASE_URL']) delete process.env[name]
const config = require('../server/config'), llm = require('../server/agent/llm'), policy = require('../server/agent/model-policy')
const messages = [{ role: 'user', content: '只回答：OK' }]
const originalFetch = global.fetch, sent = []
global.fetch = async (url, init) => { const body = JSON.parse(init.body); sent.push({ model: body.model, max_tokens: body.max_tokens ?? body.max_completion_tokens }); return originalFetch(url, init) }
async function main() {
  const primary = config.loadSettings().model
  const secondary = config.providerOf('ark').models.find(m => m.enabled !== false && m.id !== primary).id
  const results = []
  for (const test of [{ name: 'A-default', model: primary, desired: 64 }, { name: 'B-config-switch', model: secondary, desired: 64 }, { name: 'C-high-budget-clamp', model: secondary, desired: 1000000 }]) {
    if (test.name !== 'A-default') fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ provider: 'ark', model: test.model }))
    const before = sent.length, start = Date.now()
    const response = await llm.chatOnceRaw(messages, { desiredOutputTokens: test.desired, temperature: 0, timeout: 60000 })
    if (response.text.trim() !== 'OK' || response.truncated) throw new Error(test.name + ' 未得到完整 OK')
    if (test.name === 'C-high-budget-clamp' && (sent[before].max_tokens >= test.desired || sent.length !== before + 1)) throw new Error('预算未在首次调用前压低')
    results.push({ test: test.name, model: test.model, desired: test.desired, sent: sent.slice(before), response: 'OK', usage: response.usage, elapsedMs: Date.now() - start })
  }
  const report = JSON.stringify({ passed: true, results }, null, 2)
  if (report.includes(key)) throw new Error('报告脱敏校验失败')
  fs.mkdirSync(path.join(__dirname, '../build/test-reports'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '../build/test-reports/ark-live.json'), report)
  console.log(report)
}
main().catch(e => { console.error(policy.redact(e.message, [key])); process.exitCode = 1 }).finally(() => { global.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }) })
