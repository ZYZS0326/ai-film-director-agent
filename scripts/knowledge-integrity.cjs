/**
 * 知识库数据完整性测试
 *
 * 这类缺陷的共同特征：**不报错、不崩溃、界面照常有内容，只是内容是空的。**
 * 前几轮踩到的三个真实案例全部属于此类：
 *   1. matchVisualSystems 没有兜底 → 抽象命题类 brief 拿到空数组 →
 *      「推荐视觉体系」整节消失、film_history 产出「光线：undefined」
 *   2. GENRES（17 条）与 GENRE_DB（10 条）是两套不重叠的 id 空间，且兜底写了
 *      `filter(g => g.id === 'drama')` —— GENRE_DB 里根本没有 drama →
 *      「类型方法论」整节对武侠/喜剧/纪实/黑色电影/剧情片为空
 *   3. directors 数据里没有 color/lighting/sound/rhythm 四个字段，
 *      但 demo 一直在读 → 「可迁移手法 3. —」这种占位符泄漏到用户可见输出
 *
 * 本测试用 6 组断言把这三类问题一次性钉死，包括一个 Proxy 幽灵字段检测器。
 */

const kb = require('../server/knowledge')
const { SKILLS } = require('../server/skills')
const { GENRES, GENRE_DB } = require('../server/knowledge/genres')
const { VISUAL_SYSTEMS } = require('../server/knowledge/visual')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; return }
  fail++
  failures.push(`${name}${detail ? ' → ' + detail : ''}`)
}

// 覆盖足够广的 brief 集合：关键词命中型 / 抽象无关键词型 / 各主要类型
const BRIEFS = [
  '一个想法',
  '1:1 方形的实验影像，只有声音和手',
  '恐怖片：山里的一间民宿',
  '1 小时 90 分钟的电影，史诗战争',
  '赛博朋克都市，霓虹雨夜，AI 觉醒',
  '东方武侠，剑客独行，山水留白',
  '北欧雪原，一起连环杀人案',
  '梦与幻觉，一个失忆者的心理迷宫',
  '底层打工人的一天，纪实风格',
  '蒸汽朋克，维多利亚时代，飞空艇',
  '两分钟，一段暗恋的错过',
  '半小时的喜剧，一家人过年',
  '动画短片，关于一只猫的成长旅程',
  '多线交织的城市群像，一天之内',
  '非线性时间，记忆碎片，倒叙正叙对撞',
  '循环轮回，主角不断回到同一天',
  '开放结局，多义性，留白',
  '黑白默片风格，无对白',
  '只有三个镜头，极简，静物',
  '纪录片式访谈，真实人物',
]

const MATCHERS = ['styles', 'directors', 'structures', 'visualSystems', 'colors', 'materials', 'films', 'genreDb']
const SPEC_ARRAYS = ['cameras', 'lens', 'shotSizes', 'movements']

const contexts = BRIEFS.map((brief) => {
  let k = null
  try {
    k = kb.buildKnowledgeContext({ brief, extraTags: [], aspect: '', duration: '', level: '' })
  } catch (e) {
    fail++
    failures.push(`buildKnowledgeContext("${brief}") 抛错 → ${e.message}`)
  }
  return { brief, k }
})

// ── [1] 两张表的 id 必须对齐（GENRE_DB 是 GENRES 的方法论扩展）────
{
  const a = new Set(GENRES.map((g) => g.id))
  const b = new Set(GENRE_DB.map((g) => g.id))
  const missing = [...a].filter((id) => !b.has(id))
  ok('[1] GENRE_DB 覆盖 GENRES 全部 id', missing.length === 0, `缺失: ${missing.join(',') || '无'}`)
  const orphan = [...b].filter((id) => !a.has(id))
  ok('[1] GENRE_DB 无孤儿 id', orphan.length === 0, `多余: ${orphan.join(',') || '无'}`)
  // 每条方法论必须有实质内容，不能是空壳
  for (const g of GENRE_DB) {
    ok(`[1] GENRE_DB「${g.id}」结构规律非空`, String(g.structure || '').length > 40)
    ok(`[1] GENRE_DB「${g.id}」观众期待非空`, String(g.expectation || '').length > 20)
    ok(`[1] GENRE_DB「${g.id}」失败点 ≥3 条`, Array.isArray(g.failurePoints) && g.failurePoints.length >= 3)
    ok(`[1] GENRE_DB「${g.id}」视觉特点非空`, String(g.visual || '').length > 15)
    ok(`[1] GENRE_DB「${g.id}」案例 ≥3 部`, Array.isArray(g.examples) && g.examples.length >= 3)
  }
}

// ── [2] 所有匹配函数在任意 brief 下都不得返回空数组 ──────────────
for (const { brief, k } of contexts) {
  if (!k) continue
  for (const key of [...MATCHERS, ...SPEC_ARRAYS]) {
    ok(`[2] knowledge.${key} 非空`, Array.isArray(k[key]) && k[key].length > 0, `brief="${brief}"`)
  }
}

