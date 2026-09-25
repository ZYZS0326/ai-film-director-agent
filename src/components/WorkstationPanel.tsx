import { useEffect, useState } from 'react'
import { SessionState, KnowledgeStats, ContinuityData } from '../types'
import Markdown from './Markdown'
import ShotList from './ShotList'
import { IconDownload, IconRefresh } from './Icons'
import { api } from '../api'

const TABS: { key: string; label: string; output?: string }[] = [
  { key: 'analysis', label: '导演决策', output: 'analysis' },
  { key: 'structure', label: '叙事结构', output: 'structure' },
  { key: 'cinematography', label: '摄影方案', output: 'cinematography' },
  { key: 'visualBible', label: '视觉圣经', output: 'visualBible' },
  { key: 'screenplay', label: '剧本', output: 'screenplay' },
  { key: 'shots', label: '分镜' },
  { key: 'continuity', label: '连续性', output: 'continuity' },
  { key: 'prompts', label: '提示词', output: 'prompts' },
  { key: 'references', label: '参考档案', output: 'references' },
  { key: 'sound', label: '声音', output: 'sound' },
  { key: 'editing', label: '剪辑', output: 'editing' },
  { key: 'review', label: '审核', output: 'review' },
  { key: 'memory', label: '记忆' },
]

interface Props {
  session: SessionState | null
  knowledge: KnowledgeStats | null
  onRefresh: () => void
  onUpdate?: (s: SessionState) => void
  busy?: boolean
}

