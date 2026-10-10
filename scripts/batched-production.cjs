const assert = require('node:assert/strict')
const llm = require('../server/agent/llm')
const { generate, validatePlan } = require('../server/agent/batched-production')
const { extractJSONBlock } = require('../server/tools')
const original = llm.chat
let calls = [], failAt = 0, duplicates = false
llm.chat = async (messages, opts) => {
  const text = messages.at(-1).content; calls.push(text)
  if (text.includes('片段概要')) return JSON.stringify({ events: [text.includes('最终归还白纸鹤') ? '最终归还白纸鹤，结束故事' : '发现纸鹤，推进故事'] })
  if (text.includes('紧凑剧情段落计划')) return JSON.stringify({ segments: Array.from({ length: 5 }, (_, i) => ({ sceneNo: i + 1, start: i * 60, end: (i + 1) * 60, beat: i === 4 ? '归还物品，结束故事' : '发现线索，推进故事' })) })
  if (text.includes('本段：')) {
    const s = JSON.parse(text.match(/本段：(\{[^\n]+\})\n/)[1])
    return JSON.stringify({ shots: Array.from({ length: 5 }, (_, i) => ({ no: i + 1, sceneNo: s.sceneNo, start: s.start + i * 6, end: s.start + (i + 1) * 6, duration: 6, beat: s.beat })) })
  }
  if (text.includes('本批：')) {
    const rows = JSON.parse(text.match(/本批：(\[[^\n]+\])\n/)[1])
    if (failAt && rows[0].no >= failAt) throw Object.assign(new Error('mock timeout'), { category: 'TIMEOUT' })
    const shots = rows.map(s => ({ ...s, shotSize: '中景', angle: '平视', camera: 'ARRI', lens: '50mm', movement: '固定', composition: '三分线', subject: '角色A', action: '完整动作'.repeat(300), expression: '凝视', environment: '房间', lighting: '窗光', color: '灰', material: '木', sound: '呼吸', emotion: '紧张', transition: '硬切' }))
    if (duplicates && rows.length > 1) shots[1].no = shots[0].no
    return JSON.stringify({ shots })
  }
  if (text.includes('共用资产目录')) return JSON.stringify({ characterLock: { zh: '临时锁', en: 'temporary' }, sceneAssets: [], imageAssets: [{ assetId: 'CHAR_A', type: 'character', sheet: 'character_reference', aspectRatio: '3:4', lockedFacts: ['左腕黑表'] }] })
  if (text.includes('本批资产图提示词：')) {
    const rows = JSON.parse(text.match(/本批资产图提示词：(\[[^\n]+\])\n/)[1])
    assert.ok(text.includes('左腕黑表'))
    return JSON.stringify({ imageAssets: rows.map(a => ({ ...a, promptZh: '人物左腕黑表设定图', promptEn: 'black watch on left wrist', allowedChange: '机位', negative: '换脸' })) })
  }
  if (text.includes('本批镜头生成提示词和静态关键帧：')) {
    const rows = JSON.parse(text.match(/本批镜头生成提示词和静态关键帧：(\[[^\n]+\])\n/)[1])
    return JSON.stringify({ shots: rows.map(s => ({ no: s.no, start: s.start, end: s.end, promptZh: '完整中文'.repeat(150), promptEn: 'full english '.repeat(100), negative: '换脸', platform: 'seedance' })), keyframes: rows.map(s => ({ shotNo: s.no, phase: 'master', assetIds: ['CHAR_A'], aspectRatio: '16:9', promptZh: '静态帧', promptEn: 'still frame' })) })
  }
  throw new Error('unexpected task')
}
const ctx = { constraints: { duration: 300, aspect: '16:9' }, knowledge: { durationMode: { duration: 300 } } }
const params = session => ({ skill: { id: 'storyboard' }, messages: [{ role: 'user', content: '完整5分钟故事' }], ctx, session, checkpoint: () => {} })
async function main() {
  assert.throws(() => validatePlan([{ no: 1, start: 0, duration: 6, beat: '动作' }], 300))
  assert.throws(() => validatePlan([{ no: 1, end: 6, duration: 6, beat: '动作' }], 300))
  let session = { shots: [{ no: 99 }] }
  failAt = 7
  await assert.rejects(generate(params(session)), /mock timeout/)
  assert.equal(Object.keys(session.batchJobs.storyboard.completed).length, 2)
  assert.deepEqual(session.shots, [{ no: 99 }], 'failed generation does not publish partial shots')
  session = JSON.parse(JSON.stringify(session)); calls = []; failAt = 0
  const out = await generate(params(session)), data = extractJSONBlock(out, null, true)
  assert.equal(data.shots.length, 50); assert.equal(data.shots.at(-1).end, 300)
  assert.deepEqual(data.shots.map(s => s.no), Array.from({ length: 50 }, (_, i) => i + 1))
  assert.ok(out.length > 32000); assert.ok(!calls.some(t => /本批：\[\{"no":1,/.test(t)), 'completed batch resumed, not regenerated')
  assert.ok(!data.shots.some(s => s.promptEn))
  console.log('PASS 50 shots/300s, >32k output, resume after interruption, no partial publishing')
  const before = calls.length
  await generate(params(session)); assert.equal(calls.length, before)
  console.log('PASS completed batches reused with identical inputs')
  const compactSession = {}
  const stable = { brief: '相同的完整故事' }
  await generate({ ...params(compactSession), inputIdentity: stable })
  const compactBefore = calls.length
  await generate({ ...params(compactSession), inputIdentity: stable, messages: [{ role: 'user', content: '同一输入的精简上下文' }] })
  assert.equal(calls.length, compactBefore)
  console.log('PASS context compaction retains accepted batches')
  const longScriptSession = { outputs: { screenplay: '前期剧情'.repeat(1800) + '最终归还白纸鹤' } }
  await generate(params(longScriptSession))
  assert.ok(longScriptSession.batchJobs.storyboard.storyOutline.flat().some(e => e.includes('最终归还白纸鹤')))
  console.log('PASS full long screenplay read through ending, not first-4k excerpt')
  const dupeSession = {}; duplicates = true
  const deduped = extractJSONBlock(await generate(params(dupeSession)), null, true)
  assert.equal(new Set(deduped.shots.map(s => s.no)).size, 50); duplicates = false
  console.log('PASS bad/duplicate batches shrink and validate, never enter final result')
  const partialSplit = {}; duplicates = true; failAt = 3
  await assert.rejects(generate(params(partialSplit)), /mock timeout/)
  duplicates = false; failAt = 0; calls = []
  await generate(params(partialSplit))
  assert.ok(!calls.some(t => /本批：\[\{"no":[12],/.test(t)))
  console.log('PASS interrupted adaptive split resumes accepted children without parent regeneration')
  session.shots = data.shots
  session.continuityData = { lockZh: '角色A左腕黑表', lockEn: 'black watch on left wrist', rules: ['表不换手'] }
  const prompts = extractJSONBlock(await generate({ ...params(session), skill: { id: 'prompt_engineering' } }), null, true)
  assert.equal(prompts.shots.length, 50); assert.equal(prompts.keyframes.length, 50)
  assert.equal(prompts.characterLock.zh, session.continuityData.lockZh)
  assert.ok(prompts.keyframes.every(k => k.assetIds.includes('CHAR_A')))
  console.log('PASS all 50 video prompts/master frames, single asset registry, continuity lock preserved')
  const stopped = {}
  await assert.rejects(generate({ ...params(stopped), isAborted: () => true }), e => e.category === 'STOPPED')
  assert.equal(Object.keys(stopped.batchJobs.storyboard.completed).length, 0)
  console.log('PASS stop respected before requests; no false completion')
  console.log('分批生产专项：全部通过')
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { llm.chat = original })
