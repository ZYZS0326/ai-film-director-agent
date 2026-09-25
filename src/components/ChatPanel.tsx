import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChatItem, Constraints, SkillMeta, StageReview } from '../types'
import StageCard from './StageCard'
import Markdown from './Markdown'
import { IconSend, IconStop, IconSpark } from './Icons'

const EXAMPLES = [
  { t: '一个人在宇宙尽头寻找失去的记忆。', tag: '科幻 · 存在主义' },
  { t: '我要做一个 30 秒短片，一个人站在荒废城市看日出。', tag: '末世 · 情绪短片' },
  { t: '一个杀手在雨夜等一个不会来的人。', tag: '黑色电影 · 悬疑' },
  { t: '赛博朋克版的东方神话，一条龙在霓虹城市上空盘旋。', tag: '赛博 · 东方' },
]

interface Props {
  items: ChatItem[]
  busy: boolean
  status: string
  constraints: Constraints
  onSend: (text: string, targetStage: number) => void
  onContinue?: (targetStage: number, retryBlocked?: boolean) => void
  stages?: SkillMeta[]
  nextStage?: number
  stageReviews?: Record<string, StageReview>
  pendingSkills?: string[]
  onStop: () => void
  projectId?: string
  demo?: boolean
}

export default function ChatPanel({ items, busy, status, constraints, onSend, onContinue, stages = [], nextStage = 1, stageReviews = {}, pendingSkills = [], onStop, projectId, demo }: Props) {
  const [text, setText] = useState('')
  const [targetStage, setTargetStage] = useState(3)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const followRef = useRef(true)
  useEffect(() => { setText(''); setTargetStage(nextStage > 1 && nextStage <= 11 ? Math.min(11, nextStage + 2) : 3); followRef.current = true }, [projectId])
  useEffect(() => { if (nextStage <= 11 && targetStage < nextStage) setTargetStage(Math.min(11, nextStage + 2)) }, [nextStage, targetStage])
  const fill = (value: string) => { setText(value); taRef.current?.focus() }

  useEffect(() => {
    const el = scrollRef.current
    if (el && followRef.current && items.length) el.scrollTop = el.scrollHeight
  }, [items])

  const submit = () => {
    const v = text.trim()
    if (!v || busy) return
    onSend(v, targetStage)
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  const empty = items.length === 0

  return (
    <>
      <div className="chat-scroll" ref={scrollRef} onScroll={() => {
        const el = scrollRef.current
        if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      }}>
        <div className="chat-inner">
          {empty && (
            <div className="hero">
              <div className="welcome-label">新作品 / 创作起点</div>
              <div className="hero-feature">
                <div className="hero-intro">
                  <h1 className="hero-title">从一个想法，<br />到可拍的方案。</h1>
                  <p className="hero-sub">
                    描述想法，生成方案，再查看与修改剧本、分镜和提示词。
                  </p>
                </div>
                <figure className="hero-still">
                  <img src="./images/director-desk-film-set.png" alt="" />
                  <figcaption>创作，从构想开始</figcaption>
                </figure>
              </div>
              <div className="hero-example-label">从这些想法开始</div>
              <div className="hero-examples">
                {EXAMPLES.map((e, index) => (
                  <button key={e.t} className="example-card" disabled={busy} onClick={() => fill(e.t)}>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    <span>{e.t}<small>{e.tag}</small></span>
                    <i aria-hidden="true">↗</i>
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((it, i) => {
            if (it.kind === 'user') {
              return (
                <div className="msg msg-user" key={i}>
                  <div className="bubble">{it.text}</div>
                </div>
              )
            }
            if (it.kind === 'plan') {
              return (
                <div className="msg" key={i}>
                  <div className="plan-bar">
                    <div className="plan-title">
                      导演规划 · {it.plan.mode === 'llm' ? 'LLM Planner' : '演示模式'}
                    </div>
                    <div className="plan-chain">
                      {it.plan.skillNames.map((s, idx) => (
                        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="plan-step">{String(s.stage).padStart(2, '0')} {s.name}</span>
                          {idx < it.plan.skillNames.length - 1 && <span className="plan-arrow">→</span>}
                        </span>
                      ))}
                    </div>
                    {it.plan.reasoning && <div className="plan-reason">规划理由：{it.plan.reasoning}</div>}
                    <div className="kb-hits" style={{ marginTop: 8 }}>
                      <span className="chip accent">意图：{intentLabel(it.plan.intent)}</span>
                      <span className="chip">时长 {it.plan.constraints.duration ?? 30}s</span>
                      <span className="chip">画幅 {it.plan.constraints.aspect ?? '2.39:1'}</span>
                      {(it.plan.constraints.platforms || []).map((p) => (
                        <span className="chip cool" key={p}>{p}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            }
            if (it.kind === 'knowledge') {
              const d = it.data as any
              const dirNames = (d.directors || []).map((x: any) => (typeof x === 'string' ? x : x.name))
              const structNames = (d.structures || []).map((x: any) => (typeof x === 'string' ? x : x.name))
              const reasons = (d.directors || [])
                .filter((x: any) => x && x.reasons && x.reasons.length)
                .map((x: any) => `${x.name}：${x.reasons.join('；')}`)
              return (
                <div className="msg" key={i}>
                  <div className="plan-bar" style={{ paddingTop: 10 }}>
                    <div className="plan-title">知识库命中 · 导演决策建议</div>
                    <div className="kb-hits">
                      {d.conflict ? <span className="kb-hit">冲突 · {d.conflict}</span> : null}
                      {d.positioning ? <span className="kb-hit">定位 · {d.positioning}</span> : null}
                      {d.genres.map((g: string) => <span className="kb-hit" key={'g' + g}>类型 · {g}</span>)}
                      {d.moods.map((m: string) => <span className="kb-hit" key={'m' + m}>情绪 · {m}</span>)}
                    </div>
                    <div className="kb-hits">
                      {d.styles.map((s: any) => <span className="chip accent" key={s.id}>{s.name}</span>)}
                    </div>
                    {structNames.length ? (
                      <div className="kb-hits" style={{ marginTop: 6 }}>
                        <span className="kb-hit">推荐结构 · {structNames.join(' / ')}</span>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-mute)' }}>
                      参考导演：{dirNames.join('、') || '—'}　|　参考影片：{(d.films || []).join('、') || '—'}
                    </div>
                    {reasons.length ? (
                      <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                        {reasons.map((r: string, ri: number) => <div key={ri}>· {r}</div>)}
                      </div>
                    ) : null}
                    {(d.aspectRatio || d.durationMode || d.scriptLevel) ? (
                      <div className="kb-hits" style={{ marginTop: 6 }}>
                        {d.aspectRatio ? <span className="kb-hit">画幅 {d.aspectRatio}</span> : null}
                        {d.durationMode ? <span className="kb-hit">{d.durationMode}</span> : null}
                        {d.scriptLevel ? <span className="kb-hit">{d.scriptLevel}</span> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            }
            if (it.kind === 'stage') {
              return <div className="msg" key={i}><StageCard
                run={demo && it.run.skill === 'quality_control' ? { ...it.run, text: '演示模式不提供创作评分。请查看成果区的实际制作约束检查；接入模型后再评审真实方案。' } : it.run}
                review={stageReviews[it.run.skill]}
                stale={pendingSkills.includes(it.run.skill)}
              /></div>
            }
            if (it.kind === 'answer') {
              return (
                <div className="msg msg-agent" key={i}>
                  <div className="avatar"><IconSpark size={15} /></div>
                  <div className="msg-body">
                    <Markdown text={it.text} />
                    {!it.done && <span className="typing-cursor" />}
                  </div>
                </div>
              )
            }
            if (it.kind === 'error') {
              return (
                <div className="msg" key={i}>
                  <div className="notice err">生成出错：{it.text}</div>
                </div>
              )
            }
            return null
          })}

          {busy && status && (
            <div className="msg msg-agent">
              <div className="avatar"><span className="spinner" /></div>
              <div className="msg-body" style={{ color: 'var(--text-mute)', fontSize: 13, paddingTop: 5 }}>
                {status}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        <div className="composer-inner">
          {!empty && <div className="quick-actions" aria-label="快捷修改">
            {['让开场更有吸引力', '调整声音和音乐', '修改分镜，减少重复动作'].map(value =>
              <button key={value} disabled={busy} onClick={() => fill(value)}>{value}</button>)}
          </div>}
          {empty && <label className="composer-label" htmlFor="story-idea">故事想法</label>}
          <div className="run-target">
            <label htmlFor="run-target">本次运行到</label>
            <select id="run-target" value={targetStage} onChange={e => setTargetStage(Number(e.target.value))} disabled={busy}>
              {(stages.length ? stages : [
                { id: 'story_structure', name: '叙事结构', stage: 3 },
                { id: 'screenplay', name: '剧本', stage: 6 },
                { id: 'storyboard', name: '分镜', stage: 7 },
              ]).map(s => <option key={s.id} value={s.stage}>{String(s.stage).padStart(2, '0')} · {s.name}</option>)}
            </select>
            {nextStage <= 11 && !empty && <span>下一步：第 {nextStage} 环节</span>}
          </div>
          <div className="composer-box">
            <textarea
              id="story-idea"
              ref={taRef}
              aria-label={empty ? '创作想法' : '修改要求'}
              value={text}
              placeholder="描述你的想法… 例如「一个人在宇宙尽头寻找失去的记忆」"
              rows={empty ? 3 : 1}
              onChange={(e) => { setText(e.target.value); autoGrow(e.target) }}
              onKeyDown={onKey}
              disabled={busy}
            />
            {busy ? (
              <button className="icon-btn" onClick={onStop} title="停止">
                <IconStop size={14} />
              </button>
            ) : (
              <button className="icon-btn primary" onClick={() => {
                if (text.trim()) submit()
                else if (onContinue) onContinue(targetStage, Object.values(stageReviews).some(r => r.status === 'block'))
              }} disabled={!text.trim() && (!onContinue || empty || nextStage > 11 || targetStage < nextStage)}>
                <IconSend size={14} />
                {text.trim() ? (empty ? '生成方案' : '发送修改') : empty ? '生成方案' : '继续制作'}
              </button>
            )}
          </div>
          <div className="composer-foot">
            <span><span className="kbd">Enter</span> 发送 · <span className="kbd">Shift+Enter</span> 换行</span>
            <div className="spacer" />
            <span>时长 {constraints.duration ?? 300}s · 画幅 {constraints.aspect ?? '21:9'}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function intentLabel(i: string) {
  return { new_brief: '启动分段创作', revision: '增量修改', continue: '继续制作', question: '创作咨询', chat: '对话' }[i] || i
}