// ── [3] 知识上下文的每个小节都不得是空标题 ────────────────────────
for (const { brief, k } of contexts) {
  if (!k) continue
  const sections = k.contextSections || {}
  ok(`[3] contextSections 非空`, Object.keys(sections).length > 0, `brief="${brief}"`)
  for (const [name, body] of Object.entries(sections)) {
    ok(`[3] 小节「${name}」非空`, String(body || '').trim().length > 0, `brief="${brief}"`)
  }
  // contextText 里不得出现「只有标题没有内容」的段落
  const lines = String(k.contextText || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^【[^】]+】$/.test(lines[i].trim())) {
      const next = (lines[i + 1] || '').trim()
      ok(`[3] 段落「${lines[i].trim()}」有内容`, next.length > 0, `brief="${brief}"`)
    }
  }
}

// ── [4] 幽灵字段检测：读取不存在的属性必须为 0 ────────────────────
{
  const IGNORE = new Set([
    'toJSON', 'constructor', 'then', 'toString', 'valueOf', 'hasOwnProperty',
    'inspect', 'length', 'name', '_reasons', '_score',
  ])
  const misses = new Set()

  function wrap(value, path) {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v, i) => wrap(v, `${path}[${i}]`))
    if (value instanceof Date || value instanceof RegExp) return value
    return new Proxy(value, {
      get(target, prop, recv) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop, recv)
        if (!(prop in target)) {
          if (!IGNORE.has(prop) && !prop.startsWith('__')) {
            misses.add(`${path.replace(/\[\d+\]/g, '[]')}.${prop}`)
          }
          return undefined
        }
        return wrap(Reflect.get(target, prop, recv), `${path}.${prop}`)
      },
    })
  }

  for (const { brief, k } of contexts) {
    if (!k) continue
    const ctx = {
      brief,
      constraints: { aspect: '', duration: '', level: '' },
      knowledge: wrap(k, 'knowledge'),
      constraintsText: '总时长：300 秒｜画幅：21:9｜剧本等级：Level 4｜输出语言：中文',
      prior: {},
      priorShots: [],
      session: { outputs: {}, brief, constraints: {}, shots: [] },
      revision: null,
    }
    for (const skill of SKILLS) {
      try { skill.demo && skill.demo(ctx) } catch (e) { ok(`[4] demo:${skill.id} 不抛错`, false, e.message) }
      try { skill.buildPrompt && skill.buildPrompt(ctx) } catch (e) { ok(`[4] prompt:${skill.id} 不抛错`, false, e.message) }
    }
  }
  ok('[4] 无幽灵字段读取', misses.size === 0, [...misses].join(' , '))
}

// ── [5] demo 产出不得泄漏 undefined / [object Object] / NaN / null ─
const LEAK = [
  [/undefined/, 'undefined'],
  [/\[object Object\]/, '[object Object]'],
  [/(^|[^A-Za-z])NaN([^A-Za-z]|$)/, 'NaN'],
  [/：\s*null\b/, 'null'],
  [/\|\s*null\s*\|/, 'null'],
]

for (const { brief, k } of contexts) {
  if (!k) continue
  const ctx = {
    brief,
    constraints: { aspect: '', duration: '', level: '' },
    knowledge: k,
    constraintsText: '总时长：300 秒｜画幅：21:9｜剧本等级：Level 4｜输出语言：中文',
    prior: {},
    priorShots: [],
    session: { outputs: {}, brief, constraints: {}, shots: [] },
    revision: null,
  }
  for (const skill of SKILLS) {
    let text = ''
    try { text = skill.demo ? skill.demo(ctx) : '' } catch (e) { ok(`[5] demo:${skill.id} 不抛错`, false, e.message); continue }
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const [re, name] of LEAK) {
        if (re.test(line)) {
          ok(`[5] demo:${skill.id} 无 ${name}`, false, `brief="${brief}" L${i + 1}: ${line.trim().slice(0, 90)}`)
          break
        }
      }
    })
  }
}

// ── [6] buildPrompt 不得泄漏（用完整 ctx，避免误报）────────────────
for (const { brief, k } of contexts) {
  if (!k) continue
  const ctx = {
    brief,
    constraints: { aspect: '', duration: '', level: '' },
    knowledge: k,
    constraintsText: '总时长：300 秒｜画幅：21:9｜剧本等级：Level 4｜输出语言：中文',
    prior: {},
    priorShots: [],
    session: { outputs: {}, brief, constraints: {}, shots: [] },
    revision: null,
  }
  for (const skill of SKILLS) {
    let text = ''
    try { text = skill.buildPrompt ? skill.buildPrompt(ctx) : '' } catch (e) { ok(`[6] prompt:${skill.id} 不抛错`, false, e.message); continue }
    text.split('\n').forEach((line, i) => {
      for (const [re, name] of LEAK) {
        if (re.test(line)) {
          ok(`[6] prompt:${skill.id} 无 ${name}`, false, `brief="${brief}" L${i + 1}: ${line.trim().slice(0, 90)}`)
          break
        }
      }
    })
  }
}

