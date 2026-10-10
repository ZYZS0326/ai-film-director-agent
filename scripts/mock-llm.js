/**
 * 本地 OpenAI 兼容 Mock 服务（仅用于测试真实 LLM 代码路径）
 * 支持 /v1/chat/completions 的流式（SSE）与非流式两种模式。
 *
 * 启动：node scripts/mock-llm.js [port]
 */
const http = require('http')

const PORT = Number(process.argv[2] || 18999)

/** 根据 system prompt 判断当前请求来自哪个环节，返回对应格式的内容 */
function pickContent(messages) {
  const sys = String((messages || []).find((m) => m.role === 'system')?.content || '')
  const user = String((messages || []).find((m) => m.role === 'user')?.content || '')
  const last = String((messages || []).filter(m => m.role === 'user' && String(m.content).includes('【分批制作规范')).at(-1)?.content || (messages || []).filter(m => m.role === 'user').at(-1)?.content || '')
  if (last.includes('【分批制作规范')) {
    if (last.includes('片段概要')) return JSON.stringify({ events: ['本段人物发现线索并采取行动，保持原有故事顺序'] })
    if (last.includes('紧凑剧情段落计划')) {
      const total = Number(last.match(/总时长精确 (\d+)/)?.[1]) || 300
      return JSON.stringify({ segments: [0, 1, 2].map(i => ({ sceneNo: i + 1, start: Math.round(total * i / 3 * 1000) / 1000, end: Math.round(total * (i + 1) / 3 * 1000) / 1000, beat: ['开端', '转折', '结局'][i] })) })
    }
    if (last.includes('本段：')) {
      const segment = JSON.parse(last.match(/本段：(\{[^\n]+\})\n/)[1]), n = Math.ceil((segment.end - segment.start) / 6)
      return JSON.stringify({ shots: Array.from({ length: n }, (_, i) => {
        const start = Math.round((segment.start + (segment.end - segment.start) * i / n) * 1000) / 1000
        const end = Math.round((segment.start + (segment.end - segment.start) * (i + 1) / n) * 1000) / 1000
        return { no: i + 1, sceneNo: segment.sceneNo, start, end, duration: Math.round((end - start) * 1000) / 1000, beat: segment.beat }
      }) })
    }
    if (last.includes('本批：')) {
      const rows = JSON.parse(last.match(/本批：(\[[^\n]+\])\n/)[1])
      return JSON.stringify({ shots: rows.map(s => ({ ...s, shotSize: '中景', angle: '平视', camera: 'ARRI Alexa 65', lens: '50mm', movement: '固定', composition: '下三分之一', subject: '孤独者', action: '拾起旧表', expression: '平静', environment: '废墟', lighting: '5600K', color: '冷青灰', material: '混凝土', sound: '风声', emotion: '孤独', transition: '硬切' })) })
    }
    if (last.includes('共用资产目录')) return JSON.stringify({ characterLock: { zh: '灰蓝风衣男性', en: 'man in grey coat' }, sceneAssets: [], imageAssets: [{ assetId: 'CHAR_01', type: 'character', sheet: 'character_reference', aspectRatio: '3:4', lockedFacts: ['灰蓝风衣'], allowedChange: '机位' }] })
    if (last.includes('本批资产图提示词：')) {
      const rows = JSON.parse(last.match(/本批资产图提示词：(\[[^\n]+\])\n/)[1])
      return JSON.stringify({ imageAssets: rows.map(a => ({ ...a, promptZh: '中性背景人物多视图，固定灰蓝风衣', promptEn: 'character sheet, neutral background, grey coat', negative: '换脸' })) })
    }
    if (last.includes('本批镜头生成提示词和静态关键帧：')) {
      const rows = JSON.parse(last.match(/本批镜头生成提示词和静态关键帧：(\[[^\n]+\])\n/)[1])
      return JSON.stringify({ shots: rows.map(s => ({ no: s.no, start: s.start, end: s.end, promptZh: '主体：孤独者｜环境：废墟｜动作：拾表｜时间：5秒｜镜头：中景平视｜焦段：50mm｜摄影机运动：固定｜光线：5600K｜色彩：冷青灰｜材质：混凝土｜风格：写实｜情绪：孤独｜质量参数：24fps', promptEn: 'Subject: man | Environment: ruins | Action: picks watch | Time: 5s | Camera: medium | Lens: 50mm | Movement: static | Lighting: 5600K | Color: grey | Material: concrete | Style: realism | Emotion: solitude | Quality: 24fps', negative: '抖动', platform: 'seedance' })), keyframes: rows.map(s => ({ shotNo: s.no, phase: 'master', assetIds: ['CHAR_01'], aspectRatio: '21:9', promptZh: '人物手握旧表的静止瞬间', promptEn: 'man holding watch, still frame', negative: '换脸', motionNote: '抬手' })) })
    }
  }

  // ── Planner：必须返回严格 JSON ──
  if (sys.includes('规划器（Planner）')) {
    return JSON.stringify({
      intent: 'new_brief',
      skills: ['director_analysis', 'film_history', 'story_structure', 'cinematography', 'visual_design',
        'screenplay', 'storyboard', 'continuity', 'prompt_engineering', 'sound_design', 'editing', 'quality_control'],
      constraints: { duration: 300, aspect: '21:9', level: 4, platforms: ['seedance'], language: 'zh' },
      reasoning: '检测到完整创作需求，启动 11 环节导演流水线',
      answer: '',
    })
  }

  // ── 分镜：Markdown + shots JSON ──
  if (sys.includes('你是分镜师')) {
    const shots = [1, 2, 3].map((n) => ({
      no: n,
      sceneNo: n,
      start: (n - 1) * 5,
      end: n * 5,
      duration: 5,
      shotSize: ['大远景', '中景', '特写'][n - 1],
      angle: '高机位俯拍',
      camera: 'ARRI Alexa 65',
      lens: ['32mm', '50mm', '85mm'][n - 1],
      movement: ['固定镜头', '缓慢推轨', '固定镜头'][n - 1],
      composition: '人物位于画面下三分之一',
      subject: '孤独者',
      action: '穿行废墟',
      expression: '平静',
      environment: '混凝土废墟',
      lighting: '5600K 冷色散射光',
      color: '冷青灰',
      material: '清水混凝土 + 雾',
      sound: '风声',
      emotion: '孤独',
      transition: '硬切',
      promptZh: '主体：孤独者｜环境：废墟',
      promptEn: 'Subject: a lonely figure | Environment: ruins',
    }))
    return `## 分镜设计说明\n共 3 个镜头。\n\n| Shot | 时间 |\n|---|---|\n| 01 | 0-5s |\n\n\`\`\`json\n${JSON.stringify({ shots }, null, 2)}\n\`\`\``
  }

  // ── 连续性：Markdown + Continuity Bible JSON ──
  if (sys.includes('连续性监督')) {
    const data = {
      lockZh: '灰蓝风衣男性，左手腕旧机械表',
      lockEn: 'a man in grey-blue coat with a worn watch on left wrist',
      characters: [{ name: '主角', appearance: '短乱黑发', age: '30 代', clothing: '灰蓝风衣', marks: '左袖口磨破' }],
      environments: [{ scene: '废墟', time: '黎明', light: '5600K', spatial: '人物位于画面下三分之一' }],
      props: [{ name: '旧机械表', position: '左手腕', state: '磨损', shots: '全片' }],
      rules: ['风衣始终灰蓝色', '旧表在所有镜头可见', '画幅 21:9 全片统一'],
    }
    return `## Continuity Bible\n\n### 人物\n| 角色 | 外貌 |\n|---|---|\n| 主角 | 短乱黑发 |\n\n### 连续性规则\n1. 风衣始终灰蓝色\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
  }

  // ── 提示词：Markdown + prompts JSON ──
  if (sys.includes('提示词工程师')) {
    const data = {
      characterLock: { zh: '灰蓝风衣男性', en: 'a man in grey-blue coat' },
      sceneAssets: [{ name: '废墟', promptZh: '废墟中文', promptEn: 'ruins en' }],
      shots: [1, 2, 3].map((n) => ({
        no: n,
        start: (n - 1) * 5,
        end: n * 5,
        promptZh: `主体：孤独者｜环境：混凝土废墟｜动作：穿行｜时间：5 秒｜镜头：大远景｜焦段：32mm｜摄影机运动：固定｜光线：5600K 冷色散射光｜色彩：冷青灰｜材质：清水混凝土｜风格：冷峻写实｜情绪：孤独｜质量参数：24fps，21:9，胶片颗粒`,
        promptEn: `Subject: a lonely figure | Environment: concrete ruins | Action: walking | Timeline: 5s | Camera: ELS | Lens: 32mm | Movement: static | Lighting: 5600K | Color: cold cyan-grey | Material: raw concrete | Style: cold realism | Emotion: lonely | Quality: 24fps, 21:9, film grain`,
        negative: '抖动',
        platform: 'seedance',
      })),
    }
    return `## 角色一致性提示词（Character Lock）\n灰蓝风衣男性\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
  }

  // ── 审查：需要可解析的评分 ──
  if (sys.includes('最挑剔的审查者')) {
    const items = [
      ['剧情', '是否有冲突', 8], ['剧情', '人物是否有动机', 7], ['剧情', '节奏是否合理', 8],
      ['视觉', '视觉是否服务主题', 9], ['视觉', '镜头是否重复', 6], ['视觉', '风格是否统一', 8],
      ['AI生成', '是否现实可制作', 8], ['AI生成', '提示词是否生产级', 9],
    ]
    const rows = items.map(([c, n, s]) => `| ${c} | ${n} | ${s}/10 | ${s >= 8 ? '通过' : '需修订'} |`).join('\n')
    const detail = items.map(([c, n, s]) => `**${n} ${s}/10**\n- 问题：${c}维度上，Shot 0${(n.length % 3) + 1} 的处理还不够具体，目前只给出了方向没有给出参数。\n- 为什么是问题：缺少参数就无法交付执行，下游会各自解释。\n- 优化建议：把该镜头的焦段、机位高度与运动速度写成确定值。`).join('\n\n')
    return `## 审查总览\n| 分类 | 审查项 | 评分 | 结论 |\n|---|---|---|---|\n${rows}\n\n## 一、剧情审查\n${detail}\n\n## 二、视觉审查\n${detail}\n\n## 三、AI 生成审查\n${detail}\n\n## 自动修订清单\n| 优先级 | 修改项 | 具体操作 | 预期效果 |\n|---|---|---|---|\n| P0 | 消除镜头重复 | 把 Shot 03 改为 85mm 特写 | 景别分布拉开 |\n| P1 | 补足动机 | Shot 02 插入 0.5s 摸口袋动作 | 人物弧线有支点 |\n\n## 总评\n- 核心优势：氛围统一\n- 最大风险：节奏偏平\n- 信心指数：82%\n\n## 修订后方案摘要\n1. Shot 03 改 85mm\n2. Shot 02 加插入镜`
  }

  // ── 剧本：需含片名/人物表/ACT ──
  if (sys.includes('你是职业编剧')) {
    return `## 一、剧本基础信息\n| 项 | 内容 |\n|---|---|\n| **片名（中）** | 宇宙尽头 |\n| **类型** | 科幻 |\n\n## 二、人物表\n| 角色 | 年龄 |\n|---|---|\n| 主角 | 30 代 |\n\n## 三、ACT 结构划分\n| 幕 | 时间码 |\n|---|---|\n| ACT 1 | 0-75s |\n\n### 场景 01\n| 字段 | 内容 |\n|---|---|\n| **场景编号** | 01 |\n| **时间** | 0-15s |\n| **地点** | 废墟广场 |\n| **环境** | 薄雾 |\n| **人物** | 主角 |\n| **动作** | 静止站立 |\n| **对白** | （无对白） |\n| **心理** | 空 |\n| **导演备注** | 不解释 |\n| **摄影建议** | 32mm 固定 |\n| **声音设计** | 风声 |`
  }

  // ── 其他 Skill：通用 Markdown ──
  const hint = user.slice(0, 60).replace(/\n/g, ' ')
  return `## 产出（Mock LLM）\n\n针对「${hint}」的专业方案。\n\n### 决策一：导演参考\n**主参考：丹尼斯·维伦纽瓦**\n- 为什么：主题契合「宿命与预言」，其冷峻氛围能承载本片的孤独命题。\n\n### 决策二：叙事结构\n**选定：非线性叙事**\n\n| 序号 | 时间码/占比 | 节拍名称 |\n|---|---|---|\n| 1 | 0-60s | 建立 |\n| 2 | 60-300s | 对抗 |\n\n### 决策三：视觉风格\n**主风格：北欧冷峻（70%）**\n\n### 决策四：摄影方式\n- **摄影机**：ARRI Alexa 65\n- **画幅**：21:9｜24fps\n- **焦段**：32mm / 50mm / 85mm\n\n### 决策五：色彩与美术\n- 冷青灰 + 琥珀金`
}

