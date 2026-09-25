/**
 * 知识库检索层 + 自主导演决策引擎
 *
 * 职责：
 *  1. 检索：类型 / 情绪 / 风格 / 导演 / 影片 / 摄影 / 色彩 / 结构 / 类型方法论
 *  2. 决策：根据故事自动匹配「最佳导演参考 + 最佳视觉风格 + 最佳摄影方式 + 最佳叙事结构」，
 *     并对每个推荐给出可解释的理由（为什么这样选）。
 *
 * 所有 Skill 通过这一层获取事实依据，避免"凭空风格套用"。
 */

const { DIRECTORS } = require('./directors')
const { FILMS } = require('./films')
const { GENRES, GENRE_DB } = require('./genres')
const { MOODS, STYLES } = require('./styles')
const { COLOR_PSYCHOLOGY, VISUAL_SYSTEMS, MATERIALS } = require('./visual')
const { CAMERA_RIGS, LENS_SETS, SHOT_SIZES, MOVEMENTS, ASPECT_RATIOS } = require('./cinematography')
const { NARRATIVE_STRUCTURES } = require('./structures')
const {
  EDITING_TECHNIQUES, SOUND_LAYERS, PROMPT_PLATFORMS, PROMPT_ELEMENTS,
  BANNED_PROMPT_WORDS, SCRIPT_LEVELS, DURATION_MODES, QUALITY_CHECKS,
} = require('./techniques')

/** 关键词命中计分 */
function scoreByKeywords(text, keywordList) {
  const lower = String(text || '').toLowerCase()
  let score = 0
  const hits = []
  for (const kw of keywordList) {
    const k = String(kw).toLowerCase()
    if (lower.includes(k)) {
      score += k.length >= 2 ? 2 : 1
      hits.push(kw)
    }
  }
  return { score, hits }
}

/**
 * Step 1 · 故事分析
 * 判断：类型 / 情绪 / 核心冲突 / 商业定位
 */
