/**
 * UI 渲染冒烟测试
 * 用 esbuild 打包前端 → 在 jsdom 中真实挂载 React → 断言渲染结果与完整 SSE 事件流
 *
 * 运行：
 *   npm run test:ui
 *   jsdom 随项目开发依赖安装。
 */
const path = require('path')
const { JSDOM } = require('jsdom')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

// ── 模拟数据 ────────────────────────────────────────────
const SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
  temperature: 0.8, maxTokens: 8192, presetId: 'deepseek', theme: 'dark',
  hasKey: false, keyMask: '', mode: 'demo',
  provider: 'deepseek', roleModels: {}, providerConfigs: {}, roles: [{ id: 'planner', name: '任务规划' }, { id: 'reviewer', name: '环节审核' }],
  presets: [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '中文强' },
    { id: 'ark', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260628', note: '替换 Model ID', models: [{ id: 'doubao-seed-2-1-pro-260628' }, { id: 'doubao-seed-2-0-lite-260428' }] },
  ],
}

// 11 个 Skill（与 server/skills 一致）
const SKILL_IDS = [
  'director_analysis', 'film_history', 'story_structure', 'cinematography', 'visual_design',
  'screenplay', 'storyboard', 'continuity', 'prompt_engineering', 'sound_design', 'editing', 'quality_control',
]
// 与 server/skills/index.js 完全一致的 id → outputKey / 中文名映射。
// 早期 mock 把 outputKey 直接写成 id，掩盖了前端「重开项目时环节表过期」的真实缺陷。
const SKILL_META = {
  director_analysis: ['analysis', '导演分析与决策'],
  film_history: ['references', '电影史与参考档案'],
  story_structure: ['structure', '叙事结构设计'],
  cinematography: ['cinematography', '摄影方案'],
  visual_design: ['visualBible', '视觉设计与美术'],
  screenplay: ['screenplay', '剧本创作'],
  storyboard: ['storyboard', '分镜设计'],
  continuity: ['continuity', '连续性管理'],
  prompt_engineering: ['prompts', 'AI 提示词工程'],
  sound_design: ['sound', '声音设计'],
  editing: ['editing', '剪辑设计'],
  quality_control: ['review', '导演审核'],
}
const SKILL_NAME_OF = (id) => SKILL_META[id][1]
const SKILL_OUT_OF = (id) => SKILL_META[id][0]

const SKILLS = {
  skills: SKILL_IDS.map((id, i) => ({
    id, name: SKILL_META[id][1], role: '导演', stage: i + 1, outputKey: SKILL_META[id][0],
    description: '描述' + (i + 1), triggers: ['a'],
  })),
  pipeline: SKILL_IDS,
}

