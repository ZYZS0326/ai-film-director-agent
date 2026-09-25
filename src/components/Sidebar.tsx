import { useState } from 'react'
import { SkillMeta, SessionSummary, SessionState } from '../types'
import { IconPlus, IconTrash, IconBook, IconGrid } from './Icons'

interface Props {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  skills: SkillMeta[]
  activeSkill: string | null
  doneSkills: string[]
  session: SessionState | null
  onOpenSkills: () => void
  onOpenKnowledge: () => void
}

export default function Sidebar({
  sessions, activeId, onSelect, onNew, onDelete,
  skills, activeSkill, doneSkills, session, onOpenSkills, onOpenKnowledge,
}: Props) {
  const [query, setQuery] = useState('')
  const visibleSessions = sessions.filter(s => (s.title || '未命名项目').toLowerCase().includes(query.trim().toLowerCase()))
  const timeAgo = (t: number) => {
    const d = Date.now() - t
    if (d < 60000) return '刚刚'
    if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`
    if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`
    return new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }

  return (
    <>
      <div className="col-head">
        <span className="col-title">项目</span>
        <div className="spacer" />
        <button className="icon-btn ghost" onClick={onNew} title="新建项目">
          <IconPlus size={14} />
          新建
        </button>
      </div>

      <div className="col-scroll">
        <div className="project-search"><input aria-label="搜索项目" placeholder="搜索项目…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="side-section" style={{ paddingBottom: 0 }}>
          {sessions.length === 0 && (
            <div style={{ padding: '10px 6px', fontSize: 12, color: 'var(--text-mute)' }}>
              还没有项目。给我一个想法即可开始。
            </div>
          )}
          {query && !visibleSessions.length && <p className="search-empty">没有匹配的项目</p>}
          {visibleSessions.map((s) => (
            <div key={s.id} style={{ position: 'relative' }}>
              <button
                className={`session-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                <span className="st">{s.title || '未命名项目'}</span>
                <span className="sm">
                  {timeAgo(s.updatedAt)}
                  {s.hasOutput && <span style={{ color: 'var(--green)' }}>· 已生成</span>}
                </span>
              </button>
              <button
                className="icon-btn ghost"
                title="删除"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                style={{
                  position: 'absolute', right: 6, top: 9, height: 24, width: 24,
                  padding: 0, opacity: 0.5,
                }}
              >
                <IconTrash size={12} />
              </button>
            </div>
          ))}
        </div>

        <details className="side-section">
          <summary className="side-label" style={{ cursor: 'pointer' }}>制作进度 {doneSkills.length}/{skills.length}{activeSkill ? ' · 生成中' : ''}</summary>
          {skills.map((sk) => {
            const isActive = activeSkill === sk.id
            const isDone = doneSkills.includes(sk.id)
            return (
              <div key={sk.id} className={`skill-row ${isActive ? 'active' : ''} ${isDone && !isActive ? 'done' : ''}`}>
                <span className="skill-dot">
                  {isDone && !isActive ? '✓' : sk.stage}
                </span>
                <span className="skill-name">{sk.name}</span>
                <span className="skill-role">{sk.role.split(' / ')[0]}</span>
              </div>
            )
          })}
        </details>

        {session?.memory?.preferences?.length ? (
          <div className="side-section">
            <div className="side-label">记忆 · 已学习的偏好</div>
            <div style={{ padding: '0 6px' }}>
              {session.memory.preferences.slice(-6).map((p, i) => (
                <div key={i} style={{
                  fontSize: 11.5, color: 'var(--text-dim)', padding: '4px 0',
                  borderBottom: '1px solid var(--border-soft)', lineHeight: 1.5,
                }}>· {p}</div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="side-section" style={{ paddingBottom: 18 }}>
          <div className="side-label">资料</div>
          <button className="skill-row" style={{ width: '100%', textAlign: 'left' }} onClick={onOpenKnowledge}>
            <span className="skill-dot"><IconBook size={11} /></span>
            <span className="skill-name">电影知识库</span>
          </button>
          <button className="skill-row" style={{ width: '100%', textAlign: 'left' }} onClick={onOpenSkills}>
            <span className="skill-dot"><IconGrid size={11} /></span>
            <span className="skill-name">能力清单</span>
          </button>
        </div>
      </div>
    </>
  )
}
