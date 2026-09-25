import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, chatStream } from './api'
import {
  ChatItem, KnowledgeStats, SessionState, SessionSummary, Settings, SkillMeta, StageRun, Constraints,
} from './types'
import Sidebar from './components/Sidebar'
import ParamsBar from './components/ParamsBar'
import ChatPanel from './components/ChatPanel'
import WorkstationPanel from './components/WorkstationPanel'
import SettingsModal from './components/SettingsModal'
import { KnowledgeModal, SkillsModal } from './components/InfoModals'
import ErrorBoundary from './components/ErrorBoundary'
import { IconSettings, IconSun, IconMoon, IconChevron, IconFilm } from './components/Icons'

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [pipelineOrder, setPipelineOrder] = useState<string[]>([])
  const [knowledge, setKnowledge] = useState<KnowledgeStats | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [session, setSession] = useState<SessionState | null>(null)

  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [activeSkill, setActiveSkill] = useState<string | null>(null)
  const [doneSkills, setDoneSkills] = useState<string[]>([])

  const [showSettings, setShowSettings] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([])
  const [rightOpen, setRightOpen] = useState(true)
  const [view, setView] = useState('chat')

  const abortRef = useRef<AbortController | null>(null)
  /** 已发出停止请求（第一次点「停止」）；再点一次则强制断开连接 */
  const stoppingRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)

  const toast = useCallback((msg: string, kind: 'ok' | 'err' | '' = '') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  // ── 初始化 ───────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [s, sk, kn, ss] = await Promise.all([
          api.getSettings(), api.skills(), api.knowledge(), api.sessions(),
        ])
        setSettings(s)
        setSkills(sk.skills)
        setPipelineOrder(sk.pipeline)
        setKnowledge(kn)
        setSessions(ss.sessions)
        document.documentElement.setAttribute('data-theme', s.theme || 'light')
        if (ss.sessions.length) {
          await openSession(ss.sessions[0].id)
        }
      } catch (e: any) {
        toast('初始化失败：' + e.message, 'err')
      }
    })()
  }, [])

  // ── 会话加载 ─────────────────────────────────────────────
  const openSession = async (id: string) => {
    try {
      const s = normalizeSession(await api.getSession(id))
      setSession(s)
      sessionIdRef.current = s.id
      setItems(buildItemsFromSession(s, skills))
      // 已完成环节 = 历史执行并集 ∪ 当前确实有产出的环节。
      // 不能用 s.pipeline：它只保存「最近一次」技能链 —— 做过增量修改之后，
      // 重开项目时侧栏的完成标记会缩水成那一次的子集。
      setDoneSkills(doneSkillsOf(s, skills))
      setActiveSkill(null)
      setStatus('')
    } catch (e: any) {
      toast('打开项目失败：' + e.message, 'err')
    }
  }

  const refreshSession = async () => {
    if (!sessionIdRef.current) return
    try {
      setSession(normalizeSession(await api.getSession(sessionIdRef.current)))
    } catch { /* ignore */ }
  }

  /** 修改项目制作规格（时长 / 画幅 / 剧本等级 / 目标平台） */
  const updateConstraints = async (patch: Partial<Constraints>) => {
    if (!sessionIdRef.current) return
    // 乐观更新，先让 UI 立即响应
    setSession((s) => (s ? { ...s, constraints: { ...s.constraints, ...patch } } : s))
    try {
      const updated = await api.updateConstraints(sessionIdRef.current, patch)
      setSession(normalizeSession(updated))
    } catch (e: any) {
      toast('参数更新失败：' + e.message, 'err')
      refreshSession()
    }
  }

  const reloadSessions = async () => {
    try { setSessions((await api.sessions()).sessions) } catch { /* ignore */ }
  }

  const newProject = async () => {
    try {
      const s = normalizeSession(await api.createSession())
      setSession(s)
      sessionIdRef.current = s.id
      setItems([])
      setDoneSkills([])
      setActiveSkill(null)
      await reloadSessions()
    } catch (e: any) { toast('新建失败：' + e.message, 'err') }
  }

  const deleteProject = async (id: string) => {
    try {
      await api.deleteSession(id)
      const list = (await api.sessions()).sessions
      setSessions(list)
      if (sessionIdRef.current === id) {
        if (list.length) await openSession(list[0].id)
        else { setSession(null); setItems([]); sessionIdRef.current = null; setDoneSkills([]) }
      }
      toast('项目已删除', 'ok')
    } catch (e: any) { toast('删除失败：' + e.message, 'err') }
  }

  // ── 发送 ────────────────────────────────────────────────
  const send = async (text: string, targetStage = 3, continueOnly = false, retryBlocked = false) => {
    if (busy) return
    setItems((it) => [...it, { kind: 'user', text, at: Date.now() }])
    setBusy(true)
    setStatus('导演正在理解你的想法…')
    setDoneSkills([])
    setActiveSkill(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let answerIdx = -1
    const stageIndex = new Map<string, number>()

    try {
      await chatStream(sessionIdRef.current, text, (event, data) => {
        switch (event) {
          case 'session':
            sessionIdRef.current = data.id
            break
          case 'status':
            setStatus(data.text || '')
            break
          case 'plan':
            setItems((it) => [...it, { kind: 'plan', plan: data, at: Date.now() }])
            break
          case 'knowledge':
            setItems((it) => [...it, { kind: 'knowledge', data, at: Date.now() }])
            break
          case 'stage_start': {
            const run: StageRun = {
              skill: data.skill, name: data.name, role: data.role, stage: data.stage,
              index: data.index, total: data.total, status: 'running', text: '',
            }
            setActiveSkill(data.skill)
            setItems((it) => {
              stageIndex.set(data.skill, it.length)
              return [...it, { kind: 'stage', run, at: Date.now() }]
            })
            break
          }
          case 'delta':
            setItems((it) => {
              const idx = stageIndex.get(data.skill)
              if (idx === undefined) return it
              const next = [...it]
              const cur = next[idx]
              if (cur && cur.kind === 'stage') {
                next[idx] = { ...cur, run: { ...cur.run, text: cur.run.text + data.delta } }
              }
              return next
            })
            break
          case 'stage_done':
            setItems((it) => {
              const idx = stageIndex.get(data.skill)
              if (idx === undefined) return it
              const next = [...it]
              const cur = next[idx]
              if (cur && cur.kind === 'stage') {
                next[idx] = { ...cur, run: { ...cur.run, status: data.failed ? 'error' : 'done', text: data.text } }
              }
              return next
            })
            if (!data.failed) setDoneSkills((d) => (d.includes(data.skill) ? d : [...d, data.skill]))
            setActiveSkill(null)
            setSession((s) => (s ? {
              ...s,
              outputs: { ...s.outputs, [data.outputKey]: data.text },
              shots: data.shots ?? s.shots,
              promptData: data.promptData ?? s.promptData,
              continuityData: data.continuityData ?? s.continuityData,
              productionChecks: data.productionChecks ?? s.productionChecks,
              stageReviews: data.review ? { ...s.stageReviews, [data.skill]: data.review } : s.stageReviews,
            } : s))
            break
          case 'stage_review':
            setSession((s) => s ? { ...s, stageReviews: { ...s.stageReviews, [data.skill]: data.review } } : s)
            break
          case 'answer_start':
            setItems((it) => {
              answerIdx = it.length
              return [...it, { kind: 'answer', text: '', done: false, at: Date.now() }]
            })
            break
          case 'answer_delta':
            setItems((it) => {
              const idx = answerIdx >= 0 ? answerIdx : it.findIndex((x) => x.kind === 'answer' && !x.done)
              if (idx < 0) return it
              const next = [...it]
              const cur = next[idx]
              if (cur && cur.kind === 'answer') {
                next[idx] = { ...cur, text: cur.text + data.delta }
              }
              return next
            })
            break
          case 'memory':
            setSession((s) => (s ? { ...s, memory: { ...s.memory, preferences: data.preferences, revisions: data.revisions } } : s))
            break
          case 'error':
            setItems((it) => [...it, { kind: 'error', text: data.message || '未知错误', at: Date.now() }])
            break
          case 'done':
            if (data.session) setSession(normalizeSession(data.session))
            setItems((it) => it.map((x) => (x.kind === 'answer' ? { ...x, done: true } : x)))
            break
          default:
            break
        }
      }, ctrl.signal, { targetStage, continueOnly, retryBlocked })
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setItems((it) => [...it, { kind: 'error', text: String(e.message || e), at: Date.now() }])
        toast('生成中断：' + String(e.message || e).slice(0, 120), 'err')
      }
    } finally {
      setBusy(false)
      setStatus('')
      setActiveSkill(null)
      stoppingRef.current = false
      await refreshSession()
      await reloadSessions()
    }
  }

  /**
   * 停止生成。
   *
   * 这里**不直接 abort fetch**，而是通知服务端在下一个环节边界收手 ——
   * 若粗暴断开连接，服务端要等下一个环节边界才发现，而客户端此时已经刷新过了，
   * 最后一个完成的环节会永远显示不出来。让 SSE 流正常收尾并带回最终 session，
   * 状态才是准的。
   *
   * 再点一次 = 强制中断连接（服务端会在下一次 emit 时发现客户端已走）。
   */
  const stop = () => {
    if (!session?.id) return
    if (stoppingRef.current) {
      abortRef.current?.abort()
      setBusy(false)
      setStatus('')
      stoppingRef.current = false
      toast('已强制中断', '')
      return
    }
    stoppingRef.current = true
    api.stopSession(session.id).catch(() => { /* 会话可能已结束，忽略 */ })
    setStatus('正在停止…（当前环节完成后收手，再点一次可强制中断）')
    toast('已发送停止请求', '')
  }

  const toggleTheme = async () => {
    if (!settings) return
    const next = settings.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    setSettings({ ...settings, theme: next })
    try { await api.saveSettings({ theme: next }) } catch { /* ignore */ }
  }

  const mode = settings?.mode ?? 'demo'
  const plannedSkills = useMemo(
    () => (session?.pipeline?.length ? session.pipeline : pipelineOrder),
    [session?.pipeline, pipelineOrder]
  )

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">导</div>
          <div className="brand-text">
            <span className="brand-title">AI 电影导演工作站</span>
            <span className="brand-sub">Film Director Agent</span>
          </div>
        </div>

        <div className="topbar-sep" />

        <div className="chips">
          <span className={`chip dot ${mode === 'llm' ? '' : 'accent'}`}>
            {mode === 'llm' ? `LLM · ${settings?.model}` : '演示模式'}
          </span>
          {session && (
            <>
              <span className="chip">时长 {session.constraints?.duration ?? 30}s</span>
              <span className="chip">画幅 {session.constraints?.aspect ?? '2.39:1'}</span>
              {(session.constraints?.platforms || []).slice(0, 3).map((p) => (
                <span className="chip cool" key={p}>{p}</span>
              ))}
            </>
          )}
        </div>

        <div className="spacer" />

        <button className="icon-btn ghost" onClick={() => setShowSkills(true)} title="能力清单">
          <IconFilm size={14} /> 能力
        </button>
        <button className="icon-btn ghost" onClick={toggleTheme} title="切换主题">
          {settings?.theme === 'light' ? <IconMoon size={14} /> : <IconSun size={14} />}
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)}>
          <IconSettings size={14} /> 设置
        </button>
        <button
          className="icon-btn ghost"
          onClick={() => setRightOpen((v) => !v)}
          title={rightOpen ? '收起工作站' : '展开工作站'}
        >
          <IconChevron dir={rightOpen ? 'right' : 'left'} size={14} />
        </button>
      </div>

      <div className="workspace-toolbar">
        <span className="workspace-title">{session?.title || '新作品'}</span>
        <div className="view-switch" aria-label="工作区视图">
          {[['chat', '创作'], ['split', '并排'], ['results', '成果'], ['projects', '项目']].map(([id, label]) =>
            <button key={id} aria-pressed={view === id} onClick={() => { setView(id); setRightOpen(true) }}>{label}</button>)}
        </div>
        <span className="workspace-status" role="status">{busy ? status || '正在创作…' : '准备就绪'}</span>
      </div>
      <div className={`main view-${view} ${rightOpen ? '' : 'right-collapsed'}`}>
        {/* 三列各包一层错误边界：坏一块只坏一块，其余照常可用（顶层的兜底在 main.tsx） */}
        <div className="col left">
          <ErrorBoundary label="项目列表">
            <Sidebar
              sessions={sessions}
              activeId={session?.id ?? null}
              onSelect={(id) => { openSession(id); setView('split') }}
              onNew={() => { newProject(); setView('chat') }}
              onDelete={deleteProject}
              skills={skills}
              activeSkill={activeSkill}
              doneSkills={doneSkills}
              session={session}
              onOpenSkills={() => setShowSkills(true)}
              onOpenKnowledge={() => setShowKnowledge(true)}
            />
          </ErrorBoundary>
        </div>

        <div className="col center">
          {!session && <div className="start-notice">{mode === 'llm' ? '可以直接写下想法；如需先设定时长和画幅，请点击「新建」。' : '当前为演示模式，展示固定示例。接入模型后才能按你的故事创作。'}
            {mode !== 'llm' && <button className="icon-btn ghost" onClick={() => setShowSettings(true)}>配置模型</button>}
          </div>}
          {session &&
          <ErrorBoundary label="制作规格栏">
            <ParamsBar
              constraints={session?.constraints ?? {}}
              knowledge={knowledge}
              disabled={!session || busy}
              onChange={updateConstraints}
            />
          </ErrorBoundary>
          }
          <ErrorBoundary label="对话与产出流">
            <ChatPanel
              projectId={session?.id}
              demo={session?.generationMode === 'demo'}
              items={items}
              busy={busy}
              status={status}
              constraints={session?.constraints ?? {}}
              onSend={(text, target) => send(text, target)}
              onContinue={(target, retry) => send('继续制作', target, true, retry)}
              stages={skills.filter(s => s.stage <= 11)}
              nextStage={(() => {
                if (!skills.length) return 1
                const next = skills.filter(s => s.stage <= 11).sort((a, b) => a.stage - b.stage)
                  .find(s => !session?.outputs?.[s.outputKey] || session?.pendingSkills?.includes(s.id))
                return next?.stage ?? 12
              })()}
              stageReviews={session?.stageReviews}
              pendingSkills={session?.pendingSkills}
              onStop={stop}
            />
          </ErrorBoundary>
        </div>

        <div className="col right">
          <ErrorBoundary label="工作站面板">
            <WorkstationPanel key={session?.id || 'empty'} session={session} knowledge={knowledge} onRefresh={refreshSession} busy={busy} onUpdate={s => {
              if (s.id !== sessionIdRef.current) return
              setSession(normalizeSession(s)); setItems(buildItemsFromSession(s, skills)); setDoneSkills(doneSkillsOf(s, skills))
            }} />
          </ErrorBoundary>
        </div>
      </div>

      {showSettings && (
        <ErrorBoundary label="设置">
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onSaved={(s) => setSettings(s)}
            toast={toast}
          />
        </ErrorBoundary>
      )}
      {showKnowledge && (
        <ErrorBoundary label="知识库">
          <KnowledgeModal onClose={() => setShowKnowledge(false)} />
        </ErrorBoundary>
      )}
      {showSkills && (
        <ErrorBoundary label="能力清单">
          <SkillsModal onClose={() => setShowSkills(false)} />
        </ErrorBoundary>
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  )
}

