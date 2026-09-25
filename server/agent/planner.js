/**
 * LLM Planner + Skill Router
 * 不使用 if/else 硬编码流程。Planner 由 LLM 判断用户意图、抽取约束、规划需要调用的技能链；
 * LLM 不可用时降级为关键词路由 + 规则抽取（演示模式）。
 */
const llm = require('./llm')
const { SKILLS, BY_ID, FULL_PIPELINE, keywordRoute } = require('../skills')
const { expandAffected } = require('./dependencies')

const INTENTS = ['new_brief', 'revision', 'question', 'chat']

/**
 * 规划：返回 { intent, skills, constraints, reasoning, answer }
 */
async function plan({ message, session, history = [] }) {
  const hasOutput = Object.keys(session.outputs || {}).filter((k) => session.outputs[k]).length > 0
  const memorySummary = require('./memory').buildMemorySummary(session)

  if (!llm.isConfigured()) {
    return finalize(rulePlan({ message, session, hasOutput }))
  }

  const skillList = SKILLS.map((s) => `- ${s.id}｜${s.name}｜职责：${s.description}`).join('\n')
  const sys = `你是一个 AI 电影导演智能体的「规划器（Planner）」。你不写内容，只做规划与路由。

可用技能（skills）：
${skillList}

技能执行顺序必须遵循 stage 升序（按上面每个技能的 stage 字段）。

你需要判断用户意图：
- new_brief：用户给出新的故事想法/主题/情绪/视觉概念，需要启动完整创作流水线
- revision：用户要求修改已有方案。选择直接受影响的技能，系统会补齐所有下游依赖。局部修改保留无关环节；整体风格或故事修改允许更新全片。
- question：用户在提问、探讨电影创作，不需要产出方案，只需回答
- chat：寒暄或闲聊

**重要**：本智能体的定位是**主动完成创作决策**，不是问答。用户给出想法时默认 intent = new_brief，直接启动流水线；不要反问用户"你想怎么做"。

约束抽取：从用户消息中抽取
- duration：总时长（秒，数字；"两分钟"→120，"半小时"→1800）
- aspect：画幅，可选值 16:9 / 21:9 / 9:16 / 1:1（"竖屏"→9:16，"宽银幕"→21:9，"方形"→1:1）
- level：剧本等级 1-5（1 梗概 / 2 场景大纲 / 3 完整剧本 / 4 专业电影剧本 / 5 导演制作稿）
- platforms：AI 平台 id，可选值 seedance/runway/kling/sora/pika/midjourney/flux/jimeng/doubao/minimax_h3
- language：输出语言

只输出严格合法的 JSON，不要任何解释、不要 markdown 代码块：
{
  "intent": "new_brief|revision|question|chat",
  "skills": ["director_analysis", "..."],
  "constraints": { "duration": 300, "aspect": "21:9", "level": 4, "platforms": ["seedance"], "language": "zh" },
  "reasoning": "一句话说明你的规划理由",
  "answer": "当 intent 为 question/chat 时，直接给出你的回答；否则为空字符串"
}`

  const user = `${memorySummary ? memorySummary + '\n\n' : ''}【当前用户消息】${message}
${history.length ? '\n【最近对话】\n' + history.slice(-6).map((h) => `${h.role}: ${String(h.content).slice(0, 300)}`).join('\n') : ''}

请输出 JSON。`

  let raw = ''
  try {
    raw = await llm.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      // 规划结果必须是严格 JSON：截断后自动续写只会拼出「JSON + 散文」，更难解析，
      // 也白白浪费轮次。这里关掉续写，让上层直接走规则降级。
      { temperature: 0.2, maxTokens: 1200, maxContinuations: 0 }
    )
    const parsed = safeParseJSON(raw)
    if (!parsed || !parsed.intent) throw new Error('planner 输出无法解析')
    return finalize(normalize(parsed, { message, session, hasOutput }), message)
  } catch (e) {
    const fb = rulePlan({ message, session, hasOutput })
    fb.reasoning += `（LLM 规划失败已降级：${String(e.message).slice(0, 80)}）`
    return finalize(fb)
  }
}

