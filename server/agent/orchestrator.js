/**
 * Orchestrator — 智能体编排器
 * Planner → Skill Router → Tool Calling → Memory → 流式产出
 */
const llm = require('./llm')
const planner = require('./planner')
const memory = require('./memory')
const { loadSettings } = require('../config')
const kb = require('../knowledge')
const { BY_ID, FULL_PIPELINE } = require('../skills')
const { CONTRACT_BY_SKILL } = require('../skills/contracts')
const { getTool } = require('../tools')
const { productionChecks } = require('./production-checks')
const { reviewStage } = require('./stage-review')

function constraintsText(c) {
  const parts = []
  parts.push(`总时长：${c.duration || 300} 秒`)
  parts.push(`画幅：${c.aspect || '21:9'}`)
  parts.push(`剧本等级：Level ${c.level || 4}`)
  if (c.platforms?.length) parts.push(`目标 AI 平台：${c.platforms.join('、')}`)
  parts.push(`输出语言：${c.language === 'en' ? '英文' : '中文'}`)
  return parts.join('｜')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 截断文本。
 * 后面的环节会引用前面所有产出，若放任其增长，请求体可达数十 KB ——
 * 真实服务商常在请求体过大时直接断开连接（即 fetch failed / ECONNRESET）。
 */
function clip(text, max) {
  const s = String(text || '')
  if (s.length <= max) return s
  return s.slice(0, max) + '\n\n…（前文较长，此处已截断以保证请求稳定）'
}

/**
 * 每个环节实际引用的上游产出（outputKey）。
 * 早期实现把「所有历史产出」都塞给每个环节，越往后提示词越膨胀 ——
 * 后段环节（提示词 / 连续性 / 审核）一次就要吃掉上万 token 的上下文。
 * 这里按真实依赖精确投递，既省 token 又减少干扰。
 *
 * ⚠️ 新增/调整环节时必须同步维护这张表，并跑 `npm run test:wiring`。
 *    曾经漏掉的两条接线（都属"环节跑了但产出没人用"）：
 *    · continuity → prompt_engineering：连续性圣经的全部意义就是给提示词工程锁一致性，
 *      漏了它等于白跑一个环节（continuity.js 的注释里写明了它必须在上游）。
 *    · references → cinematography / visual_design：film_history 的产出小节标题
 *      就叫「参考档案速查（给制作团队）」，但当时没有任何环节接收。
 */
const { PRIOR_DEPS, expandAffected, affectedByConstraints } = require('./dependencies')

/**
 * 每个环节真正需要的知识库段落（按【小节名】前缀匹配）。
 * 全库正文 7000+ 字，只有导演分析需要其中大段内容；
 * 其余环节只取各自真正会写进提示词的那一小节。
 *
 * ⚠️ 这里声明的段落会被 makeCtx 切出来放进 ctx.knowledge.contextText。
 *    **如果某个 Skill 的 buildPrompt 不读 contextText，这一段就是白算的** ——
 *    既浪费预算又误导后来者。声明的段落必须真的被用上（`test:wiring` 会校验）。
 *    已据此收敛：cinematography 只需「摄影规格库」；screenplay 用结构化
 *    durationMode/scriptLevel，不需要正文段落。
 */
const KNOWLEDGE_SECTIONS = {
  director_analysis: ['Step 1', 'Step 2', '画幅决策', '类型方法论', '可调用风格库', '可参考影片', '摄影规格库', '本次制作规格'],
  film_history: [],          // 只用 knowledge.directors / films
  story_structure: [],       // 只用 knowledge.structures / durationMode
  cinematography: ['摄影规格库'],
  visual_design: [],         // 色彩/材质/体系已改为结构化直取
  screenplay: [],            // 只用结构化 durationMode / scriptLevel
  storyboard: ['摄影规格库'],   // 逐镜的机型/焦段/景别/运镜必须来自规格库
  continuity: [],
  prompt_engineering: [],    // 只用 platforms / promptElements / bannedWords
  sound_design: ['声音层'],
  editing: ['剪辑手法'],
  quality_control: [],       // 只用 knowledge.checks
}

/** 单个上游产出的基础字符预算 */
const BASE_PRIOR = 1600
const MIN_PRIOR = 220
/** 知识库上下文的基础字符预算 */
const BASE_KNOWLEDGE = 7000
const MIN_KNOWLEDGE = 1200
/** 上下文预算的最小缩放比例（低于此就不再压了，压坏了产出质量反而更糟） */
const MIN_SCALE = 0.18
/** 环节之间的最小间隔（毫秒），降低触发服务商限流的概率 */
const STAGE_GAP = 700
/**
 * 单个环节的最小产出长度（字符）。
 * 低于此值说明 LLM 只回了标题或干脆是空的 —— 必须重取，
 * 否则下游环节拿到的就是「只有标题、正文为空」的方案。
 */
const MIN_OUTPUT = 400

/**
 * LLM 重取后仍只返回极短内容时的用户提示。
 *
 * 不建议用户手工放大 maxTokens：旧版正是这条建议诱导出了 `1e+99` 的脏设置，
 * 而且短输出也未必是 token 上限导致的（服务商提前结束、模型未遵循格式同样常见）。
 * 真正可控的处理是减少本环节需求量，或换用输出能力更稳定的模型。
 */
function shortOutputNotice(length) {
  return `\n\n> ⚠️ 本环节输出异常短（${length} 字）。\n` +
    '> 可能原因：服务商提前结束生成、模型未遵循完整输出要求，或本环节要求的内容量过大。\n' +
    '> 建议：缩短影片总时长或减少镜头数量后重跑；若仍反复出现，请在「设置」中测试连接，或换用上下文与长输出能力更稳定的模型。'
}

/** 中文为主：保守估算 1 字符 ≈ 0.75 token（宁可高估，保证安全） */
const estTokens = (s) => Math.ceil(String(s || '').length * 0.75)

/**
 * 构建某个环节的上下文。
 * 提示词体积是「每个环节都超限」的另一半原因：流水线越往后，引用的历史产出越多。
 * 这里按环节精确投递（只给依赖的产出 + 需要的知识段落），并按 scale 缩放。
 */
function makeCtx(session, knowledge, revision, skillId, scale = 1) {
  const deps = PRIOR_DEPS[skillId] || []
  const perItem = Math.max(MIN_PRIOR, Math.round(BASE_PRIOR * scale))
  const prior = {}
  for (const k of deps) {
    const v = session.outputs?.[k]
    if (v) prior[k] = clip(v, perItem)
  }
  const wanted = KNOWLEDGE_SECTIONS[skillId] || []
  const sections = knowledge.contextSections || kb.splitSections(knowledge.contextText || '')
  const secText = wanted.length ? kb.pickSections(sections, wanted) : ''
  const kCap = Math.max(MIN_KNOWLEDGE, Math.round(BASE_KNOWLEDGE * scale))
  return {
    brief: session.brief,
    knowledge: {
      ...knowledge,
      contextText: clip(secText, kCap),
      referenceText: require('../knowledge/references').referenceText(
        [session.brief, revision, session.constraints?.platform].filter(Boolean).join(' '),
        skillId, Math.floor(1800 * Math.max(0, Math.min(1, scale)))),
      // 供 prompt_engineering 使用的要素与禁用词清单
      promptElements: kb.PROMPT_ELEMENTS,
      bannedWords: kb.BANNED_PROMPT_WORDS,
      checks: kb.QUALITY_CHECKS,
      platforms: kb.PROMPT_PLATFORMS,
    },
    constraints: session.constraints,
    constraintsText: constraintsText(session.constraints),
    prior,
    priorShots: session.shots,
    revision: revision || null,
    _scale: scale,
  }
}

/** 测量一个环节的完整提示词体积（字符） */
function promptSize(skill, ctx, extraSuffix = '') {
  return String(skill.systemPrompt || '').length +
    String(skill.buildPrompt(ctx) || '').length +
    String(CONTRACT_BY_SKILL[skill.id] || '').length +
    String(extraSuffix || '').length
}

/**
 * 自适应预算：先按 100% 构建，超限就按比例收缩，直到装得下。
 * 这样无论用户填的是 8k 还是 128k 上下文，都不用手动调参数。
 */
function fitContext(skill, buildCtx, capChars, extraSuffix = '') {
  let scale = 1
  let ctx = buildCtx(skill.id, scale)
  let size = promptSize(skill, ctx, extraSuffix)
  while (size > capChars && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, scale * 0.62)
    ctx = buildCtx(skill.id, scale)
    size = promptSize(skill, ctx, extraSuffix)
  }
  return { ctx, scale, size, cap: capChars }
}

