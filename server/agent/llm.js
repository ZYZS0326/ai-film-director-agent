/**
 * LLM 客户端 — OpenAI 兼容接口
 *
 * 设计原则：**真实世界的 LLM 服务会失败**。本客户端必须在各种异常下给出清晰错误，
 * 而不是让整条流水线静默崩溃。
 *
 * 容错策略：
 *   1. 超时控制（AbortController），避免长请求挂死
 *   2. 流式失败自动降级为非流式
 *   3. 统一模型能力与输入/输出预算；明确上限或参数错误只自校正一次
 *   4. 容忍各家 SSE 差异（data: 前缀、[DONE]、心跳注释行、reasoning_content）
 *   5. **输出被截断（finish_reason === 'length'）时自动续写** —— 这是「每个环节都只生成一半」
 *      的根因：契约要求完整正文，而模型单次输出有上限。只报警告是不够的，必须自动补完。
 */
const { loadSettings, resolveModel, isLocalOllama, sameService } = require('../config')
const policy = require('./model-policy')

const DEFAULT_TIMEOUT = 180000 // 3 分钟

/**
 * 单次输出被截断后，最多自动续写几轮。
 * 取 8：以 4096 上限的服务商为例，8 轮可覆盖 ~3.6 万 token 的正文，
 * 足够写完任何一个环节的完整契约。
 */
const MAX_CONTINUATIONS = 8
/** 某一轮续写如果只吐出这么点内容，说明模型在敷衍/拒答，再续下去没有意义 */
const MIN_USEFUL_CHUNK = 40
/**
 * 拼接总量的硬上限。
 * 有些网关会恒定回报 finish_reason='length'，若不设上限会白跑 8 轮。
 */
const MAX_TOTAL_CHARS = 256000

/** 续写指令：必须让模型「原样接上」，而不是重开一遍 */
const CONTINUE_PROMPT =
  '【续写指令】你的上一条输出被输出长度上限截断了，内容不完整。\n' +
  '请从中断处**原样接着写**，严格遵守：\n' +
  '1. 不要重复已输出的任何内容，不要重写已有标题，不要加任何前言（如"继续如下""以下是剩余部分"）。\n' +
  '2. 直接接上未写完的那一节，把剩余章节/条目**全部写完整**。\n' +
  '3. 若上一条末尾是一句话被硬截断，从被截断的那个词继续。\n' +
  '4. 不要写"因篇幅有限"这类说明，不要省略任何部分。'

function isConfigured() {
  const s = loadSettings()
  return Boolean((s.apiKey || isLocalOllama(s.baseUrl)) && s.baseUrl && s.model)
}

/**
 * 本次请求实际可用的 max_tokens。
 * 若模型上下文窗口较小（用户在设置里指定），把输出预算也压下来 ——
 * 否则「输入 + 输出」必然超出窗口，每个环节都会报上下文超长。
 */

function buildUrl(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  return b + '/chat/completions'
}

function headersOf(s, apiKey) {
  const key = String(apiKey ?? s.apiKey ?? '').trim()
  return {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

/** Apply only documented options for known default models on official endpoints. */

/** 读取错误响应体，转成人类可读文本 */
async function errorText(res, keys = []) {
  let t = ''
  try { t = await res.text() } catch { /* ignore */ }
  t = String(t || '').trim()
  // 尝试提取 JSON 里的 message
  try {
    const j = JSON.parse(t)
    if (j.error?.message) return policy.redact(`${j.error.code || ''}: ${String(j.error.message)}`, keys).slice(0, 700)
    if (j.message) return policy.redact(String(j.message), keys).slice(0, 700)
  } catch { /* 非 JSON，原样返回 */ }
  return policy.redact(t || '服务商未提供错误详情', keys).slice(0, 700)
}

/**
 * 深挖错误根因。
 * undici 抛出的 `TypeError: fetch failed` 只是包装，真正原因在 e.cause（可能多层嵌套）。
 */
function rootCause(e) {
  const parts = []
  let cur = e
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.code) parts.push(cur.code)
    if (cur.message && cur.message !== 'fetch failed') parts.push(cur.message)
    cur = cur.cause
  }
  return [...new Set(parts.filter(Boolean))].join(' / ') || String((e && e.message) || e)
}

