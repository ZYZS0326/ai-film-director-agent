import type { Settings, SessionSummary, SessionState, SkillMeta, KnowledgeStats } from './types'

const BASE = ''

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.slice(0, 300))
  return res.json() as Promise<T>
}

export const api = {
  health: () => j<{ ok: boolean; llm: string }>('/api/health'),
  getSettings: () => j<Settings>('/api/settings'),
  saveSettings: (patch: Record<string, unknown>) =>
    j<Settings>('/api/settings', { method: 'POST', body: JSON.stringify(patch) }),
  testSettings: (override?: { baseUrl?: string; apiKey?: string; model?: string; provider?: string }) =>
    j<{ ok: boolean; message: string; sample?: string }>('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify(override || {}),
    }),
  skills: () => j<{ skills: SkillMeta[]; pipeline: string[] }>('/api/skills'),
  knowledge: () => j<KnowledgeStats>('/api/knowledge'),
  sessions: () => j<{ sessions: SessionSummary[] }>('/api/sessions'),
  createSession: (title?: string) =>
    j<SessionState>('/api/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  getSession: (id: string) => j<SessionState>(`/api/sessions/${id}`),
  editShots: (id: string, body: Record<string, unknown>) => j<any>(`/api/sessions/${id}/editor`, { method: 'POST', body: JSON.stringify(body) }),
  updateConstraints: (id: string, patch: Record<string, unknown>) =>
    j<SessionState>(`/api/sessions/${id}/constraints`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSession: (id: string) => j<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  /** 请求停止正在跑的流水线。编排器会在下一个环节边界收手，并把已完成成果落盘。 */
  stopSession: (id: string) => j<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  exportUrl: (id: string) => `/api/sessions/${id}/export`,
}

export type Emit = (event: string, data: any) => void

/** 发起对话，SSE 流式接收 */
export async function chatStream(
  sessionId: string | null,
  message: string,
  emit: Emit,
  signal?: AbortSignal,
  options?: { targetStage?: number; continueOnly?: boolean; retryBlocked?: boolean }
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, ...options }),
    signal,
  })
  if (!res.ok || !res.body) {
    // 尽量把服务端给的具体原因读出来（例如「该项目的流水线正在运行中…」）。
    // 只显示「请求失败：409」对用户毫无帮助 —— 他既不知道发生了什么，也不知道该做什么。
    let detail = ''
    try {
      const j = await res.json()
      detail = j && j.error ? String(j.error) : ''
    } catch { /* 响应不是 JSON（如网关错误页），退回状态码 */ }
    throw new Error(detail || `请求失败：${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let eventName = 'message'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (!line) { eventName = 'message'; continue }
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        try {
          emit(eventName, payload ? JSON.parse(payload) : {})
        } catch {
          emit(eventName, { raw: payload })
        }
      }
    }
  }
}
