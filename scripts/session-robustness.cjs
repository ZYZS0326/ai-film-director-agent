/**
 * 会话数据健壮性回归测试。
 *
 * 背景：磁盘上的会话文件可能结构不完整 —— 旧版本写入的、被手工编辑过的、
 * 或写入过程中进程被杀导致的半截 JSON。这类坏数据曾一路走到编排器里才炸：
 *   TypeError: Cannot read properties of undefined (reading 'push')
 * 用户视角就是「打开旧项目，一发消息就全流程失败」。
 *
 * 断言：
 *  [1] normalizeSession 补齐所有必需字段
 *  [2] loadSession 对半截 / 非 JSON 文件返回 null（而不是抛错）
 *  [3] 归一化后的会话能安全跑完整编排（不抛错）
 *  [4] saveSession 是原子的：不留 .tmp 残留，且写出的内容可被读回
 *  [5] createSession 的字段集与 normalizeSession 的输出一致（避免两处漂移）
 *  [6] 各 Skill 的 outputKey 都在 createSession 的注释/输出对象里可容纳
 *  [10] 会话 id 严格拒绝非法字符，且加载后以文件名校正内容里的 id
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

// 必须在 require 业务模块之前指定数据目录
const TMP = path.join(os.tmpdir(), 'afd-sess-test-' + Date.now())
process.env.AI_FILM_DATA_DIR = TMP

const memory = require('../server/agent/memory')
const orchestrator = require('../server/agent/orchestrator')
const { SKILLS } = require('../server/skills')

let pass = 0
const fails = []
function check(cond, name, detail) {
  if (cond) pass += 1
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`)
}

const SESSIONS = path.join(TMP, 'sessions')
fs.mkdirSync(SESSIONS, { recursive: true })

// ── [1] normalizeSession 补齐字段 ──────────────────────
const REQUIRED = ['id', 'title', 'brief', 'constraints', 'outputs', 'shots',
  'promptData', 'continuityData', 'promptValidation', 'reviewScores',
  'pipeline', 'skillHistory', 'memory', 'messages']

const bare = memory.normalizeSession({ id: 'x1', brief: '测试' })
for (const k of REQUIRED) check(k in bare, `[1] normalizeSession 补出 "${k}"`)
check(Array.isArray(bare.messages), '[1] messages 是数组')
check(Array.isArray(bare.memory.decisions), '[1] memory.decisions 是数组')
check(Array.isArray(bare.memory.revisions), '[1] memory.revisions 是数组')
check(Array.isArray(bare.memory.preferences), '[1] memory.preferences 是数组')
check(Array.isArray(bare.pipeline), '[1] pipeline 是数组')
check(Array.isArray(bare.skillHistory), '[1] skillHistory 是数组')
check(Array.isArray(bare.shots), '[1] shots 是数组')
check(bare.constraints.duration === 300, '[1] constraints.duration 有默认值')
check(bare.constraints.aspect === '21:9', '[1] constraints.aspect 有默认值')
check(Array.isArray(bare.constraints.platforms) && bare.constraints.platforms.length > 0,
  '[1] constraints.platforms 有默认值')

// 传进非对象不能崩
check(memory.normalizeSession(null) === null, '[1] normalizeSession(null) 返回 null')
check(memory.normalizeSession('字符串') === null, '[1] normalizeSession(字符串) 返回 null')
check(memory.normalizeSession({ outputs: '不是对象', shots: '不是数组' }).shots.length === 0,
  '[1] 字段类型错误时被纠正为正确类型')
check(memory.normalizeSession({ constraints: { language: 'jp' } }).constraints.language === 'zh',
  '[1] 非法语言被归一为 zh')

// 存量自愈：旧版本或手工编辑过的会话里可能存着越界约束。
// 这些值若不纠正，会一路带进 buildMemorySummary（提示词）、ParamsBar（UI）
// 和 resolveDurationMode（时长模式解析）—— 用户视角是「我写的是 30 秒，方案却按两小时排」。
{
  const bad = memory.normalizeSession({
    id: 'x-bad', brief: '旧会话',
    constraints: { duration: 999999, level: 99, aspect: 'banana', platforms: ['不存在的平台'], language: 'zh' },
  })
  check(bad.constraints.duration === 300, '[1] 越界 duration 被纠正为默认', String(bad.constraints.duration))
  check(bad.constraints.level === 4, '[1] 越界 level 被纠正为默认', String(bad.constraints.level))
  check(bad.constraints.aspect === '21:9', '[1] 非法 aspect 被纠正为默认', String(bad.constraints.aspect))
  check(bad.constraints.platforms.length > 0 && !bad.constraints.platforms.includes('不存在的平台'),
    '[1] 非法平台被剔除并回退默认', JSON.stringify(bad.constraints.platforms))

  const ok2 = memory.normalizeSession({
    id: 'x-ok', brief: '正常会话',
    constraints: { duration: 120, level: 3, aspect: '9:16', platforms: ['kling'], language: 'en' },
  })
  check(ok2.constraints.duration === 120 && ok2.constraints.level === 3 &&
    ok2.constraints.aspect === '9:16' && ok2.constraints.platforms[0] === 'kling' && ok2.constraints.language === 'en',
    '[1] 合法约束不被改动', JSON.stringify(ok2.constraints))

  // 边界：0 秒既非法也不该变成 0（sanitize 会删掉 → 回落默认）
  const zero = memory.normalizeSession({ id: 'x-zero', constraints: { duration: 0 } })
  check(zero.constraints.duration === 300, '[1] duration=0 回落默认而非保留 0', String(zero.constraints.duration))
}

// ── [2] 坏文件读取 ─────────────────────────────────────
const cases = [
  ['半截 JSON', '{"id":"s_bad2","title":"半截","mess'],
  ['完全不是 JSON', '这不是 json'],
  ['空文件', ''],
]
for (const [name, content] of cases) {
  const f = path.join(SESSIONS, `s_${name.replace(/\s/g, '')}.json`)
  fs.writeFileSync(f, content, 'utf8')
  let out
  try { out = memory.loadSession(path.basename(f, '.json')) } catch (e) { out = 'THREW:' + e.message }
  check(out === null, `[2] ${name} → loadSession 返回 null`, String(out))
}

// ── [3] 坏数据能安全跑编排 ─────────────────────────────
const partial = { id: 's_partial', title: '旧会话', brief: '一个人在宇宙尽头寻找死亡的答案', outputs: {} }
fs.writeFileSync(path.join(SESSIONS, 's_partial.json'), JSON.stringify(partial), 'utf8')
const loaded = memory.loadSession('s_partial')

;(async () => {
  let threw = null
  const events = []
  try {
    await orchestrator.run(loaded, '再改一版，把色调调冷', (ev) => events.push(ev))
  } catch (e) { threw = e }
  check(threw === null, '[3] 结构不完整的旧会话跑编排不抛错', threw && threw.message)
  check(events.includes('done'), '[3] 仍能正常走到 done 事件')
  check(Array.isArray(loaded.messages) && loaded.messages.length >= 2,
    '[3] 对话消息被正确追加')

  // ── [4] 原子写入 ────────────────────────────────────
  const s = memory.createSession('原子写测试')
  s.outputs.analysis = '内容'
  memory.saveSession(s)
  check(fs.existsSync(path.join(SESSIONS, `${s.id}.json`)), '[4] 目标文件已写出')
  const leftovers = fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.tmp'))
  check(leftovers.length === 0, '[4] 不残留 .tmp 文件', leftovers.join(', '))
  const back = memory.loadSession(s.id)
  check(back && back.outputs.analysis === '内容', '[4] 写出的内容可被读回')
  check(back.title === '原子写测试', '[4] 标题往返一致')

  // 连续保存 30 次，确认不产生残留也不损坏
  for (let i = 0; i < 30; i++) {
    s.outputs.analysis = '第 ' + i + ' 版'
    memory.saveSession(s)
  }
  check(memory.loadSession(s.id).outputs.analysis === '第 29 版', '[4] 连续保存 30 次后内容正确')
  check(fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.tmp')).length === 0,
    '[4] 连续保存后仍无 .tmp 残留')

  // ── [5] createSession 与 normalizeSession 字段一致 ──
  const created = memory.createSession('字段一致性')
  const normalized = memory.normalizeSession(created)
  const ck = Object.keys(created).sort()
  const nk = Object.keys(normalized).sort()
  const missing = nk.filter((k) => !ck.includes(k))
  check(missing.length === 0,
    '[5] createSession 覆盖 normalizeSession 的全部字段',
    missing.length ? `createSession 缺：${missing.join(', ')}` : '')
  for (const k of ck) {
    const a = created[k]
    const b = normalized[k]
    if (Array.isArray(a)) check(Array.isArray(b), `[5] ${k} 类型一致（数组）`)
    else if (a && typeof a === 'object') check(b && typeof b === 'object', `[5] ${k} 类型一致（对象）`)
  }

  // ── [6] 12 个环节的 outputKey 都能落进 outputs ───────
  const s2 = memory.createSession('产出键')
  for (const sk of SKILLS) s2.outputs[sk.outputKey] = '占位'
  memory.saveSession(s2)
  const back2 = memory.loadSession(s2.id)
  for (const sk of SKILLS) {
    check(back2.outputs[sk.outputKey] === '占位', `[6] outputKey "${sk.outputKey}" 可持久化`)
  }
  check(Object.keys(back2.outputs).length === SKILLS.length,
    '[6] 12 个 outputKey 无冲突（数量吻合）', `实际 ${Object.keys(back2.outputs).length}`)

  // ── [7] 设置文件（settings.json）健壮性 ──────────────
  // 与会话文件同属「本地数据文件」：可能是手改的、写入中断的、或是合法 JSON 但不是对象。
  // loadSettings() 在**每次 LLM 调用与启动时**都会跑，它抛一次整个服务就起不来。
  {
    const config = require('../server/config')
    const SETTINGS = path.join(TMP, 'settings.json')
    const PRESET_DEFAULT = require('../server/config').PRESETS[0]

    const CASES = [
      ['空文件', ''],
      ['半截 JSON', '{"baseUrl":"https://x/v1","model":'],
      ['非法 JSON', 'not json at all'],
      ['字面量 null', 'null'],          // ← 曾经直接抛 Cannot read properties of null
      ['数组', '[1,2,3]'],
      ['字符串', '"hello"'],
      ['数字', '123'],
      ['空对象', '{}'],
    ]
    for (const [name, content] of CASES) {
      fs.writeFileSync(SETTINGS, content)
      let s = null
      let err = ''
      try { s = config.loadSettings() } catch (e) { err = e.message }
      check(!err, `[7] 设置文件「${name}」不抛错`, err)
      if (s) {
        check(typeof s.baseUrl === 'string' && s.baseUrl.length > 0, `[7] 设置文件「${name}」baseUrl 是字符串`, typeof s.baseUrl)
        check(typeof s.model === 'string' && s.model.length > 0, `[7] 设置文件「${name}」model 是字符串`, typeof s.model)
      }
    }

    // 类型错误：对象/数组/数字被写进字符串字段时，必须退回默认值而不是原样发给服务商
    fs.writeFileSync(SETTINGS, JSON.stringify({
      baseUrl: 123, model: {}, apiKey: [], presetId: [], theme: {}, temperature: 'hot', maxTokens: 'many',
    }))
    const bad = config.loadSettings()
    check(typeof bad.baseUrl === 'string' && /^https?:\/\//.test(bad.baseUrl), '[7] 数值 baseUrl 被纠正', String(bad.baseUrl))
    check(typeof bad.model === 'string' && bad.model !== '[object Object]', '[7] 对象 model 被纠正', String(bad.model))
    check(typeof bad.apiKey === 'string', '[7] 数组 apiKey 被纠正为字符串', typeof bad.apiKey)
    check(typeof bad.presetId === 'string', '[7] 数组 presetId 被纠正为字符串', typeof bad.presetId)
    check(bad.theme === 'dark' || bad.theme === 'light', '[7] 对象 theme 被纠正', String(bad.theme))
    check(Number.isFinite(bad.temperature) && bad.temperature >= 0 && bad.temperature <= 2, '[7] 非数值 temperature 被纠正', String(bad.temperature))
    check(Number.isFinite(bad.maxTokens), '[7] 非数值 maxTokens 被纠正', String(bad.maxTokens))

    // 越界数值仍要钳制（老规矩，别被这次改动破坏）
    fs.writeFileSync(SETTINGS, JSON.stringify({ temperature: 999, maxTokens: 1e99, contextWindow: 1 }))
    const clamped = config.loadSettings()
    check(clamped.temperature === 2, '[7] 越界 temperature 钳到 2', String(clamped.temperature))
    check(clamped.maxTokens === 65536, '[7] 越界 maxTokens 钳到 65536', String(clamped.maxTokens))
    check(clamped.contextWindow === 4096, '[7] 越界 contextWindow 钳到 4096', String(clamped.contextWindow))

    // 正常值必须原样保留（别把用户的配置洗掉了）
    fs.writeFileSync(SETTINGS, JSON.stringify({
      baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', apiKey: 'sk-abcdef123456',
      presetId: 'moonshot', theme: 'light', temperature: 1.2, maxTokens: 16384, contextWindow: 65536,
    }))
    const keep = config.loadSettings()
    check(keep.baseUrl === 'https://api.moonshot.cn/v1', '[7] 正常 baseUrl 保留', keep.baseUrl)
    check(keep.model === 'moonshot-v1-32k', '[7] 正常 model 保留', keep.model)
    check(keep.apiKey === 'sk-abcdef123456', '[7] 正常 apiKey 保留')
    check(keep.theme === 'light', '[7] 正常 theme 保留', keep.theme)
    check(keep.temperature === 1.2, '[7] 正常 temperature 保留', String(keep.temperature))
    check(keep.maxTokens === 16384, '[7] 正常 maxTokens 保留', String(keep.maxTokens))

    // 脱敏输出不能泄露 key 全文
    const pub = config.publicSettings()
    check(!pub.keyMask.includes('cdef'), '[7] keyMask 不泄露中段', pub.keyMask)
    check(pub.hasKey === true, '[7] hasKey 正确', String(pub.hasKey))

    // 写盘必须是原子写：不留 .tmp 残留，且落盘内容可解析
    config.saveSettings({ temperature: 0.5 })
    check(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).temperature === 0.5, '[7] saveSettings 落盘正确')
    check(!fs.existsSync(SETTINGS + '.tmp'), '[7] 原子写无 .tmp 残留')

    // 「测试连接」必须**不写盘**。
    // 早期实现只能读已保存的配置，前端不得不在测试前先 saveSettings ——
    // 于是测完直接关掉弹窗，改动其实已经生效了，用户却以为「没点保存＝没改」。
    // 现在允许把表单值作为 override 传进来，落盘必须保持原样。
    {
      const llm = require('../server/agent/llm')
      config.saveSettings({
        baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-original',
      })
      const before = config.loadSettings()
      const r = await llm.testConnection({
        baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-override', model: 'override-model',
      })
      check(r && r.ok === false, '[7] 指向不可达地址时返回失败而不是抛错', JSON.stringify(r).slice(0, 80))
      const after = config.loadSettings()
      check(after.baseUrl === before.baseUrl, '[7] 测试连接不改 baseUrl', `${before.baseUrl} → ${after.baseUrl}`)
      check(after.model === before.model, '[7] 测试连接不改 model', `${before.model} → ${after.model}`)
      check(after.apiKey === 'sk-original', '[7] 测试连接不改 apiKey（override 不落盘）',
        after.apiKey === 'sk-override' ? '被 override 覆盖了！' : '')
    }
  }

  // ── [8] listSessions 的 id 必须能「点一下就加载回来」──────
  // 早期用文件内容里的 `id` 返回。若文件被手工改过、id 缺失或类型不对，
  // 列表里点一下会加载不到（或加载到别的项目）——用户视角是「点了没反应」。
  // 现在以**文件名**为准：文件就是按 sessionFile(id) 命名的，只有它能保证往返一致。
  {
    const SESS = path.join(TMP, 'sessions')
    fs.mkdirSync(SESS, { recursive: true })

    const write = (name, obj) => fs.writeFileSync(path.join(SESS, name), JSON.stringify(obj), 'utf8')

    write('sess_good.json', { id: 'sess_good', title: '正常', updatedAt: 1000, brief: 'b', outputs: { analysis: 'x' } })
    write('sess_noid.json', { title: '缺 id', updatedAt: 2000, brief: 'b', outputs: {} })
    write('sess_wrongid.json', { id: '完全不一样的 id', title: 'id 不符', updatedAt: 3000, brief: 'b', outputs: { a: 1 } })
    write('sess_badtype.json', { id: 12345, title: 'id 类型错', updatedAt: 4000, brief: 'b', outputs: '不是对象' })
    write('sess_notobj.json', '"就是一个字符串"')
    write('sess_null.json', 'null')
    fs.writeFileSync(path.join(SESS, 'sess_broken.json'), '{ 半截', 'utf8')

    const list = memory.listSessions()
    const byId = Object.fromEntries(list.map((x) => [x.id, x]))
    check(list.length >= 4, '[8] 坏文件不影响其余项目被列出', `列出 ${list.length} 个`)
    check(!byId['12345'], '[8] 不用文件内容里的数字 id')
    check(!byId['完全不一样的 id'], '[8] 不用文件内容里不一致的 id')

    for (const f of ['sess_good', 'sess_noid', 'sess_wrongid', 'sess_badtype']) {
      const item = byId[f]
      check(!!item, `[8] 「${f}」以文件名作为 id 被列出`)
      if (item) {
        // 关键断言：拿列表里的 id 必须能加载回同一个文件
        const back = memory.loadSession(item.id)
        check(!!back, `[8] 列表 id「${f}」可加载回来`)
        check(back && back.id === f, `[8] 加载后 id 以文件名「${f}」为准`, back && String(back.id))
      }
    }
    check(byId['sess_badtype'] && byId['sess_badtype'].hasOutput === false,
      '[8] outputs 类型错误时不误判为「有产出」',
      String(byId['sess_badtype'] && byId['sess_badtype'].hasOutput))
    check(byId['sess_noid'] && byId['sess_noid'].title === '缺 id', '[8] 缺 id 的文件仍能列出标题')
    check(!list.some((x) => x.id === 'sess_broken'), '[8] 半截 JSON 被跳过而不是抛错')
    check(!list.some((x) => x.id === 'sess_notobj' || x.id === 'sess_null'), '[8] 非对象内容被跳过')
    // 排序契约：整体按 updatedAt 降序（不能假设自己造的这几条排最前 ——
    // 前面几节在同一目录里创建过真实时间戳的会话）
    const sortedOk = list.every((x, i) => i === 0 || list[i - 1].updatedAt >= x.updatedAt)
    check(sortedOk, '[8] 按 updatedAt 降序', list.map((x) => `${x.id}:${x.updatedAt}`).join(' '))
  }

  // ── [10] session id 必须严格拒绝，不能删字符后映射 ──────
  // 旧实现把非法字符直接删掉：`../sess_good` 会变成 `sess_good`，于是不同字符串
  // 会读写同一项目。更隐蔽的是文件内容里的 id 若被手改，load 后再 save 会把
  // 当前项目写进另一个文件。身份必须唯一收口到文件名。
  {
    const goodPath = path.join(SESSIONS, 'sess_good.json')
    check(memory.loadSession('../sess_good') === null, '[10] 非法别名不能读取合法会话')
    check(memory.loadSession('sess.good') === null, '[10] 含点号的 id 被拒绝')
    check(memory.loadSession('') === null, '[10] 空 id 被拒绝')

    memory.deleteSession('../sess_good')
    check(fs.existsSync(goodPath), '[10] 非法别名不能删除合法会话')

    const wrong = memory.loadSession('sess_wrongid')
    check(wrong && wrong.id === 'sess_wrongid', '[10] 内容 id 被文件名校正', wrong && String(wrong.id))
    if (wrong) {
      wrong.title = '仍保存到原文件'
      memory.saveSession(wrong)
      const disk = JSON.parse(fs.readFileSync(path.join(SESSIONS, 'sess_wrongid.json'), 'utf8'))
      check(disk.id === 'sess_wrongid' && disk.title === '仍保存到原文件',
        '[10] 校正后的会话保存回原文件', JSON.stringify({ id: disk.id, title: disk.title }))
      check(!fs.existsSync(path.join(SESSIONS, 'id.json')), '[10] 未按脏内容 id 新建旁路文件')
    }

    let threw = false
    try { memory.saveSession({ id: '../sess_good' }) } catch { threw = true }
    check(threw, '[10] saveSession 拒绝非法 id')

    fs.writeFileSync(path.join(SESSIONS, 'sess.bad.json'), '{}', 'utf8')
    check(!memory.listSessions().some((x) => x.id === 'sess.bad'), '[10] 列表不暴露无法往返的非法文件名')
  }

  // ── [9] testConnection 必须吞掉 loadSettings 的异常 ────
  // `POST /api/settings/test` 是 async 路由。Express 4 **不捕获 async handler 的异常**，
  // 它会变成未处理的 rejection，而 Node 22 默认把未处理 rejection 当致命错误 → 结束进程。
  // 用户视角：点一下「测试连接」，整个后端就没了。
  //
  // 触发条件很现实：loadSettings() 里会调 ensureDataDir()（mkdirSync），
  // 数据目录不可写时就抛 —— 而它原本在 try 之外。
  // 这里用独立子进程构造「DATA_DIR 指向一个文件下面的路径」的真实场景
  // （config.js 在 require 时读 env，所以必须换进程）。
  {
    const { execFileSync } = require('child_process')
    const blocker = path.join(TMP, 'blocker-file')
    fs.writeFileSync(blocker, 'x')
    const serverRoot = path.join(__dirname, '..', 'server')

    const script = `
      process.env.AI_FILM_DATA_DIR = ${JSON.stringify(path.join(blocker, 'sub'))};
      const config = require(${JSON.stringify(path.join(serverRoot, 'config'))});
      let loadThrew = false, loadMsg = '';
      try { config.loadSettings() } catch (e) { loadThrew = true; loadMsg = String(e.message).slice(0, 60) }
      const llm = require(${JSON.stringify(path.join(serverRoot, 'agent', 'llm'))});
      llm.testConnection().then((r) => {
        process.stdout.write(JSON.stringify({ loadThrew, loadMsg, rejected: false, ok: r && r.ok, msg: String((r && r.message) || '').slice(0, 60) }));
      }).catch((e) => {
        process.stdout.write(JSON.stringify({ loadThrew, loadMsg, rejected: true, msg: String(e.message).slice(0, 60) }));
      });
    `
    let parsed = null
    let runErr = ''
    try {
      const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 })
      parsed = JSON.parse(out.trim().split('\n').pop())
    } catch (e) {
      runErr = String(e.message).slice(0, 120)
    }
    check(!runErr, '[9] 子进程可运行', runErr)
    if (parsed) {
      check(parsed.loadThrew === true, '[9] 场景成立：loadSettings 确实会抛', JSON.stringify(parsed))
      check(parsed.rejected !== true, '[9] testConnection 吞掉异常而非 reject（否则会杀掉服务进程）', JSON.stringify(parsed))
      check(parsed.ok === false, '[9] 返回结构化失败结果而不是抛错', JSON.stringify(parsed))
    }
  }

  console.log(`\n会话数据健壮性：${pass} 项通过，${fails.length} 项失败`)
  if (fails.length) {
    console.log('\n失败明细：')
    fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
    process.exit(1)
  }
  console.log('全部通过 ✅')
})()
