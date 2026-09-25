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
    setS({ ...s, presetId: p.id, baseUrl: p.baseUrl, model: p.model })
  }

  const save = async () => {
    try {
      const next = await api.saveSettings({
        baseUrl: s.baseUrl, model: s.model, presetId: s.presetId,
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
          <div className={`notice ${s.hasKey ? 'ok' : 'warn'}`}>
            {s.hasKey
              ? `已连接 LLM（${s.keyMask}）。所有创作环节由真实大模型驱动。`
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
                <div className="api-guide-row" role="row"><strong role="cell">DeepSeek</strong><code role="cell">https://api.deepseek.com/v1</code><span role="cell">例如 deepseek-chat</span></div>
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
            <label className="field-label">Base URL</label>
            <input className="input" value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
            <div className="field-hint">填写服务商提供的 OpenAI 兼容基础地址；版本路径可能是 /v1、/v4 或 /api/v3，不要追加 /chat/completions。</div>
          </div>

          <div className="field">
            <label className="field-label">API Key</label>
            <input className="input" type="password" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={s.hasKey ? '已保存，留空则不修改' : 'sk-...'} />
          </div>

          <div className="field">
            <label className="field-label">模型</label>
            <input className="input" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} placeholder="deepseek-chat" />
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
            <label className="field-label">单次输出上限（Max Tokens）</label>
            <input className="input" type="number" min={256} max={65536} step={256} value={s.maxTokens}
              onChange={(e) => setS({ ...s, maxTokens: Number(e.target.value) })} />
            <div className="field-hint">
              模型单次回复的 token 上限。超了会自动续写补全，无需手动调高；
              但值越大，单轮能写的内容越多、速度越快。建议 4096 – 16384。
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
            <div className={`notice ${testResult.ok ? 'ok' : 'err'}`}>
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
          <button className="icon-btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
