/**
 * 输出截断 → 自动续写 回归测试
 *
 * 背景：用户反馈「每一项都超出了上限导致生成不完整」。
 * 根因是模型单次输出有上限（finish_reason='length'），而契约要求完整正文。
 * 本测试用 truncate 模式的 Mock 服务模拟这种服务商，验证：
 *   ① llm 层能把多轮结果拼成完整正文
 *   ② 编排器跑完 12 个环节，每个环节都是完整的（无截断标记）
 *   ③ 分镜 JSON / 提示词 JSON / 审核评分仍能正确解析（说明拼出来的正文结构没坏）
 *
 * 运行：node scripts/llm-continuation.cjs
 */
const path = require('path')
const { safeRm, safeDeleteSession, safeDeleteSessions } = require('./_safe-cleanup.cjs')
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')

const PORT = 18995
/** 每轮只吐 260 字符 —— 每个环节都需要多轮续写才能写完 */
const TRUNC = 400
const DATA_DIR = path.join(os.tmpdir(), 'ai-film-continuation')

process.env.AI_FILM_DATA_DIR = DATA_DIR
safeRm(DATA_DIR)
fs.mkdirSync(DATA_DIR, { recursive: true })
process.env.MOCK_MODE = 'truncate'
process.env.MOCK_TRUNC_CHARS = String(TRUNC)

