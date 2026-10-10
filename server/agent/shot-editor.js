const { expandAffected } = require('./dependencies')
const { extractJSONBlock } = require('../tools')
const llm = require('./llm')
const FIELDS = ['action', 'subject', 'environment', 'duration', 'shotSize', 'angle', 'camera', 'lens', 'movement', 'composition', 'expression', 'lighting', 'color', 'material', 'sound', 'emotion', 'transition', 'promptZh', 'promptEn', 'negative']
const STATE = ['brief', 'title', 'constraints', 'outputs', 'shots', 'promptData', 'continuityData', 'promptValidation', 'reviewScores', 'stageReviews', 'pendingSkills', 'pipeline', 'skillHistory', 'memory', 'messages', 'generationMode', 'editorNotes']
const clone = x => JSON.parse(JSON.stringify(x))
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
function checkpoint(s, label) {
  const state = {}
  for (const k of STATE) if (s[k] !== undefined) state[k] = clone(s[k])
  s.versions = [...(s.versions || []), { id: require('crypto').randomUUID(), at: Date.now(), label, state }].slice(-20)
}
function checkVersion(s, version) {
  if (!Number.isInteger(version) || version !== (s.editVersion || 0)) fail('项目已更新，请刷新后重试，避免覆盖其他修改。', 409)
}
function patchOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('无效镜头修改')
  const patch = {}
  for (const key of Object.keys(raw)) {
    if (!FIELDS.includes(key)) fail('不允许修改字段：' + key)
    const value = raw[key]
    if (key === 'duration') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8) fail('单镜时长必须大于0且不超过8秒')
      patch[key] = Math.round(value * 1000) / 1000
      if (!patch[key]) fail('时长至少0.001秒')
    } else {
      if (typeof value !== 'string' || value.length > 12000) fail('镜头文本无效或超过12000字')
      patch[key] = value
    }
  }
  return patch
}
function proposal(s, no, raw) {
  const index = s.shots.findIndex(x => x.no === no)
  if (index < 0) fail('镜头不存在', 404)
  const before = s.shots[index]
  if (before.locked) fail('该镜头已锁定，请先解锁。', 409)
  const patch = patchOf(raw)
  if (patch.duration !== undefined && patch.duration !== before.duration && s.shots.some(x => ![x.start, x.end, x.duration].every(v => typeof v === 'number' && Number.isFinite(v)) || x.duration <= 0 || x.start < 0 || Math.abs(x.end - x.start - x.duration) > 0.05)) fail('原时间码无效，请先修正分镜后再修改时长。', 422)
  if (patch.duration !== undefined && patch.duration !== before.duration && s.shots.slice(index + 1).some(x => x.locked)) fail('修改时长会移动后续锁定镜头的时间码，请先解锁相关镜头。', 409)
  const changes = Object.entries(patch).filter(([key, value]) => value !== before[key]).map(([field, after]) => ({ field, before: before[field] ?? '', after }))
  if (!changes.length) fail('没有需要应用的变化')
  return { patch, changes, version: s.editVersion || 0, affected: ['连续性', '提示词', '声音', '剪辑', '审核'], shot: { ...before, ...patch } }
}
async function suggest(s, no, instruction) {
  const before = s.shots.find(x => x.no === no)
  if (!before) fail('镜头不存在', 404)
  if (before.locked) fail('该镜头已锁定', 409)
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000) fail('请输入1至2000字的修改要求')
  if (!llm.isConfigured()) fail('局部重做需要接入模型；演示模式下可直接编辑镜头。', 422)
  const context = JSON.stringify({ instruction, shot: before, constraints: s.constraints, continuity: s.continuityData, neighbors: s.shots.filter(x => Math.abs(x.no - no) === 1) })
  if (context.length > 28000) fail('镜头上下文过长，请使用手动编辑；原镜头未改变。', 422)
  const text = await llm.chat([
    { role: 'system', content: '你是分镜编辑。只返回JSON对象，包含需要修改的字段。不可改编号、时长、起止时间，不可改其他镜头。未被要求修改的人物和环境保持原样。允许字段：' + FIELDS.filter(k => k !== 'duration').join(',') },
    { role: 'user', content: context },
  ], { role: 'shot_editor', structured: true, desiredOutputTokens: 3000 })
  let patch = extractJSONBlock(text, null, true)
  if (!patch) { try { patch = JSON.parse(text) } catch { fail('模型未返回有效JSON，原镜头未改变。', 422) } }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('模型候选必须是字段对象，原镜头未改变。', 422)
  if (patch.duration !== undefined) fail('模型试图改变时长，已拒绝。原镜头未改变。', 422)
  return proposal(s, no, patch)
}
function apply(s, no, raw) {
  const result = proposal(s, no, raw)
  const index = s.shots.findIndex(x => x.no === no)
  const delta = result.shot.duration - s.shots[index].duration
  checkpoint(s, `修改镜头 ${no} 前`)
  s.shots = s.shots.map(x => x.no === no ? result.shot : x)
  if (result.changes.some(c => c.field === 'duration')) {
    const round = n => Math.round(n * 1000) / 1000
    s.shots = s.shots.map((x, i) => i < index ? x : i === index ? { ...x, end: round(x.end + delta) } : { ...x, start: round(x.start + delta), end: round(x.end + delta) })
  }
  // Preserve original prose once. It is archival context, not the current shot list.
  s.editorNotes = s.editorNotes || {}
  if (s.editorNotes.storyboard === undefined) s.editorNotes.storyboard = s.outputs.storyboard || ''
  if (s.editorNotes.prompts === undefined) s.editorNotes.prompts = s.outputs.prompts || ''
  s.outputs.storyboard = '## 当前分镜（已人工确认）\n\n```json\n' + JSON.stringify({ shots: s.shots }, null, 2) + '\n```'
  if (s.promptData?.shots) s.promptData.shots = s.promptData.shots.map(p => {
    const shot = s.shots.find(x => x.no === p.no)
    if (!shot) return p
    const next = { ...p, start: shot.start, end: shot.end }
    if (p.no === no) for (const key of ['promptZh', 'promptEn', 'negative']) if (result.patch[key] !== undefined) next[key] = result.patch[key]
    return next
  })
  // 静态关键帧继承旧分镜的姿态、构图与状态；人工改镜后不能继续冒充当前有效帧。
  if (s.promptData?.keyframes) s.promptData.keyframes = []
  if (s.promptData?.shots) s.outputs.prompts = '## 当前提示词（分镜修改后待复核）\n\n' + s.promptData.shots.map(p => `### Shot ${p.no}\n\n${p.promptZh || ''}\n\n${p.promptEn || ''}`).join('\n\n') + '\n\n```json\n' + JSON.stringify(s.promptData, null, 2) + '\n```'
  s.pendingSkills = [...new Set([...(s.pendingSkills || []), ...expandAffected(['storyboard']).filter(id => id !== 'storyboard')])]
  s.reviewScores = null
  s.stageReviews = s.stageReviews || {}
  for (const id of expandAffected(['storyboard'])) delete s.stageReviews[id]
  s.promptValidation = null
  return result
}
function restore(s, id) {
  const version = (s.versions || []).find(v => v.id === id)
  if (!version) fail('版本不存在或已超出最近20次记录', 404)
  const state = clone(version.state)
  checkpoint(s, '恢复版本前（可撤销恢复）')
  for (const key of STATE) { if (state[key] === undefined) delete s[key]; else s[key] = state[key] }
}
module.exports = { checkpoint, checkVersion, proposal, suggest, apply, restore }