function sseChunks(content) {
  const out = []
  const step = 24
  for (let i = 0; i < content.length; i += step) {
    const piece = content.slice(i, i + step)
    out.push(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
  }
  out.push('data: [DONE]\n\n')
  return out
}

/**
 * MOCK_MODE 用于模拟「不那么乖」的真实服务商：
 *  - nostream : 忽略 stream 参数，始终返回完整 JSON（很多网关会缓冲 SSE）
 *  - bigtoken : max_tokens > 2048 时返回 400（模型上下文/输出上限）
 *  - textfield: SSE 中把内容放在 choices[0].text 而非 delta.content
 *  - slow     : 故意延迟，用于验证超时保护
 *  - stall    : 发几个分片后挂住不结束，验证流式空闲守卫（不会永久转圈）
 */
const MODE = process.env.MOCK_MODE || 'normal'
/** truncate 模式下每轮最多吐多少字符（模拟模型单次输出上限） */
const TRUNC_CHARS = Number(process.env.MOCK_TRUNC_CHARS || 400)

// flaky 模式：前 N 个请求直接掐断 socket，模拟真实环境中的
// `TypeError: fetch failed` / ECONNRESET（用户实测遇到的就是这类）
let flakyCount = 0
const FLAKY_FAILS = Number(process.env.MOCK_FLAKY_FAILS || 2)

const server = http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }

  if (MODE === 'flaky' && flakyCount < FLAKY_FAILS) {
    flakyCount += 1
    req.socket.destroy() // 客户端侧表现为 fetch failed / ECONNRESET
    return
  }

  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { /* ignore */ }
    const content = pickContent(payload.messages)

    // ── truncate：模拟「单次输出有上限」的服务商 ──
    // 每轮只吐出 MOCK_TRUNC_CHARS 个字符并报 finish_reason='length'，
    // 直到客户端发来续写指令才给下一段。用于验证自动续写能拼出完整正文。
    if (MODE === 'truncate') {
      const tail = (payload.messages || []).filter(m => m.role === 'assistant').at(-1)?.content || ''
      const continuation = (payload.messages || []).some(m => m.role === 'user' && String(m.content).includes('【续写指令】'))
      const start = continuation && tail && content.lastIndexOf(tail) >= 0 ? content.lastIndexOf(tail) + tail.length : 0
      const piece = content.slice(start, start + TRUNC_CHARS)
      const done = start + TRUNC_CHARS >= content.length
      const finish = done ? 'stop' : 'length'
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        for (const c of sseChunks(piece)) res.write(c)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', created: Date.now(), model: payload.model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: piece }, finish_reason: finish }],
      }))
      return
    }

    if (MODE === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }, 60000)
      return
    }

    // ctxlong：请求体超过阈值就报「上下文超长」，用于验证自动收缩上下文
    if (MODE === 'ctxlong' && body.length > Number(process.env.MOCK_CTX_LIMIT || 9000)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: "This model's maximum context length is 8192 tokens. Please reduce the length of the messages." },
      }))
      return
    }

    if (MODE === 'bigtoken' && (payload.max_tokens || 0) > 2048) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'max_tokens is too large: max 2048' } }))
      return
    }

    // 忽略 stream 参数，始终返回完整 JSON
    if (MODE === 'nostream') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', created: Date.now(), model: payload.model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }))
      return
    }

    // stall：发完响应头 + 一点数据后**既不继续发送、也不结束响应**，连接一直挂着。
    // 模拟「服务商中途挂死」。过去这种情形会让 reader.read() / res.json() 永久等待 ——
    // 没有超时、没有报错、界面无限转圈（fetch 的超时只覆盖到响应头，不覆盖 body）。
    if (MODE === 'stall') {
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        for (const c of sseChunks(content.slice(0, 60))) res.write(c)
      } else {
        // 非流式：只把响应头刷出去，一个字节 body 都不发 ——
        // 这样 res.json() 会一直等，只有「超时窗口覆盖到 body 读取」才能救回来。
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.flushHeaders()
      }
      return // 故意不 res.end()，也不再写入
    }

    if (payload.stream) {
      if (MODE === 'textfield') {
        // 内容放在 choices[0].text（非标准但存在）
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        const step = 24
        for (let i = 0; i < content.length; i += step) {
          res.write(`data: ${JSON.stringify({ choices: [{ text: content.slice(i, i + step) }] })}\n\n`)
        }
        res.end('data: [DONE]\n\n')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      // MOCK_CHUNK_DELAY_MS：每个 SSE 分块之间的间隔。
      // 默认 0（测试要快）；设置后用于「停止生成」这类需要时间窗的测试 ——
      // 分块立刻吐完的话，整个流水线几十毫秒就跑完了，根本来不及发停止请求。
      const gap = Number(process.env.MOCK_CHUNK_DELAY_MS || 0)
      if (gap > 0) {
        const chunks = sseChunks(content)
        let i = 0
        const timer = setInterval(() => {
          if (i >= chunks.length) { clearInterval(timer); res.end(); return }
          res.write(chunks[i]); i += 1
        }, gap)
        // 必须挂在 res 上：req 的 'close' 在请求体读完时就会触发，
        // 会把定时器立刻清掉、响应永不结束（客户端就永远卡住）。
        res.on('close', () => clearInterval(timer))
        return
      }
      for (const c of sseChunks(content)) res.write(c)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion', created: Date.now(), model: payload.model || 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-llm listening on http://127.0.0.1:${PORT}`)
})
