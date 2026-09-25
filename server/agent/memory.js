/**
 * Memory System — 会话记忆 + 项目记忆
 * 1) 短期：会话消息历史（多轮对话上下文）
 * 2) 长期：项目记忆（Brief、已确定的风格、视觉规则、用户偏好、修订历史）
 * 3) 语义记忆：从历史修订中提取的"用户偏好规则"，在后续生成中自动遵守
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('../config')

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

function sessionFile(id) {
  // 非法字符必须「拒绝」，不能删除后继续使用。
  // 否则 `../sess_x` 与 `sess_x` 会映射到同一个文件，读、写、删都可能误伤另一个项目。
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return null
  return path.join(SESSIONS_DIR, `${id}.json`)
}

function createSession(title = '新项目') {
  ensure()
  const id = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const session = {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    brief: '',
    constraints: {
      duration: 300,          // 默认 5 分钟
      aspect: '21:9',         // 默认宽银幕
      level: 4,               // 默认专业电影剧本
      platforms: ['seedance', 'kling', 'runway', 'minimax_h3', 'midjourney'],
      language: 'zh',
    },
    messages: [],
    outputs: {},      // { analysis, references, structure, cinematography, visualBible, screenplay, storyboard, continuity, prompts, sound, editing, review }
    shots: [],        // 解析出的结构化分镜
    promptData: null, // 解析出的结构化提示词
    continuityData: null,   // 解析出的连续性圣经
    promptValidation: null, // 提示词 13 要素校验结果
    reviewScores: null,     // 导演审核评分
    stageReviews: {},       // 每环节当前产出对应的审核
    memory: {
      preferences: [],   // 用户偏好规则（语义记忆）
      revisions: [],     // 修订历史
      decisions: [],     // 已确定的创作决策
    },
    pipeline: [],       // 已执行的技能链
    skillHistory: [],   // 历史执行过的技能并集（增量修改时不丢完成标记）
    pendingSkills: [],  // 生成中断/失败后仍需更新的环节
  }
  saveSession(session)
  return session
}

/**
 * 会话结构归一化。
 *
 * 磁盘上的会话文件可能结构不完整：旧版本写入的、被手工编辑过的、
 * 或写入过程中进程被杀导致的半截文件。此时 `loadSession` 能成功 parse，
 * 但后续 `session.messages.push()` / `session.memory.revisions.push()`
 * 会直接抛 `TypeError: Cannot read properties of undefined` ——
 * 用户视角就是「打开旧项目，一发消息就失败」。
 *
 * 前端早已用同名的 normalizeSession() 防住这一类问题，服务端也必须做，
 * 否则坏数据会一路走到编排器里才炸。
 */
function normalizeSession(s) {
  if (!s || typeof s !== 'object') return null
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  const arr = (v) => (Array.isArray(v) ? v : [])
  // 约束走与 planner 同一套白名单，**不再各写一份边界**（那正是「两处校验规则漂移」的来源）。
  // 懒加载：planner 会 require memory，顶层互相 require 会形成环。
  // 顺带实现存量自愈 —— 旧版本或手工编辑过的会话里可能存着 duration=999999、
  // aspect="banana" 这类值，加载时就被纠正，而不是一路带进 UI 和时长模式解析。
  const { sanitizeConstraints } = require('./planner')
  const c = sanitizeConstraints(obj(s.constraints))
  const outputs = obj(s.outputs)
  const byId = require('../skills').BY_ID
  const stageReviews = {}
  const staleReviewIds = []
  for (const [id, raw] of Object.entries(obj(s.stageReviews))) {
    const review = obj(raw)
    const key = byId[id]?.outputKey
    const digest = key ? crypto.createHash('sha256').update(String(outputs[key] || '')).digest('hex') : ''
    if (!key || !['pass', 'warn', 'block', 'unverified'].includes(review.status) || review.outputHash !== digest) {
      if (key) staleReviewIds.push(id)
      continue
    }
    stageReviews[id] = {
      status: review.status, outputHash: digest, at: Number(review.at) || 0,
      kind: typeof review.kind === 'string' ? review.kind : '',
      note: typeof review.note === 'string' ? review.note.slice(0, 500) : '',
      issues: arr(review.issues).slice(0, 3).map(issue => ({
        code: String(issue?.code || '').slice(0, 80),
        evidence: String(issue?.evidence || '').slice(0, 500),
        suggestion: String(issue?.suggestion || '').slice(0, 500),
        severity: String(issue?.severity || '').slice(0, 20),
      })),
    }
  }
  const { expandAffected } = require('./dependencies')
  const pendingFromStale = staleReviewIds.length ? expandAffected(staleReviewIds) : []
  return {
    ...s,
    id: s.id || 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: typeof s.title === 'string' && s.title ? s.title : '未命名项目',
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now(),
    brief: typeof s.brief === 'string' ? s.brief : '',
    constraints: {
      duration: c.duration != null ? c.duration : 300,
      aspect: c.aspect != null ? c.aspect : '21:9',
      level: c.level != null ? c.level : 4,
      platforms: arr(c.platforms).length ? c.platforms : ['seedance', 'kling', 'runway', 'minimax_h3', 'midjourney'],
      language: c.language === 'en' ? 'en' : 'zh',
    },
    messages: arr(s.messages),
    outputs,
    shots: arr(s.shots),
    promptData: s.promptData || null,
    continuityData: s.continuityData || null,
    promptValidation: s.promptValidation || null,
    reviewScores: Array.isArray(s.reviewScores) ? s.reviewScores : null,
    stageReviews,
    memory: {
      preferences: arr(s.memory?.preferences),
      revisions: arr(s.memory?.revisions),
      decisions: arr(s.memory?.decisions),
    },
    pipeline: arr(s.pipeline),
    skillHistory: arr(s.skillHistory),
    pendingSkills: [...new Set([...arr(s.pendingSkills).filter(id => typeof id === 'string'), ...pendingFromStale])],
  }
}