/**
 * 单个环节的输入上限（字符）。
 * 依据「模型上下文窗口 - 本次要预留给输出的空间」反推。
 * 输出预留 = maxTokens × 1.15（留出标点/格式开销）+ 固定余量。
 */
function inputCapChars() {
  const s = loadSettings()
  const win = Number(s.contextWindow) || 32768
  const want = Number(s.maxTokens) || 8192
  // 必须与 llm.effectiveMaxTokens 用同一口径：小窗口下输出预算会被压到 win*0.45，
  // 这里按未压缩值预留会白白吃掉输入空间。
  const out = Math.max(1024, Math.min(want, Math.floor(win * 0.45)))
  const capTokens = Math.floor(win * 0.85) - Math.ceil(out * 1.15) - 600
  // token → 字符（0.75 token/字），并设下限，避免预算压到 0 导致产出没内容
  return Math.max(3200, Math.floor(Math.max(capTokens, 2400) / 0.75))
}

/** 演示模式：把文本按块吐出，模拟流式 */
async function streamDemo(text, onDelta) {
  const chunk = 30
  for (let i = 0; i < text.length; i += chunk) {
    onDelta(text.slice(i, i + chunk))
    await sleep(6)
  }
}

/**
 * 主执行流程
 * @param {object} session
 * @param {string} message
 * @param {(event: string, data: any) => void} emit
 * @param {{ isAborted?: () => boolean }} [opts] isAborted 用于响应「停止」按钮：
 *   前端 abort fetch 后服务端并不会自动停，若不检查就会把 12 个环节全部跑完 ——
 *   用户已经点了停止，额度却还在烧。
 */
