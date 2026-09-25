const assert = require('node:assert/strict')
const { productionChecks } = require('../server/agent/production-checks')
const { revisionSkills } = require('../server/agent/planner')
const { expandAffected, PRIOR_DEPS, affectedByConstraints } = require('../server/agent/dependencies')
const { SKILLS } = require('../server/skills')
const { buildExportMarkdown } = require('../server/app')
const { publicSession } = require('../server/agent/orchestrator')
let count = 0
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name) }
const fixture = () => ({ constraints: { duration: 10 }, outputs: { storyboard: '分镜', prompts: '提示词' },
  shots: [{ no: 1, start: 0, end: 5, duration: 5 }, { no: 2, start: 5, end: 10, duration: 5 }],
  promptData: { shots: [{ no: 1 }, { no: 2 }] }, pendingSkills: [] })
const codes = s => productionChecks(s).issues.map(i => i.code)
check('合法时间线通过', () => assert.equal(productionChecks(fixture()).ok, true))
for (const [name, mutate, code] of [
  ['总时长不符', s => s.constraints.duration = 300, 'total_duration'],
  ['镜头重复编号', s => s.shots[1].no = 1, 'numbering'],
  ['时间线重叠', s => s.shots[1].start = 4, 'timeline'],
  ['时间线空洞', s => s.shots[1].start = 6, 'timeline'],
  ['标注与起止矛盾', s => s.shots[1].duration = 4, 'duration_mismatch'],
  ['无效时长', s => s.shots[0].duration = NaN, 'duration'],
  ['超过单镜上限', s => s.shots[0].duration = 9, 'shot_limit'],
  ['无效时间码', s => s.shots[0].start = null, 'timecode'],
  ['缺失分镜', s => s.shots = [], 'missing_shots'],
  ['脏分镜不崩溃', s => s.shots[0] = null, 'numbering'],
  ['提示词漏镜', s => s.promptData.shots.pop(), 'prompt_mapping'],
  ['提示词重复', s => s.promptData.shots.push({ no: 1 }), 'prompt_mapping'],
  ['提示词多出镜头', s => s.promptData.shots.push({ no: 3 }), 'extra_prompt'],
  ['中断后旧章节待更新', s => s.pendingSkills = ['screenplay'], 'pending'],
]) check(name, () => { const s = fixture(); mutate(s); assert.ok(codes(s).includes(code)) })
check('浮点误差容忍', () => { const s = fixture(); s.shots[1].duration += 0.00001; assert.equal(productionChecks(s).ok, true) })
check('只改声音保留剧本分镜', () => assert.deepEqual(revisionSkills('调整声音和音乐'), ['sound_design', 'editing', 'quality_control']))
check('整体风格修改更新全片', () => assert.equal(revisionSkills('不要赛博朋克，改成东方神话').length, 12))
check('时长改变影响剧本和分镜', () => assert.ok(['screenplay', 'storyboard', 'continuity', 'prompt_engineering'].every(id => revisionSkills('缩短到30秒').includes(id))))
check('平台改变更新提示词', () => assert.ok(revisionSkills('改用可灵').includes('prompt_engineering')))
check('参数面板改变时长使下游失效', () => assert.ok(affectedByConstraints({ duration: 300 }, { duration: 30 }).includes('storyboard')))
check('未改变参数不触发重跑', () => assert.deepEqual(affectedByConstraints({ duration: 30 }, { duration: 30 }), []))
for (const skill of SKILLS) check('依赖闭包完整：' + skill.id, () => {
  const affected = expandAffected([skill.id])
  const keys = SKILLS.filter(s => affected.includes(s.id)).map(s => s.outputKey)
  for (const child of SKILLS) if ((PRIOR_DEPS[child.id] || []).some(k => keys.includes(k))) assert.ok(affected.includes(child.id))
})
check('API 始终基于当前约束重算', () => { const s = fixture(); s.constraints.duration = 60; assert.equal(publicSession(s).productionChecks.ok, false) })
check('导出携带问题且不丢正文', () => { const s = fixture(); s.constraints.duration = 300; const md = buildExportMarkdown(s); assert.ok(md.includes('目标 300 秒')); assert.ok(md.includes('分镜')); })
for (const duration of [5, 30, 31, 48, 300]) check(`演示分镜使用实际秒数：${duration}`, () => {
  const { getTool, extractJSONBlock } = require('../server/tools')
  const knowledge = getTool('knowledge.search').run({ brief: '废墟日出', duration, aspect: '16:9', level: 3 })
  const output = require('../server/skills/storyboard').demo({ knowledge, constraints: { duration } })
  const parsed = extractJSONBlock(output, null, true)
  const result = productionChecks({ constraints: { duration }, shots: parsed.shots })
  assert.equal(result.actualDuration, Math.min(duration, 48))
  assert.equal(result.ok, duration <= 48)
  if (duration > 48) assert.deepEqual(result.issues.map(i => i.code), ['total_duration'])
})
console.log(`制作校验与依赖联动：${count} 项通过`)
