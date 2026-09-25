const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-staged-'))
process.env.AI_FILM_DATA_DIR = data
process.env.AIFD_TEST_MODE = '1'
process.env.LLM_API_KEY = ''
const { createApp } = require('../server/app')

async function main() {
  const server = createApp().listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (body) => fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  try {
    const invalid = await request({ message: '测试', targetStage: 0 })
    assert.equal(invalid.status, 400)
    const first = await request({ message: '制作一部30秒短片：一个人在宇宙尽头寻找失去的记忆。', targetStage: 3 })
    assert.equal(first.status, 200)
    const stream = await first.text()
    const id = JSON.parse(stream.match(/event: session\ndata: ([^\n]+)/)[1]).id
    assert.equal((stream.match(/event: stage_start/g) || []).length, 3)
    let s = await (await fetch(base + '/api/sessions/' + id)).json()
    assert(s.outputs.analysis && s.outputs.references && s.outputs.structure)
    assert(!s.outputs.cinematography)
    assert(s.stageReviews.story_structure)
    assert(s.pendingSkills.includes('cinematography'))
    const partial = await (await fetch(base + '/api/sessions/' + id + '/export')).text()
    assert(partial.includes('阶段草稿'))

    const second = await request({ sessionId: id, message: '继续制作', targetStage: 6, continueOnly: true })
    assert.equal(second.status, 200)
    const nextStream = await second.text()
    assert.equal((nextStream.match(/event: stage_start/g) || []).length, 3)
    s = await (await fetch(base + '/api/sessions/' + id)).json()
    assert(s.outputs.cinematography && s.outputs.visualBible && s.outputs.screenplay)
    assert(!s.outputs.storyboard)
    assert(s.stageReviews.screenplay)
    assert.equal(s.pipeline.length, 3)
    const third = await request({ sessionId: id, message: '继续制作', targetStage: 11, continueOnly: true })
    assert.equal(third.status, 200)
    const finalStream = await third.text()
    s = await (await fetch(base + '/api/sessions/' + id)).json()
    const started = (finalStream.match(/event: stage_start/g) || []).length
    assert.equal(started, 5, '演示流程应跑完后五阶段：' + JSON.stringify(s.stageReviews.storyboard))
    assert(s.outputs.editing && s.stageReviews.editing)
    assert(s.promptData?.imageAssets?.length, '应交付结构化资产图提示词')
    assert(s.promptData?.keyframes?.length, '应交付逐镜关键帧提示词')
    assert(!s.pendingSkills.some(id => id !== 'quality_control'))
    console.log('PASS staged workflow: strict endpoint, resume, persisted reviews, partial export')
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(data, { recursive: true, force: true })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