export default function WorkstationPanel({ session, knowledge, onRefresh, onUpdate, busy = false }: Props) {
  const [tab, setTab] = useState('shots')
  const [showAll, setShowAll] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')

  useEffect(() => {
    if (!session) return
    if (tab === 'shots' && !session.shots.length && session.outputs.prompts) setTab('prompts')
  }, [session?.id])

  const has = (key: string) => Boolean(session?.outputs?.[key])

  return (
    <>
      <div className="col-head">
        <span className="col-title">工作站</span>
        <div className="spacer" />
        {session && (
          <>
            <button className="icon-btn ghost" title="刷新" onClick={onRefresh}>
              <IconRefresh size={13} />
            </button>
            <a className="icon-btn ghost" title="导出完整方案 (Markdown)"
              href={api.exportUrl(session.id)} target="_blank" rel="noreferrer">
              <IconDownload size={13} />
              导出方案
            </a>
          </>
        )}
      </div>

      <div className="tabs">
        {TABS.filter(t => showAll || ['screenplay', 'shots', 'prompts', 'review', tab].includes(t.key)).map((t) => {
          const done = t.output ? has(t.output) : (t.key === 'shots' ? session?.shots?.length : false)
          return (
            <button key={t.key} aria-pressed={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {done ? <span className="tab-dot" /> : null}
            </button>
          )
        })}
        <button className="tab" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? '收起更多' : '更多内容'}</button>
      </div>

      <div className="panel-scroll">
        {(tab === 'shots' || tab === 'prompts') && session?.editorNotes?.[tab === 'shots' ? 'storyboard' : 'prompts'] && <details className="version-history"><summary>编辑前的原始说明（保留记录）</summary><p className="card-desc">此处保留原始节奏、转场及制作说明；旧镜头和旧提示词仅作参考，以当前分镜为准。</p><Markdown text={session.editorNotes[tab === 'shots' ? 'storyboard' : 'prompts'] || ''} /></details>}
        {!!session?.versions?.length && <details className="version-history"><summary>版本记录与撤销（最近 {session.versions.length} 次）</summary>
          <p className="card-desc">恢复的是整个制作方案，包含分镜、提示词、参数与锁定状态；恢复前也会自动留存版本。</p>
          {[...session.versions].reverse().map(v => <div className="version-row" key={v.id}><span>{v.label}<small>{new Date(v.at).toLocaleString()}</small></span><button className="icon-btn" disabled={busy || restoring || !onUpdate} onClick={async () => {
            if (!window.confirm('恢复此版本的整个制作方案？当前方案会先保存为新记录。')) return
            setRestoring(true); setRestoreError('')
            try { onUpdate?.(await api.editShots(session.id, { action: 'restore', versionId: v.id, version: session.editVersion || 0 })) }
            catch (e: any) { setRestoreError(e.message) } finally { setRestoring(false) }
          }}>恢复</button></div>)}
          {restoreError && <p role="alert">{restoreError}</p>}
        </details>}
        {session?.generationMode === 'demo' && <div className="card"><div className="card-title">演示模板</div><div className="card-desc">这些内容用于展示工作流程，分镜和评分含固定示例。请在设置中接入模型，再生成符合当前故事的制作方案。</div></div>}
        {session?.productionChecks && (
          <div className="card" role="status">
            <div className="card-title">{session.productionChecks.ok ? '制作约束检查通过' : '制作约束待处理'}</div>
            <div className="card-desc">目标 {session.productionChecks.targetDuration}s · 分镜合计 {session.productionChecks.actualDuration}s</div>
            {session.productionChecks.issues.map((issue, i) => <div className="card-desc" key={i}>{issue.message}</div>)}
            <div className="card-desc">检查时长、时间线、编号及提示词对应关系；创作质量与实际生成效果仍需审阅。</div>
          </div>
        )}
        {!session && (
          <div className="empty-panel">
            <div className="big">🎥</div>
            <div>工作站空置中。<br />在左侧描述一个想法，导演团队会开始工作。</div>
          </div>
        )}

        {session && tab === 'shots' && <ShotList shots={session.shots} session={session} onUpdate={onUpdate} busy={busy || restoring} />}

        {session && tab === 'prompts' && (
          session.promptData || session.outputs.prompts ? (
            <div>
              {session.promptData?.characterLock && (
                <div className="card">
                  <div className="card-title">角色一致性提示词（Character Lock）</div>
                  <div className="shot-prompt" style={{ margin: 0 }}>
                    <div><span className="label">中文：</span>{session.promptData.characterLock.zh}</div>
                    <div style={{ marginTop: 7 }}><span className="label">EN：</span>{session.promptData.characterLock.en}</div>
                  </div>
                </div>
              )}
              {session.promptData?.sceneAssets?.length ? (
                <div className="card">
                  <div className="card-title">场景资产提示词</div>
                  {session.promptData.sceneAssets.map((s, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div className="card-desc" style={{ color: 'var(--accent)', marginBottom: 5 }}>{s.name}</div>
                      <div className="shot-prompt" style={{ margin: 0 }}>
                        <div><span className="label">中：</span>{s.promptZh}</div>
                        <div style={{ marginTop: 6 }}><span className="label">EN：</span>{s.promptEn}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {session.promptData?.imageAssets?.length ? (
                <div className="card">
                  <div className="card-title">前期资产图 · 提示词待出图</div>
                  <div className="card-desc">先生成并核对母资产；这里保存的是提示词，不代表图片已通过。</div>
                  {session.promptData.imageAssets.map((a, i) => (
                    <details key={a.assetId || i} className="card" style={{ marginTop: 8 }}>
                      <summary>{a.assetId} · {a.sheet} · {a.aspectRatio}</summary>
                      <div className="shot-prompt">
                        <div><span className="label">中文：</span>{a.promptZh}</div>
                        {a.promptEn && <div><span className="label">EN：</span>{a.promptEn}</div>}
                        {a.negative && <div><span className="label">负向：</span>{a.negative}</div>}
                        {!!a.lockedFacts?.length && <div><span className="label">锁定：</span>{a.lockedFacts.join('、')}</div>}
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
              {session.promptData?.keyframes?.length ? (
                <div className="card">
                  <div className="card-title">逐镜静态关键帧 · 提示词待出图</div>
                  {session.promptData.keyframes.map((f, i) => (
                    <details key={i} className="card" style={{ marginTop: 8 }}>
                      <summary>镜头 {f.shotNo} · {f.phase} · {f.aspectRatio}</summary>
                      <div className="shot-prompt">
                        <div><span className="label">引用：</span>{f.assetIds.join('、')}</div>
                        <div><span className="label">中文：</span>{f.promptZh}</div>
                        {f.promptEn && <div><span className="label">EN：</span>{f.promptEn}</div>}
                        {f.negative && <div><span className="label">负向：</span>{f.negative}</div>}
                        {f.motionNote && <div><span className="label">视频阶段：</span>{f.motionNote}</div>}
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
              {session.promptValidation ? (
                <div className="card">
                  <div className="card-title">提示词质检</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className={`chip ${session.promptValidation.banned.length ? 'err' : 'accent'}`}>
                      无效词：{session.promptValidation.banned.length ? session.promptValidation.banned.join('、') : '0（已清除）'}
                    </span>
                    <span className="chip cool">13 要素覆盖：{session.promptValidation.covered}/{session.promptValidation.total}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {session.promptValidation.elements.map((e) => (
                      <span key={e.id} className="chip" style={{
                        opacity: e.present ? 1 : 0.42,
                        borderColor: e.present ? 'var(--accent)' : undefined,
                        color: e.present ? 'var(--accent)' : undefined,
                      }}>
                        {e.present ? '✓ ' : '· '}{e.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {session.outputs.prompts && (
                <div className="card" style={{ padding: '4px 15px 10px' }}>
                  <Markdown text={stripJsonBlock(session.outputs.prompts)} />
                </div>
              )}
            </div>
          ) : (
            <EmptyHint label="提示词" />
          )
        )}

        {session && ['structure', 'cinematography', 'visualBible', 'screenplay', 'analysis', 'references', 'continuity', 'sound', 'editing', 'review'].includes(tab) && (
          session.outputs[tab]
            ? (
              <div>
                {tab === 'review' && session.generationMode !== 'demo' && session.reviewScores?.length ? <ReviewSummary scores={session.reviewScores} /> : null}
                {tab === 'continuity' ? <ContinuitySummary data={session.continuityData} /> : null}
                <div className="card" style={{ padding: '4px 16px 14px' }}><Markdown text={tab === 'review' && session.generationMode === 'demo' ? '演示模式不展示固定创作评分。请参考上方制作约束检查，并接入模型评审真实方案。' : session.outputs[tab]} /></div>
              </div>
            )
            : <EmptyHint label={TABS.find((t) => t.key === tab)?.label || ''} />
        )}

        {session && tab === 'memory' && <MemoryPanel session={session} />}

        {!session && tab !== 'shots' && null}
      </div>
    </>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="empty-panel">
      <div className="big">⏳</div>
      <div>「{label}」尚未生成。<br />它会随导演流水线自动产出。</div>
    </div>
  )
}

function stripJsonBlock(text: string) {
  return text.replace(/```json[\s\S]*?```/gi, '').trim()
}

/**
 * 连续性锁定总览。
 *
 * continuity 环节解析出的结构化数据（lockZh / rules / props…）此前只存不用 ——
 * 而「生成下一镜头前必须核对的规则清单」恰恰是这个环节最该被看见的产出。
 * 这里把规则渲染成核对清单，锁定的复用片段单独拎出来，方便直接复制。
 */
function ContinuitySummary({ data }: { data?: ContinuityData | null }) {
  if (!data) return null
  const rules = data.rules || []
  const props = data.props || []
  const chars = data.characters || []
  const hasAny = data.lockZh || rules.length || props.length || chars.length
  if (!hasAny) return null
  return (
    <div className="card">
      <div className="card-title">连续性锁定（Continuity Bible）</div>

      {data.lockZh ? (
        <div style={{ marginBottom: 12 }}>
          <div className="card-desc" style={{ marginBottom: 5 }}>
            提示词复用片段 · 每镜提示词开头必须<span style={{ color: 'var(--accent)' }}>逐字照抄</span>
          </div>
          <div className="shot-prompt" style={{ margin: 0 }}>
            <div><span className="label">中：</span>{data.lockZh}</div>
            {data.lockEn ? <div style={{ marginTop: 6 }}><span className="label">EN：</span>{data.lockEn}</div> : null}
          </div>
        </div>
      ) : null}

      {rules.length ? (
        <div style={{ marginBottom: props.length || chars.length ? 12 : 0 }}>
          <div className="card-desc" style={{ marginBottom: 6 }}>
            生成下一镜头前必须逐条核对（{rules.length} 条）
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.65 }}>
                <span style={{ flex: '0 0 20px', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.length ? (
        <div style={{ marginBottom: chars.length ? 12 : 0 }}>
          <div className="card-desc" style={{ marginBottom: 6 }}>关键道具状态</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {props.map((p, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                <span className="chip accent">{p.name}</span>
                <span style={{ color: 'var(--text-dim)' }}> {p.position}{p.state ? ` · ${p.state}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {chars.length ? (
        <div>
          <div className="card-desc" style={{ marginBottom: 6 }}>人物一致性档案</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {chars.map((c, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                <span className="chip cool">{c.name}</span>
                <span style={{ color: 'var(--text-dim)' }}> {c.age} · {c.clothing}{c.marks ? ` · ${c.marks}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 审核评分总览（三分类） */
function ReviewSummary({ scores }: { scores: { name: string; score: number }[] }) {  const avg = scores.reduce((a, x) => a + x.score, 0) / scores.length
  const tone = avg >= 8 ? 'ok' : avg >= 7 ? 'warn' : 'bad'
  const color = tone === 'ok' ? 'var(--ok, #5ec27a)' : tone === 'warn' ? 'var(--accent)' : 'var(--danger, #e06a5c)'
  return (
    <div className="card">
      <div className="card-title">导演审核评分</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color }}>{avg.toFixed(1)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>/ 10 · 共 {scores.length} 项</div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {scores.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: '0 0 130px', fontSize: 12, color: 'var(--text-dim)' }}>{s.name}</div>
            <div style={{ flex: 1, height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${s.score * 10}%`, height: '100%',
                background: s.score >= 8 ? '#5ec27a' : s.score >= 7 ? 'var(--accent)' : '#e06a5c',
              }} />
            </div>
            <div style={{ flex: '0 0 30px', fontSize: 11.5, textAlign: 'right', color: 'var(--text-dim)' }}>{s.score}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MemoryPanel({ session }: { session: SessionState }) {
  const m = session.memory
  return (
    <div>
      <div className="card">
        <div className="card-title">项目 Brief</div>
        <div className="card-desc">{session.brief || '—'}</div>
        <div className="tag-list">
          <span className="tag accent">时长 {session.constraints.duration ?? 300}s</span>
          <span className="tag accent">画幅 {session.constraints.aspect ?? '21:9'}</span>
          <span className="tag accent">Level {session.constraints.level ?? 4}</span>
          {(session.constraints.platforms || []).map((p) => <span className="tag" key={p}>{p}</span>)}
        </div>
      </div>

      <div className="card">
        <div className="card-title">已学习的偏好（语义记忆）</div>
        {m.preferences?.length ? (
          <div className="tag-list">
            {m.preferences.map((p, i) => <span className="tag accent" key={i}>{p}</span>)}
          </div>
        ) : <div className="card-desc">尚无。当你提出修改要求（如「不要赛博朋克，改成东方神话」）时，系统会从中提取长期偏好。</div>}
      </div>

      <div className="card">
        <div className="card-title">创作决策记录</div>
        {m.decisions?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
            {m.decisions.map((d, i) => <li key={i} style={{ margin: '3px 0' }}>{d}</li>)}
          </ul>
        ) : <div className="card-desc">尚无。</div>}
      </div>

      <div className="card">
        <div className="card-title">修改历史</div>
        {m.revisions?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
            {m.revisions.map((r, i) => (
              <li key={i} style={{ margin: '3px 0' }}>
                {r.instruction}
                <span style={{ color: 'var(--text-mute)', fontSize: 11 }}> · {new Date(r.at).toLocaleString('zh-CN')}</span>
              </li>
            ))}
          </ul>
        ) : <div className="card-desc">尚无。</div>}
      </div>

      <div className="card">
        <div className="card-title">已执行技能链</div>
        <div className="tag-list">
          {(session.pipeline || []).map((p) => <span className="tag" key={p}>{p}</span>)}
        </div>
      </div>
    </div>
  )
}
