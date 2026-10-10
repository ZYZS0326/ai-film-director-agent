// Opt-in integration test: real credentials stay in memory, user projects stay untouched.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-batch-live-'))
const saved = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'AI 电影导演工作站', 'data', 'settings.json'), 'utf8'))
const key = process.env.ARK_API_KEY || saved.apiKey
if (!key) throw new Error('缺少方舟 API Key')
process.env.AI_FILM_DATA_DIR = dir
process.env.AIFD_TEST_MODE = '1'
process.env.ARK_API_KEY = key
for (const name of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER', 'ARK_BASE_URL']) delete process.env[name]
const { generate, validatePlan } = require('../server/agent/batched-production')
const { extractJSONBlock } = require('../server/tools')
const policy = require('../server/agent/model-policy')
const ctx = { constraints: { duration: 40, aspect: '16:9' }, knowledge: { durationMode: { duration: 40 } } }
const session = { shots: [], continuityData: { lockZh: '青年穿灰色衬衫，左腕黑表；房间西侧窗、中央木桌，白色纸鹤。', lockEn: 'Young adult in gray shirt, black watch on left wrist. West window, central wooden desk, white paper crane.' } }
const messages = [{ role: 'system', content: '你是电影导演和AI影像提示词工程师。按指定的分批结构制作，严守人物、道具、空间和时间码。视频提示词包含主体、动作、环境、景别、角度、构图、摄影机、镜头、运镜、光线、色彩、材质、氛围。图片提示词只描述单张静态画面。' }, { role: 'user', content: '40秒短片，16:9。青年在房间木桌上发现白纸鹤，展开看到“别忘了回家”；他重新折好纸鹤，放回窗下的木桌，拿起手机给母亲打电话，最后微笑。只有一个青年，灰衬衫左腕黑表；西侧窗、中央木桌，白纸鹤和手机。暖灰电影写实。' }]
async function main() {
  const start = Date.now()
  const opts = { messages, ctx, session, onBatch: b => console.log(JSON.stringify({ phase: b.phase, from: b.from, to: b.to, total: b.total })) }
  const storyboard = extractJSONBlock(await generate({ ...opts, skill: { id: 'storyboard' } }), null, true)
  session.shots = storyboard.shots
  validatePlan(session.shots.map(s => ({ ...s, beat: s.action })), 40)
  assert.ok(session.shots.length >= 5)
  const prompts = extractJSONBlock(await generate({ ...opts, skill: { id: 'prompt_engineering' } }), null, true)
  assert.equal(prompts.shots.length, session.shots.length)
  assert.ok(session.shots.every(s => prompts.keyframes.some(k => k.shotNo === s.no && k.phase === 'master')))
  assert.equal(prompts.characterLock.zh, session.continuityData.lockZh)
  const report = JSON.stringify({ passed: true, duration: 40, shots: session.shots.length, prompts: prompts.shots.length, assets: prompts.imageAssets.length, keyframes: prompts.keyframes.length, elapsedMs: Date.now() - start }, null, 2)
  assert.ok(!report.includes(key))
  fs.mkdirSync(path.join(__dirname, '../build/test-reports'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '../build/test-reports/batched-live.json'), report)
  console.log(report)
}
main().catch(e => { console.error(policy.redact(e.message, [key])); process.exitCode = 1 }).finally(() => fs.rmSync(dir, { recursive: true, force: true }))
