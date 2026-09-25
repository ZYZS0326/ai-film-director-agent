const assert = require('assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-editor-'))
process.env.AI_FILM_DATA_DIR = tmp
const memory = require('../server/agent/memory')
const llm = require('../server/agent/llm')
const editor = require('../server/agent/shot-editor')
const { createApp } = require('../server/app')
const server = createApp().listen(0, '127.0.0.1')
let count = 0
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name) }
;(async () => {
  await new Promise(r => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const s = memory.createSession('编辑测试')
  s.brief = '日出'; s.outputs = { storyboard: '原分镜', prompts: '原提示词' }
  s.shots = [{ no: 1, start: 0, end: 5, duration: 5, action: '旧动作', promptZh: '旧提示词' }, { no: 2, start: 5, end: 10, duration: 5, action: '第二镜' }]
  s.promptData = { shots: [{ no: 1, start: 0, end: 5, promptZh: '旧提示词' }, { no: 2, start: 5, end: 10, promptZh: '第二镜提示词' }], keyframes: [{ shotNo: 1, phase: 'master', assetIds: ['CHAR_01'], promptZh: '旧关键帧' }] }
  memory.saveSession(s)
  let current = s
  const req = async body => {
    const r = await fetch(`${base}/api/sessions/${s.id}/editor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: current.editVersion, ...body }) })
    return { status: r.status, data: await r.json() }
  }
  const preview = await req({ action: 'preview', no: 1, patch: { action: '抬头' } })
  check('预览返回差异', () => assert.equal(preview.data.changes[0].after, '抬头'))
  check('预览不保存', () => assert.equal(memory.loadSession(s.id).shots[0].action, '旧动作'))
  let r = await req({ action: 'apply', no: 1, patch: { action: '抬头', promptZh: '抬头提示词' } })
  check('保存成功', () => assert.equal(r.status, 200)); current = r.data
  check('其他镜头不变', () => assert.deepEqual(current.shots[1], s.shots[1]))
  check('下游标记待复核', () => assert.ok(current.pendingSkills.includes('prompt_engineering')))
  check('正文与结构化提示词同步', () => assert.ok(current.outputs.prompts.includes('抬头提示词') && !current.outputs.prompts.includes('旧提示词')))
  check('版本已保存', () => assert.equal(current.versions.length, 1))
  r = await req({ action: 'apply', no: 1, version: s.editVersion, patch: { action: '过期修改' } })
  check('旧版本拒绝覆盖', () => assert.equal(r.status, 409))
  r = await req({ action: 'lock', no: 2, locked: true }); current = r.data
  r = await req({ action: 'apply', no: 2, patch: { action: '改锁定镜头' } })
  check('后端保护锁定镜头', () => assert.equal(r.status, 409))
  r = await req({ action: 'apply', no: 1, patch: { duration: 4 } })
  check('不移动后续锁定镜头', () => assert.equal(r.status, 409))
  const p = require('../server/agent/planner'), oldPlan = p.plan
  p.plan = async () => ({ intent: 'revision', constraints: {}, skills: ['storyboard'] })
  await assert.rejects(() => require('../server/agent/orchestrator').run(memory.loadSession(s.id), '修改分镜', () => {}), /锁定镜头/)
  p.plan = oldPlan; count++; console.log('PASS 整案生成不会覆盖锁定镜头')
  r = await req({ action: 'lock', no: 2, locked: false }); current = r.data
  r = await req({ action: 'apply', no: 1, patch: { duration: 4 } }); current = r.data
  check('时长变更顺延后镜', () => assert.equal(current.shots[1].start, 4))
  check('提示词时间码同步', () => assert.equal(current.promptData.shots[1].start, 4))
  check('修改分镜后旧关键帧失效', () => assert.deepEqual(current.promptData.keyframes, []))
  const first = current.versions[0].id
  r = await req({ action: 'restore', versionId: first }); current = r.data
  check('恢复分镜', () => assert.equal(current.shots[0].action, '旧动作'))
  check('恢复正文', () => assert.equal(current.outputs.storyboard, '原分镜'))
  check('恢复前仍有备份', () => assert.equal(current.versions.at(-1).label, '恢复版本前（可撤销恢复）'))
  for (const patch of [{ duration: 0 }, { duration: 9 }, { duration: '5' }, { locked: true }, { no: 4 }, { action: {} }]) {
    r = await req({ action: 'apply', no: 1, patch })
    check('拒绝无效字段 ' + JSON.stringify(patch), () => assert.equal(r.status, 400))
  }
  r = await req({ action: 'suggest', no: 1, instruction: '抬头' })
  check('无模型不伪装重做', () => assert.equal(r.status, 422))
  const oldConfigured = llm.isConfigured, oldChat = llm.chat
  let release, started
  const start = new Promise(r => started = r)
  llm.isConfigured = () => true
  llm.chat = async () => { throw new Error('Oversized context must not call the model') }
  await assert.rejects(() => editor.suggest({ shots: [{ no: 1, action: 'x'.repeat(28001) }] }, 1, '改动作'), err => err.status === 422)
  count++; console.log('PASS 过长上下文在调用模型前拒绝')
  llm.chat = () => { started(); return new Promise(r => release = r) }
  const pending = req({ action: 'suggest', no: 1, instruction: '抬头' })
  await start
  r = await req({ action: 'lock', no: 1, locked: true })
  check('重做期间拒绝并发写入', () => assert.equal(r.status, 409))
  const param = await fetch(`${base}/api/sessions/${s.id}/constraints`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"duration":60}' })
  check('重做期间参数不可覆盖', () => assert.equal(param.status, 409))
  release('{"action":"候选动作"}')
  r = await pending
  check('模型仅生成候选', () => assert.equal(r.data.shot.action, '候选动作'))
  check('模型候选尚未覆盖原稿', () => assert.equal(memory.loadSession(s.id).shots[0].action, '旧动作'))
  llm.chat = async () => '{"no":99}'
  r = await req({ action: 'suggest', no: 1, instruction: '改动作' })
  check('拒绝模型修改编号', () => assert.equal(r.status, 400))
  llm.chat = oldChat; llm.isConfigured = oldConfigured
  const bounded = memory.loadSession(s.id)
  for (let i = 0; i < 25; i++) editor.checkpoint(bounded, 'test')
  check('最多保存20次历史', () => assert.equal(bounded.versions.length, 20))
  const gapped = { outputs: { storyboard: '重要的转场策略', prompts: '保留原始制作说明' }, shots: [{ no: 1, start: 2, end: 7, duration: 5, locked: true }, { no: 2, start: 9, end: 14, duration: 5 }, { no: 3, start: 16, end: 21, duration: 5 }], pendingSkills: [] }
  const lockedBefore = JSON.stringify(gapped.shots[0])
  editor.apply(gapped, 2, { duration: 4 })
  check('非零起点锁定镜头逐字段不变', () => assert.equal(JSON.stringify(gapped.shots[0]), lockedBefore))
  check('保留时间线空隙', () => assert.deepEqual(gapped.shots.map(x => [x.start, x.end]), [[2, 7], [9, 13], [15, 20]]))
  check('原始分镜文字保留', () => assert.equal(gapped.editorNotes.storyboard, '重要的转场策略'))
  check('原始提示词说明保留', () => assert.equal(gapped.editorNotes.prompts, '保留原始制作说明'))
  editor.apply(gapped, 2, { action: '再次编辑' })
  check('重复编辑不覆盖原始说明', () => assert.equal(gapped.editorNotes.storyboard, '重要的转场策略'))
  const broken = { outputs: {}, shots: [{ no: 1, start: null, end: 5, duration: 5 }] }
  const brokenBefore = JSON.stringify(broken)
  check('无效时间码拒绝改时长', () => assert.throws(() => editor.apply(broken, 1, { duration: 4 }), /原时间码无效/))
  check('拒绝操作不产生副作用', () => assert.equal(JSON.stringify(broken), brokenBefore))
  llm.isConfigured = () => true
  for (const text of ['null', '[]', 'true', '12', '"hello"']) {
    llm.chat = async () => text
    await assert.rejects(() => editor.suggest({ shots: [{ no: 1 }] }, 1, '改动作'), err => err.status === 422)
    count++; console.log('PASS 模型异常类型受控拒绝：' + text)
  }
  llm.chat = oldChat; llm.isConfigured = oldConfigured
  console.log(`镜头编辑 API：${count} 项通过`)
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => {
  server.closeAllConnections(); server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})
