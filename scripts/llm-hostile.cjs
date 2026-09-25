/**
 * 对抗性测试：模拟「不那么乖」的真实 LLM 服务商，验证流水线依然能完成
 *
 * 覆盖：
 *   nostream  —— 忽略 stream 参数，始终返回完整 JSON（网关缓冲 SSE）
 *   bigtoken  —— max_tokens 过大时返回 400（模型输出上限）
 *   textfield —— SSE 内容放在 choices[0].text 而非 delta.content
 *
 * 运行：node scripts/llm-hostile.cjs
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')

// ctxlong 模式的请求体阈值（字节）：超过即返回「上下文超长」
process.env.MOCK_CTX_LIMIT = process.env.MOCK_CTX_LIMIT || '9000'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

async function runMode(mode, port, label) {
  const DATA_DIR = path.join(os.tmpdir(), 'ai-film-hostile-' + mode)
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  process.env.AI_FILM_DATA_DIR = DATA_DIR

  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(port)], {
    env: { ...process.env, MOCK_MODE: mode },
    stdio: 'ignore',
  })
  await new Promise((r) => setTimeout(r, 1000))

  // 每个 mode 用独立进程语义：清掉模块缓存，重新按新 DATA_DIR 载入
  for (const k of Object.keys(require.cache)) {
    if (k.includes('server' + path.sep)) delete require.cache[k]
  }

  const config = require('../server/config')
  const llm = require('../server/agent/llm')
  const memory = require('../server/agent/memory')
  const orchestrator = require('../server/agent/orchestrator')

  config.saveSettings({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'sk-mock',
    model: 'mock-model',
    temperature: 0.8,
    maxTokens: 8192, // 故意给一个大值，触发 bigtoken 场景
    theme: 'dark',
  })

  const s = memory.createSession()
  const errors = []
  await orchestrator.run(s, '一个人在宇宙尽头寻找死亡的答案，做成5分钟宽银幕',
    (e, d) => { if (e === 'error') errors.push((d.skill || '-') + ': ' + d.message) })

  check(`${label}：流水线不报错`, errors.length === 0, errors.slice(0, 2).join(' | '))
  check(`${label}：12 项产出全部生成`, Object.keys(s.outputs).length === 12, String(Object.keys(s.outputs).length))
  check(`${label}：产出内容非空`, Object.values(s.outputs).every((v) => String(v).length > 20))
  check(`${label}：分镜可解析`, s.shots.length > 0, `${s.shots.length} 个`)
  check(`${label}：提示词可解析`, !!s.promptData && (s.promptData.shots || []).length > 0)

  srv.kill()
  await new Promise((r) => setTimeout(r, 300))
}

/**
 * stall 专项：服务商发完响应头就挂住，既不继续发送也不结束连接。
 *
 * 这是过去会**永久挂起**的故障：`fetch()` 在响应头到达时就 resolve，
 * 而超时定时器在 `finally` 里被清掉了 —— 超时窗口只覆盖「连接 + 首字节」，
 * body 的读取（`reader.read()` / `res.json()`）没有任何保护。
 * 用户视角是「界面一直转圈，没有报错，只能强杀」。
 *
 * 这里不走完整流水线（12 个环节每个都会等超时，太慢），
 * 直接调底层并传入很短的超时来验证守卫确实生效。
 */
