const crypto = require('crypto')
const llm = require('./llm')
const { productionChecks } = require('./production-checks')

const hash = text => crypto.createHash('sha256').update(String(text || '')).digest('hex')

async function reviewStage(skill, text, { failed = false, parsed = null, session = null } = {}) {
  const issues = []
  const add = (code, evidence, suggestion) => issues.push({ code, evidence, suggestion, severity: 'block' })
  if (failed || !String(text || '').trim()) add('stage_failed', skill.name, '重新运行本环节，确认模型连接和输出完整性。')
  if (skill.id === 'storyboard' && !session?.shots?.length) add('shots_missing', '未解析到分镜镜头', '补齐可解析的结构化分镜。')
  if (skill.id === 'continuity' && !session?.continuityData) add('continuity_missing', '未解析到连续性规则', '补齐人物与场景的连续性锁定。')
  if (skill.id === 'prompt_engineering' && !session?.promptData?.shots?.length) add('prompts_missing', '未解析到逐镜提示词', '补齐与分镜编号对应的提示词。')
  if (skill.id === 'prompt_engineering' && !session?.promptData?.imageAssets?.length) add('image_assets_missing', '未解析到前期资产图提示词', '为实际需要的人物、场景和道具补齐带稳定 ID 的资产图。')
  if (skill.id === 'prompt_engineering' && !session?.promptData?.keyframes?.length) add('keyframes_missing', '未解析到逐镜静态关键帧', '至少为关键镜头补齐引用资产 ID 的 Master Frame。')
  if (skill.id === 'prompt_engineering' && session?.promptData?.keyframes?.length) {
    const badAsset = (session.promptData.imageAssets || []).find(a => !a?.assetId || !a.type || !a.sheet || !a.aspectRatio || !String(a.promptZh || '').trim())
    if (badAsset) add('image_asset_incomplete', '资产图缺少 ID、类型、版式、画幅或中文提示词', '补齐可直接出图的资产规格。')
    const assets = new Set((session.promptData.imageAssets || []).map(a => a.assetId))
    const shots = new Set((session.shots || []).map(s => s.no))
    for (const frame of session.promptData.keyframes) {
      if (!shots.has(frame.shotNo) || !Array.isArray(frame.assetIds) || !frame.assetIds.length || frame.assetIds.some(id => !assets.has(id)) ||
          !frame.phase || !frame.aspectRatio || !String(frame.promptZh || '').trim()) {
        add('keyframe_mapping', '关键帧镜号或资产引用无效', '使每张关键帧指向现有分镜与已登记资产 ID。')
        break
      }
    }
  }
  if (['storyboard', 'prompt_engineering', 'editing'].includes(skill.id) && session?.shots?.length) {
    const checks = productionChecks(session)
    for (const issue of checks.issues.filter(x => x.code !== 'pending' && (skill.id !== 'storyboard' || x.code !== 'prompt_mapping')).slice(0, 4)) {
      add(issue.code, issue.message, '修正对应分镜或提示词后再继续。')
    }
  }
  if (issues.length) return { status: 'block', issues, outputHash: hash(text), at: Date.now(), kind: 'structural' }

  if (!llm.isConfigured()) {
    return { status: 'unverified', issues: [], outputHash: hash(text), at: Date.now(), kind: 'demo',
      note: '仅完成结构检查；演示模式不提供真实创作质量审核。' }
  }

  try {
    const answer = await llm.chat([
      { role: 'system', content: '你是独立的环节审核员。只审核当前环节，不重写内容。仅报告有直接文本证据的实质问题；允许零问题。输出严格 JSON：{"issues":[{"evidence":"原文中的短句","suggestion":"具体修改动作"}]}。最多3项。不引用原文就不要报告。' },
      { role: 'user', content: `环节：${skill.name}\n原文：\n${String(text).slice(0, 6000)}` },
    ], { role: 'reviewer', structured: true, temperature: 0.1, desiredOutputTokens: 600, maxContinuations: 0 })
    const match = String(answer).match(/\{[\s\S]*\}/)
    const data = match ? JSON.parse(match[0]) : null
    if (!data || !Array.isArray(data.issues)) throw new Error('审核格式无效')
    const found = data.issues.slice(0, 3).filter(x =>
      typeof x.evidence === 'string' && x.evidence.length >= 6 &&
      String(text).includes(x.evidence) && typeof x.suggestion === 'string' && x.suggestion.trim()
    ).map(x => ({ code: 'creative_issue', evidence: x.evidence, suggestion: x.suggestion, severity: 'warn' }))
    return { status: found.length ? 'warn' : 'pass', issues: found, outputHash: hash(text), at: Date.now(), kind: 'llm' }
  } catch {
    return { status: 'unverified', issues: [], outputHash: hash(text), at: Date.now(), kind: 'llm',
      note: '创作审核暂未完成，可稍后重试；不将未审核结果标为通过。' }
  }
}

module.exports = { reviewStage, hash }
