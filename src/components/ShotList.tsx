import { useState } from 'react'
import { Shot, SessionState } from '../types'
import ShotEditor from './ShotEditor'

export default function ShotList({ shots, session, onUpdate, busy = false }: { shots: Shot[]; session?: SessionState; onUpdate?: (s: SessionState) => void; busy?: boolean }) {
  const [openNo, setOpenNo] = useState<number | null>(shots[0]?.no ?? null)

  if (!shots.length) {
    return (
      <div className="empty-panel">
        <div className="big">🎬</div>
        <div>还没有分镜。完成分镜环节后会自动出现在这里。</div>
      </div>
    )
  }

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num">{shots.length}</div><div className="stat-label">镜头数</div></div>
        <div className="stat-card">
          <div className="stat-num">{shots.reduce((a, s) => a + (Number(s.duration) || 0), 0)}s</div>
          <div className="stat-label">总时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{new Set(shots.map((s) => s.shotSize)).size}</div>
          <div className="stat-label">景别种类</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{new Set(shots.map((s) => s.movement)).size}</div>
          <div className="stat-label">运动方式</div>
        </div>
      </div>

      {shots.map((s) => {
        const open = openNo === s.no
        return (
          <div className="shot-card" key={s.no}>
            {session && onUpdate && <ShotEditor key={`${session.id}-${s.no}`} shot={s} session={session} onUpdate={onUpdate} disabled={busy} />}
            <div className="shot-card-head" onClick={() => setOpenNo(open ? null : s.no)} style={{ cursor: 'pointer' }}>
              <span className="shot-no">SHOT {String(s.no).padStart(2, '0')}</span>
              <span className="shot-time">{s.start}s – {s.end}s</span>
              <span className="chip" style={{ marginLeft: 'auto' }}>{s.shotSize}</span>
              {s.movement && <span className="chip cool">{s.movement}</span>}
            </div>
            <div className="shot-grid">
              <span className="k">画面</span><span className="v">{s.action || '—'}</span>
              <span className="k">摄影</span><span className="v">{s.camera || '—'}</span>
              <span className="k">镜头</span><span className="v">{s.lens || '—'}{s.angle ? ` · ${s.angle}` : ''}</span>
              <span className="k">运动</span><span className="v">{s.movement || '—'}</span>
              {s.composition && <><span className="k">构图</span><span className="v">{s.composition}</span></>}
              <span className="k">人物动作</span><span className="v">{s.subject ? `${s.subject}｜` : ''}{s.action || '—'}</span>
              {s.expression && <><span className="k">表情</span><span className="v">{s.expression}</span></>}
              <span className="k">环境</span><span className="v">{s.environment || '—'}</span>
              <span className="k">光线</span><span className="v">{s.lighting || '—'}</span>
              <span className="k">色彩</span><span className="v">{s.color || '—'}</span>
              <span className="k">声音</span><span className="v">{s.sound || '—'}</span>
              <span className="k">情绪</span><span className="v" style={{ color: 'var(--accent)' }}>{s.emotion || '—'}</span>
              <span className="k">转场</span><span className="v">{s.transition || '—'}</span>
            </div>
            {open && (s.promptZh || s.promptEn) && (
              <div className="shot-prompt">
                {s.promptZh && <div><span className="label">AI 提示词（中）：</span>{s.promptZh}</div>}
                {s.promptEn && <div style={{ marginTop: 7 }}><span className="label">AI Prompt (EN)：</span>{s.promptEn}</div>}
                {s.negative && <div style={{ marginTop: 7 }}><span className="label">负向：</span>{s.negative}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
