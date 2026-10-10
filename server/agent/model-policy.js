const { modelCatalog, resolveModel, loadSettings } = require('../config')
const learned = new Map()
// Same conservative character estimator as the existing Context LOD, with message overhead.
const estTokens = text => Math.ceil(String(text || '').length * 0.75)
const inputTokens = messages => 16 + messages.reduce((n, m) => n + 12 + estTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0)
const identity = s => `${s.provider}|${s.baseUrl}|${s.model}`
function redact(value, extra = []) {
  let text = String(value || '')
  let s = {}
  try { s = loadSettings() } catch {}
  const keys = [s.apiKey, ...Object.values(s.providerConfigs || {}).map(p => p.apiKey), process.env.ARK_API_KEY, process.env.LLM_API_KEY, ...extra].filter(k => typeof k === 'string' && k)
  for (const key of keys.sort((a, b) => b.length - a.length)) text = text.split(key).join('[REDACTED]')
  return text.replace(/Bearer\s+[^\s"',;}]+/gi, 'Bearer [REDACTED]').replace(/((?:api[_-]?key|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]')
}
function classify(status, text) {
  text = String(text || '')
  if (status === 401 || /invalid.*(?:api.?key|auth)|authentication|unauthorized/i.test(text)) return 'AUTH'
  if (/quota|insufficient|balance|credit|billing|余额|额度.*(?:耗尽|不足)/i.test(text)) return 'QUOTA'
  if (/safety|content.?filter|sensitive|安全|内容审核/i.test(text)) return 'SAFE_MODE'
  // Status is authoritative: TPM throttling can mention "token limit", but is not an output cap.
  if (status === 429 || /rate.?limit|限流/i.test(text)) return 'RATE_LIMIT'
  if (/context[_ -]?(?:length|window)|maximum context|context.*(?:exceed|long)|input.*(?:too long|exceed)|上下文/i.test(text)) return 'CONTEXT_LIMIT'
  if (/(?:max[_ ]?(?:completion[_ ]?)?tokens|max[_ ]?output[_ ]?tokens|output.*tokens|token limit).*(?:large|exceed|invalid|maximum|allowed|limit|range|must)|(?:invalid|maximum|allowed|limit).*max[_ ]?(?:completion[_ ]?)?tokens/i.test(text)) return 'OUTPUT_LIMIT'
  if (/unavailable|not.?available|not.?activated|not.?enabled|endpoint.*(?:paused|disabled|unavailable)|暂停|未开通/i.test(text) || status >= 500) return 'MODEL_NOT_AVAILABLE'
  if (status === 404 || /model.*(?:not found|does not exist)|模型不存在/i.test(text)) return 'MODEL_NOT_FOUND'
  if (status === 403) return 'AUTH'
  if (/timeout|超时|STREAM_IDLE|abort/i.test(text)) return 'TIMEOUT'
  if (/ECONN|ENOTFOUND|EAI_|EPIPE|fetch failed|network|socket|网络|连接.*(?:重置|拒绝)/i.test(text)) return 'NETWORK'
  if ([400, 405, 413, 415, 422].includes(status)) return 'INVALID_PARAMETER'
  return 'UNKNOWN'
}
function modelError(status, message, keys = []) {
  const category = classify(status, message)
  return Object.assign(new Error(redact(`${category}${status ? ` HTTP ${status}` : ''}: ${message}`, keys).slice(0, 800)), { category, status })
}
function effectiveBudget(messages, opts = {}, s = resolveModel(opts)) {
  const catalog = modelCatalog(), capability = { ...s.capability, ...learned.get(identity(s)) }
  const win = Math.min(Number(s.contextWindow) || catalog.unknown.context_window, Number(capability.context_window) || catalog.unknown.context_window)
  const desired = Number(opts.desiredOutputTokens ?? opts.maxTokens ?? catalog.taskBudgets[opts.role] ?? s.maxTokens ?? catalog.taskBudgets.stage)
  const cap = Number(capability.max_output_tokens) || catalog.unknown.max_output_tokens
  const estimatedInput = inputTokens(messages), margin = Math.max(256, Math.ceil(win * 0.02))
  const available = win - estimatedInput - margin
  if (available < 1) throw modelError(0, `上下文预算不足：估算输入 ${estimatedInput}，窗口 ${win}，余量 ${margin}。请按 Context LOD 精简非关键引用，核心契约未被删除。`)
  return { desired, effective: Math.max(1, Math.floor(Math.min(Number.isFinite(desired) && desired > 0 ? desired : 4096, cap, available, opts.outputCap ?? Infinity))), estimatedInput, window: win, margin, capability }
}
function payload(messages, opts = {}) {
  const s = resolveModel(opts), budget = effectiveBudget(messages, opts, s)
  const c = budget.capability
  const body = { model: s.model, messages, stream: Boolean(opts.streaming) }
  body[c.output_parameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens'] = budget.effective
  if (c.supports_temperature !== false && !opts.omitTemperature) body.temperature = opts.temperature ?? s.temperature
  if (c.supports_thinking === true && !opts.omitThinking) body.thinking = { type: opts.thinking === true ? 'enabled' : 'disabled' }
  if (opts.json && c.supports_json === true) body.response_format = { type: 'json_object' }
  return { s, body, budget }
}
function correctedOptions(error, request, opts) {
  const { category } = error
  if (!['OUTPUT_LIMIT', 'CONTEXT_LIMIT', 'INVALID_PARAMETER'].includes(category)) return null
  const message = error.message
  if (category === 'INVALID_PARAMETER') {
    if (/temperature/i.test(message) && request.body.temperature !== undefined) return { ...opts, omitTemperature: true }
    if (/thinking/i.test(message) && request.body.thinking) return { ...opts, omitThinking: true }
    return null
  }
  // Only accept explicit maximum/allowed upper bounds, never the requested value or token usage.
  const match = message.match(/(?:maximum(?:\s+(?:allowed|context(?:\s+length)?|output(?:\s+tokens)?|max_tokens))?|at most|allowed|limit|<=|less than or equal to)(?:\s+is)?\s*[:=]?\s*(\d[\d,]*)/i) || message.match(/\[\s*\d+\s*,\s*(\d+)\s*\]/)
  const bound = match ? Number(match[1].replace(/,/g, '')) : 0
  const old = learned.get(identity(request.s)) || {}
  if (bound > 0 && bound <= 1048576) {
    const field = category === 'CONTEXT_LIMIT' ? 'context_window' : 'max_output_tokens'
    learned.set(identity(request.s), { ...old, [field]: Math.min(bound, old[field] || Infinity) })
    if (learned.size > 128) learned.delete(learned.keys().next().value)
  }
  const newCap = category === 'OUTPUT_LIMIT' && bound > 0 ? Math.min(bound, request.budget.effective - 1) : Math.max(1, Math.floor(request.budget.effective / 2))
  if (newCap >= request.budget.effective) return null
  return { ...opts, outputCap: newCap }
}
module.exports = { estTokens, inputTokens, effectiveBudget, payload, correctedOptions, redact, classify, modelError }
