import { useEffect, useState } from 'react'
import { Settings } from '../types'
import { api } from '../api'

interface Props {
  onClose: () => void
  onSaved: (s: Settings) => void
  toast: (msg: string, kind?: 'ok' | 'err' | '') => void
}

export default function SettingsModal({ onClose, onSaved, toast }: Props) {
  const [s, setS] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => toast('读取设置失败：' + e.message, 'err'))
  }, [])

  if (!s) return null

  const pickPreset = (p: Settings['presets'][number]) => {
    const changed = p.baseUrl !== s.baseUrl
    const profile = p.id === s.provider ? { baseUrl: s.baseUrl, model: s.model, hasKey: s.hasKey, fallbackModels: s.fallbackModels } : s.providerConfigs?.[p.id]
    if (changed) setApiKey('')
    setTestResult(null)
    setS({ ...s, provider: p.id, presetId: p.id, baseUrl: profile?.baseUrl || p.baseUrl, model: profile?.model || p.model, fallbackModels: profile?.fallbackModels,
      maxTokens: 8192, contextWindow: p.id === 'ollama' ? 32768 : 131072,
      hasKey: profile?.hasKey ?? (changed ? false : s.hasKey), keyMask: profile?.hasKey ? '已保存（隐藏）' : changed ? '' : s.keyMask,
      mode: p.id === 'ollama' || profile?.hasKey || (!changed && s.hasKey) ? 'llm' : 'demo' })
  }

  const save = async () => {
    try {
      const next = await api.saveSettings({
        baseUrl: s.baseUrl, model: s.model, presetId: s.presetId, provider: s.provider,
        roleModels: s.roleModels || {},
        ...(s.fallbackModels !== undefined ? { fallbackModels: s.fallbackModels } : {}),
        temperature: s.temperature,
        maxTokens: Math.min(65536, Math.max(256, s.maxTokens || 8192)),
        contextWindow: s.contextWindow ?? 32768,
        ...(apiKey ? { apiKey } : {}),
      })
      onSaved(next)
      toast('设置已保存', 'ok')
      onClose()
    } catch (e: any) {
      toast('保存失败：' + e.message, 'err')
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 用表单里当前填的值直接测，**不写盘** ——
      // 早期实现是先 saveSettings 再测，于是「测试连接」变成有副作用的操作：
      // 用户测完直接关掉弹窗，以为改动被丢弃了，其实已经生效。
      const r = await api.testSettings({
        baseUrl: s.baseUrl,
        provider: s.provider,
        model: s.model,
        ...(apiKey ? { apiKey } : {}),
      })
      setTestResult(r)
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">设置</span>
          <button className="icon-btn ghost" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className={`notice ${s.mode === 'llm' ? 'ok' : 'warn'}`}>
            {s.presetId === 'ollama'
              ? '本地 Ollama 无需 API Key。请先启动 Ollama 并下载所选模型，然后测试连接。'
              : s.hasKey
              ? `已保存 API Key（${s.keyMask}）。请测试连接确认模型可用。`
              : '未配置 API Key —— 当前运行在「演示模式」：导演流水线、知识库检索、结构化分镜与提示词均可完整运行，但文本由内置引擎生成。填入任意 OpenAI 兼容接口的 Key 即可切换为真实 LLM 创作。'}
          </div>

          <details className="api-guide">
            <summary>
              <span>
                <strong>第一次接入？查看 API 配置教程</strong>
                <small>适用于火山方舟、DeepSeek、OpenAI 兼容服务和本地 Ollama</small>
              </span>
              <span className="api-guide-toggle" aria-hidden="true">展开</span>
            </summary>
            <div className="api-guide-body">
              <ol className="api-guide-steps">
                <li><strong>在服务商控制台开通模型并创建 API Key</strong><span>Key 通常只显示一次，请单独保存；不要把 Key 发给他人。</span></li>
                <li><strong>填写 Base URL</strong><span>填写兼容接口的基础地址，不要手动追加 <code>/chat/completions</code>。</span></li>
                <li><strong>填写模型标识</strong><span>复制控制台给出的 Model ID；火山自定义推理接入点可填写 Endpoint ID。</span></li>
                <li><strong>先测试，再保存</strong><span>“测试连接”不会保存设置。看到成功提示后，再点击“保存”。</span></li>
              </ol>
              <div className="api-guide-table" role="table" aria-label="常见服务商配置示例">
                <div className="api-guide-row api-guide-head" role="row"><span role="columnheader">服务</span><span role="columnheader">Base URL</span><span role="columnheader">模型填写方式</span></div>
                <div className="api-guide-row" role="row"><strong role="cell">火山方舟</strong><code role="cell">https://ark.cn-beijing.volces.com/api/v3</code><span role="cell">控制台的 Model ID / Endpoint ID</span></div>
                <div className="api-guide-row" role="row"><strong role="cell">DeepSeek</strong><code role="cell">https://api.deepseek.com/v1</code><span role="cell">deepseek-flash</span></div>
                <div className="api-guide-row" role="row"><strong role="cell">其他兼容服务</strong><span role="cell">服务商文档中的 OpenAI Compatible Base URL</span><span role="cell">服务商提供的模型名称</span></div>
                <div className="api-guide-row" role="row"><strong role="cell">本地 Ollama</strong><code role="cell">http://localhost:11434/v1</code><span role="cell">本机已下载的模型名</span></div>
              </div>
              <div className="api-guide-security"><strong>隐私提醒</strong><span>API Key 保存在本机设置文件中，当前尚未使用系统密钥库加密。使用远程模型时，故事和制作上下文会发送给所选服务商。</span></div>
            </div>
          </details>

          <div className="field">
            <label className="field-label">服务商预设</label>
            <div className="preset-grid">
              {s.presets.map((p) => (
                <button key={p.id} className={`preset-card ${s.presetId === p.id ? 'active' : ''}`} onClick={() => pickPreset(p)}>
                  <div className="preset-name">{p.name}</div>
                  <div className="preset-note">{p.note}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="api-base-url">Base URL</label>
            <input id="api-base-url" className="input" value={s.baseUrl} onChange={(e) => { setTestResult(null); setS({ ...s, baseUrl: e.target.value }) }} placeholder="https://api.deepseek.com/v1" />
            <div className="field-hint">填写服务商提供的 OpenAI 兼容基础地址；版本路径可能是 /v1、/v4 或 /api/v3，不要追加 /chat/completions。</div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="api-key">API Key{s.presetId === 'ollama' ? '（本地无需填写）' : ''}</label>
            <input id="api-key" className="input" type="password" value={apiKey} autoComplete="off"
              onChange={(e) => { setTestResult(null); setApiKey(e.target.value) }}
              placeholder={s.hasKey ? '已保存，留空则不修改' : '填写所选服务商的 API Key'} />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="api-model">模型</label>
            <input id="api-model" className="input" list="model-options" aria-describedby="model-help" value={s.model} onChange={(e) => { setTestResult(null); setS({ ...s, model: e.target.value }) }} placeholder="选择或填写 Model ID / Endpoint ID" />
            <datalist id="model-options">{s.presets.find(p => p.id === s.presetId)?.models?.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</datalist>
            <div id="model-help" className="field-hint">可选择目录内模型，也可直接填写任何 Model ID 或 ep-…；标识原样发送，不需要更改接口地址。</div>
          </div>

          <details className="api-guide">
            <summary>高级：各角色独立选模型（可选）</summary>
            <div className="field-hint">留空使用主模型。跨服务商使用前，请先在对应预设中保存 Key。目录和能力可通过本机数据目录的 model-catalog.json 配置。</div>
            {(s.roles || []).map(role => {
              const value = s.roleModels?.[role.id]
              return <div className="field" key={role.id}>
                <label className="field-label" htmlFor={`role-${role.id}`}>{role.name} · 模型（可选）</label>
                <select className="input" aria-label={`${role.name}服务商`} value={value?.provider || s.provider} onChange={e => setS({ ...s, roleModels: { ...s.roleModels, [role.id]: { model: value?.model || '', provider: e.target.value } } })}>
                  {s.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="input" id={`role-${role.id}`} value={value?.model || ''} placeholder={`继承主模型：${s.model}`} onChange={e => setS({ ...s, roleModels: { ...s.roleModels, [role.id]: { provider: value?.provider || s.provider, model: e.target.value } } })} />
              </div>
            })}
          </details>

          <div className="field">
            <label className="field-label" htmlFor="fallback-models">备用模型（可选，逗号分隔）</label>
            <input id="fallback-models" className="input" value={(s.fallbackModels ?? s.presets.find(p => p.id === s.presetId)?.fallbackModels ?? []).join(', ')} onChange={e => setS({ ...s, fallbackModels: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} aria-describedby="fallback-help" />
            <div id="fallback-help" className="field-hint">仅在限流持续、额度耗尽或接口不可用时切换；清空可禁用。不会因内容质量或 JSON 格式切换。</div>
          </div>

          <div className="field">
            <label className="field-label">Temperature · {s.temperature.toFixed(2)}</label>
            <div className="range-row">
              <input type="range" min={0} max={1.5} step={0.05} value={s.temperature}
                onChange={(e) => setS({ ...s, temperature: Number(e.target.value) })} />
              <span className="range-val">{s.temperature.toFixed(2)}</span>
            </div>
            <div className="field-hint">创作类任务建议 0.75 – 0.95；规划类任务系统会自动降到 0.2</div>
          </div>

          <div className="field">
            <label className="field-label">期望单次输出预算（Tokens）</label>
            <input className="input" type="number" min={256} max={65536} step={256} value={s.maxTokens}
              onChange={(e) => setS({ ...s, maxTokens: Number(e.target.value) })} />
            <div className="field-hint">
              这是期望值，不是模型硬上限；发送前会按模型能力和剩余上下文压低。长内容安全分段续写，无需填写超大值。
            </div>
          </div>

          <div className="field">
            <label className="field-label">模型上下文窗口</label>
            <select className="input" value={String(s.contextWindow ?? 32768)}
              onChange={(e) => setS({ ...s, contextWindow: Number(e.target.value) })}>
              {[8192, 16384, 32768, 65536, 131072, 262144].map((n) => (
                <option key={n} value={n}>
                  {n >= 1024 * 1024 ? `${n / 1024 / 1024}M` : `${Math.round(n / 1024)}K`}
                </option>
              ))}
            </select>
            <div className="field-hint">
              决定每个环节能读进多少历史方案与知识库。系统据此自动裁剪上下文，
              低于 16K 时后段环节会被大幅精简，建议 32K 及以上。
            </div>
          </div>

          {testResult && (
            <div role="status" aria-live="polite" className={`notice ${testResult.ok ? 'ok' : 'err'}`}>
              {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {/* 「测试连接」用表单里当前填的值直接连，**不写盘** ——
              所以测通了也要记得点「保存」，否则改动不会生效。
              这两件事都必须说清楚，否则用户要么以为测试会保存，要么以为测通了就已经生效。 */}
          <div className="field-hint" style={{ marginRight: 'auto', maxWidth: 280, textAlign: 'left' }}>
            测试不会保存设置；测通后请点「保存」才会生效
          </div>
          <button className="icon-btn" onClick={test} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="icon-btn primary" onClick={save} disabled={testing}>保存</button>
        </div>
      </div>
    </div>
  )
}
