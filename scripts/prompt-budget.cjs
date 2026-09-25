/**
 * 提示词体积回归测试（断言式）
 *
 * 背景：用户反馈「每一项都超出了上限导致生成不完整」。
 * 超限有两种：① 输入超出模型上下文窗口 ② 输出超出 max_tokens。
 * 本测试只负责 ① —— 断言每个环节的实际提示词都装得进模型窗口。
 *
 * 运行：node scripts/prompt-budget.cjs
 */
const path = require('path')
const { safeRm, safeDeleteSession, safeDeleteSessions } = require('./_safe-cleanup.cjs')
const fs = require('fs')
const os = require('os')

// 用独立数据目录，避免污染用户设置
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-budget-'))
process.env.AI_FILM_DATA_DIR = tmp
delete process.env.LLM_API_KEY

const config = require('../server/config')
const memory = require('../server/agent/memory')
const kb = require('../server/knowledge')
const { BY_ID, FULL_PIPELINE } = require('../server/skills')
const orchestrator = require('../server/agent/orchestrator')

let pass = 0
let fail = 0
const fails = []

function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) } else {
    fail += 1
    fails.push(`${name} — ${detail || ''}`)
    console.log(`  ✗ ${name} — ${detail || ''}`)
  }
}

const estTokens = orchestrator.estTokens

;(async () => {
  // ── 用 demo 流水线填满 session.outputs，拿到真实历史产出 ──
  const s = memory.createSession()
  await orchestrator.run(s, '一个人在宇宙尽头寻找死亡的答案，做成5分钟的宽银幕', () => {})
  const knowledge = kb.buildKnowledgeContext({ brief: s.brief })
  const revision = null

  console.log('=== 历史产出体积 ===')
  for (const [k, v] of Object.entries(s.outputs)) {
    console.log(`  ${k.padEnd(16)} ${String(v.length).padStart(6)} 字符 / ≈${estTokens(v)} token`)
  }

  /** 场景：不同上下文窗口 × 不同输出预算 */
  const SCENARIOS = [
    { name: '16k 窗口 / 8192 输出', win: 16384, out: 8192 },
    { name: '32k 窗口 / 8192 输出（默认）', win: 32768, out: 8192 },
    { name: '64k 窗口 / 8192 输出', win: 65536, out: 8192 },
    { name: '128k 窗口 / 16384 输出', win: 131072, out: 16384 },
  ]

  for (const sc of SCENARIOS) {
    console.log(`\n=== ${sc.name} ===`)
    config.saveSettings({ contextWindow: sc.win, maxTokens: sc.out })
    const cap = orchestrator.inputCapChars()
    console.log(`  输入上限 ≈ ${cap} 字符 / ${Math.round(cap * 0.75)} token`)

    const buildCtx = (skillId, scale) => orchestrator.makeCtx(s, knowledge, revision, skillId, scale)

    let worst = 0
    let worstId = ''
    for (const id of FULL_PIPELINE) {
      const skill = BY_ID[id]
      const fitted = orchestrator.fitContext(skill, buildCtx, cap)
      const tokens = estTokens(String(fitted.size))
      if (fitted.size > worst) { worst = fitted.size; worstId = id }
      const ok = fitted.size <= cap
      console.log(
        `  ${skill.name.padEnd(8)} ${String(fitted.size).padStart(6)} 字符 / ${String(tokens).padStart(6)} token` +
        `  scale=${fitted.scale.toFixed(2)} ${ok ? '✓' : '✗ 超限'}`
      )
      check(`${sc.name} · ${skill.name} 装得下`, ok, `${fitted.size} > ${cap}`)
    }
    console.log(`  最重环节：${BY_ID[worstId].name}（${worst} 字符）`)
  }

  // ── 依赖白名单：不允许任何环节引用空依赖以外的东西导致 undefined ──
  console.log('\n=== 依赖完整性 ===')
  for (const id of FULL_PIPELINE) {
    const deps = orchestrator.PRIOR_DEPS[id] || []
    const missing = deps.filter((d) => !FULL_PIPELINE.some((p) => BY_ID[p].outputKey === d))
    check(`${id} 的依赖都是合法 outputKey`, missing.length === 0, `未知依赖：${missing.join(',')}`)
  }

  // ── 每个环节的 prompt 不得包含 undefined（Skill 引用了未投递的产出时会露出）──
  console.log('\n=== 提示词无 undefined ===')
  config.saveSettings({ contextWindow: 32768, maxTokens: 8192 })
  const cap2 = orchestrator.inputCapChars()
  const buildCtx2 = (skillId, scale) => orchestrator.makeCtx(s, knowledge, revision, skillId, scale)
  for (const id of FULL_PIPELINE) {
    const skill = BY_ID[id]
    const ctx = buildCtx2(id, 1)
    const text = skill.buildPrompt(ctx)
    check(`${skill.name} buildPrompt 无 undefined`, !/undefined/.test(text),
      '出现 undefined —— 说明引用了未投递的产出')
  }

  // ── 输出截断的续写指令必须存在 ──
  console.log('\n=== 续写机制 ===')
  const llm = require('../server/agent/llm')
  check('存在续写指令且要求不重复', /不要重复已输出/.test(llm.CONTINUE_PROMPT))
  check('续写指令要求写完整', /全部写完整/.test(llm.CONTINUE_PROMPT))

  // ── 设置项健壮性 ────────────────────────────────────────
  // 真实教训：用户为消除截断提示把 Max Tokens 填成 1e+99，该值被原样发给服务商，
  // 导致「每个环节都超出上限」。数值型设置必须钳制。
  console.log('\n=== 设置项钳制 ===')
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-cfg-'))
  const cfgPath = path.join(cfgDir, 'settings.json')
  fs.writeFileSync(cfgPath, JSON.stringify({
    baseUrl: 'http://x/v1', apiKey: 'k', model: 'm',
    maxTokens: 1e99, contextWindow: 'abc', temperature: 99,
  }))
  process.env.AI_FILM_DATA_DIR = cfgDir
  delete require.cache[require.resolve('../server/config')]
  const cfg = require('../server/config')
  const clamped = cfg.loadSettings()
  check('maxTokens 荒谬值被钳到上限', clamped.maxTokens === 65536, String(clamped.maxTokens))
  check('contextWindow 非数字回退默认', clamped.contextWindow === 32768, String(clamped.contextWindow))
  check('temperature 越界被钳到 2', clamped.temperature === 2, String(clamped.temperature))
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  check('磁盘上的脏值被就地改写', after.maxTokens === 65536 && after.contextWindow === 32768,
    JSON.stringify({ m: after.maxTokens, c: after.contextWindow }))
  try { fs.rmSync(cfgDir, { recursive: true, force: true }) } catch { /* ignore */ }

  safeDeleteSession(memory, s.id)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (fail) {
    console.log('\n失败项：')
    for (const f of fails) console.log('  - ' + f)
    process.exit(1)
  }
})().catch((e) => { console.error(e); process.exit(1) })