const DURATION_MODES = [
  { id: 'short_1', duration: 60, label: '1 分钟短片', mode: 'short', scenes: '4-8 场', shots: '10-20 镜', note: '' },
  { id: 'short_3', duration: 180, label: '3 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
  { id: 'short_5', duration: 300, label: '5 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
  { id: 'short_10', duration: 600, label: '10 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
  { id: 'mid_30', duration: 1800, label: '30 分钟中片', mode: 'medium', scenes: '', shots: '', note: '' },
  { id: 'feature_60', duration: 3600, label: '60 分钟长片', mode: 'feature', scenes: '', shots: '', note: '' },
  { id: 'feature_90', duration: 5400, label: '90 分钟电影', mode: 'feature', scenes: '', shots: '', note: '' },
  { id: 'feature_120', duration: 7200, label: '120 分钟电影', mode: 'feature', scenes: '', shots: '', note: '' },
]
const ASPECT_RATIOS = [
  { id: '16:9', name: '16:9', value: 1.778, label: '标准宽屏', composition: '', lens: '', narrative: '', strength: '', weakness: '', bestFor: [] },
  { id: '21:9', name: '21:9（2.39:1）', value: 2.39, label: '宽银幕 / 变形', composition: '', lens: '', narrative: '', strength: '', weakness: '', bestFor: [] },
  { id: '9:16', name: '9:16', value: 0.5625, label: '竖屏 / 短视频', composition: '', lens: '', narrative: '', strength: '', weakness: '', bestFor: [] },
  { id: '1:1', name: '1:1', value: 1, label: '方形', composition: '', lens: '', narrative: '', strength: '', weakness: '', bestFor: [] },
]
const SCRIPT_LEVELS = [1, 2, 3, 4, 5].map((n) => ({
  id: n, key: '', name: ['故事梗概', '场景大纲', '完整剧本', '专业电影剧本', '导演制作稿'][n - 1],
  desc: '', length: '', contains: [],
}))

const SHOTS = [
  {
    no: 1, start: 0, end: 5, duration: 5, shotSize: '大远景', angle: '高机位俯拍',
    camera: 'ARRI Alexa 65', lens: '32mm', movement: '固定镜头',
    composition: '负空间 40%', subject: '孤独者', action: '废墟全景', expression: '面无表情',
    environment: '混凝土废墟', lighting: '5600K 冷色散射', color: '冷青灰', sound: '风声',
    emotion: '空无', transition: '硬切', promptZh: '中文提示词示例', promptEn: 'English prompt sample',
  },
]

const KNOWLEDGE = {
  stats: {
    directors: 13, films: 12, styles: 17, genres: 17, moods: 10, materials: 12, colors: 8,
    visualSystems: 7, cameras: 8, lenses: 10, movements: 14, shotSizes: 14, structures: 9,
    aspectRatios: 4, scriptLevels: 5, durationModes: 8, platforms: 10, promptElements: 13, checks: 13,
  },
  directors: [{ id: 'nolan', name: '克里斯托弗·诺兰', nameEn: 'Christopher Nolan', nationality: 'UK', era: 'e', philosophy: 'p', narrative: ['n'], lensLanguage: ['l'], themes: ['时间'], aesthetic: 'a', filmAnalyses: [], method: 'm', signature: '宏大真实感', tags: ['科幻'], bestFor: ['科幻'], avoidWhen: 'x' }],
  films: [{ id: 'inception', title: '盗梦空间', titleEn: 'Inception', year: 2010, director: 'nolan', tags: ['时间结构'], genre: ['科幻'], logline: 'l', learnFrom: ['x'] }],
  styles: [{ id: 'nolan_grand_realism', name: '诺兰式宏大真实感', category: '科幻', summary: '用实拍物理质感承载高概念', rationale: '因为抽象命题需要可触摸的真实', visual: {}, fit: [], avoidWhen: '' }],
  genres: [{ id: 'sci_fi', name: '科幻', structure: 's', expectation: 'e', failurePoints: ['f'], visual: 'v', examples: ['x'] }],
  platforms: [{ id: 'seedance', name: 'Seedance', type: 'video', lang: 'zh+en', structure: ['主体', '环境'], notes: '中文强', styleTag: '电影感', negativeHint: '避免畸变', maxLength: 800 }],
  promptElements: [{ id: 'subject', name: '主体', desc: '' }],
  bannedWords: ['电影感'],
  structures: [{ id: 'three_act', name: '三幕结构', definition: '建立-对抗-解决', beats: ['开场'], fitGenres: ['短片'], pros: ['清晰'], cons: ['可预测'], cases: ['教父'], difficulty: 2 }],
  cameras: [{ id: 'alexa65', name: 'ARRI Alexa 65', sensor: '65mm', note: 'n', psychology: 'p', bestFor: [] }],
  lenses: [{ id: 'wide_24', name: '24mm 广角', fov: '74°', effect: 'e', psychology: '空间压迫', use: [], cases: [] }],
  shotSizes: [{ id: 'els', name: '大远景', en: 'ELS', emotion: '渺小', scene: 's', cases: [] }],
  movements: [{ id: 'static', name: '固定镜头', emotion: '冷静', scene: 's', cases: [] }],
  aspectRatios: ASPECT_RATIOS,
  colors: [{ id: 'blue', name: '蓝色', meaning: '孤独', nuance: '', usage: '', caution: '', cases: [] }],
  visualSystems: [{ id: 'nordic_cold', name: '北欧冷峻', origin: '', philosophy: '', palette: '', light: '', material: '', composition: '', lens: '', sound: '', bestFor: [], cases: [] }],
  materials: [{ id: 'concrete', name: '清水混凝土', mood: ['冷峻'], desc: 'd', cases: [] }],
  scriptLevels: SCRIPT_LEVELS,
  durationModes: DURATION_MODES,
  editing: [{ id: 'match_cut', name: '匹配剪辑', desc: '用形状连接时空', cases: [] }],
  sound: [{ id: 'drone', name: '低频持续音', desc: '制造压迫', cases: [] }],
  checks: [{ id: 'conflict', category: '剧情', name: '是否有冲突', question: '是否自洽？', weight: 1.3 }],
}

// ── 结构化产出（模拟真实服务端响应）────────────────────
const STORYBOARD_MD = [
  '## 分镜总览',
  '共 1 个镜头，总时长 5 秒。',
  '',
  '## Shot List',
  '| Shot | 时间 | 景别 | 运动 | 情绪 |',
  '|---|---|---|---|---|',
  '| 01 | 0-5s | 大远景 | 固定镜头 | 空无 |',
].join('\n')

const PROMPTS_MD = '## 角色一致性提示词（Character Lock）\n灰蓝风衣男性\n\n## 生产建议\n1. 先生成角色参考图'

const PROMPT_DATA = {
  characterLock: { zh: '灰蓝风衣男性', en: 'a man in grey-blue coat' },
  sceneAssets: [{ name: '废弃城市废墟', promptZh: '废墟中文提示词', promptEn: 'ruins english prompt' }],
  shots: [{ no: 1, start: 0, end: 5, promptZh: '中文提示词示例', promptEn: 'English prompt sample', negative: '抖动' }],
}

/** 与真实服务端 publicSession 结构一致 */
const FINAL_SESSION = {
  productionChecks: { ok: false, targetDuration: 300, actualDuration: 48, issues: [{ code: 'total_duration', message: '目标 300 秒，分镜合计 48 秒，相差 252 秒。' }] },
  id: 'sess_smoke1',
  title: '一个人站在荒废城市看日出',
  brief: '我要做一个30秒短片，一个人站在荒废城市看日出。',
  constraints: { duration: 300, aspect: '21:9', level: 4, platforms: ['seedance', 'kling'], language: 'zh' },
  outputs: {
    analysis: '## 一句话故事内核\n测试\n\n## Step 2 · 导演决策\n### 决策一：导演参考\n**主参考：丹尼斯·维伦纽瓦**',
    references: '## 参考导演档案\n### 丹尼斯·维伦纽瓦',
    structure: '## 结构决策\n**选定：非线性叙事**\n\n## 节拍表\n| 序号 | 时间码 |',
    cinematography: '## 一、摄影机与画幅\n- **机型**：ARRI Alexa 65',
    visualBible: '## 一、色彩体系\n| 色彩 | 色相 |',
    screenplay: '## 一、剧本基础信息\n| 项 | 内容 |\n|---|---|\n| **片名（中）** | 测试 |',
    continuity: '## Continuity Bible\n\n### 人物\n| 角色 | 外貌 |\n|---|---|\n| 主角 | 短乱黑发 |\n\n### 连续性规则\n1. 风衣始终灰蓝色',
    storyboard: STORYBOARD_MD,
    prompts: PROMPTS_MD,
    sound: '## 声音设计理念\n用静默制造落差',
    editing: '## 剪辑理念\n用长镜头保留时间',
    review: '## 审查总览\n| 分类 | 审查项 | 评分 | 结论 |\n|---|---|---|---|\n| 剧情 | 是否有冲突 | 8/10 | 通过 |\n| 视觉 | 镜头是否重复 | 6/10 | 需修订 |',
  },
  promptValidation: {
    banned: [],
    elements: [{ id: 'subject', name: '主体', present: true }, { id: 'material', name: '材质', present: true }],
    covered: 13, total: 13,
  },
  reviewScores: [
    { name: '是否有冲突', score: 8 }, { name: '镜头是否重复', score: 6 },
  ],
  shots: SHOTS,
  promptData: PROMPT_DATA,
  // continuity 环节解析出的结构化数据。此前只存不用，面板里看不到
  // 「生成下一镜头前必须核对的规则清单」—— 而那正是该环节最该被看见的产出。
  continuityData: {
    lockZh: '一名 30 多岁的东亚男性，灰蓝色硬挺风衣，左袖口 3cm 磨破',
    lockEn: 'a man in his 30s, stiff grey-blue trench coat, 3cm frayed left cuff',
    characters: [{ name: '主角', appearance: '短乱黑发', age: '30 代', clothing: '灰蓝风衣', marks: '左袖口磨破' }],
    environments: [{ scene: '废墟广场', time: '黎明', light: '5600K', spatial: '开阔' }],
    props: [{ name: '旧机械表', position: '主角左手腕', state: '磨损、表带开裂', shots: '全片' }],
    rules: [
      '风衣必须始终为灰蓝色，不得被渲染成深灰或黑色',
      '旧机械表在所有镜头中必须可见于左手腕',
      '前 4 镜主角面部不得被完全照亮',
    ],
  },
  // 模拟「最后一次执行的是增量修改」：pipeline 只剩子集，skillHistory 才是全集。
  // 曾经前端用 pipeline 推导完成标记，导致修订后重开项目、侧栏大半环节不再显示已完成。
  pipeline: ['cinematography', 'storyboard', 'continuity', 'prompt_engineering', 'quality_control'],
  skillHistory: SKILL_IDS,
  memory: {
    preferences: ['禁止：赛博朋克', '偏好方向：东方神话'],
    revisions: [{ instruction: '不要赛博朋克，改成东方神话。', at: Date.now() }],
    decisions: ['完成创意与类型定位'],
  },
}

// ── SSE 事件流（覆盖全部前端处理分支）──────────────────
function buildSSE() {
  const ev = []
  const push = (e, d) => ev.push(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
  push('session', { id: 'sess_smoke1', title: '测试项目' })
  push('status', { phase: 'planning', text: '导演正在理解你的想法…' })
  push('plan', {
    intent: 'new_brief', skills: SKILL_IDS,
    skillNames: SKILL_IDS.map((id, i) => ({ id, name: SKILL_META[id][1], role: '导演', stage: i + 1 })),
    reasoning: '检测到创作需求，启动完整导演流水线',
    constraints: { duration: 30, aspect: '2.39:1', platforms: ['seedance', 'kling'], language: 'zh' },
    mode: 'demo',
  })
  push('knowledge', {
    genres: ['社会寓言'], moods: ['孤独', '希望'],
    conflict: '人 vs 命运/时间', positioning: '作者商业（中间地带）',
    styles: [{ id: 'nolan_grand_realism', name: '诺兰式宏大真实感', summary: 's' }],
    directors: [{ id: 'villeneuve', name: '丹尼斯·维伦纽瓦', signature: '冷峻哲学感', reasons: ['主题契合「宿命与预言」'] }],
    structures: [{ id: 'nonlinear', name: '非线性叙事', reasons: ['故事含「时间」信号'] }],
    visualSystems: ['北欧冷峻'], colors: ['蓝色'],
    aspectRatio: '21:9', durationMode: '5 分钟短片', scriptLevel: 'Level 4 专业电影剧本',
    films: ['盗梦空间(2010)'],
  })
  // 11 个技能全部走一遍（覆盖前端全部处理分支）
  SKILL_IDS.forEach((id, i) => {
    push('stage_start', { skill: id, name: SKILL_META[id][1], role: '导演', stage: i + 1, index: i + 1, total: SKILL_IDS.length })
    push('delta', { skill: id, delta: '产出内容第 ' + (i + 1) + ' 段。\n' })
    if (id === 'storyboard') {
      push('delta', { skill: id, delta: '## Shot List\n| Shot | 时间 | 景别 |\n|---|---|---|\n| 01 | 0-5s | 大远景 |\n' })
      push('stage_done', { skill: id, name: '分镜设计', outputKey: 'storyboard', text: STORYBOARD_MD, parsed: { shots: 1 }, shots: SHOTS })
    } else if (id === 'prompt_engineering') {
      push('stage_done', { skill: id, name: 'AI 提示词工程', outputKey: 'prompts', text: PROMPTS_MD, parsed: { prompts: 1, characters: 1, covered: '13/13' }, promptData: PROMPT_DATA })
    } else {
      push('stage_done', { skill: id, name: SKILL_META[id][1], outputKey: SKILL_META[id][0], text: '产出内容第 ' + (i + 1) + ' 段。', parsed: {} })
    }
  })
  push('memory', { preferences: ['禁止：赛博朋克', '偏好方向：东方神话'], revisions: [{ instruction: '不要赛博朋克', at: Date.now() }] })
  push('done', { session: FINAL_SESSION })
  return ev.join('')
}

// ── fetch 桩 ────────────────────────────────────────────
// 主流程里项目列表必须为空：App 初始化时会自动打开列表中的第一个项目，
// 那会跳过示例卡片流程。重开项目的测试单独用开关打开。
let sessionListVisible = false

function makeFetch() {
  return async function fetchStub(url, init) {
    const u = String(url)
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (u.includes('/api/health')) return json({ ok: true, llm: 'demo' })
    if (u.includes('/api/settings')) return json(SETTINGS)
    if (u.includes('/api/skills')) return json(SKILLS)
    if (u.includes('/api/knowledge')) return json(KNOWLEDGE)
    if (u.includes('/api/sessions/') && u.includes('/export')) return new Response('# export', { status: 200 })
    if (u.includes('/api/sessions/')) return json(FINAL_SESSION)
    if (u.includes('/api/sessions')) {
      return json({
        sessions: sessionListVisible
          ? [{
              id: FINAL_SESSION.id, title: FINAL_SESSION.title, brief: FINAL_SESSION.brief,
              updatedAt: Date.now(), pipeline: SKILL_IDS, hasOutput: true,
            }]
          : [],
      })
    }
    if (u.includes('/api/chat')) {
      const body = new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(buildSSE())); c.close() },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return json({})
  }
}

// ── 主流程 ──────────────────────────────────────────────
;(async () => {
  console.log('\n=== UI 渲染冒烟测试 ===\n')

  console.log('[1] esbuild 打包前端…')
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"' },
    jsx: 'automatic', logLevel: 'silent',
  })
  const code = out.outputFiles[0].text
  console.log(`    打包完成：${(code.length / 1024).toFixed(0)} KB`)

  console.log('[2] 建立 jsdom 环境…')
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173/', pretendToBeVisual: true, runScripts: 'outside-only',
  })
  const { window } = dom
  window.fetch = makeFetch()
  window.MessageChannel = MessageChannel
  window.ReadableStream = ReadableStream
  window.Response = Response
  window.TextEncoder = TextEncoder
  window.TextDecoder = TextDecoder
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  const errors = []
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)))
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + String(e.reason)))

  console.log('[3] 挂载 React…')
  window.eval(code)
  const root = window.document.getElementById('root')
  await new Promise((r) => setTimeout(r, 600))

  const html = root.innerHTML
  check('React 成功挂载（#root 非空）', html.length > 200, `${html.length} 字节`)
  check('渲染品牌标题', html.includes('AI 电影导演工作站'))
  check('首页说明创作流程', html.includes('描述想法') && html.includes('生成方案') && html.includes('查看与修改'))
  check('渲染示例卡片', html.includes('example-card'))
  check('渲染制作团队 Skill 列表', html.includes('导演分析与决策') && html.includes('连续性管理'))
  check('工作站显示空态', html.includes('工作站空置中') || html.includes('分镜'))
  check('无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  for (const [label, cls] of [['成果', 'view-results'], ['项目', 'view-projects'], ['创作', 'view-chat'], ['并排', 'view-split']]) {
    Array.from(root.querySelectorAll('.view-switch button')).find(b => b.textContent === label).click()
    await new Promise(r => setTimeout(r, 30))
    check('切换工作区：' + label, !!root.querySelector('.main.' + cls))
  }

  console.log('[4] 模拟点击示例卡片，走完整 SSE 事件流…')
  const cards = root.querySelectorAll('.example-card')
  check('找到示例卡片按钮', cards.length > 0, `${cards.length} 个`)
  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 80))
  check('示例先填入编辑器', root.querySelector('textarea').value.includes('宇宙'))
  check('示例不会直接启动生成', !root.querySelector('.msg-user'))
  const generateButton = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('生成方案'))
  generateButton.click()

  // 等待 SSE 流消费完成
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (root.innerHTML.includes('已完成') || root.querySelector('.plan-bar')) break
  }
  await new Promise((r) => setTimeout(r, 800))

  const h2 = root.innerHTML
  check('用户消息上屏', h2.includes('msg-user'))
  check('渲染导演规划条', h2.includes('plan-bar') && h2.includes('导演规划'))
  check('渲染规划技能链', h2.includes('plan-step'))
  check('渲染知识库命中', h2.includes('知识库命中') && h2.includes('kb-hit'))
  check('渲染阶段卡片（streaming）', h2.includes('stage-card'))
  check('阶段卡片标记完成', h2.includes('stage-card done') || h2.includes('✓ 完成'))
  check('渲染 Markdown 表格', h2.includes('<table>') && h2.includes('<thead>'))
  check('规划条显示约束 chip', h2.includes('意图：'))
  check('顶栏显示 LLM/演示模式', h2.includes('演示模式'))
  check('知识面板含导演决策命中理由', h2.includes('主题契合') || h2.includes('维伦纽瓦'))
  check('知识面板含叙事结构与画幅', h2.includes('非线性叙事') || h2.includes('21:9'))

  console.log('[4b] 校验项目参数面板…')
  check('渲染项目参数面板', h2.includes('params-bar'))
  check('参数面板含时长下拉', h2.includes('1 分钟短片') && h2.includes('120 分钟电影'))
  check('参数面板含剧本等级 L1-L5', h2.includes('L1') && h2.includes('L5 · 导演制作稿'))
  check('参数面板含四种画幅', h2.includes('21:9 宽银幕') && h2.includes('9:16 竖屏') && h2.includes('1:1 方形'))
  check('参数面板含目标平台芯片', h2.includes('platform-chip'))

  console.log('[5] 校验工作站结构化产出…')
  check('分镜卡片渲染 SHOT 01', h2.includes('SHOT 01'))
  check('分镜渲染景别/情绪字段', h2.includes('大远景') && h2.includes('空无'))
  check('分镜渲染 AI 提示词', h2.includes('中文提示词示例') || h2.includes('AI 提示词'))
  check('分镜统计卡渲染', h2.includes('stat-num') && h2.includes('镜头数'))

  // 切到「提示词」页签
  const moreButton = Array.from(root.querySelectorAll('.tab')).find(b => b.textContent === '更多内容')
  check('次要成果默认折叠', !!moreButton)
  moreButton?.click()
  await new Promise(r => setTimeout(r, 80))
  const tabs = Array.from(root.querySelectorAll('.tab'))
  const promptTab = tabs.find((t) => t.textContent.includes('提示词'))
  check('存在「提示词」页签', !!promptTab)
  if (promptTab) {
    promptTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const h3 = root.innerHTML
    check('提示词面板渲染 Character Lock', h3.includes('角色一致性提示词'))
    check('提示词面板渲染场景资产', h3.includes('场景资产提示词') && h3.includes('废墟'))
  }

  const h4a = root.innerHTML
  check('提示词质检卡片渲染', h4a.includes('提示词质检'))
  check('提示词质检显示 13 要素覆盖', h4a.includes('13 要素覆盖：13/13'))
  check('提示词质检显示无效词已清除', h4a.includes('0（已清除）'))

  // 切到「连续性」页签：结构化核对清单必须渲染出来
  const contTab = tabs.find((t) => t.textContent.includes('连续性'))
  check('存在「连续性」页签', !!contTab)
  if (contTab) {
    contTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const hc = root.innerHTML
    check('连续性面板渲染锁定片段', hc.includes('连续性锁定') && hc.includes('灰蓝色硬挺风衣'))
    check('连续性面板渲染核对清单', hc.includes('生成下一镜头前必须逐条核对') && hc.includes('必须始终为灰蓝色'))
    check('连续性面板渲染道具状态', hc.includes('旧机械表') && hc.includes('主角左手腕'))
    check('连续性面板渲染人物档案', hc.includes('人物一致性档案') && hc.includes('左袖口磨破'))
  }

  // 切到「审核」页签
  const revTab = Array.from(root.querySelectorAll('.tab')).find((t) => t.textContent.includes('审核'))
  check('存在「审核」页签', !!revTab)
  if (revTab) {
    revTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    check('审核页显示评分总览', root.innerHTML.includes('导演审核评分') && root.innerHTML.includes('7.0'))
  }

  // 切到「记忆」页签
  const memTab = tabs.find((t) => t.textContent.includes('记忆'))
  if (memTab) {
    memTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const h4 = root.innerHTML
    check('记忆面板渲染已学习偏好', h4.includes('禁止：赛博朋克'))
    check('记忆面板渲染项目 Brief', h4.includes('项目 Brief'))
  }

  check('制作约束警告可见', root.textContent.includes('制作约束待处理'))
  check('分镜时长差异可见', root.textContent.includes('相差 252 秒'))
  console.log('[6] 打开设置弹窗…')
  const btns = Array.from(root.querySelectorAll('button'))
  const setBtn = btns.find((b) => b.textContent.trim() === '设置')
  check('存在「设置」按钮', !!setBtn)
  if (setBtn) {
    setBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const h5 = root.innerHTML
    check('设置弹窗渲染服务商预设', h5.includes('modal') && h5.includes('DeepSeek'))
    check('设置弹窗提供 API 接入教程', h5.includes('API 配置教程') && h5.includes('火山方舟') && h5.includes('不要手动追加'))
    check('设置弹窗提示演示模式', h5.includes('演示模式') && h5.includes('API Key'))
    const ark = Array.from(root.querySelectorAll('.preset-card')).find(x => x.textContent.includes('火山'))
    ark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    check('Ark 预设设置默认模型和地址', root.querySelector('#api-base-url').value.includes('ark.cn-beijing') && root.querySelector('#api-model').value === 'doubao-seed-2-1-pro-260628')
    check('模型目录呈现且允许自定义 ID', root.querySelector('#api-model').getAttribute('list') === 'model-options' && root.querySelectorAll('#model-options option').length === 2 && !root.querySelector('#api-model').hasAttribute('pattern'))
    check('角色覆盖仅使用现有角色并有可访问标签', !!root.querySelector('label[for="role-planner"]') && !!root.querySelector('#role-reviewer') && !!root.querySelector('select[aria-label="任务规划服务商"]'))
    check('备用模型可编辑且说明不因质量切换', !!root.querySelector('#fallback-models') && root.querySelector('#fallback-help').textContent.includes('不会因内容质量'))
  }

  // ── 重开已保存项目：对话流必须完整且用真实环节名 ──
  // 曾经的缺陷：前端硬编码的环节表过期，重开后缺「叙事结构 / 摄影方案 / 连续性」，
  // 且环节名显示成 film_analysis 这类早已不存在的英文 id。
  console.log('[7] 从侧栏重开已保存项目…')
  const closeBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.includes('关闭') || b.className.includes('modal-close'))
  if (closeBtn) { closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)) }

  // 让项目列表出现（真实场景里用户是重新打开软件，这里用「新建项目」触发一次列表刷新）
  sessionListVisible = true
  const newBtn = Array.from(root.querySelectorAll('button')).find((b) => b.getAttribute('title') === '新建项目')
  check('存在「新建项目」按钮', !!newBtn)
  if (newBtn) {
    newBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
  }

  const sessItems = root.querySelectorAll('.session-item')
  check('侧栏渲染已保存项目', sessItems.length > 0, `${sessItems.length} 个`)
  if (sessItems.length) {
    sessItems[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (root.querySelectorAll('.stage-card').length >= 12) break
    }
    await new Promise((r) => setTimeout(r, 400))
    const h6 = root.innerHTML
    const cards = root.querySelectorAll('.stage-card').length
    check('重开后 12 个环节卡片全部还原', cards >= 12, `${cards} 个`)
    for (const nm of ['导演分析与决策', '叙事结构设计', '摄影方案', '视觉设计与美术', '连续性管理', '导演审核']) {
      check(`重开后包含环节「${nm}」`, h6.includes(nm))
    }
    for (const bad of ['film_analysis', 'visual_reference', 'director_style']) {
      check(`重开后不出现过期 id「${bad}」`, !h6.includes(bad))
    }
    // 增量修改后重开：完成标记必须覆盖全部有产出的环节，而不是最后一次的子集
    const doneRows = root.querySelectorAll('.skill-row.done').length
    check('重开后侧栏完成标记不缩水（≥12）', doneRows >= 12, `${doneRows} 个`)

    // 修订历史也应还原到对话流
    check('重开后还原修订记录', h6.includes('不要赛博朋克'))
  }

  // ── 知识库弹窗：包含实操参考与来源目录的11个页签 ──
  // 这里曾有覆盖盲区：InfoModals 对 /api/knowledge 的数据做了十几处**无保护**的
  // .map()（k.films.map → f.tags.map 等），接口一旦漏返回某个集合，
  // 弹窗会直接白屏，而之前的测试完全看不到 —— 因为压根没打开过它。
  //
  // ⚠️ 选择器必须**限定在弹窗内部**：工作站面板（WorkstationPanel）也有 `button.tab`，
  //    而且它的「叙事结构」与知识库弹窗的「叙事结构」同名。
  //    不限定范围就会点到左边面板上去，测试假失败。
  console.log('[8] 打开电影知识库弹窗并遍历全部页签…')
  for (const b of Array.from(root.querySelectorAll('button'))) {
    if (b.textContent.trim() === '✕') { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 150)) }
  }

  const kbBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.includes('电影知识库'))
  check('存在「电影知识库」入口', !!kbBtn)
  if (kbBtn) {
    kbBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    check('知识库弹窗已打开', root.innerHTML.includes('Film Knowledge Base'))

    const kbModal = root.querySelector('.modal')
    const kbTabs = kbModal ? Array.from(kbModal.querySelectorAll('button.tab')) : []
    check('知识库弹窗有11个页签，含实操参考与来源目录', kbTabs.length === 11 && kbTabs.some(t => t.textContent === '实操参考') && kbTabs.some(t => t.textContent === '来源目录'), `${kbTabs.length} 个`)

    const KB_TABS = [
      ['总览', '导演档案'],
      ['导演', '克里斯托弗·诺兰'],
      ['影片', '盗梦空间'],
      ['类型库', '科幻'],
      ['叙事结构', '三幕结构'],
      ['风格库', '诺兰式宏大真实感'],
      ['摄影语言', 'ARRI Alexa 65'],
      ['色彩美术', '北欧冷峻'],
      ['AI 平台', 'Seedance'],
    ]
    for (const [label, expect] of KB_TABS) {
      const el = kbTabs.find((b) => b.textContent.trim() === label)
      check(`知识库页签「${label}」存在`, !!el)
      if (!el) continue
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      const body = kbModal.querySelector('.modal-body')
      const html = body ? body.innerHTML : ''
      const active = kbTabs.find((b) => b.className.includes('active'))
      const detail = html.includes(expect)
        ? ''
        : `激活=${active ? active.textContent.trim() : '?'}；未找到「${expect}」；实际: ${html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)}`
      check(`知识库页签「${label}」渲染内容`, html.includes(expect), detail)
    }

    const kbClose = kbModal.querySelector('.modal-head button')
    check('知识库弹窗有关闭按钮', !!kbClose)
    if (kbClose) { kbClose.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 400)) }
    check('知识库弹窗可关闭', !root.innerHTML.includes('Film Knowledge Base'))
  }

  check('全程无运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  // ── [9] 错误边界 ───────────────────────────────────────────
  // 界面渲染的是任意 LLM 输出，任何形状异常都可能让某个组件在 render 阶段抛错。
  // 没有错误边界时，React 会卸载整棵树 → 用户看到纯白窗口，而且会话持久化意味着
  // 重开同一个项目会立刻再崩，等于「这个项目永远打不开了」。
  // 这里验证：坏一块只坏一块，兄弟节点照常渲染，并给出可操作的兜底界面。
  console.log('[9] 错误边界（子组件抛错时整棵树不该白屏）…')
  try {
    const entry = `
      import React from 'react'
      import ReactDOM from 'react-dom/client'
      import ErrorBoundary from './components/ErrorBoundary'
      function Boom() { throw new Error('boom-in-card') }
      function Fine() { return React.createElement('div', { id: 'fine' }, 'SIBLING-SURVIVED') }
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement('div', null,
          React.createElement(ErrorBoundary, { label: '坏卡片' }, React.createElement(Boom)),
          React.createElement(Fine)
        )
      )
    `
    const out2 = await esbuild.build({
      stdin: { contents: entry, resolveDir: path.join(ROOT, 'src'), loader: 'tsx' },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"development"' },
      jsx: 'automatic', logLevel: 'silent',
    })
    const dom2 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost:5173/', pretendToBeVisual: true, runScripts: 'outside-only',
    })
    dom2.window.MessageChannel = MessageChannel
    // React 会把被边界捕获的错误打到 console.error，那是预期行为，静音掉避免刷屏
    const origErr = console.error
    console.error = () => {}
    try {
      dom2.window.eval(out2.outputFiles[0].text)
      await new Promise((r) => setTimeout(r, 500))
    } finally {
      console.error = origErr
    }
    const h9 = dom2.window.document.getElementById('root').innerHTML
    check('错误边界渲染兜底界面', h9.includes('eb') && h9.includes('渲染失败'), h9.slice(0, 80))
    check('兜底界面标明出错区域', h9.includes('坏卡片'))
    check('兜底界面显示错误信息', h9.includes('boom-in-card'))
    check('兜底界面提供恢复入口', h9.includes('重试渲染') && h9.includes('重新加载应用'))
    check('兄弟节点未被连带卸载', h9.includes('SIBLING-SURVIVED'))
  } catch (e) {
    check('错误边界用例可运行', false, e.message)
  }

  // ── 汇总 ──
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) {
    console.log('失败项：')
    failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? '  (' + f.extra + ')' : '')))
    process.exit(1)
  }
  console.log('全部通过\n')
  process.exit(0)
})().catch((e) => {
  console.error('\n测试脚本异常：', e)
  process.exit(1)
})
