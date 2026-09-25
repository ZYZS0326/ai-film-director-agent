import { useState } from 'react'
import { SessionState, Shot } from '../types'
import { api } from '../api'

const FIELDS = [ ['action', '画面动作'], ['duration', '时长（秒）'], ['shotSize', '景别'], ['angle', '机位角度'], ['movement', '运镜'], ['subject', '人物'], ['environment', '场景'], ['lighting', '光线'], ['sound', '声音'], ['promptZh', '中文提示词'], ['promptEn', '英文提示词'] ] as const
export default function ShotEditor({ shot, session, onUpdate, disabled }: { shot: Shot; session: SessionState; onUpdate: (s: SessionState) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Shot>({ ...shot })
  const [instruction, setInstruction] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const [baseVersion, setBaseVersion] = useState(session.editVersion || 0)
  const request = async (body: Record<string, unknown>, isPreview = false) => {
    setWaiting(true); setError('')
    try {
      const data = await api.editShots(session.id, { version: baseVersion, no: shot.no, ...body })
      if (isPreview) setPreview(data)
      else { onUpdate(data); setEditing(false); setPreview(null); setBaseVersion(data.editVersion) }
    } catch (e: any) { setError(e.message) }
    finally { setWaiting(false) }
  }
  const unavailable = disabled || waiting
  return <div className="shot-editor">
    <div className="shot-actions">
      <button className="icon-btn" disabled={unavailable || shot.locked} onClick={() => { setDraft({ ...shot }); setBaseVersion(session.editVersion || 0); setEditing(true); setPreview(null); setError('') }}>编辑 / 局部重做</button>
      <button className="icon-btn ghost" disabled={unavailable} onClick={() => request({ action: 'lock', locked: !shot.locked, version: session.editVersion || 0 })}>{shot.locked ? '解锁镜头' : '锁定镜头'}</button>
      {shot.locked && <span className="chip">已锁定，不会被生成覆盖</span>}
    </div>
    {editing && <div className="shot-edit-form">
      <p className="card-desc">只修改这一镜。修改时长会顺延后续时间码；不自动重跑其他环节。</p>
      {!preview && <div className="shot-edit-fields">{FIELDS.map(([key, label]) => <label key={key}>{label}
        {key === 'duration' ? <input type="number" min="0.001" max="8" step="0.1" value={draft.duration} disabled={unavailable || !!preview} onChange={e => setDraft({ ...draft, duration: Number(e.target.value) })} />
          : <textarea rows={key.startsWith('prompt') ? 4 : 2} value={draft[key] || ''} disabled={unavailable || !!preview} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />}
      </label>)}</div>}
      {!preview && <>
        <button className="icon-btn primary" disabled={unavailable} onClick={() => {
          const patch = Object.fromEntries(FIELDS.filter(([k]) => draft[k] !== shot[k]).map(([k]) => [k, draft[k]]))
          request({ action: 'preview', patch }, true)
        }}>预览手动修改</button>
        <label className="rewrite-instruction">或让模型只重做这一镜（使用已保存内容）
          <textarea rows={2} value={instruction} disabled={unavailable} onChange={e => setInstruction(e.target.value)} placeholder="例如：保留人物和场景，删除走路过程，直接从拾起旧表开始。" />
        </label>
        <button className="icon-btn" disabled={unavailable || !instruction.trim()} onClick={() => request({ action: 'suggest', instruction }, true)}>生成单镜候选</button>
        {session.generationMode === 'demo' && <p className="card-desc">演示模式可手动编辑；模型重做需在设置中接入模型。单镜重做不会把其余演示内容变成真实创作。</p>}
      </>}
      {preview && <div className="revision-preview">
        <h4>确认这次修改</h4>
        {preview.changes.map((c: any) => <div className="revision-change" key={c.field}><strong>{FIELDS.find(([k]) => k === c.field)?.[1] || c.field}</strong><div><del>{String(c.before || '（空）')}</del><ins>{String(c.after || '（空）')}</ins></div></div>)}
        <p className="card-desc">应用后需复核：{preview.affected.join('、')}。保存修改前版本，可在版本记录中恢复。</p>
        <button className="icon-btn primary" disabled={unavailable} onClick={() => request({ action: 'apply', patch: preview.patch, version: preview.version })}>确认应用</button>
        <button className="icon-btn ghost" disabled={unavailable} onClick={() => setPreview(null)}>返回编辑</button>
      </div>}
      <button className="icon-btn ghost" disabled={waiting} onClick={() => { setEditing(false); setPreview(null) }}>取消</button>
    </div>}
    {waiting && <p role="status">正在处理，原镜头尚未改变…</p>}
    {error && <p role="alert" className="editor-error">{error}</p>}
  </div>
}
