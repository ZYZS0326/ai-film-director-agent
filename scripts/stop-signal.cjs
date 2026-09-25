/**
 * 「停止生成」端到端测试。
 *
 * 背景：前端原来点「停止」只是 abort fetch —— 服务端根本不知道，
 * 会把 12 个环节全部跑完。用户以为停了，API 额度却还在烧。
 *
 * 现在的契约：
 *   1. 前端 POST /api/sessions/:id/stop，**不**断开 SSE 连接
 *   2. 编排器在下一个环节边界收手，已完成成果全部落盘
 *   3. SSE 流正常收尾：`done` 事件带 `aborted: true` 与最终 session
 *      （若粗暴断开连接，客户端拿不到这个最终状态，最后一个完成的环节会永远不显示）
 *
 * 断言：
 *  [1] 停止请求后流水线确实提前结束（完成的环节数 < 12）
 *  [2] done 事件带 aborted: true，且 session 里保留了已完成的产出
 *  [3] 落盘的会话文件与 done 事件一致（刷新后不丢成果）
 *  [4] 正常跑完时 aborted 为 false（不能把没停止的也标成 aborted）
 *  [5] 没有停止请求时，12 个环节全部完成
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')
const { safeRm } = require('./_safe-cleanup.cjs')

const MOCK_PORT = Number(process.env.STOP_TEST_MOCK_PORT || 18994)
const APP_PORT = Number(process.env.STOP_TEST_APP_PORT || 18995)
const DATA_DIR = path.join(os.tmpdir(), 'ai-film-stop-signal')

process.env.AI_FILM_DATA_DIR = DATA_DIR
safeRm(DATA_DIR)
fs.mkdirSync(DATA_DIR, { recursive: true })

/** 看门狗：任何一步卡住都要能看到卡在哪，而不是静默挂死 */
const WATCHDOG_MS = Number(process.env.STOP_TEST_TIMEOUT_MS || 300000)
const watchdog = setTimeout(() => {
  console.error(`\n❌ 看门狗超时（${WATCHDOG_MS}ms）：最后阶段 = ${global.__phase || '未知'}`)
  process.exit(1)
}, WATCHDOG_MS)
watchdog.unref?.()

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

/** 读一条 SSE 流，把事件回调出去 */
async function consumeSSE(res, onEvent) {
  const reader = res.body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = ''
  let ev = 'message'
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (!line) { ev = 'message'; continue }
      if (line.startsWith('event:')) { ev = line.slice(6).trim(); continue }
      if (line.startsWith('data:')) {
        const p = line.slice(5).trim()
        let data = {}
        try { data = p ? JSON.parse(p) : {} } catch { /* ignore */ }
        onEvent(ev, data)
      }
    }
  }
}

async function runOnce({ stopAfterStages }) {
  const created = await fetch(`http://127.0.0.1:${APP_PORT}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '停止测试' }),
  }).then((r) => r.json())
  const sid = created.id

  const events = []
  let doneCount = 0
  let stopSent = false

  const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, message: '一个人在宇宙尽头寻找死亡的答案，做成 5 分钟宽银幕' }),
  })

  await consumeSSE(res, (name, data) => {
    events.push({ name, data })
    if (name === 'stage_done') {
      doneCount += 1
      global.__phase = `第 ${doneCount} 个环节完成（${data.skill}）`
      console.log(`      · 环节 ${doneCount} 完成：${data.skill}`)
      // 完成指定数量的环节后请求停止（只发一次）
      if (!stopSent && stopAfterStages && doneCount >= stopAfterStages) {
        stopSent = true
        console.log(`      → 发出停止请求`)
        fetch(`http://127.0.0.1:${APP_PORT}/api/sessions/${sid}/stop`, { method: 'POST' })
          .catch(() => { /* ignore */ })
      }
    }
  })

  const doneEv = events.filter((e) => e.name === 'done').pop()
  const persisted = await fetch(`http://127.0.0.1:${APP_PORT}/api/sessions/${sid}`).then((r) => r.json())
  // publicSession 有意不返回 messages（前端不需要），要查对话记录得读落盘文件
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sessions', `${sid}.json`), 'utf8'))
  return { sid, events, doneCount, doneEv, persisted, raw, stopSent }
}