/** 归一化会话对象：服务端返回可能缺少字段（历史数据 / 异常响应），补齐以免渲染崩溃 */
function normalizeSession(s: any): SessionState {
  const src = s && typeof s === 'object' ? s : {}
  return {
    id: src.id || '',
    editVersion: src.editVersion || 0,
    editorNotes: src.editorNotes || {},
    versions: Array.isArray(src.versions) ? src.versions : [],
    title: src.title || '未命名项目',
    brief: src.brief || '',
    constraints: src.constraints && typeof src.constraints === 'object' ? src.constraints : {},
    outputs: src.outputs && typeof src.outputs === 'object' ? src.outputs : {},
    shots: Array.isArray(src.shots) ? src.shots : [],
    promptData: src.promptData || null,
    continuityData: src.continuityData || null,
    promptValidation: src.promptValidation || null,
    reviewScores: Array.isArray(src.reviewScores) ? src.reviewScores : null,
    stageReviews: src.stageReviews && typeof src.stageReviews === 'object' ? src.stageReviews : {},
    productionChecks: src.productionChecks || undefined,
    generationMode: src.generationMode,
    pendingSkills: Array.isArray(src.pendingSkills) ? src.pendingSkills : [],
    pipeline: Array.isArray(src.pipeline) ? src.pipeline : [],
    skillHistory: Array.isArray(src.skillHistory) ? src.skillHistory : [],
    memory: {
      preferences: Array.isArray(src.memory?.preferences) ? src.memory.preferences : [],
      revisions: Array.isArray(src.memory?.revisions) ? src.memory.revisions : [],
      decisions: Array.isArray(src.memory?.decisions) ? src.memory.decisions : [],
    },
  }
}