async function run(session, message, emit, opts = {}) {
  const isAborted = typeof opts.isAborted === 'function' ? opts.isAborted : () => false
  const staged = Number.isInteger(opts.targetStage)
  const targetStage = opts.targetStage
  const isNew = !session.brief
  if (opts.continueOnly && isNew) throw new Error('请先输入故事想法，再继续制作。')
  if (isNew) {
    session.brief = message
    session.title = message.slice(0, 24) + (message.length > 24 ? '…' : '')
  }
  session.messages.push({ role: 'user', content: message, at: Date.now() })

  // ── 1. 规划 ──────────────────────────────────────────────
  emit('status', { phase: 'planning', text: '导演正在分析这个故事…' })
  const planResult = opts.continueOnly ? {
    intent: 'continue', skills: [], constraints: {}, reasoning: '从已保存的成果继续制作', answer: '',
  } : await planner.plan({
    message,
    session,
    history: session.messages.slice(-8),
  })
  if (staged && isNew && ['question', 'chat'].includes(planResult.intent)) {
    planResult.intent = 'new_brief'
    planResult.reasoning = '用户明确选择了分段创作终点'
  }

  const nextConstraints = { ...session.constraints, ...planResult.constraints }
  if (staged && !['question', 'chat'].includes(planResult.intent)) {
    const permitted = FULL_PIPELINE.filter(id => BY_ID[id].stage <= targetStage && id !== 'quality_control')
    if (opts.continueOnly) {
      planResult.skills = permitted.filter(id => !session.outputs[BY_ID[id].outputKey] || session.pendingSkills?.includes(id))
      if (!planResult.skills.length) throw new Error('所选终点之前的环节均已完成。请选择更后的环节，或输入修改要求。')
      if (permitted.some(id => session.stageReviews?.[id]?.status === 'block') && !opts.retryBlocked) {
        throw new Error('此前环节存在阻断问题。请提出修改要求，或使用重新生成该环节。')
      }
    } else if (isNew) {
      planResult.skills = permitted
    } else {
      const wanted = new Set([...(planResult.skills || []), ...(session.pendingSkills || []), ...affectedByConstraints(session.constraints, nextConstraints)])
      planResult.skills = permitted.filter(id => wanted.has(id))
    }
  }
  const wouldRun = staged ? planResult.skills : expandAffected([...(planResult.skills || []), ...(session.pendingSkills || []), ...affectedByConstraints(session.constraints, nextConstraints)])
  if (!['question', 'chat'].includes(planResult.intent) && session.shots.some(s => s.locked) && (!wouldRun.length || wouldRun.includes('storyboard') || wouldRun.includes('prompt_engineering'))) {
    throw new Error('项目中有锁定镜头。请使用分镜卡片的局部重做，或先解锁后再生成整案；锁定镜头未被覆盖。')
  }
  if (Object.keys(session.outputs || {}).length) {
    session.pendingSkills = [...new Set([...(session.pendingSkills || []), ...affectedByConstraints(session.constraints, nextConstraints)])]
  }
  session.constraints = nextConstraints
  if (planResult.intent === 'revision' && !staged) {
    planResult.skills = expandAffected([...planResult.skills, ...(session.pendingSkills || [])])
  }
  if (staged && !['question', 'chat'].includes(planResult.intent) && !planResult.skills.length) {
    throw new Error('本次没有可运行的环节。请选择更后的终点，或提出具体修改要求。')
  }
  emit('plan', {
    intent: planResult.intent,
    skills: planResult.skills,
    skillNames: planResult.skills.map((s) => ({
      id: s, name: BY_ID[s].name, role: BY_ID[s].role, stage: BY_ID[s].stage,
    })),
    reasoning: planResult.reasoning,
    constraints: session.constraints,
    mode: llm.isConfigured() ? 'llm' : 'demo',
  })

  // ── 2. 提问/闲聊：直接回答 ────────────────────────────────
  if (planResult.intent === 'question' || planResult.intent === 'chat') {
    emit('status', { phase: 'answering', text: '导演正在回答…' })
    let answer = planResult.answer || ''
    if (!answer && llm.isConfigured()) {
      const sys = `你是一位拥有 20 年以上电影工业经验的导演、编剧与摄影指导。
用专业、具体、有判断力的语言回答用户的电影创作问题。
**不要只说"可以考虑"，要给出你的判断与理由**——用户需要的是决策，不是选项列表。
禁止空话与教科书式定义，每个建议必须可执行。使用 Markdown。`
      const ctxSummary = memory.buildMemorySummary(session)
      emit('answer_start', {})
      answer = await llm.chatStream(
        [
          { role: 'system', content: sys },
          { role: 'user', content: `${ctxSummary}\n\n【问题】${message}` },
        ],
        (d) => emit('answer_delta', { delta: d })
      )
    } else if (!answer) {
      answer = '（演示模式）我已记录你的问题。在「设置」中填入 LLM API Key 后，我可以展开完整的电影创作讨论。\n\n你也可以直接给我一个想法——我会主动完成从创意到成片方案的完整决策，例如："一个人在宇宙尽头寻找死亡的答案，做成 5 分钟的宽银幕。"'
      emit('answer_start', {})
      await streamDemo(answer, (d) => emit('answer_delta', { delta: d }))
    } else {
      emit('answer_start', {})
      await streamDemo(answer, (d) => emit('answer_delta', { delta: d }))
    }
    session.messages.push({ role: 'assistant', content: answer, at: Date.now() })
    memory.saveSession(session)
    emit('done', { session: publicSession(session) })
    return
  }

  // ── 3. 修订记忆 ──────────────────────────────────────────
  if (planResult.intent === 'revision') {
    session.memory.revisions.push({ instruction: message, at: Date.now() })
    const prefs = memory.extractPreferences(message)
    if (prefs.length) {
      session.memory.preferences = [...new Set([...(session.memory.preferences || []), ...prefs])].slice(-20)
    }
    emit('memory', { preferences: session.memory.preferences, revisions: session.memory.revisions.slice(-5) })
  }

  // ── 4. 知识库检索 + 导演决策（Tool Calling）─────────────
  emit('status', { phase: 'retrieving', text: '正在检索电影知识库并生成导演决策…' })
  const c = session.constraints
  const knowledge = getTool('knowledge.search').run({
    brief: session.brief,
    aspect: c.aspect,
    duration: c.duration,
    level: c.level,
  })
  emit('knowledge', {
    genres: knowledge.analysis.genres.map((g) => g.name),
    moods: knowledge.analysis.moods.map((m) => m.name),
    conflict: knowledge.analysis.primaryConflict,
    positioning: knowledge.analysis.positioning.level,
    styles: knowledge.styles.map((s) => ({ id: s.id, name: s.name, summary: s.summary })),
    directors: knowledge.directors.map((d) => ({
      id: d.id, name: d.name, signature: d.signature, reasons: d._reasons || [],
    })),
    structures: knowledge.structures.map((s) => ({ id: s.id, name: s.name, reasons: s._reasons || [] })),
    visualSystems: knowledge.visualSystems.map((v) => v.name),
    colors: knowledge.colors.map((c2) => c2.name),
    aspectRatio: knowledge.aspectRatio.name,
    durationMode: knowledge.durationMode.label,
    scriptLevel: `Level ${knowledge.scriptLevel.id} ${knowledge.scriptLevel.name}`,
    films: knowledge.films.map((f) => `${f.title}(${f.year})`),
  })

  // ── 5. 逐技能执行 ────────────────────────────────────────
  const skills = planResult.skills.length ? planResult.skills : [...FULL_PIPELINE]
  if (!llm.isConfigured()) session.generationMode = 'demo'
  else if (session.generationMode !== 'demo' || skills.length === Object.keys(BY_ID).length) session.generationMode = 'llm'
  session.pipeline = skills
  session.skillHistory = [...new Set([...(session.skillHistory || []), ...skills])]
  session.pendingSkills = [...new Set([...(session.pendingSkills || []), ...skills])]
  memory.saveSession(session)

  const capChars = inputCapChars()
  const revisionText = planResult.intent === 'revision' ? message : null

  const buildCtx = (skillId, sc = 1) => makeCtx(session, knowledge, revisionText, skillId, sc)

  /**
   * 自适应预算：先按 100% 构建，超限就按比例收缩，直到装得下。
   * 这样无论用户填的是 8k 还是 128k 上下文，都不用手动调参数。
   */
  const fitCtx = (skill, extraSuffix = '') =>
    fitContext(skill, buildCtx, capChars, extraSuffix)

  let fatal = null
  let aborted = false
  let blockedReview = false
  // ctx 在循环内由 fitCtx 重新构建；这里的初值只为 skills 为空时兜底
  let ctx = buildCtx(skills[0] || 'director_analysis')

  for (let i = 0; i < skills.length; i++) {
    if (fatal) break
    // 用户点了「停止」：立刻收手，已完成的环节已逐个落盘，不会丢
    if (isAborted()) { aborted = true; break }
    const skillId = skills[i]
    const skill = BY_ID[skillId]
    if (!skill) continue
    if (staged) {
      session.stageReviews = session.stageReviews || {}
      for (const affected of expandAffected([skillId])) delete session.stageReviews[affected]
      session.reviewScores = null
      session.pendingSkills = [...new Set([...(session.pendingSkills || []).filter(id => id !== 'quality_control'),
        ...expandAffected([skillId]).filter(id => id !== 'quality_control')])]
      memory.saveSession(session)
    }

    // 环节之间留出间隔，降低触发服务商限流（429）的概率
    if (i > 0 && llm.isConfigured()) await sleep(STAGE_GAP)

    emit('stage_start', {
      skill: skill.id,
      name: skill.name,
      role: skill.role,
      stage: skill.stage,
      index: i + 1,
      total: skills.length,
    })

    const revisionPrefix = ctx.revision
      ? `\n\n【⚠️ 本次为修订任务，用户的最新要求是】\n"${ctx.revision}"\n请严格按此要求修改，保持未被要求修改的部分不变。禁止推翻整体方案重新开始。\n`
      : ''
    // 导演台增强 Skill Pack v1.0 的输出契约（强制结构化正文 + 禁用空泛词 + 解释为什么）
    const contract = CONTRACT_BY_SKILL[skill.id] || ''

    // 按本环节的输入上限自适应构建上下文
    let fitted = fitCtx(skill, revisionPrefix)
    ctx = fitted.ctx

    let text = ''
    let stageFailed = false
    try {
      if (llm.isConfigured()) {
        // 若服务商仍报上下文超长，继续收缩预算重试（最多 3 次），而不是直接放弃该环节
        let shrinkTries = 0
        while (true) {
          try {
            const messages = [
              { role: 'system', content: skill.systemPrompt },
              { role: 'user', content: skill.buildPrompt(ctx) + revisionPrefix + contract },
            ]
            text = await llm.chatStream(messages, (d) => emit('delta', { skill: skill.id, delta: d }), {
              // 输出被模型上限截断时会自动续写，这里给出可见进度，避免界面像卡住
              onContinue: (n) => emit('status', {
                phase: 'continuing',
                text: `${skill.name}：内容较长，正在续写第 ${n} 段…`,
              }),
            })
            break
          } catch (err) {
            const m = String(err && err.message || err)
            if (llm.isContextOverflow(m) && shrinkTries < 3) {
              shrinkTries += 1
              const sc = Math.max(MIN_SCALE * 0.5, (ctx._scale ?? 1) * 0.55)
              ctx = buildCtx(skill.id, sc)
              emit('status', {
                phase: 'shrinking',
                text: `上下文超出模型上限，已自动精简后重试（第 ${shrinkTries} 次）…`,
              })
              continue
            }
            throw err
          }
        }
      } else {
        text = skill.demo(ctx)
        await streamDemo(text, (d) => emit('delta', { skill: skill.id, delta: d }))
      }
    } catch (e) {
      stageFailed = true
      const msg = String(e.message || e)
      emit('error', { skill: skill.id, message: msg })
      text = (session.outputs[skill.outputKey] || '') + `\n\n> ⚠️ 本环节生成失败：${msg.slice(0, 200)}`
      // LLM 连通性 / 鉴权 / 配额类错误：中断后续环节。
      // 否则 11 个技能会连续报同一个错 —— 用户视角就是「全流程失败」。
      if (llm.isConfigured() && /超时|连接|网络|认证|鉴权|401|403|API[ _-]?Key|模型名称|模型不存在|ECONN|ENOTFOUND|CERT|SSL|被拒绝|无法解析|quota|余额|insufficient|rate.?limit|context|上下文|过长|token/i.test(msg)) {
        fatal = msg
      }
    }

    // ── 输出过短保护 ──────────────────────────────────────
    // 现象：LLM 只回了章节标题、正文为空（多为输出被截断，或模型敷衍）。
    // 处理：收缩上下文 + 明确要求，用非流式再要一次；仍短则给出可操作提示。
    if (!stageFailed && llm.isConfigured() && String(text || '').trim().length < MIN_OUTPUT) {
      try {
        const tighter = '\n\n【重要】上一次你的输出几乎是空的（只有标题或极短内容）。' +
          '这次必须输出完整正文：每个小节都要写满具体内容，不要只列标题，不要写"此处省略"。'
        ctx = buildCtx(skill.id, Math.max(MIN_SCALE, (ctx._scale ?? 1) * 0.6))
        emit('status', { phase: 'retrying', text: `${skill.name}：首次输出过短，正在精简上下文后重取…` })
        const again = await llm.chat(
          [
            { role: 'system', content: skill.systemPrompt },
            {
              role: 'user',
              content: skill.buildPrompt(ctx) + revisionPrefix + contract + tighter,
            },
          ],
          { timeout: 240000 }
        )
        if (String(again || '').trim().length > String(text || '').trim().length) {
          text = again
          emit('delta', { skill: skill.id, delta: '' })
        }
      } catch { /* 重取失败则保留首次结果 */ }

      if (String(text || '').trim().length < MIN_OUTPUT) {
        stageFailed = true
        text = String(text || '') + shortOutputNotice(String(text || '').trim().length)
      }
    }

    session.outputs[skill.outputKey] = text

    // ── 结构化解析（Tool Calling）──
    let parsed = null
    if (skill.id === 'storyboard') {
      const shots = getTool('shotlist.parse').run({ text }).shots
      if (!stageFailed) session.shots = shots || []
      if (!shots?.length) stageFailed = true
      if (shots?.length) {
        session.shots = shots
        parsed = { shots: shots.length }
      }
    } else if (skill.id === 'prompt_engineering') {
      const data = getTool('prompts.parse').run({ text })
      if (!stageFailed) session.promptData = data || null
      if (!data?.shots?.length) stageFailed = true
      if (data) {
        // 兜底：模型没吐出 characterLock，但上一环节的连续性圣经已经锁定了角色。
        // 两者必须一致 —— 与其让面板空白，不如直接复用已锁定的片段。
        const cont = session.continuityData
        if (!data.characterLock?.zh && cont?.lockZh) {
          data.characterLock = { zh: cont.lockZh, en: cont.lockEn || '' }
        }
        session.promptData = data
        if (Array.isArray(data.shots) && data.shots.length && session.shots?.length) {
          session.shots = session.shots.map((s) => {
            const p = data.shots.find((x) => x.no === s.no)
            return p
              ? { ...s, promptZh: p.promptZh || s.promptZh, promptEn: p.promptEn || s.promptEn, negative: p.negative || s.negative }
              : s
          })
        }
        // 只校验「实际提示词文本」，不校验说明性文字（避免自检表误报）
        const promptCorpus = [
          data.characterLock?.zh, data.characterLock?.en,
          ...(data.sceneAssets || []).flatMap((s) => [s.promptZh, s.promptEn]),
          ...(data.imageAssets || []).flatMap((a) => [a.promptZh, a.promptEn]),
          ...(data.keyframes || []).flatMap((f) => [f.promptZh, f.promptEn]),
          ...(data.shots || []).flatMap((s) => [s.promptZh, s.promptEn]),
        ].filter(Boolean).join('\n')
        const v = getTool('prompt.validate').run({ text: promptCorpus || text })
        session.promptValidation = v
        parsed = {
          prompts: data.shots?.length || 0,
          characters: data.characterLock ? 1 : 0,
          imageAssets: data.imageAssets?.length || 0,
          keyframes: data.keyframes?.length || 0,
          covered: `${v.covered}/${v.total}`,
          banned: v.banned,
        }
      }
    } else if (skill.id === 'continuity') {
      const data = getTool('continuity.parse').run({ text })
      if (!stageFailed) session.continuityData = data || null
      if (!data || !(data.lockZh || data.rules?.length)) stageFailed = true
      if (data && (data.lockZh || (data.rules && data.rules.length))) {
        session.continuityData = data
        parsed = { lock: !!data.lockZh, rules: (data.rules || []).length }
      }
    } else if (skill.id === 'quality_control') {
      const scores = getTool('review.parse').run({ text }).scores
      if (scores.length) {
        session.reviewScores = scores
        const avg = (scores.reduce((a, x) => a + x.score, 0) / scores.length).toFixed(1)
        session.memory.decisions.push(`导演审核：平均 ${avg}/10（${scores.length} 项）`)
        parsed = { scores: scores.length, average: avg }
      }
    } else if (skill.id === 'director_analysis') {
      const m = text.match(/主风格[：:]\s*([^\n（(]{2,40})/)
      const dm = text.match(/选定[：:]\s*([^\n（(]{2,40})/)
      if (m) session.memory.decisions.push(`确定风格：${m[1].trim()}`)
      if (dm) session.memory.decisions.push(`确定结构：${dm[1].trim()}`)
      parsed = { style: m ? m[1].trim() : null, structure: dm ? dm[1].trim() : null }
    } else if (skill.id === 'story_structure') {
      session.memory.decisions.push('完成叙事结构设计')
    } else if (skill.id === 'visual_design') {
      session.memory.decisions.push('完成视觉圣经')
    }

    let stageReview = null
    if (staged) {
      stageReview = await reviewStage(skill, text, { failed: stageFailed, parsed, session })
      session.stageReviews[skill.id] = stageReview
      emit('stage_review', { skill: skill.id, review: stageReview })
      if (stageReview.status === 'block') stageFailed = true
    }
    const pendingOutputs = session.pendingSkills.filter(id => id !== skill.id).map(id => BY_ID[id]?.outputKey)
    const upstreamPending = (PRIOR_DEPS[skill.id] || []).some(key => pendingOutputs.includes(key))
    if (!stageFailed && !upstreamPending) session.pendingSkills = session.pendingSkills.filter(id => id !== skill.id)
    emit('stage_done', {
      skill: skill.id,
      name: skill.name,
      outputKey: skill.outputKey,
      text,
      failed: stageFailed,
      review: stageReview,
      parsed,
      shots: skill.id === 'storyboard' ? session.shots : undefined,
      promptData: skill.id === 'prompt_engineering' ? session.promptData : undefined,
      continuityData: skill.id === 'continuity' ? session.continuityData : undefined,
      productionChecks: productionChecks(session),
    })
    memory.saveSession(session)
    if (staged && stageReview?.status === 'block') { blockedReview = true; break }
  }

  if (fatal) {
    // 给出可执行的修复指引，而不是让用户面对 11 条相同报错
    emit('error', {
      message:
        `LLM 调用失败，已中断后续环节。\n\n` +
        `**原因**：${String(fatal).slice(0, 300)}\n\n` +
        `**请依次检查**：\n` +
        `1. 打开「设置」，点「测试连接」看具体报错\n` +
        `2. Base URL 是否为你服务商的 OpenAI 兼容地址（通常以 /v1 结尾）\n` +
        `3. API Key 是否正确、是否有余额/额度\n` +
        `4. 模型名称是否与该服务商实际可用模型一致\n` +
        `5. 网络是否需要代理\n\n` +
        `若暂时无法连通，可清空 API Key 以「演示模式」跑通全流程（产出为内置专业模板）。`,
      fatal: true,
    })
    session.messages.push({ role: 'assistant', content: `⚠️ 流水线中断：${fatal.slice(0, 120)}`, at: Date.now() })
    memory.saveSession(session)
    emit('done', { session: publicSession(session), aborted: true })
    return
  }

  session.messages.push({
    role: 'assistant',
    content: blockedReview
      ? '当前环节审核未通过，已暂停后续制作。请查看问题并修改或重试。'
      : aborted
      ? `已停止（已完成 ${Object.keys(session.outputs || {}).length} 个环节，成果已保存）`
      : `已完成：${skills.map((s) => BY_ID[s].name).join(' → ')}`,
    at: Date.now(),
  })
  if (staged && targetStage === 11 && !aborted && !blockedReview &&
      FULL_PIPELINE.filter(id => id !== 'quality_control').every(id => session.outputs[BY_ID[id].outputKey] && !session.pendingSkills.includes(id))) {
    session.pendingSkills = session.pendingSkills.filter(id => id !== 'quality_control')
  }
  memory.saveSession(session)
  emit('done', { session: publicSession(session), aborted, blockedReview })
}

function publicSession(session) {
  return {
    id: session.id,
    editVersion: session.editVersion || 0,
    editorNotes: session.editorNotes || {},
    versions: (session.versions || []).map(({ id, at, label }) => ({ id, at, label })),
    title: session.title,
    brief: session.brief,
    constraints: session.constraints,
    outputs: session.outputs,
    generationMode: session.generationMode,
    productionChecks: productionChecks(session),
    pendingSkills: session.pendingSkills || [],
    shots: session.shots,
    promptData: session.promptData,
    // 结构化派生数据必须与 session 内保持一致 ——
    // 前端 normalizeSession() 是白名单式的，这里漏一个字段，前端就静默丢一个。
    continuityData: session.continuityData || null,
    promptValidation: session.promptValidation || null,
    reviewScores: session.reviewScores || null,
    stageReviews: session.stageReviews || {},
    pipeline: session.pipeline,
    skillHistory: session.skillHistory || [],
    memory: session.memory,
  }
}

module.exports = {
  run,
  publicSession,
  constraintsText,
  // 供体积测试与诊断使用
  inputCapChars,
  makeCtx,
  promptSize,
  fitContext,
  estTokens,
  PRIOR_DEPS,
  KNOWLEDGE_SECTIONS,
  MIN_SCALE,
  shortOutputNotice,
}