// ── [7] 占位符「—」不得作为列表项的唯一内容泄漏到 demo ────────────
for (const { brief, k } of contexts) {
  if (!k) continue
  const ctx = {
    brief,
    constraints: { aspect: '', duration: '', level: '' },
    knowledge: k,
    constraintsText: '总时长：300 秒｜画幅：21:9｜剧本等级：Level 4｜输出语言：中文',
    prior: {},
    priorShots: [],
    session: { outputs: {}, brief, constraints: {}, shots: [] },
    revision: null,
  }
  for (const skill of SKILLS) {
    let text = ''
    try { text = skill.demo ? skill.demo(ctx) : '' } catch { continue }
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\d+\.|[-*])\s*—\s*$/.test(line)) {
        ok(`[7] demo:${skill.id} 无空占位符`, false, `brief="${brief}" L${i + 1}: ${line.trim()}`)
      }
    })
  }
}

// ── [8] 视觉体系 / 导演 / 色彩 / 材质 的必需字段齐全 ───────────────
{
  for (const v of VISUAL_SYSTEMS) {
    for (const f of ['name', 'philosophy', 'palette', 'light', 'material', 'composition', 'lens', 'sound']) {
      ok(`[8] VISUAL_SYSTEMS「${v.id}」有 ${f}`, Boolean(v[f]), `实际: ${JSON.stringify(v[f])}`)
    }
  }
  const { DIRECTORS } = require('../server/knowledge/directors')
  for (const d of DIRECTORS) {
    for (const f of ['name', 'signature', 'philosophy', 'aesthetic', 'method', 'avoidWhen']) {
      ok(`[8] DIRECTORS「${d.id}」有 ${f}`, Boolean(d[f]))
    }
    for (const f of ['lensLanguage', 'themes', 'narrative', 'bestFor', 'tags']) {
      ok(`[8] DIRECTORS「${d.id}」${f} 为非空数组`, Array.isArray(d[f]) && d[f].length > 0)
    }
  }
  // film_history.demo 对影片对象做了 5 处 .slice() 直接调用，缺字段会直接抛错
  const { FILMS } = require('../server/knowledge/films')
  for (const f of FILMS) {
    for (const k of ['title', 'year', 'lens', 'structure', 'rhythm', 'color', 'lighting', 'learnFrom']) {
      const v = f[k]
      const good = v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim().length > 0)
      ok(`[8] FILMS「${f.id}」有 ${k}`, good)
    }
  }
  // 风格库：rationale 是本项目区别于模板工具的核心，不能省
  const { STYLES } = require('../server/knowledge/styles')
  for (const s of STYLES) {
    ok(`[8] STYLES「${s.id}」有 rationale（适用性理由）`, String(s.rationale || '').length > 10)
    ok(`[8] STYLES「${s.id}」有 visual 对象`, s.visual && typeof s.visual === 'object')
    ok(`[8] STYLES「${s.id}」有 sound`, Boolean(s.sound))
    ok(`[8] STYLES「${s.id}」有 pacing`, Boolean(s.pacing))
  }
  // 叙事结构：beats 被 demo 直接取用，不能为空
  const { NARRATIVE_STRUCTURES } = require('../server/knowledge/structures')
  for (const s of NARRATIVE_STRUCTURES) {
    ok(`[8] STRUCTURES「${s.id}」有 definition`, Boolean(s.definition))
    ok(`[8] STRUCTURES「${s.id}」beats 非空`, Array.isArray(s.beats) && s.beats.length > 0)
    ok(`[8] STRUCTURES「${s.id}」有 pros/cons`, Array.isArray(s.pros) && s.pros.length > 0 && Array.isArray(s.cons) && s.cons.length > 0)
  }
}