/**
 * 环节顺序表。
 * 优先用服务端返回的技能元数据（id / name / outputKey / stage）——
 * 前端硬编码的那份曾经严重过期：漏了叙事结构、摄影方案、连续性三个环节，
 * 且 id 对不上（film_analysis / visual_reference 早已不存在），
 * 导致重新打开项目时对话流缺环节、环节名显示成英文 id。
 */
const FALLBACK_SKILLS: { key: string; id: string; name: string }[] = [
  { key: 'analysis', id: 'director_analysis', name: '导演分析与决策' },
  { key: 'references', id: 'film_history', name: '电影史与参考档案' },
  { key: 'structure', id: 'story_structure', name: '叙事结构设计' },
  { key: 'cinematography', id: 'cinematography', name: '摄影方案' },
  { key: 'visualBible', id: 'visual_design', name: '视觉设计与美术' },
  { key: 'screenplay', id: 'screenplay', name: '剧本创作' },
  { key: 'storyboard', id: 'storyboard', name: '分镜设计' },
  { key: 'continuity', id: 'continuity', name: '连续性管理' },
  { key: 'prompts', id: 'prompt_engineering', name: 'AI 提示词工程' },
  { key: 'sound', id: 'sound_design', name: '声音设计' },
  { key: 'editing', id: 'editing', name: '剪辑设计' },
  { key: 'review', id: 'quality_control', name: '导演审核' },
]