/** 网络层错误码转中文可读文案 */
function humanizeNetwork(causeText) {
  const t = String(causeText || '')
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|connect timeout/i.test(t)) return '连接超时：服务商无响应，或网络/代理不通'
  if (/ECONNRESET|UND_ERR_SOCKET|socket hang up/i.test(t)) return '连接被服务端重置：可能是请求体过大、长连接被断开，或被代理/防火墙中断'
  if (/ECONNREFUSED/i.test(t)) return '连接被拒绝：Base URL 端口无服务'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(t)) return '域名解析失败：请检查 Base URL 与 DNS'
  if (/CERT|SSL|UNABLE_TO_VERIFY/i.test(t)) return 'TLS 证书校验失败'
  if (/429|rate.?limit/i.test(t)) return '触发服务商限流（429）'
  if (/fetch failed/i.test(t)) return '网络请求失败（fetch failed）'
  return ''
}

/** 是否为值得重试的瞬时故障 */
function isTransient(text) {
  return /ECONNRESET|UND_ERR_SOCKET|socket hang up|ETIMEDOUT|connect timeout|fetch failed|EPIPE|EAI_AGAIN|429|500|502|503|504|rate.?limit|超时/i.test(String(text || ''))
}

/** 上下文超长类错误 —— 重试无用，必须缩小提示词 */
function isContextOverflow(text) {
  return policy.classify(0, text) === 'CONTEXT_LIMIT'
}

/** 带退避重试执行：避免偶发网络抖动毁掉一整个环节 */
async function withRetry(fn, { retries = 3, baseDelay = 1500, shouldRetry } = {}) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const canRetry = shouldRetry ? shouldRetry(e) : isTransient(e && e.message)
      if (attempt >= retries || !canRetry) break
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)))
    }
  }
  const cause = rootCause(lastErr)
  const human = humanizeNetwork(cause)
  throw policy.modelError(lastErr?.status || 0, human ? `${human}（${cause}）` : String((lastErr && lastErr.message) || lastErr))
}

/**
 * 带超时的 fetch。
 *
 * ⚠️ 关键：`fetch()` 在**响应头到达**时就 resolve 了，body 还没读。
 * 如果在这里 `clearTimeout`，超时窗口就只覆盖「连接 + 首字节」——
 * 服务商发完响应头就挂住时，`res.json()` / `reader.read()` 会**永久挂起**：
 * 没有超时、没有报错、界面一直转圈。
 *
 * 所以这里把定时器与 abort 一起交给调用方，**读完 body 再 release()**。
 * 返回值：`{ res, release, abort, timeout }`。
 */
