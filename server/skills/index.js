/**
 * Skill Registry — 能力注册与路由
 * Agent 根据任务自动调用；也支持用户显式指定（自然语言或 /skill）。
 *
 * 导演台增强 Skill Pack v1.0 —— 12 个模块：
 *  01 director_analysis   导演视觉分析（概念诊断 + 导演意图）
 *  02 film_history        电影参考分析库
 *  03 story_structure     故事结构诊断
 *  04 cinematography      摄影指导
 *  05 visual_design       美术指导（Visual Bible）
 *  06 screenplay          场景设计
 *  07 storyboard          分镜导演
 *  08 continuity          连续性管理（Continuity Bible）
 *  09 prompt_engineering  AI 视频提示词工程
 *  10 sound_design        声音设计
 *  11 editing             剪辑导演
 *  12 quality_control     导演审核 Agent
 */

const director_analysis = require('./director_analysis')
const film_history = require('./film_history')
const story_structure = require('./story_structure')
const cinematography = require('./cinematography')
const visual_design = require('./visual_design')
const screenplay = require('./screenplay')
const storyboard = require('./storyboard')
const continuity = require('./continuity')
const prompt_engineering = require('./prompt_engineering')
const sound_design = require('./sound_design')
const editing = require('./editing')
const quality_control = require('./quality_control')

const SKILLS = [
  director_analysis,
  film_history,
  story_structure,
  cinematography,
  visual_design,
  screenplay,
  storyboard,
  continuity,
  prompt_engineering,
  sound_design,
  editing,
  quality_control,
]

// Append through buildPrompt so promptSize/fitContext count the same text sent to the model.
// Empty low-budget references disappear as whole cards, never truncated instructions or links.
for (const skill of SKILLS) {
  const build = skill.buildPrompt
  skill.buildPrompt = function (ctx) {
    const base = build.call(this, ctx)
    const refs = ctx.knowledge?.referenceText
    return refs ? `${base}\n\n${refs}` : base
  }
}
const BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]))

/** 默认完整生产流水线（从创意到成片方案） */
const FULL_PIPELINE = [
  'director_analysis',
  'film_history',
  'story_structure',
  'cinematography',
  'visual_design',
  'screenplay',
  'storyboard',
  'continuity',
  'prompt_engineering',
  'sound_design',
  'editing',
  'quality_control',
]

/** 关键词路由（LLM 不可用时的兜底） */
function keywordRoute(message) {
  const text = String(message || '')
  const matched = SKILLS.filter((s) => s.triggers.some((t) => text.includes(t)))
  if (!matched.length) return FULL_PIPELINE
  return [...new Set(matched.map((s) => s.id))].sort((a, b) => BY_ID[a].stage - BY_ID[b].stage)
}

/** 技能元信息（用于前端展示） */
function skillManifest() {
  return SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    stage: s.stage,
    outputKey: s.outputKey,
    description: s.description,
    triggers: s.triggers,
  }))
}

module.exports = { SKILLS, BY_ID, FULL_PIPELINE, keywordRoute, skillManifest }