function analyzeBrief(brief) {
  const text = String(brief || '')

  const genreScores = GENRES.map((g) => {
    const { score, hits } = scoreByKeywords(text, g.keywords)
    return { id: g.id, name: g.name, score, hits }
  }).sort((a, b) => b.score - a.score)

  const moodScores = MOODS.map((m) => {
    const { score, hits } = scoreByKeywords(text, m.keywords)
    return { id: m.id, name: m.name, score, hits }
  }).sort((a, b) => b.score - a.score)

  const topGenres = genreScores.filter((g) => g.score > 0).slice(0, 4)
  const topMoods = moodScores.filter((m) => m.score > 0).slice(0, 4)

  const genres = topGenres.length ? topGenres : [{ id: 'drama', name: '剧情', score: 0, hits: [] }]
  const moods = topMoods.length ? topMoods : [{ id: 'melancholy', name: '忧郁', score: 0, hits: [] }]

  // 核心冲突推断：人 vs 人 / 人 vs 环境 / 人 vs 自我 / 人 vs 命运
  const conflictRules = [
    { type: '人 vs 自我', keys: ['寻找', '记忆', '身份', '自我', '意义', '孤独', '内心', '挣扎', '抉择', '悔'] },
    { type: '人 vs 命运/时间', keys: ['宿命', '命运', '时间', '死亡', '宇宙', '尽头', '轮回', '预言', '记忆'] },
    { type: '人 vs 环境/系统', keys: ['末世', '荒废', '废墟', '社会', '阶级', '体制', '城市', '战争', '生存'] },
    { type: '人 vs 人', keys: ['复仇', '对抗', '追', '敌人', '背叛', '爱', '错过', '分手', '争夺', '审判'] },
  ]
  const conflicts = conflictRules
    .map((r) => ({ type: r.type, score: r.keys.reduce((a, k) => a + (text.includes(k) ? 1 : 0), 0) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
  const primaryConflict = conflicts.length ? conflicts[0].type : '人 vs 自我'

  // 商业定位推断：艺术 / 作者商业 / 主流商业
  const artKeys = ['存在', '虚无', '意识', '哲学', '诗', '意象', '梦境', '孤独', '时间', '记忆', '荒诞']
  const commercialKeys = ['复仇', '拯救', '任务', '追逐', '战争', '超级', '英雄', '怪兽', '爆炸', '逃', '抢劫']
  const artScore = artKeys.reduce((a, k) => a + (text.includes(k) ? 1 : 0), 0)
  const comScore = commercialKeys.reduce((a, k) => a + (text.includes(k) ? 1 : 0), 0)
  const positioning = artScore > comScore
    ? { level: '艺术向 / 作者电影', note: '以命题与氛围为驱动，观众以电影节/艺术院线/深度影迷为主；可承受慢节奏与非闭合结局。' }
    : comScore > artScore
      ? { level: '主流商业', note: '以类型满足与情绪释放为驱动，观众要求清晰目标与节奏回报；需明确的类型承诺。' }
      : { level: '作者商业（中间地带）', note: '用类型片外壳承载作者表达——先给类型满足，再给命题深度；是当代国际获奖片的主流策略。' }

  return {
    brief: text,
    genres,
    moods,
    genreIds: genres.map((g) => g.id),
    moodIds: moods.map((m) => m.id),
    primaryConflict,
    conflicts,
    positioning,
  }
}

/** 匹配风格候选（带理由） */
function matchStyles(analysis, limit = 4) {
  const genreNames = (analysis.genreIds || [])
    .map((id) => (GENRES.find((g) => g.id === id) || {}).name)
    .filter(Boolean)
  const moodNames = (analysis.moodIds || [])
    .map((id) => (MOODS.find((m) => m.id === id) || {}).name)
    .filter(Boolean)
  const pool = [...genreNames, ...moodNames].filter(Boolean)

  const scored = STYLES.map((s) => {
    let score = 0
    if (genreNames.includes(s.category)) score += 5
    if (Array.isArray(s.fit)) {
      for (const f of s.fit) {
        for (const p of pool) {
          if (String(f).includes(p) || String(p).includes(f)) score += 3
        }
      }
    }
    const rationale = String(s.rationale || '')
    for (const m of moodNames) if (rationale.includes(m)) score += 1
    return { ...s, _score: score }
  })
    .filter((s) => s._score > 0)
    .sort((a, b) => b._score - a._score)

  const DEFAULTS = ['documentary_realism', 'noir_neon', 'nolan_grand_realism', 'villeneuve_cold_philosophy']
  if (scored.length < 3) {
    const have = new Set(scored.map((s) => s.id))
    for (const id of DEFAULTS) {
      if (scored.length >= limit) break
      if (have.has(id)) continue
      const s = STYLES.find((x) => x.id === id)
      if (s) { scored.push({ ...s, _score: 0 }); have.add(id) }
    }
  }
  return scored.slice(0, limit)
}

/**
 * Step 2 · 匹配导演参考（带理由）
 * 评分维度：类型契合(bestFor/tags) + 主题契合(themes) + 情绪契合 + 知识库命中
 */
function matchDirectors(analysis, limit = 3) {
  const genreNames = analysis.genres.map((g) => g.name)
  const moodNames = analysis.moods.map((m) => m.name)
  const brief = analysis.brief || ''
  const pool = [...genreNames, ...moodNames]

  const scored = DIRECTORS.map((d) => {
    let score = 0
    const reasons = []

    // 类型 / 适用性
    for (const b of d.bestFor || []) {
      for (const p of pool) {
        if (String(b).includes(p) || String(p).includes(b)) { score += 4; reasons.push(`类型契合「${p}」`) }
      }
    }
    for (const t of d.tags || []) {
      for (const p of pool) {
        if (String(t).includes(p) || String(p).includes(t)) score += 2
      }
    }
    // 主题契合：直接用 brief 命中导演的常用主题
    for (const th of d.themes || []) {
      const key = th.replace(/[与和]/g, '')
      if (key.length >= 2 && brief.includes(key.slice(0, 2))) { score += 3; reasons.push(`主题契合「${th}」`) }
    }
    // 情绪契合：rationale 风格的签名文本
    for (const m of moodNames) {
      if (String(d.signature + d.philosophy).includes(m)) score += 1
    }
    return { ...d, _score: score, _reasons: [...new Set(reasons)].slice(0, 3) }
  })
    .sort((a, b) => b._score - a._score)

  const picked = scored.filter((d) => d._score > 0).slice(0, limit)
  if (picked.length) return picked
  // 兜底：给三位当代通用型导演
  return DIRECTORS.filter((d) => ['villeneuve', 'nolan', 'bong'].includes(d.id)).slice(0, limit)
}

/**
 * Step 2 · 匹配叙事结构（带理由）
 */
function matchStructures(analysis, limit = 2) {
  const genreNames = analysis.genres.map((g) => g.name)
  const brief = analysis.brief || ''
  const scored = NARRATIVE_STRUCTURES.map((s) => {
    let score = 0
    const reasons = []
    for (const f of s.fitGenres || []) {
      for (const g of genreNames) {
        if (String(f).includes(g) || g.includes(f)) { score += 4; reasons.push(`适配「${g}」`) }
      }
    }
    // 结构关键词直接命中 brief
    const kw = {
      nonlinear: ['非线性', '时间', '记忆', '倒叙', '交错'],
      circular: ['循环', '轮回', '回到', '重复'],
      multi_thread: ['群像', '多线', '几个', '交织', '城市'],
      open_ending: ['开放', '留白', '多义', '不确定'],
      fragmented: ['碎片', '意识', '回忆', '实验'],
      heros_journey: ['成长', '旅程', '冒险', '试炼', '归来'],
      five_act: ['史诗', '悲剧', '历史', '王朝'],
      save_the_cat: ['商业', '喜剧', '家庭', '动画'],
      three_act: ['短片', '故事'],
    }[s.id] || []
    for (const k of kw) if (brief.includes(k)) { score += 3; reasons.push(`故事含「${k}」信号`) }
    return { ...s, _score: score, _reasons: [...new Set(reasons)].slice(0, 2) }
  }).sort((a, b) => b._score - a._score)

  const picked = scored.filter((s) => s._score > 0).slice(0, limit)
  if (picked.length) return picked
  return NARRATIVE_STRUCTURES.filter((s) => ['three_act', 'nonlinear'].includes(s.id)).slice(0, limit)
}

/** 匹配视觉体系 */
function matchVisualSystems(analysis, limit = 2) {
  const text = analysis.brief || ''
  const genreNames = analysis.genres.map((g) => g.name)
  const kwMap = {
    cyberpunk: ['赛博', '未来', '机器', 'AI', '人工智能', '虚拟', '霓虹', '都市'],
    film_noir: ['犯罪', '悬疑', '雨夜', '侦探', '杀手', '黑帮', '雾'],
    neorealism: ['现实', '底层', '生活', '纪实', '打工', '贫困', '真实'],
    surrealism: ['梦', '幻觉', '潜意识', '超现实', '错乱', '心理'],
    steampunk: ['蒸汽', '机械', '齿轮', '维多利亚', '飞空', '工业'],
    eastern_aesthetic: ['东方', '武侠', '江湖', '禅', '山水', '神话', '剑', '留白'],
    nordic_cold: ['北欧', '雪', '冰', '冷', '孤独', '犯罪', '极简'],
  }
  const scored = VISUAL_SYSTEMS.map((v) => {
    let score = 0
    const reasons = []
    for (const k of kwMap[v.id] || []) {
      if (text.includes(k)) { score += 2; reasons.push(`含「${k}」`) }
    }
    for (const b of v.bestFor || []) {
      for (const g of genreNames) if (String(b).includes(g) || g.includes(b)) score += 3
    }
    return { ...v, _score: score, _reasons: [...new Set(reasons)].slice(0, 3) }
  }).sort((a, b) => b._score - a._score)

  const picked = scored.filter((v) => v._score > 0).slice(0, limit)
  if (picked.length >= limit) return picked
  // 兜底：抽象命题 / 纯形式实验 / 类型不明确的 brief（如「1:1 方形的实验影像，只有声音和手」）
  // 不会命中任何关键词。**绝不能返回空数组** —— 下游 visual_design / prompt_engineering /
  // screenplay / film_history 都要取 [0]，空数组会让「推荐视觉体系」整段静默消失，
  // 离线 demo 直接产出 undefined。这是知识库里唯一一个漏写兜底的匹配函数。
  const FALLBACK = ['nordic_cold', 'film_noir', 'surrealism', 'neorealism', 'eastern_aesthetic']
  const have = new Set(picked.map((v) => v.id))
  for (const id of FALLBACK) {
    if (picked.length >= limit) break
    if (have.has(id)) continue
    const hit = scored.find((v) => v.id === id)
    if (hit) { picked.push(hit); have.add(id) }
  }
  return picked
}

/** 匹配色彩方案 */
function matchColors(analysis, limit = 3) {
  const text = analysis.brief || ''
  const moodNames = analysis.moods.map((m) => m.name)
  const scored = COLOR_PSYCHOLOGY.map((c) => {
    let score = 0
    for (const m of moodNames) if (String(c.meaning).includes(m) || String(c.nuance).includes(m)) score += 2
    for (const k of String(c.meaning).split('、')) if (text.includes(k)) score += 1
    return { ...c, _score: score }
  }).sort((a, b) => b._score - a._score)

  // 补齐到 limit，保证下游始终有完整的色彩方案可用
  const FALLBACK = ['blue', 'monochrome', 'desaturated', 'orange_teal']
  if (scored.filter((c) => c._score > 0).length < limit) {
    const have = new Set(scored.map((c) => c.id))
    for (const id of FALLBACK) {
      const idx = scored.findIndex((c) => c.id === id)
      if (idx > 0) scored.push(scored.splice(idx, 1)[0])
      if (!have.has(id)) { have.add(id) }
    }
  }
  return scored.slice(0, limit)
}

/** 匹配材质 */
function matchMaterials(analysis, limit = 3) {
  const moodNames = analysis.moods.map((m) => m.name)
  const scored = MATERIALS.map((m) => {
    let score = 0
    for (const mm of m.mood) for (const n of moodNames) if (mm.includes(n) || n.includes(mm)) score += 2
    return { ...m, _score: score }
  }).sort((a, b) => b._score - a._score)
  const picked = scored.filter((m) => m._score > 0).slice(0, limit)
  return picked.length ? picked : MATERIALS.slice(0, limit)
}

/** 画幅决策 */
function resolveAspectRatio(aspect) {
  const key = String(aspect || '2.39:1')
  if (ASPECT_RATIOS.some((a) => a.id === key)) return ASPECT_RATIOS.find((a) => a.id === key)
  if (/9:16|竖/.test(key)) return ASPECT_RATIOS.find((a) => a.id === '9:16')
  if (/21:9|2\.3|宽银幕|变形/.test(key)) return ASPECT_RATIOS.find((a) => a.id === '21:9')
  if (/1:1|方形/.test(key)) return ASPECT_RATIOS.find((a) => a.id === '1:1')
  if (/16:9|横/.test(key)) return ASPECT_RATIOS.find((a) => a.id === '16:9')
  return ASPECT_RATIOS.find((a) => a.id === '21:9')
}

/** 剧本等级 / 时长模式 */
function resolveScriptLevel(level) {
  const n = Number(level)
  return SCRIPT_LEVELS.find((l) => l.id === n) || SCRIPT_LEVELS[2]
}
function resolveDurationMode(duration) {
  const d = Number(duration) || 30
  let best = DURATION_MODES[0]
  let diff = Infinity
  for (const m of DURATION_MODES) {
    const dd = Math.abs(m.duration - d)
    if (dd < diff) { diff = dd; best = m }
  }
  return { ...best, requested: d }
}

/** 类型方法论 */
function getGenreDb(analysis, limit = 2) {
  const ids = analysis.genreIds || []
  const picked = GENRE_DB.filter((g) => ids.includes(g.id))
  if (picked.length) return picked.slice(0, limit)
  // 兜底：GENRES（17 条，用于关键词匹配）与 GENRE_DB（用于方法论）曾是两套不重叠的 id 空间，
  // 导致武侠/喜剧/纪实/黑色电影/剧情片拿到的类型方法论**整节为空**。
  // 现在两表 id 已对齐；这里再做一层保险——按 name 反查，最后才退到首条，
  // 不再假设「某个 id 一定存在」。
  const names = (analysis.genres || []).map((g) => g.name)
  const byName = GENRE_DB.filter((g) => names.includes(g.name))
  if (byName.length) return byName.slice(0, limit)
  return GENRE_DB.slice(0, limit)
}

/** 检索导演（按 id 或标签） */
function findDirectors({ tags = [], ids = [], limit = 3 } = {}) {
  if (ids.length) return DIRECTORS.filter((d) => ids.includes(d.id))
  const scored = DIRECTORS.map((d) => {
    let score = 0
    for (const t of tags) {
      if (d.tags.some((dt) => dt.includes(t) || t.includes(dt))) score += 2
      if (d.bestFor.some((b) => b.includes(t) || t.includes(b))) score += 1
    }
    return { ...d, _score: score }
  }).sort((a, b) => b._score - a._score)
  return scored.slice(0, limit)
}

/** 检索影片 */
function findFilms({ tags = [], ids = [], limit = 4 } = {}) {
  if (ids.length) return FILMS.filter((f) => ids.includes(f.id))
  const scored = FILMS.map((f) => {
    let score = 0
    for (const t of tags) {
      if (f.tags.some((ft) => ft.includes(t) || t.includes(ft))) score += 2
      if (f.genre.some((g) => g.includes(t) || t.includes(g))) score += 2
      if (f.logline.includes(t)) score += 1
    }
    return { ...f, _score: score }
  }).sort((a, b) => b._score - a._score)
  return scored.slice(0, limit)
}

function filmsByDirectorIds(ids = [], limit = 6) {
  return FILMS.filter((f) => ids.includes(f.director)).slice(0, limit)
}

/**
 * 构建完整知识上下文 + 导演决策（注入 LLM）
 */
/**
 * 把 contextText 按【小节标题】切成命名段落。
 * 各 Skill 只需要与自己相关的段落 —— 把 7000+ 字的全文塞给每个环节，
 * 是后段环节上下文爆炸的主因之一。
 */
function splitSections(text) {
  const out = {}
  let cur = 'head'
  let buf = []
  const flush = () => { if (buf.length) { out[cur] = (out[cur] || '') + buf.join('\n'); buf = [] } }
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*【([^】]+)】/)
    if (m) { flush(); cur = m[1].trim(); buf = [line] } else buf.push(line)
  }
  flush()
  return out
}

/** 按名称前缀挑选段落（保持原文顺序） */
function pickSections(sections, wanted = []) {
  const order = Object.keys(sections)
  const picked = order.filter((k) => wanted.some((w) => k.includes(w)))
  return picked.map((k) => sections[k]).join('\n').trim()
}

function buildKnowledgeContext({ brief, extraTags = [], aspect, duration, level }) {
  const analysis = analyzeBrief(brief)
  const tags = [
    ...analysis.genres.map((g) => g.name),
    ...analysis.moods.map((m) => m.name),
    ...extraTags,
  ]

  const styles = matchStyles(analysis, 4)
  const directors = matchDirectors(analysis, 3)
  const structures = matchStructures(analysis, 2)
  const visualSystems = matchVisualSystems(analysis, 2)
  const colors = matchColors(analysis, 3)
  const materials = matchMaterials(analysis, 3)
  const genreDb = getGenreDb(analysis, 2)
  const aspectRatio = resolveAspectRatio(aspect)
  const durationMode = resolveDurationMode(duration)
  const scriptLevel = resolveScriptLevel(level)

  const directorIds = [...new Set([...styles.flatMap((s) => s.refs || []), ...directors.map((d) => d.id)])]
  const filmIds = [...new Set(styles.flatMap((s) => s.refs || []).filter((r) => FILMS.some((f) => f.id === r)))]
  const films = [
    ...filmsByDirectorIds(directors.map((d) => d.id), 4),
    ...findFilms({ ids: filmIds, limit: 4 }),
  ].filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i).slice(0, 6)

  const lines = []
  lines.push('【Step 1 · 故事分析】')
  lines.push('类型候选：' + analysis.genres.map((g) => `${g.name}(${g.score})`).join(' / '))
  lines.push('情绪候选：' + analysis.moods.map((m) => `${m.name}(${m.score})`).join(' / '))
  lines.push('核心冲突：' + analysis.primaryConflict)
  lines.push('商业定位：' + analysis.positioning.level + ' —— ' + analysis.positioning.note)
  lines.push('')

  lines.push('【Step 2 · 导演决策建议（必须批判性使用，可修正但需给理由）】')
  lines.push('▸ 推荐导演参考：')
  directors.forEach((d, i) => {
    lines.push(
      `  ${i + 1}. ${d.name}（${d.signature}）` +
      (d._reasons?.length ? `｜命中理由：${d._reasons.join('；')}` : '') + '\n' +
      `     理念：${d.philosophy}\n` +
      `     镜头：${(d.lensLanguage || [])[0] || '—'}\n` +
      `     主题：${(d.themes || []).join('、')}\n` +
      `     可迁移方法：${d.method}`
    )
  })
  lines.push('▸ 推荐叙事结构：')
  structures.forEach((s, i) => {
    lines.push(
      `  ${i + 1}. ${s.name}｜${s.definition}` +
      (s._reasons?.length ? `｜命中理由：${s._reasons.join('；')}` : '') + '\n' +
      `     节拍：${(s.beats || []).slice(0, 5).join(' → ')}\n` +
      `     优点：${(s.pros || []).join('；')}\n` +
      `     缺点：${(s.cons || []).join('；')}`
    )
  })
  lines.push('▸ 推荐视觉体系：')
  visualSystems.forEach((v, i) => {
    lines.push(`  ${i + 1}. ${v.name}｜${v.philosophy}｜色板：${v.palette}｜光：${v.light}｜材质：${v.material}` +
      (v._reasons?.length ? `｜命中：${v._reasons.join('、')}` : ''))
  })
  lines.push('▸ 推荐色彩方案：')
  colors.forEach((c) => lines.push(`  · ${c.name}：${c.meaning}｜用法：${c.usage}｜风险：${c.caution}`))
  lines.push('▸ 推荐材质方向：')
  materials.forEach((m) => lines.push(`  · ${m.name}：${m.desc}（案例：${(m.cases || []).join('、')}）`))
  lines.push('')
  lines.push('【画幅决策】' + aspectRatio.name + '（' + aspectRatio.label + '）')
  lines.push('  构图：' + aspectRatio.composition)
  lines.push('  镜头：' + aspectRatio.lens)
  lines.push('  叙事：' + aspectRatio.narrative)
  lines.push('  优势：' + aspectRatio.strength + '｜局限：' + aspectRatio.weakness)
  lines.push('')
  lines.push('【类型方法论】')
  genreDb.forEach((g) => {
    lines.push(`  ▸ ${g.name}`)
    lines.push(`    结构规律：${g.structure}`)
    lines.push(`    观众期待：${g.expectation}`)
    lines.push(`    常见失败点：${(g.failurePoints || []).map((f, i) => `${i + 1}) ${f}`).join(' ')}`)
    lines.push(`    视觉特点：${g.visual}`)
  })
  lines.push('')
  lines.push('【可调用风格库（含适用性理由）】')
  styles.forEach((s, i) => {
    const v = s.visual || {}
    lines.push(
      `${i + 1}. ${s.name}｜${s.summary}\n` +
      `   视觉：${v.camera || '—'}；${v.lens || '—'}；${v.movement || '—'}；${v.color || '—'}；${v.light || '—'}；${v.composition || '—'}\n` +
      `   声音：${s.sound || '—'}｜节奏：${s.pacing || '—'}\n` +
      `   为什么适合：${s.rationale || '—'}\n` +
      `   适用：${(s.fit || []).join('、')}｜不适合：${s.avoidWhen || '—'}`
    )
  })
  lines.push('')
  lines.push('【可参考影片（学习其方法论，不是复制剧情）】')
  films.forEach((f) => {
    lines.push(`${f.title}（${f.year}）：${(f.learnFrom || []).join('；')}`)
  })
  lines.push('')
  lines.push('【摄影规格库】')
  lines.push('机身：' + CAMERA_RIGS.map((c) => `${c.name}(${c.note})`).join('｜'))
  lines.push('焦段与心理：' + LENS_SETS.map((l) => `${l.name}→${l.psychology}`).join('｜'))
  lines.push('景别：' + SHOT_SIZES.map((s) => `${s.name}(${s.emotion})`).join('｜'))
  lines.push('运镜：' + MOVEMENTS.map((m) => `${m.name}(${m.emotion})`).join('｜'))
  lines.push('')
  lines.push('【剪辑手法】' + EDITING_TECHNIQUES.map((e) => `${e.name}：${e.desc}`).join('｜'))
  lines.push('【声音层】' + SOUND_LAYERS.map((s) => `${s.name}：${s.desc}`).join('｜'))
  lines.push('【AI 平台】' + PROMPT_PLATFORMS.map((p) => p.name).join('、'))
  lines.push('【提示词 13 要素】' + PROMPT_ELEMENTS.map((e) => e.name).join('、'))
  lines.push('【禁用无效词】' + BANNED_PROMPT_WORDS.join('、'))
  lines.push('')
  lines.push('【本次制作规格】')
  lines.push(`  时长模式：${durationMode.label}（约 ${durationMode.duration}s / ${durationMode.scenes} / ${durationMode.shots}）—— ${durationMode.note}`)
  lines.push(`  剧本等级：Level ${scriptLevel.id} ${scriptLevel.name} —— ${scriptLevel.desc}（篇幅：${scriptLevel.length}）`)
  lines.push(`  必须包含：${scriptLevel.contains.join('、')}`)

  return {
    analysis,
    genreDb,
    styles,
    directors,
    structures,
    visualSystems,
    colors,
    materials,
    films,
    aspectRatio,
    durationMode,
    scriptLevel,
    // 摄影与制作规格（供各 Skill 直接取用）
    cameras: CAMERA_RIGS,
    lens: LENS_SETS,
    shotSizes: SHOT_SIZES,
    movements: MOVEMENTS,
    aspectRatios: ASPECT_RATIOS,
    // 提示词与审核规范
    promptElements: PROMPT_ELEMENTS,
    bannedWords: BANNED_PROMPT_WORDS,
    checks: QUALITY_CHECKS,
    platforms: PROMPT_PLATFORMS,
    scriptLevels: SCRIPT_LEVELS,
    durationModes: DURATION_MODES,
    // Per-stage references are selected by makeCtx; raw knowledge has no selected cards yet.
    referenceText: '',
    contextText: lines.join('\n'),
    contextSections: splitSections(lines.join('\n')),
  }
}

module.exports = {
  // 数据
  DIRECTORS, FILMS, GENRES, GENRE_DB, MOODS, STYLES, MATERIALS,
  COLOR_PSYCHOLOGY, VISUAL_SYSTEMS,
  CAMERA_RIGS, LENS_SETS, SHOT_SIZES, MOVEMENTS, ASPECT_RATIOS,
  NARRATIVE_STRUCTURES,
  EDITING_TECHNIQUES, SOUND_LAYERS, PROMPT_PLATFORMS, PROMPT_ELEMENTS,
  BANNED_PROMPT_WORDS, SCRIPT_LEVELS, DURATION_MODES, QUALITY_CHECKS,
  // 检索与决策
  analyzeBrief, matchStyles, matchDirectors, matchStructures, matchVisualSystems,
  matchColors, matchMaterials, resolveAspectRatio, resolveScriptLevel, resolveDurationMode,
  getGenreDb, findDirectors, findFilms, filmsByDirectorIds, buildKnowledgeContext,
  splitSections, pickSections,
}
