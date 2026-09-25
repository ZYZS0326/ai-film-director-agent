// 上下文投递与修订传播共用同一张依赖表，避免两套规则漂移。
const PRIOR_DEPS = {
  director_analysis: [],
  film_history: ['analysis'],
  story_structure: ['analysis'],
  cinematography: ['analysis', 'structure', 'references'],
  visual_design: ['analysis', 'cinematography', 'references'],
  screenplay: ['analysis', 'structure', 'cinematography', 'visualBible'],
  storyboard: ['screenplay', 'cinematography', 'visualBible'],
  continuity: ['screenplay', 'storyboard', 'visualBible', 'cinematography'],
  prompt_engineering: ['storyboard', 'cinematography', 'visualBible', 'continuity'],
  sound_design: ['structure', 'screenplay', 'storyboard'],
  editing: ['structure', 'storyboard', 'sound'],
  quality_control: ['analysis', 'structure', 'cinematography', 'visualBible',
    'screenplay', 'storyboard', 'continuity', 'prompts', 'sound', 'editing'],
}

function expandAffected(ids) {
  const { SKILLS } = require('../skills')
  const affected = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    const outputs = new Set(SKILLS.filter(s => affected.has(s.id)).map(s => s.outputKey))
    for (const skill of SKILLS) {
      if (!affected.has(skill.id) && (PRIOR_DEPS[skill.id] || []).some(key => outputs.has(key))) {
        affected.add(skill.id)
        changed = true
      }
    }
  }
  return SKILLS.filter(s => affected.has(s.id)).sort((a, b) => a.stage - b.stage).map(s => s.id)
}

function affectedByConstraints(before, after) {
  const seeds = []
  const roots = { duration: 'story_structure', aspect: 'cinematography', level: 'screenplay', platforms: 'prompt_engineering', language: 'director_analysis' }
  for (const [key, id] of Object.entries(roots)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) seeds.push(id)
  }
  return expandAffected(seeds)
}

module.exports = { PRIOR_DEPS, expandAffected, affectedByConstraints }
