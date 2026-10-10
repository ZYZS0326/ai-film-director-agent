/**
 * 真实 LLM 路径冒烟测试（用本地 Mock LLM 服务，不走 demo 兜底）
 *
 * 目的：覆盖「用户配置了 API Key」时的完整代码路径——
 *       Planner(LLM) → 11 Skill(LLM stream) → 结构化解析 → 审核评分
 *
 * 运行：npm run test:llm
 */
const path = require('path')
const { spawn } = require('child_process')

const PORT = 18997
const DATA_DIR = path.join(require('os').tmpdir(), 'ai-film-llm-smoke')
const fs = require('fs')

process.env.AI_FILM_DATA_DIR = DATA_DIR
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

;(async () => {
  console.log('\n=== 真实 LLM 路径冒烟测试（Mock 服务）===\n')

  console.log('[1] 启动 Mock LLM 服务…')
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(PORT)], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1200))

  const config = require('../server/config')
  const llm = require('../server/agent/llm')
  const memory = require('../server/agent/memory')
  const orchestrator = require('../server/agent/orchestrator')
  const planner = require('../server/agent/planner')

  // 写入「已配置」的设置
  config.saveSettings({
    baseUrl: `http://127.0.0.1:${PORT}/v1`,
    apiKey: 'sk-mock-key',
    model: 'mock-model',
    temperature: 0.8,
    maxTokens: 4096,
    theme: 'dark',
  })

  console.log('[2] 校验 LLM 已配置…')
  check('isConfigured() 为 true', llm.isConfigured() === true)
  const ping = await llm.testConnection()
  check('连通性测试通过', ping && ping.ok === true, String(ping && ping.message).slice(0, 60))

  console.log('[3] LLM Planner 解析…')
  const plan = await planner.plan({ message: '一个人在宇宙尽头寻找死亡的答案', session: { constraints: {} }, history: [] })
  check('LLM Planner 返回 intent', !!plan.intent, plan.intent)
  check('LLM Planner 技能链完整', plan.skills.length === 12, String(plan.skills.length))
  check('LLM Planner 约束生效', plan.constraints.duration === 300 && plan.constraints.aspect === '21:9', JSON.stringify(plan.constraints))

  console.log('[4] 完整流水线（真实 LLM 流式路径）…')
  const s = memory.createSession()
  const events = []
  const errors = []
  await orchestrator.run(s, '一个人在宇宙尽头寻找死亡的答案，做成5分钟的宽银幕',
    (e, d) => {
      events.push(d && d.skill ? `${e}:${d.skill}` : e)
      if (e === 'error') errors.push((d.skill || '-') + ': ' + d.message)
    })

  check('流水线无错误', errors.length === 0, errors.slice(0, 3).join(' | '))
  check('12 个技能全部执行', s.pipeline.length === 12, String(s.pipeline.length))
  check('12 项产出全部落库', Object.keys(s.outputs).length === 12, Object.keys(s.outputs).join(','))
  check('每个技能都有流式增量', [...new Set(events)].filter((x) => x.startsWith('delta:')).length === 12,
    String([...new Set(events)].filter((x) => x.startsWith('delta:')).length))
  check('产出内容非空', Object.values(s.outputs).every((v) => String(v).length > 20))

  console.log('[5] 结构化解析（LLM 输出的 JSON 块）…')
  check('分镜完整覆盖目标时长', s.shots.length > 3 && Math.abs(s.shots.at(-1).end - s.constraints.duration) < 0.05, `${s.shots.length} 个`)
  check('分镜字段含材质', !!s.shots[0].material, s.shots[0].material)
  check('提示词完整对应全部镜头', !!s.promptData && s.promptData.shots.length === s.shots.length)
  check('角色一致性中英双版', !!(s.promptData?.characterLock?.zh && s.promptData?.characterLock?.en))
  check('提示词 13 要素覆盖 13/13', s.promptValidation?.covered === 13, `${s.promptValidation?.covered}/${s.promptValidation?.total}`)
  check('提示词零无效词', (s.promptValidation?.banned || []).length === 0, JSON.stringify(s.promptValidation?.banned))
  check('审核评分可解析', s.reviewScores?.length === 8, `${s.reviewScores?.length} 项`)

  console.log('[6] 增量修改（LLM 路径）…')
  const s2 = memory.createSession()
  await orchestrator.run(s2, '一个人在宇宙尽头寻找死亡的答案', () => {})
  const errors2 = []
  const revisedStages = []
  await orchestrator.run(s2, '不要赛博朋克，改成东方神话', (e, d) => {
    if (e === 'error') errors2.push(d.message)
    if (e === 'stage_done') revisedStages.push(d.skill)
  })
  check('修订无错误', errors2.length === 0, errors2.join(' | '))
  check('整体风格修订覆盖完整下游', s2.pipeline.length === 12, String(s2.pipeline.length))
  check('真实执行剧本、分镜、连续性与提示词更新', ['screenplay', 'storyboard', 'continuity', 'prompt_engineering'].every(id => revisedStages.includes(id)))
  check('偏好已提取', s2.memory.preferences.some((p) => p.includes('东方神话')), JSON.stringify(s2.memory.preferences))

  srv.kill()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) {
    console.log('失败项：')
    failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? '  (' + f.extra + ')' : '')))
    process.exit(1)
  }
  console.log('全部通过\n')
  process.exit(0)
})().catch((e) => {
  console.error('\n测试脚本异常：', e)
  process.exit(1)
})