async function fetchWithTimeout(url, init, timeout, firstContentMs = 0) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  const firstTimer = firstContentMs ? setTimeout(() => ac.abort(), firstContentMs) : null
  const markContent = () => { if (firstTimer) clearTimeout(firstTimer) }
  const release = () => { clearTimeout(timer); markContent() }
  let handed = false
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    handed = true
    return { res, release, markContent, abort: () => ac.abort(), signal: ac.signal, timeout }
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeout / 1000)} 秒）。可能是模型响应慢或网络不通，可尝试换用更快的模型。`)
    }
    if (e.cause?.code) {
      const map = {
        ECONNREFUSED: '连接被拒绝：请检查 Base URL 是否正确、服务是否已启动。',
        ENOTFOUND: '域名无法解析：请检查 Base URL 与网络。',
        CERT_HAS_EXPIRED: 'SSL 证书异常。',
        ECONNRESET: '连接被重置：可能是网络不稳定或被防火墙拦截。',
      }
      throw new Error(map[e.cause.code] || `网络错误：${e.cause.code}`)
    }
    throw new Error(String(e.message || e))
  } finally {
    if (!handed) release()
  }
}

/**
 * 流式读取的空闲超时：超过这么久没有任何分片，就判定流断了。
 * 取 2 分钟 —— 推理模型在首个内容分片前可能思考很久，而多数服务商还会发 SSE 心跳注释
 * （`:` 开头，会被 reader 读到并重置本计时器），所以正常慢响应不会误伤。
 */
const STREAM_IDLE_TIMEOUT = 120000

/**
 * 读取一个流分片，带空闲超时。
 * 超时后 abort 底层请求（复用同一个 AbortController），让 `reader.read()` 自己 reject，
 * 交给调用方已有的 catch 统一处理 —— 这样既不留下悬空 socket，也不会永久挂起。
 * 注意：`reader.read()` 的 promise **始终挂上了 then/catch**，不会产生 unhandledRejection。
 */
function readWithIdle(reader, idleMs, abort) {
  let timer = null
  let settled = false
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { abort() } catch { /* ignore */ }
      reject(Object.assign(
        new Error(`流式响应空闲超过 ${Math.round(idleMs / 1000)} 秒，判定为流中断`),
        { code: 'STREAM_IDLE' },
      ))
    }, idleMs)
    reader.read().then(
      (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r) },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e) },
    )
  })
}

/** 构造参数降级序列：max_tokens 过大是各家最常见的 400 */
async function requestRaw(messages, onDelta, opts = {}) {
  let attemptOpts = opts
  for (let correction = 0; correction < 2; correction++) {
    const request = policy.payload(messages, attemptOpts)
    const { s, body, budget } = request
    const timeout = opts.timeout || DEFAULT_TIMEOUT
    let transport
    try {
      opts.onRequestBudget?.({ model: s.model, provider: s.provider, ...budget })
      transport = await fetchWithTimeout(buildUrl(s.baseUrl), {
        method: 'POST', headers: headersOf(s), body: JSON.stringify(body),
      }, timeout, opts.firstContentTimeout || 0)
      const { res, signal, abort, markContent } = transport
      if (!res.ok) throw policy.modelError(res.status, await errorText(res, [s.apiKey]), [s.apiKey])
      if (body.stream) return await consumeStream(res, messages, onDelta, { ...attemptOpts, apiKey: s.apiKey }, abort, markContent)
      let json
      try { json = await res.json() } catch {
        if (signal.aborted) throw policy.modelError(0, `请求超时（${Math.round(timeout / 1000)} 秒）：已连接但未返回正文`)
        throw policy.modelError(0, 'LLM 返回的不是合法 JSON，请检查 Base URL 是否为 OpenAI 兼容接口。')
      }
      const choice = json.choices?.[0] || {}
      const text = String(choice.message?.content ?? json.content ?? json.text ?? '')
      if (opts.streaming && onDelta) onDelta(text)
      opts.onUsage?.(json.usage || null)
      return { text, truncated: choice.finish_reason === 'length', generation_truncated: choice.finish_reason === 'length', usage: json.usage || null, effectiveOutputTokens: budget.effective }
    } catch (raw) {
      const error = policy.modelError(raw.status || 0, raw.message || String(raw), [s.apiKey])
      // Exactly one corrective attempt; neither authentication nor throttling enters here.
      const streamUnsupported = body.stream && ([405, 415, 501].includes(error.status) || error.category === 'INVALID_PARAMETER' && /stream|sse/i.test(error.message))
      const corrected = correction === 0 ? streamUnsupported ? { ...attemptOpts, streaming: false } : policy.correctedOptions(error, request, attemptOpts) : null
      if (!corrected) throw error
      opts.onBudgetCorrection?.({ category: error.category, model: s.model, from: budget.effective, to: corrected.outputCap ?? budget.effective })
      attemptOpts = corrected
    } finally { transport?.release() }
  }
}

/**
 * 非流式对话（单次）—— 返回 { text, truncated }
 */
async function chatOnceRaw(messages, opts = {}) {
  return requestRaw(messages, null, { ...opts, streaming: false })
}

/**
 * 流式对话（单次）—— 返回 { text, truncated }
 * 失败时自动降级为非流式（很多服务/网关不支持 SSE）
 */
async function chatStreamRaw(messages, onDelta, opts = {}) {
  return requestRaw(messages, onDelta, { ...opts, streaming: true })
}

/**
 * 消费流式响应体。
 * 独立成函数是为了能用 try/finally 包住整段读取逻辑（release() 必须覆盖到 body 读完），
 * 同时不必把原逻辑整体缩进一层。
 */
async function consumeStream(res, messages, onDelta, opts, abort, markContent) {
  const idleMs = opts.idleTimeout || STREAM_IDLE_TIMEOUT

  if (!res.ok) {
    const t = await errorText(res)
    if (opts.failoverAttempt && [403, 404, 429, 500, 502, 503, 504].includes(res.status)) throw new Error(`LLM ${t}`)
    // 流式被拒绝或不支持 → 降级非流式
    if (/400|404|405|415|501/.test(String(res.status))) {
      const r = await chatOnceRaw(messages, opts)
      onDelta && onDelta(r.text)
      return r
    }
    throw new Error(`LLM ${t}`)
  }

  // Some compatible gateways ignore stream:true and return ordinary JSON.
  // Consume that response directly instead of restarting it on every model.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const json = await res.json()
    const choice = json.choices?.[0] || {}
    const text = String(choice.message?.content || '')
    if (!text.trim()) throw new Error('模型返回空正文')
    markContent && markContent()
    onDelta && onDelta(text)
    opts.onUsage?.(json.usage || null)
    return { text, truncated: choice.finish_reason === 'length', generation_truncated: choice.finish_reason === 'length', usage: json.usage || null }
  }

  if (!res.body) {
    // 无 body（某些网关会缓冲响应）→ 按非流式解析
    try {
      const json = await res.json()
      const ch = json?.choices?.[0] || {}
      const text = ch?.message?.content || ''
      if (text) { onDelta && onDelta(text); return { text, truncated: ch.finish_reason === 'length' } }
    } catch { /* fallthrough */ }
    // 仍无法流式读取 → 降级非流式
    const r = await chatOnceRaw(messages, opts)
    onDelta && onDelta(r.text)
    return r
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''
  let sawAny = false
  let truncated = false

  try {
    while (true) {
      // 带空闲守卫的读取：服务商发完响应头就挂住时，这里不会再永久等待。
      const { done, value } = await readWithIdle(reader, idleMs, abort)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line.startsWith(':')) continue              // SSE 心跳注释
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          if (json.usage) opts.onUsage?.(json.usage)
          const ch = json.choices?.[0] || {}
          if (ch.finish_reason === 'length') truncated = true
          // 兼容各家字段；推理模型还会把思考过程放在 reasoning_content（不作为正文）
          const delta = ch.delta?.content ?? ch.text ?? json.content ?? ch.message?.content
          if (delta) { markContent && markContent(); full += delta; sawAny = true; onDelta && onDelta(String(delta)) }
        } catch { /* 忽略不完整分片 */ }
      }
    }
  } catch (e) {
    // 读取中断（网络抖动，或空闲守卫判定流已挂死）。
    // 无论哪种，只要已经拿到部分内容就保留它 —— 丢掉的只是尾部，而不是整个环节。
    try { await reader.cancel() } catch { /* 已经 abort 过，忽略 */ }
    if (full) return { text: full, truncated: true, generation_truncated: true }
    if (opts.failoverAttempt) throw new Error(`模型未返回正文，流式请求中断或超时：${e.message}`)
    // 一点内容都没有 → 降级为非流式重来（有些网关对 SSE 支持不好，非流式反而正常）
    const r = await chatOnceRaw(messages, opts)
    onDelta && onDelta(r.text)
    return r
  }

  if (!sawAny) {
    if (opts.failoverAttempt) throw new Error('模型返回空正文，尝试备用模型')
    // 流里没有任何内容（网关缓冲 / 空响应，或只有 reasoning_content）→ 降级非流式
    const r = await chatOnceRaw(messages, opts)
    onDelta && onDelta(r.text)
    return r
  }

  return { text: full, truncated, generation_truncated: truncated }
}

/**
 * 截断后的兜底提示（自动续写也失败时才出现）。
 *
 * ⚠️ 措辞要小心：这里**不能**把「调高 maxTokens」当成解法来推。
 * 历史教训 —— 旧版提示写的是「可在设置中把 maxTokens 调高（建议 8192 以上）」，
 * 用户为了消除这条提示一路填到了 `1e+99`，结果每个环节都被服务商拒掉，
 * 反而变成「全都生成不完整」。数值现在有 LIMITS 钳制（上限 65536）兜底，
 * 但「调个数字就好了」这个暗示本身是错的：
 * 已经续写 N 轮仍没写完，说明**内容总量**超过了 N × 单轮上限，
 * 把单轮上限往后推只会让截断点后移，内容量不变时照样会再次截断。
 * 真正有效的杠杆是**减少本环节的产出量**，所以那句要放在最前面。
 */
function truncatedNotice(n) {
  return `\n\n> ⚠️ 本环节内容确实过长：已自动续写 ${n} 次仍未写完。\n` +
    '> 最有效的办法是减少这一环节的产出量 —— 缩短影片总时长，或减少镜头数量。\n' +
    '> （调高 maxTokens 只能把单轮输出上限往后推，内容总量不变时仍会再次截断。）'
}

/**
 * 通用续写循环。
 * 只要模型报告「输出被截断」，就把已生成的部分作为 assistant 消息回传，让它接着写。
 * 这是解决「每个环节都只生成一半」的关键 —— 单次输出上限是服务商的硬限制，
 * 但"上限"不等于"总量上限"，多轮拼接即可拿到完整正文。
 */
async function runWithContinuation(convo, callOnce, onDelta, opts = {}) {
  const maxCont = opts.maxContinuations ?? MAX_CONTINUATIONS
  let messages = convo
  let full = ''
  let cont = 0
  let truncated = false

  while (true) {
    let r
    try {
      r = await callOnce(messages)
    } catch (e) {
      // 已有部分内容就保留它，不要因为续写失败丢掉前面的成果
      if (full) { truncated = true; break }
      throw e
    }
    let chunk = r.text || ''
    // Remove only an exact substantial overlap; never discard a short legitimate repeated phrase.
    if (cont && full && chunk) {
      for (let n = Math.min(full.length, chunk.length, 4000); n >= 80; n--) {
        if (full.endsWith(chunk.slice(0, n))) { chunk = chunk.slice(n); break }
      }
    }
    if (cont && !chunk.trim()) { truncated = true; break }
    full += chunk
    truncated = r.truncated

    // 没有内容、没报截断、续写轮次用尽、或总量已足够长 → 结束
    if (!truncated || cont >= maxCont || !String(r.text || '').trim()) break
    if (full.length >= MAX_TOTAL_CHARS) break
    // 续写轮只吐了几个字：模型在敷衍，继续下去只会堆垃圾
    if (cont > 0 && String(r.text || '').trim().length < MIN_USEFUL_CHUNK) break

    cont += 1
    messages = [
      ...convo,
      // Keep original contracts/hard facts, but avoid resending every previous long reply.
      { role: 'assistant', content: full.slice(-6000) },
      { role: 'user', content: CONTINUE_PROMPT },
    ]
    // 让界面知道「还在写」而不是卡住了
    if (typeof opts.onContinue === 'function') opts.onContinue(cont, r.text.length)
    if (onDelta) onDelta('')
  }

  return { text: full, truncated, continuations: cont }
}

const modelCooldowns = new Map()

/** A model pool shares only the selected origin and its key; explicit test overrides stay single-model. */
async function routeRequest(fn, opts = {}, canSwitch = () => true) {
  const s = resolveModel(opts)
  const explicit = ['baseUrl', 'model', 'apiKey'].some(k => Object.hasOwn(opts, k))
  const models = explicit || opts.failover === false ? [s.model] : [...new Set([s.model, ...s.fallbackModels])]
  const retryable = e => canSwitch() && ['RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'MODEL_NOT_AVAILABLE'].includes(e.category || policy.classify(e.status || 0, e.message))
  if (models.length === 1) return withRetry(() => fn(opts), { shouldRetry: retryable })
  const keyId = require('crypto').createHash('sha256').update(s.apiKey).digest('hex').slice(0, 16)
  const poolId = `${s.baseUrl}|${keyId}|${models.join(',')}`
  const cooling = m => (modelCooldowns.get(`${poolId}|${m}`) || 0) > Date.now()
  const candidates = [...models.filter(m => !cooling(m)), ...models.filter(cooling)]
  const failures = []
  for (const model of candidates) {
    try {
      const requestOpts = { ...opts, provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey, model,
        timeout: opts.timeout || (opts.streaming ? DEFAULT_TIMEOUT : 60000),
        // Non-streaming returns the whole batch at once, not an early first token.
        // Applying the streaming 45s gate here prematurely kills valid long JSON.
        firstContentTimeout: opts.firstContentTimeout ?? (opts.streaming ? 45000 : 0),
        failoverAttempt: true }
      // A sustained rate limit gets one backoff before switching. Quota/auth never retry.
      const result = await withRetry(() => fn(requestOpts), { retries: 1, baseDelay: opts.retryDelay ?? 1500,
        shouldRetry: e => canSwitch() && e.category === 'RATE_LIMIT' })
      if (!String(result.text || '').trim()) throw new Error('模型返回空正文')
      modelCooldowns.delete(`${poolId}|${model}`)
      return result
    } catch (e) {
      const category = e.category || policy.classify(e.status || 0, e.message)
      if (!canSwitch() || !['MODEL_NOT_AVAILABLE', 'RATE_LIMIT', 'QUOTA', 'TIMEOUT', 'NETWORK'].includes(category)) throw e
      modelCooldowns.set(`${poolId}|${model}`, Date.now() + 120000)
      if (modelCooldowns.size > 128) modelCooldowns.delete(modelCooldowns.keys().next().value)
      failures.push(model)
      const to = candidates[candidates.indexOf(model) + 1]
      if (to) {
        const event = { from: policy.redact(model, [s.apiKey]), to: policy.redact(to, [s.apiKey]), reason: policy.redact(category + ': ' + e.message, [s.apiKey]) }
        console.info('[LLM fallback]', JSON.stringify(event))
        if (typeof opts.onModelSwitch === 'function') opts.onModelSwitch(event)
      }
    }
  }
  throw policy.modelError(0, `主模型和备用模型均未能完成请求（${failures.join('、')}）。请检查模型开通状态、额度和网络。`, [s.apiKey])
}

/** 非流式对话（带重试 + 自动续写） */
async function chat(messages, opts = {}) {
  if (opts.structured) {
    // Repair a truncated structured object from scratch once; do not concatenate JSON fragments.
    for (let repair = 0; repair < 2; repair++) {
      const result = await routeRequest(requestOpts => chatOnceRaw(messages, requestOpts), opts)
      if (!result.truncated) { opts.onGenerationResult?.({ generation_truncated: false }); return result.text }
      opts.onGenerationResult?.({ generation_truncated: true, repair })
      if (repair) throw Object.assign(new Error('结构化输出被截断，修复未完成；不会作为完整结果使用。'), { category: 'TRUNCATED', generation_truncated: true })
      messages = [...messages, { role: 'user', content: '上一轮触及输出上限。请从头输出更紧凑但完整的合法 JSON，不省略必需字段，不要输出说明或 Markdown。' }]
    }
  }
  const r = await runWithContinuation(
    messages,
    (m) => routeRequest(requestOpts => chatOnceRaw(m, requestOpts), opts),
    null,
    opts
  )
  opts.onGenerationResult?.({ generation_truncated: r.truncated, continuations: r.continuations })
  return r.truncated ? r.text + truncatedNotice(r.continuations) : r.text
}

/**
 * 流式对话（带重试 + 自动续写）
 * 仅在「一个字都还没发出去」时才重试，避免已流式输出的内容重复上屏
 */
async function chatStream(messages, onDelta, opts = {}) {
  const state = { sent: 0 }
  const guarded = (d) => { state.sent += String(d).length; onDelta && onDelta(d) }

  const r = await runWithContinuation(
    messages,
    (m) => {
      // 每一轮续写重置计数，允许新一轮在开吐之前重试
      state.sent = 0
      return routeRequest(requestOpts => chatStreamRaw(m, guarded, requestOpts), { ...opts, streaming: true }, () => state.sent === 0)
    },
    onDelta,
    opts
  )
  opts.onGenerationResult?.({ generation_truncated: r.truncated, continuations: r.continuations })
  return r.truncated ? r.text + truncatedNotice(r.continuations) : r.text
}

/** 连通性测试 —— 返回结构化结果，便于前端展示真实错误 */
/**
 * 连通性测试。
 *
 * `override` 允许用「表单里当前填的值」去测，而**不必先写盘** ——
 * 早期实现只能读已保存的配置，于是前端不得不在测试前先 saveSettings，
 * 导致「测试连接」有副作用：测完直接关掉弹窗，改动其实已经生效了，
 * 用户却以为「没点保存＝没改」。
 */
async function testConnection(override = {}) {
  try {
    // ⚠️ loadSettings() 必须在 try **内部**。
    // 它会调用 ensureDataDir()（mkdirSync），数据目录不可写时抛错 ——
    // 放在 try 外面的话 testConnection 会 reject，而调用它的
    // `POST /api/settings/test` 是 async 路由，Express 4 不捕获 async 异常，
    // Node 22 默认把未处理的 rejection 当致命错误 → **整个服务进程结束**。
    // 用户视角：点一下「测试连接」，后端就没了。
    const s = loadSettings()
    const resolved = resolveModel(override)
    const baseUrl = resolved.baseUrl
    const apiKey = typeof override.apiKey === 'string' ? override.apiKey.trim() : resolved.apiKey
    const model = resolved.model
    if (!baseUrl) throw new Error('未填写 Base URL')
    if (!override.provider && !Object.hasOwn(override, 'apiKey') && !sameService(baseUrl, s.baseUrl) && !isLocalOllama(baseUrl)) throw new Error('已切换服务商，请填写该服务商的 API Key 后再测试')
    if (!apiKey && !isLocalOllama(baseUrl)) throw new Error('未填写 API Key')
    if (!model) throw new Error('未填写模型名称')
    const text = await chat(
      [
        { role: 'system', content: '你是一个测试助手，只回复两个字。' },
        { role: 'user', content: '请回复：连通' },
      ],
      { maxTokens: 1024, temperature: 0, timeout: 30000, maxContinuations: 0, baseUrl, apiKey: apiKey || 'ollama', model }
    )
    if (!String(text || '').trim()) throw new Error('接口已响应，但模型未返回正文；请检查模型权限或输出参数')
    return { ok: true, message: `连接成功，模型响应：${String(text).slice(0, 40)}`, sample: String(text).slice(0, 120) }
  } catch (e) {
    return { ok: false, message: policy.redact(e.message || e, [override.apiKey]), category: e.category || policy.classify(0, e.message) }
  }
}

module.exports = {
  isConfigured,
  chat,
  chatStream,
  chatOnceRaw,
  chatStreamRaw,
  testConnection,
  isContextOverflow,
  CONTINUE_PROMPT,
  truncatedNotice,
}
