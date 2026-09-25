import { useState } from 'react'
import { StageRun, StageReview } from '../types'
import Markdown from './Markdown'
import { IconChevron } from './Icons'

export default function StageCard({ run, review, stale = false }: { run: StageRun; review?: StageReview; stale?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`stage-card ${run.status}`}>
      <div className="stage-head" role="button" tabIndex={0} aria-expanded={open} onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
      }} onClick={() => setOpen((o) => !o)}>
        <span className="stage-badge">{String(run.stage).padStart(2, '0')}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="stage-name">{run.name}</div>
          <div className="stage-role">{run.role} · 环节 {run.index}/{run.total}</div>
        </div>
        <span className="stage-status">
          {run.status === 'running' && <><span className="spinner" /> 生成中</>}
          {run.status === 'done' && <>{stale ? '待更新' : '✓ 已生成'}</>}
          {run.status === 'error' && <span style={{ color: 'var(--red)' }}>失败</span>}
        </span>
        <span style={{ color: 'var(--text-mute)', display: 'inline-flex' }}>
          <IconChevron size={13} dir={open ? 'down' : 'right'} />
        </span>
      </div>
      {review && !stale && <div className={`stage-review ${review.status}`} role="status">
        <strong>{review.status === 'pass' ? '审核通过' : review.status === 'warn' ? '审核有建议' : review.status === 'block' ? '审核阻断' : '创作审核未完成'}</strong>
        {review.note && <span>{review.note}</span>}
        {review.issues.map((issue, i) => <div key={i}>「{issue.evidence}」— {issue.suggestion}</div>)}
      </div>}
      {stale && <div className="stage-review stale" role="status">上游内容已改变，本环节待更新。</div>}
      <div className={`stage-content ${open ? '' : 'collapsed'}`}>
        <Markdown text={run.text} />
        {run.status === 'running' && <span className="typing-cursor" />}
      </div>
    </div>
  )
}
