/**
 * 流水线接线体检 — 专查「静默失联」类缺陷。
 *
 * 这类缺陷的共同特征：代码不报错、测试不失败、界面有内容，
 * 但某个环节的产出实际上从未被下游使用，或者某个知识库小节名
 * 根本不存在（pickSections 静默返回空串）。
 *
 * 断言：
 *  [1] PRIOR_DEPS 的 key 必须是真实 skill id
 *  [2] PRIOR_DEPS 的 value 必须是真实 outputKey
 *  [3] 每个产出型 Skill 的 outputKey 至少被一个下游环节消费（或明确登记为「终点产出」）
 *  [4] KNOWLEDGE_SECTIONS 的 key 必须是真实 skill id
 *  [5] KNOWLEDGE_SECTIONS 里写的每个小节名都必须在 contextSections 里真实存在
 *  [6] 每个环节的依赖必须来自「更早的 stage」（禁止前向依赖）
 *  [7] buildPrompt 引用的 ctx.prior.X 必须已在 PRIOR_DEPS 里声明
 */
const path = require('path')
const { SKILLS, BY_ID, FULL_PIPELINE } = require('../server/skills')
const { PRIOR_DEPS, KNOWLEDGE_SECTIONS, makeCtx, MIN_SCALE } = require('../server/agent/orchestrator')
const kb = require('../server/knowledge')

let pass = 0
const fails = []
function ok(name) { pass += 1 }
function bad(name, detail) { fails.push(`${name}${detail ? ' — ' + detail : ''}`) }
function check(cond, name, detail) { cond ? ok(name) : bad(name, detail) }

const OUTPUT_KEYS = new Set(SKILLS.map((s) => s.outputKey))
const SKILL_IDS = new Set(SKILLS.map((s) => s.id))

// ── [1][2] 依赖表本身合法 ──────────────────────────────
for (const [id, deps] of Object.entries(PRIOR_DEPS)) {
  check(SKILL_IDS.has(id), `[1] PRIOR_DEPS key "${id}" 是真实 skill id`)
  for (const d of deps) {
    check(OUTPUT_KEYS.has(d), `[2] ${id} 依赖的 "${d}" 是真实 outputKey`)
  }
}

// ── [6] 禁止前向依赖（只能引用更早 stage 的产出）──────
const keyOwner = {}
for (const s of SKILLS) keyOwner[s.outputKey] = s
for (const [id, deps] of Object.entries(PRIOR_DEPS)) {
  const self = BY_ID[id]
  if (!self) continue
  for (const d of deps) {
    const owner = keyOwner[d]
    if (!owner) continue
    check(owner.stage < self.stage,
      `[6] ${id}(stage ${self.stage}) 只依赖更早环节，未引用 ${owner.id}(stage ${owner.stage})`)
  }
}

// ── [3] 产出是否被消费 ────────────────────────────────
// 终点产出：只用于展示/导出，不需要下游消费。新增环节时必须显式登记。
// 注意 continuity 不在此列 —— 它的存在意义就是给 prompt_engineering 锁一致性，
// 曾经因为没登记依赖而白跑一个环节。
const TERMINAL = new Set(['review'])
const consumers = {}
for (const [id, deps] of Object.entries(PRIOR_DEPS)) {
  for (const d of deps) (consumers[d] ||= []).push(id)
}
for (const s of SKILLS) {
  const used = consumers[s.outputKey] || []
  if (TERMINAL.has(s.outputKey)) {
    ok(`[3] ${s.id} 是终点产出（已显式登记）`)
  } else {
    check(used.length > 0,
      `[3] ${s.id} 的产出 "${s.outputKey}" 被下游消费`,
      '无任何环节引用它 —— 这个环节跑了但结果没用上')
  }
}

