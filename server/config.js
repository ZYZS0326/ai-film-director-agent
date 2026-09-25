/**
 * 配置管理 — 读取 .env / settings.json，支持 UI 在线修改
 */
const fs = require('fs')
const path = require('path')

// 数据目录：Electron 打包后 app.asar 只读，必须指向用户数据目录
// Electron 主进程会在 require 之前设置 AI_FILM_DATA_DIR
const DATA_DIR = process.env.AI_FILM_DATA_DIR || path.join(__dirname, 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '中文强，性价比高' },
  { id: 'volcengine', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260628', note: '请按方舟控制台替换 Model ID' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', note: '接口模板，模型名请按账号可用项调整' },
  { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', note: '长上下文' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', note: '中文创作佳' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '中文强，稳定' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', note: '多模型聚合' },
  { id: 'ollama', name: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b', note: '完全离线' },
]

/** 极简 .env 解析 */
function loadEnvFile() {
  if (process.env.AIFD_TEST_MODE === '1') return {}
  const envPath = path.join(__dirname, '..', '.env')
  const out = {}
  try {
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* ignore */ }
  return out
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * 数值范围钳制。
 * 真实教训：用户为了消除「输出被截断」提示，把 Max Tokens 一路填到了 1e+99。
 * 这个数字会被原样发给服务商 —— 要么被拒（400），要么被掐到模型真实上限，
 * 结果就是「每个环节都超出上限、生成不完整」。设置项必须钳到合理区间。
 */
function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const LIMITS = {
  temperature: [0, 2, 0.8],
  maxTokens: [256, 65536, 8192],
  contextWindow: [4096, 1048576, 32768],
}

/**
 * 只接受非空字符串；其它类型一律退回默认值。
 *
 * 为什么需要：`sanitize()` 早期只钳制数值字段，字符串字段直接 `saved.model || 默认` ——
 * 而对象、数组、数字都是真值，会被原样留下：
 *   `{"model":{}}`   → 模型名变成 `{}`，请求体里是个 JSON 对象而不是字符串
 *   `{"apiKey":[]}`  → Authorization 头拼出空值，服务商返回鉴权错误
 *   `{"baseUrl":123}`→ buildUrl 拼出畸形地址
 * 这些都只在手改过设置文件时出现，但一旦出现，报错信息完全指不到真正的原因。
 */
function strOr(v, fallback) {
  return typeof v === 'string' && v.trim() ? v : fallback
}

/** 把任意来源的设置钳成安全值（读与写都走这里） */
function sanitize(raw = {}) {
  const out = { ...raw }
  out.temperature = (() => {
    const n = Number(raw.temperature)
    if (!Number.isFinite(n)) return LIMITS.temperature[2]
    return Math.min(LIMITS.temperature[1], Math.max(LIMITS.temperature[0], n))
  })()
  out.maxTokens = clampNum(raw.maxTokens, ...LIMITS.maxTokens)
  out.contextWindow = clampNum(raw.contextWindow, ...LIMITS.contextWindow)
  // 字符串字段：类型不对就退回默认值（见 strOr 的注释）
  out.baseUrl = strOr(raw.baseUrl, PRESETS[0].baseUrl)
  out.model = strOr(raw.model, PRESETS[0].model)
  out.presetId = strOr(raw.presetId, PRESETS[0].id)
  // apiKey 允许为空串（演示模式），所以只做类型检查、不要求非空
  out.apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
  out.theme = raw.theme === 'light' ? 'light' : 'dark'
  out.stream = raw.stream !== false
  return out
}

function loadSettings() {
  ensureDataDir()
  const env = { ...loadEnvFile(), ...process.env }
  let saved = {}
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      // ⚠️ `JSON.parse('null')` / '[]' / '"x"' / '123' 都是**合法 JSON**，但不是设置对象。
      // 原来直接把结果赋给 saved，紧接着读 `saved.baseUrl` 就会抛
      // `Cannot read properties of null` —— 而 loadSettings 在每次 LLM 调用与启动时都会跑，
      // 抛一次整个服务就起不来了（用户视角：软件打不开 / 一发消息就失败）。
      saved = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    }
  } catch { /* 解析失败：退回默认值 */ }

  const next = sanitize({
    baseUrl: saved.baseUrl || env.LLM_BASE_URL || PRESETS[0].baseUrl,
    apiKey: saved.apiKey || env.LLM_API_KEY || '',
    model: saved.model || env.LLM_MODEL || PRESETS[0].model,
    temperature: saved.temperature ?? env.LLM_TEMPERATURE ?? LIMITS.temperature[2],
    maxTokens: saved.maxTokens ?? env.LLM_MAX_TOKENS ?? LIMITS.maxTokens[2],
    // 模型上下文窗口（token）。决定每个环节能塞进多少历史产出与知识库。
    contextWindow: saved.contextWindow ?? env.LLM_CONTEXT_WINDOW ?? LIMITS.contextWindow[2],
    presetId: saved.presetId || 'deepseek',
    theme: saved.theme || 'light',
    stream: saved.stream !== false,
  })

  // 存量自愈：若磁盘上的数值越界（例如历史遗留的 1e+99），就地改写成合法值。
  // 直接写文件，不走 saveSettings，避免递归。
  const dirty = ['maxTokens', 'contextWindow', 'temperature']
    .some((k) => saved[k] !== undefined && Number(saved[k]) !== Number(next[k]))
  if (dirty) writeSettingsFile(next)
  return next
}

/**
 * 原子写设置文件（临时文件 + rename）。
 * 非原子写一旦被中断（断电 / 强杀进程）会留下半截 JSON —— 虽然 loadSettings 能容错回退，
 * 但用户会**静默丢掉已保存的 API Key 与全部配置**，且没有任何提示。
 * 会话文件早已是原子写，设置文件也应当一致。
 */
function writeSettingsFile(next) {
  ensureDataDir()
  const tmp = SETTINGS_FILE + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(tmp, SETTINGS_FILE)
  } catch {
    // rename 失败（跨设备/权限）就退回直写，并清掉临时文件
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8') } catch { /* ignore */ }
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

function saveSettings(patch) {
  const current = loadSettings()
  const next = sanitize({ ...current, ...patch })
  writeSettingsFile(next)
  return next
}

/** 返回给前端的脱敏配置 */
function publicSettings() {
  const s = loadSettings()
  return {
    baseUrl: s.baseUrl,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    contextWindow: s.contextWindow,
    presetId: s.presetId,
    theme: s.theme,
    hasKey: Boolean(s.apiKey),
    keyMask: s.apiKey ? s.apiKey.slice(0, 4) + '****' + s.apiKey.slice(-4) : '',
    presets: PRESETS,
    mode: s.apiKey ? 'llm' : 'demo',
  }
}

module.exports = { loadSettings, saveSettings, publicSettings, PRESETS, DATA_DIR }