let pass = 0
let fail = 0
const fails = []
function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`) } else {
    fail += 1
    fails.push(`${name} — ${extra}`)
    console.log(`  ✗ ${name} — ${extra}`)
  }
}

;(async () => {
  console.log('\n=== 输出截断 → 自动续写 回归测试 ===\n')
  console.log(`[1] 启动 Mock（每轮最长 ${TRUNC} 字符，强制触发续写）…`)
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(PORT)], {
    stdio: 'ignore',
    env: { ...process.env, MOCK_MODE: 'truncate', MOCK_TRUNC_CHARS: String(TRUNC) },
  })
  await new Promise((r) => setTimeout(r, 1200))

  const config = require('../server/config')
  const llm = require('../server/agent/llm')
  const memory = require('../server/agent/memory')
  const orchestrator = require('../server/agent/orchestrator')

  config.saveSettings({
    baseUrl: `http://127.0.0.1:${PORT}/v1`,
    apiKey: 'sk-mock-key',
    model: 'mock-model',
    temperature: 0.8,
    maxTokens: 4096,
    contextWindow: 32768,
    theme: 'dark',
  })

  // 用「分镜师」system prompt 触发 Mock 的长输出（含 JSON 块），才能真正考验续写
  const LONG_MSGS = [
    { role: 'system', content: '你是分镜师。' },
    { role: 'user', content: '请输出分镜表' },
  ]

  console.log('\n[2] 单次调用：截断后必须自动拼完整…')
  const long = await llm.chat(LONG_MSGS, { maxTokens: 4096 })
  check('续写后长度远大于单轮上限', String(long).length > TRUNC * 3, `实际 ${String(long).length} 字符`)
  check('结果不含"仍被模型输出上限截断"警告',
    !/仍被模型输出上限截断/.test(String(long)), String(long).slice(-120))
  check('续写后的正文仍包含完整 JSON 块', /```json[\s\S]*```/.test(String(long)))

  console.log('\n[3] 流式调用：截断后必须自动拼完整…')
  let streamed = ''
  await llm.chatStream(LONG_MSGS, (d) => { streamed += d })
  check('流式续写后长度远大于单轮上限', streamed.length > TRUNC * 3, `实际 ${streamed.length} 字符`)
  check('流式结果不含截断警告', !/仍被模型输出上限截断/.test(streamed))
  check('流式续写后 JSON 块完整', /```json[\s\S]*```/.test(streamed))
  check('流式与单次结果一致', streamed.length === String(long).length,
    `stream=${streamed.length} chat=${String(long).length}`)

  console.log('\n[4] 完整流水线（每个环节都被截断，必须全部续写完整）…')
  const session = memory.createSession()
  const events = []
  await orchestrator.run(
    session,
    '一个人在宇宙尽头寻找死亡的答案，做成5分钟的宽银幕',
    (type, data) => events.push({ type, data })
  )

  const doneCount = events.filter((e) => e.type === 'stage_done').length
  check('12 个环节全部完成', doneCount === 12, `实际 ${doneCount}`)

  const errs = events.filter((e) => e.type === 'error')
  check('没有环节报错', errs.length === 0, errs.map((e) => String(e.data.message).slice(0, 80)).join(' | '))

  // 逐环节检查正文完整性
  const OUTPUT_KEYS = {
    director_analysis: 'analysis', film_history: 'references', story_structure: 'structure',
    cinematography: 'cinematography', visual_design: 'visualBible', screenplay: 'screenplay',
    storyboard: 'storyboard', continuity: 'continuity', prompt_engineering: 'prompts',
    sound_design: 'sound', editing: 'editing', quality_control: 'review',
  }
  for (const [id, key] of Object.entries(OUTPUT_KEYS)) {
    const t = String(session.outputs[key] || '')
    check(`${id} 产出非空`, t.trim().length > 200, `仅 ${t.trim().length} 字符`)
    check(`${id} 无截断警告`, !/仍被模型输出上限截断/.test(t), t.slice(-100))
    check(`${id} 无"输出过短"警告`, !/输出异常短/.test(t), t.slice(-100))
  }

  console.log('\n[5] 结构化解析（验证拼出来的正文结构没坏）…')
  check('分镜 shots 已解析', Array.isArray(session.shots) && session.shots.length === 3,
    `实际 ${session.shots ? session.shots.length : 0}`)
  check('提示词数据已解析', !!session.promptData && Array.isArray(session.promptData.shots),
    session.promptData ? `shots=${session.promptData.shots.length}` : 'null')
  check('连续性 Bible 已解析', !!session.continuityData && !!session.continuityData.lockZh)
  check('审核评分已解析', Array.isArray(session.reviewScores) && session.reviewScores.length >= 8,
    `实际 ${session.reviewScores ? session.reviewScores.length : 0}`)
  check('提示词质检已生成', !!session.promptValidation)

  console.log('\n[6] 极端组合：小上下文窗口(16K) + 输出截断…')
  config.saveSettings({ contextWindow: 16384, maxTokens: 4096 })
  const s2 = memory.createSession()
  const ev2 = []
  await orchestrator.run(s2, '一个孤独的人在废墟中寻找答案，3分钟', (t, d) => ev2.push({ type: t, data: d }))
  const done2 = ev2.filter((e) => e.type === 'stage_done').length
  check('小窗口下 12 个环节仍全部完成', done2 === 12, `实际 ${done2}`)
  check('小窗口下无环节报错', ev2.filter((e) => e.type === 'error').length === 0,
    ev2.filter((e) => e.type === 'error').map((e) => String(e.data.message).slice(0, 80)).join(' | '))
  const shortKeys = Object.keys(session.outputs).filter((k) => String(s2.outputs[k] || '').trim().length < 200)
  check('小窗口下所有产出仍有实质内容', shortKeys.length === 0, `过短：${shortKeys.join(',')}`)
  check('小窗口下分镜仍可解析', Array.isArray(s2.shots) && s2.shots.length === 3,
    `实际 ${s2.shots ? s2.shots.length : 0}`)

  // ── [4] 截断提示的措辞 ──────────────────────────────────
  // 历史教训：旧提示写「可在设置中把 maxTokens 调高（建议 8192 以上）」，
  // 用户为了消除这条提示一路填到了 1e+99，结果每个环节都被服务商拒掉 ——
  // 反而变成「全都生成不完整」。所以这里锁住两件事：
  //   ① 真正有效的杠杆（减少产出量）必须排在前面
  //   ② 不能出现「调高 maxTokens 就好了」这种暗示
  console.log('\n[4] 截断提示措辞…')
  {
    const llm = require('../server/agent/llm')
    const { shortOutputNotice } = require('../server/agent/orchestrator')
    const notice = llm.truncatedNotice(8)
    check('提示里带上了续写轮数', notice.includes('8'), notice.slice(0, 60))
    check('提示含「缩短影片总时长」这类可操作建议', /缩短影片总时长|减少镜头数量/.test(notice), notice.slice(0, 120))
    check('可操作建议排在「maxTokens」之前',
      notice.indexOf('缩短影片总时长') < notice.indexOf('maxTokens'), notice.slice(0, 160))
    check('不把调高 maxTokens 描述成解法',
      !/建议\s*8192|把 maxTokens 调高（建议|调高 maxTokens 即可/.test(notice), notice.slice(0, 160))
    check('明确说明调高上限只是把截断点后移',
      /只能把单轮输出上限往后推|仍会再次截断/.test(notice), notice.slice(0, 160))

    const shortNotice = shortOutputNotice(42)
    check('异常短提示带上实际字数', shortNotice.includes('42'), shortNotice.slice(0, 80))
    check('异常短提示给出减少内容量的可操作建议',
      /缩短影片总时长|减少镜头数量/.test(shortNotice), shortNotice.slice(0, 160))
    check('异常短提示不再建议调高 maxTokens',
      !/maxTokens|调到\s*8192|调高/.test(shortNotice), shortNotice.slice(0, 180))
  }

  srv.kill()
  safeDeleteSessions(memory, [session.id, s2.id])
  safeRm(DATA_DIR)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (fail) {
    console.log('\n失败项：')
    for (const f of fails) console.log('  - ' + f)
    process.exit(1)
  }
})().catch((e) => { console.error(e); process.exit(1) })