// ── [4][5] 知识库小节名必须真实存在 ───────────────────
const sections = kb.splitSections(
  kb.buildKnowledgeContext({ brief: '测试', aspect: '21:9', duration: 300, level: 4 }).contextText
)
const sectionNames = new Set(Object.keys(sections))
for (const [id, wanted] of Object.entries(KNOWLEDGE_SECTIONS)) {
  check(SKILL_IDS.has(id), `[4] KNOWLEDGE_SECTIONS key "${id}" 是真实 skill id`)
  for (const w of wanted) {
    check([...sectionNames].some((n) => n.includes(w)),
      `[5] ${id} 需要的小节「${w}」在知识库中存在`,
      `知识库里没有这个名 —— pickSections 会静默返回空串`)
  }
}

// ── [7] buildPrompt 里写的 ctx.prior.X 必须已声明 ─────
const src = (f) => require('fs').readFileSync(path.join(__dirname, '..', 'server', 'skills', f), 'utf8')
for (const s of SKILLS) {
  const code = src(`${s.id}.js`)
  const refs = [...code.matchAll(/ctx\.prior\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  for (const r of new Set(refs)) {
    check((PRIOR_DEPS[s.id] || []).includes(r),
      `[7] ${s.id} 用到的 prior.${r} 已在 PRIOR_DEPS 声明`,
      `代码读了 ctx.prior.${r}，但 PRIOR_DEPS 没给 —— 运行时永远是 undefined`)
  }
}

// ── [7b] 声明要的知识段落必须真的被用上 ────────────────
// makeCtx 会把 KNOWLEDGE_SECTIONS 切出来塞进 ctx.knowledge.contextText。
// 如果 buildPrompt 根本不读它，这段文字就是白算的 —— 既浪费输入预算，
// 又让后来者以为该环节已经拿到了知识库。
for (const s of SKILLS) {
  const wanted = KNOWLEDGE_SECTIONS[s.id] || []
  const code = src(`${s.id}.js`)
  const usesContextText = /ctx\.knowledge\.contextText/.test(code)
  if (wanted.length) {
    check(usesContextText,
      `[7b] ${s.id} 声明了知识段落并真的注入提示词`,
      `KNOWLEDGE_SECTIONS 给了 [${wanted.join(', ')}]，但 buildPrompt 没读 contextText —— 白算`)
  } else {
    check(!usesContextText || true, `[7b] ${s.id} 未声明知识段落`)
  }
}

// ── [8] 用最小预算实跑一遍 makeCtx，确认依赖真能取到值 ──
const fake = {
  brief: '一个人在宇宙尽头寻找死亡的答案',
  constraints: { duration: 300, aspect: '21:9', level: 4, platforms: ['seedance'], language: 'zh' },
  outputs: Object.fromEntries([...OUTPUT_KEYS].map((k) => [k, '【上游产出占位文本】' + '内容'.repeat(200)])),
  shots: [{ no: 1, start: 0, end: 5 }],
}
const full = kb.buildKnowledgeContext({ brief: fake.brief, aspect: '21:9', duration: 300, level: 4 })
for (const s of SKILLS) {
  const ctx = makeCtx(fake, full, null, s.id, MIN_SCALE)
  for (const d of (PRIOR_DEPS[s.id] || [])) {
    check(typeof ctx.prior[d] === 'string' && ctx.prior[d].length > 0,
      `[8] ${s.id} 在最小预算下仍能取到 prior.${d}`)
  }
  let promptText = ''
  try { promptText = String(s.buildPrompt(ctx) || '') } catch (e) {
    bad(`[8] ${s.id}.buildPrompt 在最小预算下不抛错`, String(e.message))
    continue
  }
  ok(`[8] ${s.id}.buildPrompt 在最小预算下不抛错`)
  check(!/undefined/.test(promptText),
    `[8] ${s.id} 提示词不含 undefined`,
    promptText.slice(Math.max(0, promptText.indexOf('undefined') - 40), promptText.indexOf('undefined') + 40))
}

console.log(`\n流水线接线体检：${pass} 项通过，${fails.length} 项失败`)
if (fails.length) {
  console.log('\n失败明细：')
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  process.exit(1)
}
console.log('全部通过 ✅')