;(async () => {
  console.log('\n=== 停止生成 · 端到端测试 ===\n')

  console.log('[0] 启动 Mock LLM（每分块间隔 25ms，制造时间窗）与后端…')
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(MOCK_PORT)], {
    stdio: 'ignore',
    env: { ...process.env, MOCK_CHUNK_DELAY_MS: '25' },
  })
  await new Promise((r) => setTimeout(r, 1200))

  const config = require('../server/config')
  config.saveSettings({
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    apiKey: 'sk-mock-key',
    model: 'mock-model',
    temperature: 0.8,
    maxTokens: 4096,
    contextWindow: 32768,
    theme: 'dark',
  })

  const { createApp } = require('../server/app')
  const app = createApp()
  const server = app.listen(APP_PORT, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))

  // ── [1][2][3] 中途停止 ──────────────────────────────
  console.log('[1] 跑流水线，完成 3 个环节后请求停止…')
  const a = await runOnce({ stopAfterStages: 3 })
  check('[1] 确实发出了停止请求', a.stopSent === true)
  check('[1] 流水线提前结束（完成环节 < 12）', a.doneCount < 12, `完成 ${a.doneCount} 个`)
  check('[1] 已完成环节数 ≥ 3', a.doneCount >= 3, `完成 ${a.doneCount} 个`)
  check('[1] 没有跑到最后的审核环节', !a.events.some((e) => e.name === 'stage_done' && e.data.skill === 'quality_control'))

  check('[2] done 事件带 aborted: true', a.doneEv?.data?.aborted === true,
    JSON.stringify(a.doneEv?.data?.aborted))
  const outKeys = Object.keys(a.doneEv?.data?.session?.outputs || {})
  check('[2] done 事件的 session 保留了已完成产出', outKeys.length >= 3, `${outKeys.length} 项`)
  check('[2] 流正常收尾（收到 end 事件）', a.events.some((e) => e.name === 'end'))

  check('[3] 落盘会话与 done 事件一致', Object.keys(a.persisted.outputs || {}).length === outKeys.length,
    `落盘 ${Object.keys(a.persisted.outputs || {}).length} / 事件 ${outKeys.length}`)
  check('[3] 刷新会话仍能看到已完成产出', Object.keys(a.persisted.outputs || {}).length >= 3)
  check('[3] 中断信息写入了对话记录',
    (a.raw.messages || []).some((m) => String(m.content || '').includes('已停止')),
    JSON.stringify((a.raw.messages || []).slice(-1).map((m) => String(m.content).slice(0, 40))))
  check('[3] 用户消息也被保留', (a.raw.messages || []).some((m) => m.role === 'user'))
  check('[3] 中断后待更新环节落盘', a.raw.pendingSkills?.includes('quality_control'))
  check('[3] API 提示尚未更新完成', a.persisted.productionChecks?.issues.some(i => i.code === 'pending'))

  // ── [4][5] 不停止时跑完整 ────────────────────────────
  console.log('[2] 不请求停止，确认 12 个环节全部跑完且 aborted 为 false…')
  const b = await runOnce({ stopAfterStages: null })
  check('[5] 完整生成清除待更新标记', b.persisted.pendingSkills?.length === 0)
  check('[5] 完成全部 12 个环节', b.doneCount === 12, `完成 ${b.doneCount} 个`)
  check('[4] aborted 为 false', b.doneEv?.data?.aborted === false,
    JSON.stringify(b.doneEv?.data?.aborted))
  check('[5] 12 个 outputKey 全部有产出', Object.keys(b.persisted.outputs || {}).length === 12,
    `${Object.keys(b.persisted.outputs || {}).length} 项`)

  // ── [6] 同一会话的并发请求必须被拒绝 ───────────────────
  // 两个请求各自 loadSession 出独立内存副本、各自 saveSession —— 后写覆盖前写，
  // 先跑完那条的产出整段丢失且**没有任何报错**。
  // 正常单窗口不会触发（前端 busy 时禁用发送），但双开标签页 / 脚本重放会。
  console.log('[6] 同一会话并发请求应被拒绝（409），且锁会释放…')
  {
    const created = await fetch(`http://127.0.0.1:${APP_PORT}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '并发测试' }),
    }).then((r) => r.json())
    const sid = created.id
    const headers = { 'Content-Type': 'application/json' }
    const body = JSON.stringify({ sessionId: sid, message: '一个人在宇宙尽头寻找死亡的答案，做成 5 分钟宽银幕' })

    const resA = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, { method: 'POST', headers, body })
    check('[6] 首个请求正常开始流式', resA.ok && !!resA.body, String(resA.status))

    // 等 A 真正进入编排（收到第一个 stage_start），确保锁已被占用
    let sawStart = null
    const started = new Promise((r) => { sawStart = r })
    const consumeA = consumeSSE(resA, (name) => { if (name === 'stage_start') sawStart() })
    await Promise.race([started, new Promise((r) => setTimeout(r, 10000))])

    const resB = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, { method: 'POST', headers, body })
    check('[6] 并发请求被拒绝（409）', resB.status === 409, String(resB.status))
    let msg = ''
    try { msg = String((await resB.json()).error || '') } catch { /* 非 JSON */ }
    check('[6] 409 给出可操作的原因', /正在运行/.test(msg), msg.slice(0, 60))

    // 停掉 A 并等它收尾
    await fetch(`http://127.0.0.1:${APP_PORT}/api/sessions/${sid}/stop`, { method: 'POST' }).catch(() => {})
    await consumeA.catch(() => {})
    await new Promise((r) => setTimeout(r, 1200))

    // A 结束后锁必须释放，同一会话可以再次请求
    const resC = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, { method: 'POST', headers, body })
    check('[6] 前一条结束后锁已释放（可再次请求）', resC.status === 200, String(resC.status))
    try { await resC.body.cancel() } catch { /* ignore */ }
    await fetch(`http://127.0.0.1:${APP_PORT}/api/sessions/${sid}/stop`, { method: 'POST' }).catch(() => {})
    await new Promise((r) => setTimeout(r, 1200))
  }

  server.close()
  mock.kill()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n停止生成测试：${results.length - failed.length} 项通过，${failed.length} 项失败`)
  if (failed.length) {
    console.log('\n失败明细：')
    failed.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}${f.extra ? ' — ' + f.extra : ''}`))
    process.exit(1)
  }
  console.log('全部通过 ✅')
  process.exit(0)
})().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