function loadSession(id) {
  ensure()
  const f = sessionFile(id)
  if (!f || !fs.existsSync(f)) return null
  try {
    const session = normalizeSession(JSON.parse(fs.readFileSync(f, 'utf8')))
    if (!session) return null
    // 文件名是会话身份的唯一可信来源。磁盘内容里的 id 可能缺失、过期或被手改；
    // 若继续信任它，下一次 saveSession() 会把当前项目写到另一个文件。
    session.id = id
    return session
  } catch { return null }
}

/**
 * 原子写入：先写临时文件再 rename。
 * 直接 writeFileSync 时若进程在写入中途退出（用户强退 / 系统休眠 / 断电），
 * 会留下一个**半截的 JSON**，下次打开该项目就永久损坏。
 * rename 在同一分区上是原子操作，要么是旧文件、要么是新文件。
 */
function saveSession(session) {
  ensure()
  if (!session || !sessionFile(session.id)) {
    throw new TypeError('invalid session id')
  }
  session.updatedAt = Date.now()
  session.editVersion = (Number.isInteger(session.editVersion) ? session.editVersion : 0) + 1
  const target = sessionFile(session.id)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, target)
  } catch (e) {
    // 极端情况下 rename 失败（目标被占用等）：退回直接写，并清掉临时文件
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    fs.writeFileSync(target, JSON.stringify(session, null, 2), 'utf8')
  }
  return session
}

function listSessions() {
  ensure()
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => {
    if (!f.endsWith('.json')) return false
    return SESSION_ID_RE.test(f.slice(0, -5))
  })
  const list = []
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      // id 以**文件名**为准，不用文件内容里的 id。
      // 文件是按 sessionFile(id) 命名的，只有用文件名才能保证「列表里点一下」
      // 一定加载回同一个文件；内容里的 id 可能是旧的、被手工改过的、或干脆缺失 ——
      // 照它返回会出现「点了没反应」或「打开的是另一个项目」。
      const id = f.replace(/\.json$/, '')
      const out = raw.outputs
      const hasOut = out && typeof out === 'object' && !Array.isArray(out) && Object.keys(out).length > 0
      list.push({
        id,
        title: typeof raw.title === 'string' && raw.title ? raw.title : '未命名项目',
        updatedAt: Number(raw.updatedAt) || 0,
        brief: typeof raw.brief === 'string' ? raw.brief : '',
        pipeline: Array.isArray(raw.pipeline) ? raw.pipeline : [],
        hasOutput: Boolean(hasOut),
      })
    } catch { /* 坏文件跳过，不影响其余项目 */ }
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

function deleteSession(id) {
  ensure()
  const f = sessionFile(id)
  if (f && fs.existsSync(f)) fs.unlinkSync(f)
}

/**
 * 生成记忆摘要，注入 LLM 上下文，保证多轮对话的连贯性与"增量修改"能力
 */
function buildMemorySummary(session) {
  if (!session) return ''
  const lines = []
  if (session.brief) lines.push(`【项目 Brief】${session.brief}`)
  const c = session.constraints || {}
  lines.push(`【约束】时长 ${c.duration}s｜画幅 ${c.aspect}｜目标平台 ${(c.platforms || []).join('/')}`)

  const done = Object.keys(session.outputs || {}).filter((k) => session.outputs[k])
  if (done.length) lines.push(`【已完成的创作环节】${done.join('、')}`)

  const m = session.memory || {}
  if (m.decisions?.length) lines.push(`【已确定的创作决策】\n- ${m.decisions.slice(-8).join('\n- ')}`)
  if (m.preferences?.length) lines.push(`【用户偏好（必须遵守）】\n- ${m.preferences.slice(-10).join('\n- ')}`)
  if (m.revisions?.length) {
    lines.push(`【最近的修改要求（体现用户意图）】\n- ${m.revisions.slice(-5).map((r) => r.instruction).join('\n- ')}`)
  }
  return lines.join('\n')
}

/** 提取"风格/约束"类偏好，写入语义记忆 */
function extractPreferences(instruction) {
  const rules = []
  const t = String(instruction || '')
  // 先按句读切分，避免跨子句误捕获
  const clauses = t.split(/[，。；、,;.!?！？\n]/).map((s) => s.trim()).filter(Boolean)
  const patterns = [
    [/(?:不要|别|不用|避免)(.{1,20}?)(?:了|吧)?$/, (a) => `禁止：${a}`],
    [/(?:改成|换成|改为|变成|调整为)(.{1,24})$/, (a) => `偏好方向：${a}`],
    [/(?:必须|一定要|务必)(.{1,24})$/, (a) => `强制要求：${a}`],
    [/(?:更|再)(.{1,12})一点$/, (a) => `倾向「更${a}」`],
    [/(?:要|希望|偏向)(.{1,20})$/, (a) => `倾向：${a}`],
  ]
  for (const clause of clauses) {
    for (const [re, fn] of patterns) {
      const m = clause.match(re)
      if (m && m[1]) { rules.push(fn(m[1].trim())); break }
    }
    if (rules.length > 6) break
  }
  return [...new Set(rules)]
}

module.exports = {
  createSession, loadSession, saveSession, listSessions, deleteSession, normalizeSession,
  buildMemorySummary, extractPreferences, SESSIONS_DIR,
}
