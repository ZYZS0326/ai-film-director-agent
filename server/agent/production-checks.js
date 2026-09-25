/** 确定性制作校验，不以模型自评分代替时长/编号/时间线检查。 */
function productionChecks(session) {
  const issues = []
  const add = (code, message) => issues.push({ code, message })
  const shots = Array.isArray(session.shots) ? session.shots : []
  const target = Number(session.constraints?.duration) || 0
  const pending = Array.isArray(session.pendingSkills) ? session.pendingSkills : []
  if (pending.length) add('pending', `有 ${pending.length} 个环节尚未完成更新，当前方案可能混有旧内容。`)
  if (!shots.length) add('missing_shots', '尚无可校验的分镜，请先生成或重做分镜。')
  let total = 0
  let end = 0
  const ids = new Set()
  const finite = v => typeof v === 'number' && Number.isFinite(v)
  for (const [index, raw] of shots.entries()) {
    const s = raw && typeof raw === 'object' ? raw : {}
    const label = `第 ${index + 1} 镜`
    if (!Number.isInteger(s.no) || s.no !== index + 1 || ids.has(s.no)) {
      add('numbering', `${label}编号异常：应为 ${index + 1}，实际为 ${String(s.no)}。`)
    }
    ids.add(s.no)
    if (!finite(s.duration) || s.duration <= 0) add('duration', `${label}时长必须为正数。`)
    else {
      total += s.duration
      if (s.duration > 8) add('shot_limit', `${label}长达 ${s.duration} 秒，超过当前单镜 8 秒制作约束，请拆镜。`)
    }
    if (!finite(s.start) || !finite(s.end) || s.start < 0 || s.end <= s.start) {
      add('timecode', `${label}起止时间无效。`)
    } else {
      if (Math.abs(s.start - end) > 0.05) add('timeline', `${label}起点 ${s.start}s 与前镜终点 ${end}s 不连续。`)
      if (finite(s.duration) && Math.abs(s.end - s.start - s.duration) > 0.05) {
        add('duration_mismatch', `${label}起止时间与标注时长不一致。`)
      }
      end = s.end
    }
  }
  total = Math.round(total * 1000) / 1000
  if (shots.length && target && Math.abs(total - target) > 0.05) {
    add('total_duration', `目标 ${target} 秒，分镜合计 ${total} 秒，相差 ${Math.round(Math.abs(target - total) * 1000) / 1000} 秒。`)
  }
  if (session.outputs?.prompts && shots.length) {
    const prompts = Array.isArray(session.promptData?.shots) ? session.promptData.shots : []
    for (const s of shots) {
      if (!s || prompts.filter(p => p && p.no === s.no).length !== 1) {
        add('prompt_mapping', `镜头 ${s?.no ?? '?'} 未对应唯一的结构化提示词。`)
      }
    }
    if (prompts.some(p => !p || !ids.has(p.no))) add('extra_prompt', '提示词含不存在的镜头编号。')
  }
  return { ok: issues.length === 0, targetDuration: target, actualDuration: total, issues }
}

module.exports = { productionChecks }