/**
 * 规划结果的唯一出口：约束一律过白名单。
 *
 * 曾经只有 `normalize()`（LLM 路径）里做了清洗，`rulePlan()`（无 Key 的演示模式，
 * 以及 LLM 规划失败时的兜底）把 `extractConstraints` 的**原始结果**直接返回，
 * 由 orchestrator 合并进 session.constraints。于是「999999 秒的电影」会一路带进
 * constraintsText 与时长模式解析 —— 用户视角是「我写了 30 秒，方案却按两小时排」。
 * 教训同 PATCH /constraints 那次：**校验不能只加在一条路径上**。
 */
function finalize(result, message = '') {
  const skills = result.intent === 'revision'
    ? expandAffected([...result.skills, ...(message ? revisionSkills(message) : [])])
    : result.skills
  return { ...result, skills, constraints: sanitizeConstraints(result.constraints) }
}

function safeParseJSON(text) {
  if (!text) return null
  let t = String(text).trim()
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  // 复用统一容错（尾随逗号 / 零宽字符）—— 模型在规划这种短 JSON 上也常犯
  return require('../tools').extractJSONBlock('```json\n' + t + '\n```', null, true)
}

/** 判断消息是否含明显修订措辞 */
function isRevisionWording(text) {
  return /不要|不用|别用|改成|换成|换个|去掉|删掉|太[暗亮快慢长短多少]|重新|重做|调整|而是|不如|还是/.test(String(text || ''))
}

function normalize(parsed, { message, session, hasOutput }) {
  let intent = INTENTS.includes(parsed.intent) ? parsed.intent : (hasOutput ? 'revision' : 'new_brief')

  // 保护：已有产出 + 明显修订措辞 → 强制判定为 revision。
  // 否则 LLM 偶尔误判为 new_brief 会导致 11 个技能全量重跑（慢，且覆盖用户已确认的内容）。
  if (hasOutput && intent === 'new_brief' && isRevisionWording(message)) {
    intent = 'revision'
  }

  let skills = Array.isArray(parsed.skills) ? parsed.skills.filter((s) => BY_ID[s]) : []

  if (intent === 'new_brief' && skills.length === 0) skills = [...FULL_PIPELINE]
  if (intent === 'new_brief') {
    // 保证完整流水线（允许 Planner 少选，但至少覆盖 分析→结构→摄影→剧本→分镜→提示词）
    const required = ['director_analysis', 'story_structure', 'cinematography', 'screenplay', 'storyboard', 'prompt_engineering']
    for (const r of required) if (!skills.includes(r)) skills.push(r)
  }
  if (intent === 'revision' && skills.length === 0) skills = ['quality_control']
  // 大范围修改可能影响全片，不能按技能数量把必要的下游更新裁掉。
  skills = [...new Set(skills)].sort((a, b) => BY_ID[a].stage - BY_ID[b].stage)

  const constraints = sanitizeConstraints(parsed.constraints)

  return {
    intent,
    skills: intent === 'question' || intent === 'chat' ? [] : skills,
    constraints,
    reasoning: parsed.reasoning || '',
    answer: parsed.answer || '',
  }
}

/**
 * 约束白名单化。
 * LLM 抽出来的约束不可信：可能出现 aspect="2.39:1"、platforms=["Seedance"]、
 * duration=-5 这类值。它们会被原样写进 session.constraints，
 * 下游（知识库解析 / 提示词平台规范）只能各自兜底 —— 不如在入口统一清洗。
 */
const VALID_ASPECTS = ['16:9', '21:9', '9:16', '1:1']
// 平台白名单直接从知识库派生 —— 曾在这里另抄一份硬编码清单，
// 一旦知识库增删平台，两处就会悄悄不一致（表现为「某个平台选了却没规范」）。
const VALID_PLATFORMS = require('../knowledge/techniques').PROMPT_PLATFORMS.map((p) => p.id)

