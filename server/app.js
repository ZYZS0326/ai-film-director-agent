/**
 * Express 应用 — Web 后端 API
 */
const express = require('express')
const cors = require('cors')
const path = require('path')

const { publicSettings, saveSettings } = require('./config')
const llm = require('./agent/llm')
const shotEditor = require('./agent/shot-editor')
const memory = require('./agent/memory')
const orchestrator = require('./agent/orchestrator')
const { skillManifest, FULL_PIPELINE, SKILLS } = require('./skills')
const { sanitizeConstraints } = require('./agent/planner')
const kb = require('./knowledge')
const references = require('./knowledge/references')
const { productionChecks } = require('./agent/production-checks')
const { affectedByConstraints } = require('./agent/dependencies')
const { PROMPT_PLATFORMS, PROMPT_ELEMENTS, BANNED_PROMPT_WORDS, SCRIPT_LEVELS, DURATION_MODES, EDITING_TECHNIQUES, SOUND_LAYERS, QUALITY_CHECKS } = require('./knowledge/techniques')

function createApp() {
  const app = express()
  // Local desktop API, not a network service. Reject DNS rebinding and foreign browser origins.
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(req.hostname)) return res.status(403).json({ error: '仅允许本机访问' })
    const origin = req.get('Origin')
    const allowed = [`http://${req.get('Host')}`, 'http://localhost:5173', 'http://127.0.0.1:5173']
    if (origin && !allowed.includes(origin)) return res.status(403).json({ error: '不允许来自其他网站的请求' })
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && (req.get('Content-Length') !== '0' && (req.get('Content-Length') || req.get('Transfer-Encoding'))) && !req.is('application/json')) return res.status(415).json({ error: '请使用 application/json' })
    next()
  })
  app.use(cors({ origin: true })) // Origin is validated above, never wildcard.
  app.use(express.json({ limit: '12mb' }))

  /**
   * 「停止生成」信号表：sessionId → 请求停止的时间戳。
   *
   * 设计取舍：前端点停止时**不 abort fetch**，而是打这个接口。
   * 若直接 abort，服务端要到下一个环节边界才发现，而客户端此时已经刷新过了 ——
   * 最后一个完成的环节会永远显示不出来。让 SSE 流正常收尾并带上
   * `aborted: true` 的最终 session，客户端才能拿到准确状态。
   */
  const STOP_FLAGS = new Map()

  // 正在跑流水线的会话 id。用于拒绝同一会话的并发请求 ——
  // 两个请求各自 loadSession 出独立副本、各自 saveSession，后写会覆盖前写，
  // 先跑完那条的产出整段丢失且无任何报错。
  const RUNNING_SESSIONS = new Set()
  // Share the same lock with generation, settings changes and shot mutations.
  app.use('/api/sessions/:id', (req, res, next) => {
    if (req.method !== 'GET' && req.path !== '/stop' && RUNNING_SESSIONS.has(req.params.id)) return res.status(409).json({ error: '项目正在生成或重做，请等待完成后再修改。' })
    next()
  })
  app.post('/api/sessions/:id/editor', async (req, res) => {
    const s = memory.loadSession(req.params.id)
    if (!s) return res.status(404).json({ error: '项目不存在' })
    RUNNING_SESSIONS.add(s.id)
    try {
      const { action, no, patch, instruction, version, versionId, locked } = req.body || {}
      shotEditor.checkVersion(s, version)
      if (action === 'preview') return res.json(shotEditor.proposal(s, no, patch))
      if (action === 'suggest') return res.json(await shotEditor.suggest(s, no, instruction))
      if (action === 'apply') shotEditor.apply(s, no, patch)
      else if (action === 'lock') {
        const shot = s.shots.find(x => x.no === no)
        if (!shot) throw Object.assign(new Error('镜头不存在'), { status: 404 })
        if (typeof locked !== 'boolean') throw Object.assign(new Error('无效锁定状态'), { status: 400 })
        shotEditor.checkpoint(s, `${locked ? '锁定' : '解锁'}镜头 ${no} 前`)
        shot.locked = locked
      } else if (action === 'restore') shotEditor.restore(s, versionId)
      else throw Object.assign(new Error('未知编辑操作'), { status: 400 })
      memory.saveSession(s)
      res.json(orchestrator.publicSession(s))
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
    finally { RUNNING_SESSIONS.delete(s.id) }
  })

  // ── 健康检查 ─────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: Date.now(), llm: llm.isConfigured() ? 'configured' : 'demo' })
  })

  // ── 设置 ────────────────────────────────────────────────
  app.get('/api/settings', (req, res) => res.json(publicSettings()))
  app.post('/api/settings', (req, res) => {
    const { baseUrl, apiKey, model, temperature, maxTokens, contextWindow, presetId, theme } = req.body || {}
    const patch = {}
    if (baseUrl !== undefined) patch.baseUrl = baseUrl
    if (apiKey !== undefined && apiKey !== '') patch.apiKey = apiKey
    if (model !== undefined) patch.model = model
    if (temperature !== undefined) patch.temperature = Number(temperature)
    if (maxTokens !== undefined) patch.maxTokens = Number(maxTokens)
    if (contextWindow !== undefined) patch.contextWindow = Number(contextWindow)
    if (presetId !== undefined) patch.presetId = presetId
    if (theme !== undefined) patch.theme = theme
    saveSettings(patch)
    res.json(publicSettings())
  })
  app.post('/api/settings/test', async (req, res) => {
    // ⚠️ async 路由必须自带 try/catch。
    // Express 4 **不会**捕获 async handler 抛出的异常 —— 它会变成未处理的 rejection，
    // 而 Node 22 默认把未处理 rejection 当致命错误，**直接结束进程**。
    // 用户视角：点一下「测试连接」，整个后端就没了（打包版靠 main.js 的
    // process.on('unhandledRejection') 记日志才不至于退出，但请求永远收不到响应，界面一直转圈）。
    try {
      // 允许前端把**表单里当前填的值**传进来测，不必先写盘 ——
      // 否则「测试连接」会有副作用（测完直接关掉弹窗，改动其实已经生效了）。
      const { baseUrl, apiKey, model } = req.body || {}
      const override = {}
      if (typeof baseUrl === 'string') override.baseUrl = baseUrl
      if (typeof apiKey === 'string') override.apiKey = apiKey
      if (typeof model === 'string') override.model = model
      if (!override.baseUrl && !override.apiKey && !override.model && !llm.isConfigured()) {
        return res.json({ ok: false, message: '未填写 Base URL / API Key / 模型名称' })
      }
      // testConnection 内部已捕获异常，返回结构化结果（含真实错误原因）
      const r = await llm.testConnection(override)
      res.json({
        ok: Boolean(r && r.ok),
        message: String((r && r.message) || '未知结果').slice(0, 300),
        sample: r && r.sample ? String(r.sample).slice(0, 120) : '',
      })
    } catch (e) {
      res.json({ ok: false, message: String((e && e.message) || e).slice(0, 300) })
    }
  })

  // ── 能力清单 ─────────────────────────────────────────────
  app.get('/api/skills', (req, res) => {
    res.json({ skills: skillManifest(), pipeline: FULL_PIPELINE })
  })

  // ── 知识库统计 ───────────────────────────────────────────
  app.get('/api/knowledge/references', (req, res) => {
    const { q, stage, domain } = req.query
    if ([q, stage, domain].some(value => value !== undefined && typeof value !== 'string')) return res.status(400).json({ error: '检索参数必须为文本' })
    if (q && q.length > 500) return res.status(400).json({ error: '检索词过长' })
    res.json({ cards: references.searchReferences({ query: q, stage, domain }), sources: references.SOURCES, domains: references.DOMAINS })
  })
  app.get('/api/knowledge', (req, res) => {
    res.json({
      referenceCards: references.CARDS,
      referenceSources: references.SOURCES,
      referenceDomains: references.DOMAINS,
      stats: {
        referenceCards: references.CARDS.length,
        referenceSources: references.SOURCES.length,
        referenceDomains: references.DOMAINS.length,
        directors: kb.DIRECTORS.length,
        films: kb.FILMS.length,
        styles: kb.STYLES.length,
        genres: kb.GENRE_DB.length,
        moods: kb.MOODS.length,
        materials: kb.MATERIALS.length,
        colors: kb.COLOR_PSYCHOLOGY.length,
        visualSystems: kb.VISUAL_SYSTEMS.length,
        cameras: kb.CAMERA_RIGS.length,
        lenses: kb.LENS_SETS.length,
        movements: kb.MOVEMENTS.length,
        shotSizes: kb.SHOT_SIZES.length,
        structures: kb.NARRATIVE_STRUCTURES.length,
        aspectRatios: kb.ASPECT_RATIOS.length,
        scriptLevels: SCRIPT_LEVELS.length,
        durationModes: DURATION_MODES.length,
        platforms: PROMPT_PLATFORMS.length,
        promptElements: PROMPT_ELEMENTS.length,
        checks: QUALITY_CHECKS.length,
      },
      directors: kb.DIRECTORS.map((d) => ({
        id: d.id, name: d.name, nameEn: d.nameEn, nationality: d.nationality, era: d.era,
        philosophy: d.philosophy, narrative: d.narrative, lensLanguage: d.lensLanguage,
        themes: d.themes, aesthetic: d.aesthetic, filmAnalyses: d.filmAnalyses, method: d.method,
        signature: d.signature, tags: d.tags, bestFor: d.bestFor, avoidWhen: d.avoidWhen,
      })),
      films: kb.FILMS.map((f) => ({
        id: f.id, title: f.title, titleEn: f.titleEn, year: f.year, director: f.director,
        tags: f.tags, genre: f.genre, logline: f.logline, learnFrom: f.learnFrom,
      })),
      styles: kb.STYLES.map((s) => ({ id: s.id, name: s.name, category: s.category, summary: s.summary, rationale: s.rationale, visual: s.visual, fit: s.fit, avoidWhen: s.avoidWhen })),
      genres: kb.GENRE_DB,
      platforms: PROMPT_PLATFORMS,
      promptElements: PROMPT_ELEMENTS,
      bannedWords: BANNED_PROMPT_WORDS,
      structures: kb.NARRATIVE_STRUCTURES,
      cameras: kb.CAMERA_RIGS,
      lenses: kb.LENS_SETS,
      shotSizes: kb.SHOT_SIZES,
      movements: kb.MOVEMENTS,
      aspectRatios: kb.ASPECT_RATIOS,
      colors: kb.COLOR_PSYCHOLOGY,
      visualSystems: kb.VISUAL_SYSTEMS,
      materials: kb.MATERIALS,
      scriptLevels: SCRIPT_LEVELS,
      durationModes: DURATION_MODES,
      editing: EDITING_TECHNIQUES,
      sound: SOUND_LAYERS,
      checks: QUALITY_CHECKS,
    })
  })

  // ── 会话 ────────────────────────────────────────────────
  app.get('/api/sessions', (req, res) => res.json({ sessions: memory.listSessions() }))

  // 更新项目制作规格（时长 / 画幅 / 剧本等级 / 目标平台）
  app.patch('/api/sessions/:id/constraints', (req, res) => {
    const s = memory.loadSession(req.params.id)
    if (!s) return res.status(404).json({ error: 'session not found' })
    // 复用 planner 的白名单，避免两处校验规则漂移。
    // 曾经这里对 aspect 不做校验：写入 "banana" 后，resolveAspectRatio 会兜底成 21:9，
    // 但 constraintsText 仍把 "画幅：banana" 发给模型 —— 同一份提示词里两个互相矛盾的画幅。
    const patch = sanitizeConstraints(req.body || {})
    if (s.shots?.length) shotEditor.checkpoint(s, '修改制作规格前')
    const before = s.constraints || {}
    const c = { ...before }
    if (patch.duration != null) c.duration = patch.duration
    if (patch.aspect != null) c.aspect = patch.aspect
    if (patch.level != null) c.level = patch.level
    if (Array.isArray(patch.platforms) && patch.platforms.length) c.platforms = patch.platforms
    if (patch.language) c.language = patch.language
    s.constraints = c
    if (Object.keys(s.outputs || {}).length) {
      const affected = affectedByConstraints(before, c)
      s.pendingSkills = [...new Set([...(s.pendingSkills || []), ...affected])]
      s.stageReviews = s.stageReviews || {}
      for (const id of affected) delete s.stageReviews[id]
    }
    memory.saveSession(s)
    res.json(orchestrator.publicSession(s))
  })

  app.post('/api/sessions', (req, res) => {
    const s = memory.createSession((req.body && req.body.title) || '新项目')
    res.json(orchestrator.publicSession(s))
  })
  app.get('/api/sessions/:id', (req, res) => {
    const s = memory.loadSession(req.params.id)
    if (!s) return res.status(404).json({ error: 'not found' })
    res.json(orchestrator.publicSession(s))
  })
  app.delete('/api/sessions/:id', (req, res) => {
    memory.deleteSession(req.params.id)
    STOP_FLAGS.delete(req.params.id)
    res.json({ ok: true })
  })

  // 请求停止当前会话正在跑的流水线（编排器会在下一个环节边界收手）
  app.post('/api/sessions/:id/stop', (req, res) => {
    STOP_FLAGS.set(req.params.id, Date.now())
    res.json({ ok: true })
  })

  // ── 导出完整制作方案 ─────────────────────────────────────
  app.get('/api/sessions/:id/export', (req, res) => {
    const s = memory.loadSession(req.params.id)
    if (!s) return res.status(404).json({ error: 'not found' })
    const md = buildExportMarkdown(s)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="film-plan-${s.id}.md"`)
    res.send(md)
  })

  // ── 对话（SSE 流式）──────────────────────────────────────
  app.post('/api/chat', async (req, res) => {
    const { sessionId, message, targetStage, continueOnly, retryBlocked } = req.body || {}
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'empty message' })
    if (targetStage !== undefined && (!Number.isInteger(targetStage) || targetStage < 1 || targetStage > 11)) {
      return res.status(400).json({ error: '运行终点必须是第 1 至 11 环节' })
    }
    if (continueOnly !== undefined && typeof continueOnly !== 'boolean') return res.status(400).json({ error: '无效的继续操作' })
    if (retryBlocked !== undefined && typeof retryBlocked !== 'boolean') return res.status(400).json({ error: '无效的重试操作' })

    let session = sessionId ? memory.loadSession(sessionId) : null
    if (!session) session = memory.createSession()

    // 同一个会话不允许并发跑两条流水线。
    // 两边各自 loadSession 出一份内存副本、各自 saveSession —— **后写覆盖前写**，
    // 先跑完那条的产出会被整段丢掉，而且没有任何报错（用户只看到「内容没了」）。
    // 正常单窗口操作不会触发（前端 busy 时会禁用发送），但双开标签页 / 脚本重放会。
    if (RUNNING_SESSIONS.has(session.id)) {
      return res.status(409).json({
        error: '该项目的流水线正在运行中。请等它跑完，或先点「停止生成」再重试。',
      })
    }
    RUNNING_SESSIONS.add(session.id)

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders && res.flushHeaders()

    const emit = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch { /* client gone */ }
    }

    // 前端点「停止」= 打 /stop 接口。服务端必须知道，否则会把 12 个环节全部跑完，
    // 用户以为停了、额度却还在烧。res 的 close 则覆盖「直接关窗口」的情况。
    let clientGone = false
    res.on('close', () => { clientGone = true })
    const startedAt = Date.now()
    const stopRequested = () => {
      const at = STOP_FLAGS.get(session.id)
      return clientGone || (typeof at === 'number' && at >= startedAt)
    }

    emit('session', { id: session.id, title: session.title })

    try {
      if (session.shots?.length) { shotEditor.checkpoint(session, '整案对话执行前'); memory.saveSession(session) }
      await orchestrator.run(session, String(message), emit, {
        isAborted: stopRequested, targetStage, continueOnly: continueOnly === true, retryBlocked: retryBlocked === true,
      })
    } catch (e) {
      emit('error', { message: String(e.message || e) })
    } finally {
      STOP_FLAGS.delete(session.id)
      RUNNING_SESSIONS.delete(session.id)
      emit('end', {})
      res.end()
    }
  })

  // ── 静态资源（Electron 生产环境）─────────────────────────
  const distDir = path.join(__dirname, '..', 'dist')
  app.use(express.static(distDir))
  app.get(/^\/(?!api).*/, (req, res, next) => {
    const idx = path.join(distDir, 'index.html')
    const fs = require('fs')
    if (fs.existsSync(idx)) res.sendFile(idx)
    else next()
  })

  return app
}

function buildExportMarkdown(s) {
  const c = s.constraints || {}
  const parts = []
  parts.push(`# ${s.title || 'AI 导演方案'}`)
  parts.push('')
  parts.push(`> 由「AI 电影导演工作站」生成 · ${new Date(s.createdAt || Date.now()).toLocaleString('zh-CN')}`)
  parts.push('')
  const unfinished = FULL_PIPELINE.filter(id => id !== 'quality_control' && (!s.outputs?.[SKILLS.find(x => x.id === id)?.outputKey] || s.pendingSkills?.includes(id)))
  if (unfinished.length) parts.push(`> 阶段草稿：还有 ${unfinished.length} 个制作环节未完成或待更新，不是完整交付方案。\n`)
  parts.push('## 项目参数')
  if (s.generationMode === 'demo') parts.push('> 演示模板：分镜和评分含固定示例，不代表当前故事的完整创作方案。')
  const checks = productionChecks(s)
  parts.push(checks.ok
    ? '> 制作约束检查通过（时长、时间线、编号和已生成提示词的镜头对应；不代表创作质量验收）。'
    : '> 制作约束尚未通过，请处理以下问题后再用于制作：')
  for (const issue of checks.issues) parts.push(`- ${issue.message}`)
  parts.push(`- 创意 Brief：${s.brief}`)
  parts.push(`- 总时长：${c.duration || 300} 秒`)
  parts.push(`- 画幅：${c.aspect || '21:9'}`)
  parts.push(`- 剧本等级：Level ${c.level || 4}`)
  parts.push(`- 目标平台：${(c.platforms || []).join('、') || '—'}`)
  // 用 skillHistory（历史并集）而不是 pipeline（只存**最近一次**执行链）。
  // 增量修改后 pipeline 只剩被重跑的那几个环节，照它写会让人以为整个方案只有 3 个环节产出。
  parts.push(`- 已执行技能链：${(s.skillHistory?.length ? s.skillHistory : s.pipeline || []).join(' → ')}`)
  if (s.memory?.revisions?.length) {
    parts.push(`- 增量修改：${s.memory.revisions.length} 次（最近一次：${String(s.memory.revisions[s.memory.revisions.length - 1].instruction || '').slice(0, 60)}）`)
  }
  if (s.generationMode !== 'demo' && s.reviewScores?.length) {
    const avg = (s.reviewScores.reduce((a, x) => a + x.score, 0) / s.reviewScores.length).toFixed(1)
    parts.push(`- 导演审核平均分：${avg}/10（${s.reviewScores.length} 项）`)
  }
  parts.push('')
  // 章节表从技能注册表动态生成。
  // 曾经硬编码成 11 条，漏了「连续性管理」——导出的方案里没有 Continuity Bible，
  // 且章节编号与实际环节数对不上。硬编码清单迟早会再次漂移。
  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五']
  const ordered = [...SKILLS].sort((a, b) => (a.stage || 0) - (b.stage || 0))
  // 编号必须按「实际输出的章节数」递增，不能用 ordered 的下标 ——
  // 某个环节没有产出（被跳过 / 未执行）时，下标会跳号，导出大纲出现「一、三、四」。
  let chapterNo = 0
  ordered.forEach((sk) => {
    const key = sk.outputKey
    if (key === 'review' && s.generationMode === 'demo') return
    if (!s.outputs?.[key]) return
    chapterNo += 1
    parts.push(`# ${CN_NUM[chapterNo - 1] || chapterNo}、${sk.name}`)
    parts.push('')
    // 产出正文里若混入一级标题（模型偶尔不守契约），降为二级，
    // 否则导出大纲里会冒出与章节同级的条目。
    parts.push(String(s.outputs[key]).replace(/^# (?!#)/gm, '## '))
    parts.push('')
  })
  if (s.memory?.preferences?.length) {
    parts.push('# 附：用户偏好记录')
    parts.push(...s.memory.preferences.map((p) => `- ${p}`))
  }
  for (const [key, label] of [['storyboard', '分镜'], ['prompts', '提示词']]) {
    if (s.editorNotes?.[key]) parts.push(`\n# 附：编辑前${label}原始说明\n\n> 历史记录，不代表当前镜头；请以正文当前方案为准。\n\n${s.editorNotes[key]}`)
  }
  return parts.join('\n')
}

module.exports = { createApp, buildExportMarkdown }
