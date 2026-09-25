/**
 * 测量每个 Skill 的真实提示词体积（字符 / 估算 token）
 *
 * 用途：定位"每项都超出上限"到底是 input 太大还是 output 预算不够。
 * 运行：node scripts/prompt-size.cjs
 */
const kb = require('../server/knowledge')
const { safeRm, safeDeleteSession, safeDeleteSessions } = require('./_safe-cleanup.cjs')
const { BY_ID, FULL_PIPELINE } = require('../server/skills')
const { CONTRACT_BY_SKILL } = require('../server/skills/contracts')
const memory = require('../server/agent/memory')
const orchestrator = require('../server/agent/orchestrator')

/** 中文为主的内容：保守估算 1 字符 ≈ 0.75 token（宁可高估，保证安全） */
const estTokens = (s) => Math.ceil(String(s || '').length * 0.75)

;(async () => {
  // 跑一遍 demo 流水线，拿到真实的历史产出
  const s = memory.createSession()
  await orchestrator.run(s, '一个人在宇宙尽头寻找死亡的答案，做成5分钟的宽银幕', () => {})

  const knowledge = kb.buildKnowledgeContext({ brief: s.brief })
  const prior = {}
  for (const [k, v] of Object.entries(s.outputs)) prior[k] = String(v)

  // 各预算档位
  const BUDGETS = [
    ['当前：PRIOR 2600 / KNOWLEDGE 14000', 2600, 14000],
    ['收紧：PRIOR 1200 / KNOWLEDGE 6000', 1200, 6000],
    ['极紧：PRIOR 600  / KNOWLEDGE 2500', 600, 2500],
  ]

  for (const [label, pc, kc] of BUDGETS) {
    const clip = (t, m) => (String(t || '').length <= m ? String(t || '') : String(t || '').slice(0, m))
    const p2 = {}
    for (const [k, v] of Object.entries(s.outputs)) p2[k] = clip(v, pc)
    const ctx = {
      brief: s.brief,
      knowledge: { ...knowledge, contextText: clip(knowledge.contextText, kc) },
      constraints: s.constraints,
      constraintsText: '时长 300 秒｜画幅 21:9｜剧本等级 L4｜平台 seedance｜输出语言：中文',
      prior: p2,
      priorShots: s.shots,
      revision: null,
    }

    console.log(`\n=== ${label} ===`)
    console.log('环节'.padEnd(22) + 'system'.padStart(8) + 'build'.padStart(9) + '契约'.padStart(8) + '合计字符'.padStart(10) + '≈token'.padStart(9))
    let total = 0
    for (const id of FULL_PIPELINE) {
      const sk = BY_ID[id]
      const sys = sk.systemPrompt || ''
      const build = sk.buildPrompt(ctx) || ''
      const contract = CONTRACT_BY_SKILL[id] || ''
      const sum = sys.length + build.length + contract.length
      total += sum
      console.log(
        (sk.name + ' (' + id + ')').padEnd(22) +
        String(sys.length).padStart(8) +
        String(build.length).padStart(9) +
        String(contract.length).padStart(8) +
        String(sum).padStart(10) +
        String(estTokens(sys + build + contract)).padStart(9)
      )
    }
    console.log('平均 ≈ ' + Math.round(total / FULL_PIPELINE.length) + ' 字符 / ' + Math.round(estTokens(String(total / FULL_PIPELINE.length))) + ' token')
  }

  console.log('\n=== 参考：常见模型上下文上限 ===')
  for (const [name, lim] of [['8k', 8000], ['16k', 16000], ['32k', 32000], ['64k', 64000], ['128k', 128000]]) {
    console.log(`  ${name.padEnd(6)} input 安全线(60%) ≈ ${Math.round(lim * 0.6)} token，输出预留 ≈ ${Math.round(lim * 0.3)} token`)
  }
  safeDeleteSession(memory, s.id)
})().catch((e) => { console.error(e); process.exit(1) })