function sanitizeConstraints(raw) {
  const c = { ...(raw && typeof raw === 'object' ? raw : {}) }
  const n = Number(c.duration)
  if (!Number.isFinite(n) || n < 3 || n > 7200) delete c.duration
  else c.duration = Math.round(n)

  const lv = Number(c.level)
  if (!Number.isFinite(lv) || lv < 1 || lv > 5) delete c.level
  else c.level = Math.round(lv)

  if (c.aspect !== undefined) {
    const a = String(c.aspect).trim()
    if (VALID_ASPECTS.includes(a)) c.aspect = a
    else if (/2\.3[59]|宽银幕/.test(a)) c.aspect = '21:9'
    else if (/竖|9:16/.test(a)) c.aspect = '9:16'
    else if (/方|1:1/.test(a)) c.aspect = '1:1'
    else delete c.aspect
  }

  if (c.platforms !== undefined) {
    const list = (Array.isArray(c.platforms) ? c.platforms : [c.platforms])
      .map((x) => String(x).trim().toLowerCase().replace(/\s+/g, ''))
      .map((x) => (x === 'mj' ? 'midjourney' : x === 'h3' || x === 'minimax' ? 'minimax_h3' : x))
      .filter((x) => VALID_PLATFORMS.includes(x))
    if (list.length) c.platforms = [...new Set(list)]
    else delete c.platforms
  }

  if (c.language !== undefined) c.language = c.language === 'en' ? 'en' : 'zh'
  return c
}

/** 规则降级规划（演示模式） */
function rulePlan({ message, session, hasOutput }) {
  const t = String(message || '')
  const constraints = extractConstraints(t)

  const isQuestion = /[?？]$/.test(t.trim()) && !/生成|做一?个|帮我写|制作|短片|视频/.test(t)
  const looksLikeBrief = /做一?个|帮我|生成|短片|视频|故事|剧本|想法|主题|情绪|概念|秒/.test(t) || t.length > 20

  if (isQuestion) {
    return {
      intent: 'question',
      skills: [],
      constraints,
      reasoning: '检测到提问，直接回答（演示模式）',
      answer: '',
    }
  }

  if (hasOutput && /不要|改成|换成|调整|修改|更|再|增加|删|去掉|变成/.test(t)) {
    return {
      intent: 'revision',
      skills: revisionSkills(t),
      constraints,
      reasoning: `检测到修改意图，仅重跑受影响环节（演示模式）`,
      answer: '',
    }
  }

  return {
    intent: looksLikeBrief || !hasOutput ? 'new_brief' : 'question',
    skills: FULL_PIPELINE,
    constraints,
    reasoning: '检测到创作需求，启动完整导演流水线（演示模式）',
    answer: '',
  }
}

function revisionSkills(text) {
  const s = new Set(['quality_control'])
  if (/导演|风格|视觉|美学|流派|参考|调性|改成|换成/.test(text)) { s.add('director_analysis'); s.add('film_history'); s.add('visual_design') }
  if (/结构|叙事|节奏|幕|节拍|转折/.test(text)) s.add('story_structure')
  if (/摄影|镜头语言|焦段|光线|色彩|画幅|景深|构图/.test(text)) s.add('cinematography')
  if (/美术|材质|服装|空间|色调|色彩/.test(text)) s.add('visual_design')
  if (/分镜|机位|运动|景别|镜头/.test(text)) s.add('storyboard')
  if (/一致|连续性|穿帮|角色一致|连贯|漂移/.test(text)) s.add('continuity')
  if (/剧本|对白|情节|故事|段落|梗概|大纲|人物/.test(text)) s.add('screenplay')
  if (/提示词|prompt|生成|平台|Seedance|Runway|Kling|Sora|H3/.test(text)) s.add('prompt_engineering')
  if (/声音|音乐|音效|静默/.test(text)) s.add('sound_design')
  if (/剪辑|转场|时长|变速/.test(text)) s.add('editing')
  const constraints = extractConstraints(text)
  if (constraints.duration != null || /时长|缩短|加长/.test(text)) s.add('story_structure')
  if (constraints.aspect != null) s.add('cinematography')
  if (constraints.level != null) s.add('screenplay')
  if (constraints.platforms?.length) s.add('prompt_engineering')
  if (s.size === 1) {
    s.add('director_analysis'); s.add('cinematography'); s.add('visual_design')
    s.add('storyboard'); s.add('prompt_engineering')
  }
  return expandAffected([...s])
}

