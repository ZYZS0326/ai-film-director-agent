const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-production-api-'))
process.env.AI_FILM_DATA_DIR = tmp
const memory = require('../server/agent/memory')
const { createApp } = require('../server/app')
const server = createApp().listen(0, '127.0.0.1')
;(async () => {
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const s = memory.createSession('制作校验 API 测试')
  s.constraints.duration = 10
  s.outputs = { storyboard: '原分镜内容' }
  s.shots = [{ no: 1, start: 0, end: 5, duration: 5 }, { no: 2, start: 5, end: 10, duration: 5 }]
  memory.saveSession(s)
  const response = await fetch(`${base}/api/sessions/${s.id}/constraints`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: 30 }),
  })
  assert.equal(response.status, 200)
  const updated = await response.json()
  assert.ok(updated.pendingSkills.includes('storyboard'))
  assert.ok(updated.pendingSkills.includes('prompt_engineering'))
  assert.ok(updated.productionChecks.issues.some(i => i.code === 'total_duration'))
  const loaded = await (await fetch(`${base}/api/sessions/${s.id}`)).json()
  assert.deepEqual(loaded.pendingSkills, updated.pendingSkills)
  assert.equal(loaded.outputs.storyboard, '原分镜内容')
  const md = await (await fetch(`${base}/api/sessions/${s.id}/export`)).text()
  assert.ok(md.includes('目标 30 秒'))
  assert.ok(md.includes('尚未完成更新'))
  console.log('制作校验 API：8 项通过（参数修改、持久化、旧内容保留、导出提示）')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => {
  server.closeAllConnections()
  server.close()
  // 仅删除本脚本 mkdtemp 创建的隔离目录。
  fs.rmSync(tmp, { recursive: true, force: true })
})