// ── [9] 兜底数组里硬编码的 id 必须真实存在 ────────────────────────
// 兜底本身也会静默失效：GENRE_DB.filter(g => g.id === 'drama') 里的 drama 不存在，
// 于是兜底什么都没兜到。这里直接从源码里把所有 FALLBACK / DEFAULTS 数组抽出来校验，
// 将来新增兜底 id 写错会立刻被这条测试抓住。
{
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'knowledge', 'index.js'), 'utf8')

  const pools = new Map()
  const addPool = (name, arr) => {
    for (const x of arr) if (x && x.id) pools.set(x.id, name)
  }
  addPool('GENRES', GENRES)
  addPool('GENRE_DB', GENRE_DB)
  addPool('VISUAL_SYSTEMS', VISUAL_SYSTEMS)
  addPool('COLOR_PSYCHOLOGY', require('../server/knowledge/visual').COLOR_PSYCHOLOGY)
  addPool('MATERIALS', require('../server/knowledge/visual').MATERIALS)
  addPool('STYLES', require('../server/knowledge/styles').STYLES)
  addPool('NARRATIVE_STRUCTURES', require('../server/knowledge/structures').NARRATIVE_STRUCTURES)
  addPool('DIRECTORS', require('../server/knowledge/directors').DIRECTORS)
  addPool('FILMS', require('../server/knowledge/films').FILMS)

  const re = /const\s+(?:FALLBACK|DEFAULTS)\s*=\s*\[([^\]]*)\]/g
  let m
  let found = 0
  while ((m = re.exec(src))) {
    const ids = [...m[1].matchAll(/['"]([a-z0-9_]+)['"]/g)].map((x) => x[1])
    for (const id of ids) {
      found++
      ok(`[9] 兜底 id「${id}」在知识库中存在`, pools.has(id), `所属数组: ${m[1].trim().slice(0, 60)}`)
    }
  }
  ok('[9] 源码中确实存在兜底数组', found > 0, '未匹配到任何 FALLBACK/DEFAULTS 数组')
}

// ── [10] 所有知识库集合的 id 必须唯一；analyzeBrief 输出不得有重复项 ──
// MOODS 里曾出现两条逐字节相同的 melancholy，导致：
//   ① 第二条永远选不中（find 只返回第一条）—— 死数据
//   ② 忧郁的分数被算两遍，情绪候选里出现「忧郁(4) / 忧郁(4)」直接发给模型
{
  const COLLECTIONS = {
    GENRES,
    GENRE_DB,
    MOODS: require('../server/knowledge/styles').MOODS,
    STYLES: require('../server/knowledge/styles').STYLES,
    VISUAL_SYSTEMS,
    COLOR_PSYCHOLOGY: require('../server/knowledge/visual').COLOR_PSYCHOLOGY,
    MATERIALS: require('../server/knowledge/visual').MATERIALS,
    NARRATIVE_STRUCTURES: require('../server/knowledge/structures').NARRATIVE_STRUCTURES,
    DIRECTORS: require('../server/knowledge/directors').DIRECTORS,
    FILMS: require('../server/knowledge/films').FILMS,
    CAMERA_RIGS: require('../server/knowledge/cinematography').CAMERA_RIGS,
    LENS_SETS: require('../server/knowledge/cinematography').LENS_SETS,
    SHOT_SIZES: require('../server/knowledge/cinematography').SHOT_SIZES,
    MOVEMENTS: require('../server/knowledge/cinematography').MOVEMENTS,
    ASPECT_RATIOS: require('../server/knowledge/cinematography').ASPECT_RATIOS,
    PROMPT_PLATFORMS: require('../server/knowledge/techniques').PROMPT_PLATFORMS,
  }
  for (const [name, arr] of Object.entries(COLLECTIONS)) {
    if (!Array.isArray(arr)) { ok(`[10] ${name} 是数组`, false); continue }
    const seen = new Map()
    for (const x of arr) seen.set(x.id, (seen.get(x.id) || 0) + 1)
    const dup = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`)
    ok(`[10] ${name} id 唯一`, dup.length === 0, `重复: ${dup.join(', ')}`)
  }

  // analyzeBrief 输出不得有重复的情绪 / 类型
  for (const { brief } of contexts) {
    let a
    try { a = kb.analyzeBrief(brief) } catch (e) { ok(`[10] analyzeBrief("${brief}") 不抛错`, false, e.message); continue }
    const gNames = (a.genres || []).map((g) => g.name)
    const mNames = (a.moods || []).map((m) => m.name)
    ok(`[10] "${brief}" 类型无重复`, new Set(gNames).size === gNames.length, gNames.join(' / '))
    ok(`[10] "${brief}" 情绪无重复`, new Set(mNames).size === mNames.length, mNames.join(' / '))
    const gIds = a.genreIds || []
    const mIds = a.moodIds || []
    ok(`[10] "${brief}" genreIds 无重复`, new Set(gIds).size === gIds.length, gIds.join(','))
    ok(`[10] "${brief}" moodIds 无重复`, new Set(mIds).size === mIds.length, mIds.join(','))
  }
}

// ── 输出 ────────────────────────────────────────────────────────
console.log(`\n知识库完整性测试：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 项）`)
if (fail) {
  console.log('\n失败项：')
  for (const f of failures.slice(0, 40)) console.log('  ✗ ' + f)
  if (failures.length > 40) console.log(`  … 另有 ${failures.length - 40} 项`)
}
process.exit(fail ? 1 : 0)