/** 解析阿拉伯数字或中文数字（支持 1-99，以及「半」） */
function parseNumberToken(s) {
  if (!s) return null
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s)
  const D = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (s === '半') return 0.5
  if (/^[零一二两三四五六七八九]$/.test(s)) return D[s]
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) {
    const tens = m[1] ? D[m[1]] : 1
    const ones = m[2] ? D[m[2]] : 0
    return tens * 10 + ones
  }
  return null
}

function extractConstraints(text) {
  const out = {}
  const t = String(text || '')
  // 时长：支持「30秒」「45s」「两分钟」「一小时」
  const dm = t.match(/(\d+(?:\.\d+)?|[零一二两三四五六七八九十半]{1,3})\s*(小时|分钟|分|秒钟|秒|hours?|hrs?|h|min|sec|s)/i)
  if (dm) {
    const n = parseNumberToken(dm[1])
    if (n != null) {
      const unit = dm[2].toLowerCase()
      const mult = /^(小时|h|hour)/.test(unit) ? 3600 : /^(分钟|分|min)/.test(unit) ? 60 : 1
      out.duration = Math.round(n * mult)
    }
  }
  // 画幅：21:9 / 16:9 / 9:16 / 1:1（含中文口语说法）
  if (/竖屏|竖构图|9:16|手机竖/.test(t)) out.aspect = '9:16'
  else if (/21:9|2\.39|2\.35|宽银幕|变形宽银幕|电影画幅/.test(t)) out.aspect = '21:9'
  else if (/1:1|方形|正方形/.test(t)) out.aspect = '1:1'
  else if (/16:9|横屏|横构图|标准宽屏/.test(t)) out.aspect = '16:9'

  // 剧本等级：Level 1-5 / 梗概 / 大纲 / 完整剧本 / 专业剧本 / 制作稿
  const lvMatch = t.match(/(?:level|等级|lv|L)\s*([1-5１-５])/i)
  if (lvMatch) {
    out.level = Number(String(lvMatch[1]).replace(/[１-５]/, (c) => '１２３４５'.indexOf(c) + 1))
  } else if (/梗概|一句话|logline|概要/.test(t)) out.level = 1
  else if (/场景大纲|大纲|分场/.test(t)) out.level = 2
  else if (/导演制作稿|制作稿|拍摄稿/.test(t)) out.level = 5
  else if (/专业剧本|可开机|拍摄剧本/.test(t)) out.level = 4
  else if (/完整剧本|全剧本|写.*剧本/.test(t)) out.level = 3

  const platformMap = {
    seedance: 'seedance', runway: 'runway', kling: 'kling', '可灵': 'kling', sora: 'sora',
    pika: 'pika', midjourney: 'midjourney', mj: 'midjourney', flux: 'flux',
    '即梦': 'jimeng', jimeng: 'jimeng', '豆包': 'doubao', doubao: 'doubao',
    'minimax': 'minimax_h3', '海螺': 'minimax_h3',
  }
  const plats = []
  const lower = t.toLowerCase()
  for (const [k, v] of Object.entries(platformMap)) {
    if (lower.includes(k.toLowerCase())) plats.push(v)
  }
  // H3 需按词边界匹配，避免误伤含 "h3" 的普通词
  if (/\bh3\b/i.test(t)) plats.push('minimax_h3')
  if (plats.length) out.platforms = [...new Set(plats)]
  return out
}

module.exports = { plan, rulePlan, extractConstraints, safeParseJSON, sanitizeConstraints, revisionSkills, isRevisionWording }