function skillOrder(skills?: SkillMeta[]): { key: string; id: string; name: string }[] {
  const list = (skills || []).filter((x) => x && x.outputKey)
  if (!list.length) return FALLBACK_SKILLS
  return [...list]
    .sort((a, b) => (a.stage || 0) - (b.stage || 0))
    .map((x) => ({ key: x.outputKey, id: x.id, name: x.name }))
}

/**
 * 推导「已完成环节」。
 * 以实际产出为ground truth，再并入 skillHistory（历史执行并集），
 * 避免增量修改之后完成标记丢失。
 */
function doneSkillsOf(s: SessionState, skills?: SkillMeta[]): string[] {
  const out = new Set<string>(s.skillHistory || [])
  const meta = (skills && skills.length) ? skills : null
  const pairs = meta
    ? meta.map((x) => ({ id: x.id, key: x.outputKey }))
    : FALLBACK_SKILLS.map((x) => ({ id: x.id, key: x.key }))
  for (const p of pairs) if (s.outputs?.[p.key]) out.add(p.id)
  // 兼容旧数据：pipeline 也并进来
  for (const id of s.pipeline || []) out.add(id)
  for (const id of s.pendingSkills || []) out.delete(id)
  for (const [id, review] of Object.entries(s.stageReviews || {})) if (review.status === 'block') out.delete(id)
  return [...out]
}

/** 从已保存的会话重建对话流 */
function buildItemsFromSession(s: SessionState, skills?: SkillMeta[]): ChatItem[] {
  const items: ChatItem[] = []
  if (s.brief) items.push({ kind: 'user', text: s.brief, at: Date.now() })
  const order = skillOrder(skills)
  const present = order.filter((o) => s.outputs?.[o.key])
  present.forEach((o, i) => {
    items.push({
      kind: 'stage',
      at: Date.now(),
      run: {
        skill: o.id, name: o.name, role: '', stage: i + 1,
        index: i + 1, total: present.length, status: 'done', text: s.outputs[o.key],
      },
    })
  })
  if (s.memory?.revisions?.length) {
    s.memory.revisions.forEach((r) => items.push({ kind: 'user', text: r.instruction, at: r.at }))
  }
  return items
}