async function runStall(port) {
  const DATA_DIR = path.join(os.tmpdir(), 'ai-film-hostile-stall')
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  process.env.AI_FILM_DATA_DIR = DATA_DIR

  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(port)], {
    env: { ...process.env, MOCK_MODE: 'stall' },
    stdio: 'ignore',
  })
  await new Promise((r) => setTimeout(r, 1000))

  for (const k of Object.keys(require.cache)) {
    if (k.includes('server' + path.sep)) delete require.cache[k]
  }
  const config = require('../server/config')
  const llm = require('../server/agent/llm')
  config.saveSettings({
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-mock', model: 'mock-model',
    temperature: 0.8, maxTokens: 1024, theme: 'dark',
  })

  const msgs = [{ role: 'user', content: '写一段测试文本' }]
  const t0 = Date.now()

  // ── A. 流式：空闲守卫应把它救回来，并保留已收到的分片 ──
  try {
    let got = ''
    const r = await Promise.race([
      llm.chatStreamRaw(msgs, (d) => { got += d }, { idleTimeout: 1500, timeout: 4000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('WATCHDOG')), 9000)),
    ])
    const ms = Date.now() - t0
    check('stall：流式不会永久挂起', true, `${ms}ms`)
    check('stall：流式返回了已收到的部分内容', String(r.text || got).length > 0, `${String(r.text || got).length} 字符`)
    check('stall：流式标记为截断', r.truncated === true, String(r.truncated))
  } catch (e) {
    check('stall：流式不会永久挂起', e.message !== 'WATCHDOG', e.message === 'WATCHDOG' ? '超过 9 秒仍未返回 —— 空闲守卫失效' : e.message)
  }

  // ── B. 非流式：body 读取必须在超时窗口内被中止，且错误信息要指向「超时」而非 Base URL ──
  const t1 = Date.now()
  try {
    await Promise.race([
      llm.chatOnceRaw(msgs, { timeout: 2000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('WATCHDOG')), 9000)),
    ])
    // 没抛错也接受（某些实现会把半截 JSON 当空内容返回），但不能是挂死
    check('stall：非流式不会永久挂起', true, `${Date.now() - t1}ms`)
  } catch (e) {
    const ms = Date.now() - t1
    if (e.message === 'WATCHDOG') {
      check('stall：非流式不会永久挂起', false, '超过 9 秒仍未返回 —— body 读取未受超时保护')
    } else {
      check('stall：非流式不会永久挂起', true, `${ms}ms 后报错：${String(e.message).slice(0, 50)}`)
      // 错误信息必须指向真正的原因。曾把「超时中止」误报成
      // 「返回的不是合法 JSON，请检查 Base URL」—— 会把用户引去查一个根本没写错的配置。
      check('stall：超时的报错指向超时而非 Base URL', /超时/.test(String(e.message)), String(e.message).slice(0, 60))
    }
  }

  srv.kill()
  await new Promise((r) => setTimeout(r, 300))
}

/**
 * slow 专项：服务商**连响应头都不发**，一直拖（mock 里延迟 60 秒）。
 *
 * 这覆盖的是与 stall 不同的另一条超时路径：
 *  - slow  → 卡在「连接/首字节」，由 `fetchWithTimeout` 的 abort 定时器兜住
 *  - stall → 卡在「body 读取」，由空闲守卫 / body 超时兜住
 * 两条都必须有保护，缺一条就会永久转圈。
 */
async function runSlow(port) {
  const DATA_DIR = path.join(os.tmpdir(), 'ai-film-hostile-slow')
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  process.env.AI_FILM_DATA_DIR = DATA_DIR

  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-llm.js'), String(port)], {
    env: { ...process.env, MOCK_MODE: 'slow' },
    stdio: 'ignore',
  })
  await new Promise((r) => setTimeout(r, 1000))

  for (const k of Object.keys(require.cache)) {
    if (k.includes('server' + path.sep)) delete require.cache[k]
  }
  const config = require('../server/config')
  const llm = require('../server/agent/llm')
  config.saveSettings({
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-mock', model: 'mock-model',
    temperature: 0.8, maxTokens: 1024, theme: 'dark',
  })

  const msgs = [{ role: 'user', content: '写一段测试文本' }]
  const t0 = Date.now()
  try {
    await Promise.race([
      llm.chatOnceRaw(msgs, { timeout: 2000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('WATCHDOG')), 9000)),
    ])
    check('slow：首字节超时保护生效', false, '既没超时也没返回 —— 超时保护失效')
  } catch (e) {
    const ms = Date.now() - t0
    const hung = e.message === 'WATCHDOG'
    check('slow：首字节超时保护生效', !hung, hung ? '超过 9 秒仍未返回' : `${ms}ms 后报错`)
    if (!hung) {
      check('slow：报错含「超时」', /超时/.test(String(e.message)), String(e.message).slice(0, 50))
      check('slow：不误导为 Base URL 错误', !/Base URL/.test(String(e.message)), String(e.message).slice(0, 50))
    }
  }

  srv.kill()
  await new Promise((r) => setTimeout(r, 300))
}

;(async () => {
  console.log('\n=== 对抗性测试：异常 LLM 服务商 ===\n')

  console.log('[A] nostream —— 服务商忽略 stream 参数…')
  await runMode('nostream', 18981, 'nostream')

  console.log('\n[B] bigtoken —— max_tokens 过大返回 400…')
  await runMode('bigtoken', 18982, 'bigtoken')

  console.log('\n[C] textfield —— SSE 内容放在 choices[0].text…')
  await runMode('textfield', 18983, 'textfield')

  console.log('\n[D] flaky —— 前 2 个请求掐断 socket（fetch failed / ECONNRESET，靠重试自愈）…')
  await runMode('flaky', 18984, 'flaky')

  console.log('\n[E] ctxlong —— 请求体过大时报「上下文超长」（靠自动收缩上下文）…')
  await runMode('ctxlong', 18985, 'ctxlong')

  console.log('\n[F] stall —— 发完响应头就挂住（验证流式空闲守卫 / body 超时）…')
  await runStall(18986)

  console.log('\n[G] slow —— 连响应头都不发（验证首字节超时保护）…')
  await runSlow(18987)

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
