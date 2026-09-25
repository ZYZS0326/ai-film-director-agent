import { useEffect, useState } from 'react'
import { KnowledgeStats, SkillMeta } from '../types'
import { api } from '../api'

export function KnowledgeModal({ onClose }: { onClose: () => void }) {
  const [k, setK] = useState<KnowledgeStats | null>(null)
  const [tab, setTab] = useState<'overview' | 'references' | 'sources' | 'directors' | 'films' | 'genres' | 'structures' | 'styles' | 'cinema' | 'visual' | 'platforms'>('overview')
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState('')

  useEffect(() => { api.knowledge().then(setK).catch(() => {}) }, [])
  if (!k) return null

  const s = k.stats
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">电影知识库 · Film Knowledge Base</span>
          <button className="icon-btn ghost" onClick={onClose}>✕</button>
        </div>

        <div className="tabs" style={{ paddingTop: 6, flexWrap: 'wrap' }}>
          {([
            ['overview', '总览'], ['references', '实操参考'], ['sources', '来源目录'], ['directors', '导演'], ['films', '影片'],
            ['genres', '类型库'], ['structures', '叙事结构'], ['styles', '风格库'],
            ['cinema', '摄影语言'], ['visual', '色彩美术'], ['platforms', 'AI 平台'],
          ] as const).map(([key, label]) => (
            <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'references' && (() => {
            const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
            const cards = (k.referenceCards || []).filter(card => {
              const text = [card.title, ...card.tags, card.method, card.deliverable, card.check, card.pitfall].join(' ').toLowerCase()
              return (!domain || domain === card.domain) && (!terms.length || terms.some(term => text.includes(term)))
            })
            return <>
              <div className="notice info">原创实操建议，附延伸阅读，不是教材原文。生成时按环节与故事关键词挑选，遵守上下文预算；演示模式不代表模型已执行这些建议。</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
                <input className="input" aria-label="搜索实操参考" placeholder="搜索：空间、表演、纪录片、字幕…" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: '1 1 220px', minWidth: 0 }} />
                <select className="select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="参考领域" value={domain} onChange={e => setDomain(e.target.value)}>
                  <option value="">全部领域</option>
                  {(k.referenceDomains || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button className="icon-btn" onClick={() => { setQuery(''); setDomain('') }}>清除筛选</button>
              </div>
              <p className="card-desc">找到 {cards.length} 条参考 · 共 {k.referenceCards?.length || 0} 条</p>
              {!cards.length && <p className="notice info">没有匹配资料，请缩短关键词或清除领域筛选。</p>}
              {cards.map(card => <details className="card" key={card.id}>
                <summary className="card-title">{card.title} <span className="tag">{k.referenceDomains?.find(d => d.id === card.domain)?.name}</span></summary>
                <p className="card-desc"><b>做法：</b>{card.method}</p>
                <p className="card-desc"><b>应产出：</b>{card.deliverable}</p>
                <p className="card-desc"><b>验收问题：</b>{card.check}</p>
                <p className="card-desc"><b>常见误区：</b>{card.pitfall}</p>
                <p className="card-desc">{card.provenance}</p>
                <div className="tag-list">{card.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</div>
                <p className="card-desc">延伸阅读：{card.sourceIds.map(id => {
                  const source = k.referenceSources?.find(s => s.id === id)
                  return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 12, color: 'var(--accent)', overflowWrap: 'anywhere' }}>{source.publisher} · {source.title}</a> : null
                })}</p>
              </details>)}
            </>
          })()}
          {tab === 'sources' && <>
            <div className="notice info">外部资料仅提供入口与适用范围，不代表已收录全文。平台规则会变化，制作前请重新核对；“索引确认”不等于已阅读全文。</div>
            {(k.referenceSources || []).map(source => <div className="card" key={source.id}>
              <a className="card-title" style={{ color: 'var(--accent)', overflowWrap: 'anywhere' }} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              <p className="card-desc">{source.publisher} · {source.checkedAt} · {source.verification === 'page' ? '已读取入口页面' : '检索索引确认'}</p>
              <p className="card-desc">{source.scope}</p>
            </div>)}
          </>}
          {tab === 'overview' && (
            <>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-num">{s.referenceCards || 0}</div><div className="stat-label">新增实操参考</div></div>
                <div className="stat-card"><div className="stat-num">{s.referenceSources || 0}</div><div className="stat-label">来源入口</div></div>
                <div className="stat-card"><div className="stat-num">{s.referenceDomains || 0}</div><div className="stat-label">实操领域</div></div>
                <div className="stat-card"><div className="stat-num">{s.directors}</div><div className="stat-label">导演档案</div></div>
                <div className="stat-card"><div className="stat-num">{s.films}</div><div className="stat-label">影片方法论</div></div>
                <div className="stat-card"><div className="stat-num">{s.styles}</div><div className="stat-label">视觉风格</div></div>
                <div className="stat-card"><div className="stat-num">{s.genres}</div><div className="stat-label">类型</div></div>
                <div className="stat-card"><div className="stat-num">{s.moods}</div><div className="stat-label">情绪</div></div>
                <div className="stat-card"><div className="stat-num">{s.cameras}</div><div className="stat-label">摄影机</div></div>
                <div className="stat-card"><div className="stat-num">{s.lenses}</div><div className="stat-label">镜头焦段</div></div>
                <div className="stat-card"><div className="stat-num">{s.movements}</div><div className="stat-label">运镜方式</div></div>
                <div className="stat-card"><div className="stat-num">{s.shotSizes}</div><div className="stat-label">景别</div></div>
                <div className="stat-card"><div className="stat-num">{s.platforms}</div><div className="stat-label">AI 平台规范</div></div>
              </div>
              <div className="card">
                <div className="card-title">学习内容（不复制剧情，只学习方法论）</div>
                <div className="card-desc">
                  镜头语言 · 叙事结构 · 节奏控制 · 色彩体系 · 光影设计 · 构图方式 · 声音设计 · 情绪制造方法
                </div>
              </div>
              <div className="card">
                <div className="card-title">叙事结构库</div>
                <div className="card-desc">{k.structures.map((x) => x.name).join(' · ')}</div>
              </div>
              <div className="card">
                <div className="card-title">导演自我审查清单</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
                  {k.checks.map((c) => <li key={c.id} style={{ margin: '4px 0' }}><b style={{ color: 'var(--text)' }}>{c.name}</b>：{c.question}</li>)}
                </ul>
              </div>
            </>
          )}

          {tab === 'directors' && k.directors.map((d) => (
            <div className="card" key={d.id}>
              <div className="card-title">
                {d.name} <span style={{ color: 'var(--text-mute)', fontWeight: 400, fontSize: 11.5 }}>{d.nameEn} · {d.nationality}</span>
              </div>
              <div className="card-desc">{d.signature}</div>
              <div className="card-desc" style={{ color: 'var(--text-mute)', fontSize: 11.5, marginBottom: 6 }}>{d.era}</div>
              <div className="card-desc"><b>创作理念：</b>{d.philosophy}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>叙事特点：</b>{(d.narrative || []).join('；')}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>镜头语言：</b>{(d.lensLanguage || []).join('；')}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>美学体系：</b>{d.aesthetic}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>创作方法：</b>{d.method}</div>
              {(d.filmAnalyses || []).length ? (
                <div style={{ marginTop: 8 }}>
                  <div className="card-desc" style={{ color: 'var(--accent)', marginBottom: 5 }}>代表作品分析</div>
                  {(d.filmAnalyses || []).map((f) => (
                    <div key={f.title} style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0', lineHeight: 1.65 }}>
                      <b style={{ color: 'var(--text)' }}>{f.title}（{f.year}）</b>：{f.analysis}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="tag-list">
                {(d.themes || []).map((t) => <span className="tag accent" key={t}>{t}</span>)}
                {(d.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}
              </div>
              <div className="card-desc" style={{ marginTop: 5, color: 'var(--text-mute)', fontSize: 11.5 }}>不适合：{d.avoidWhen}</div>
            </div>
          ))}

          {tab === 'genres' && k.genres.map((g) => (
            <div className="card" key={g.id}>
              <div className="card-title">{g.name}</div>
              <div className="card-desc"><b>结构规律：</b>{g.structure}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>观众期待：</b>{g.expectation}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>视觉特点：</b>{g.visual}</div>
              <div style={{ marginTop: 6 }}>
                <div className="card-desc" style={{ color: '#e06a5c', marginBottom: 3 }}>常见失败点</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                  {(g.failurePoints || []).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
              <div className="tag-list">{(g.examples || []).map((e) => <span className="tag" key={e}>{e}</span>)}</div>
            </div>
          ))}

          {tab === 'structures' && k.structures.map((st) => (
            <div className="card" key={st.id}>
              <div className="card-title">
                {st.name}
                <span className="tag" style={{ marginLeft: 6 }}>难度 {st.difficulty}/5</span>
              </div>
              <div className="card-desc">{st.definition}</div>
              <div className="card-desc" style={{ marginTop: 5 }}><b>节拍：</b>{(st.beats || []).join(' → ')}</div>
              <div className="card-desc" style={{ marginTop: 5, color: '#5ec27a' }}><b>优点：</b>{(st.pros || []).join('；')}</div>
              <div className="card-desc" style={{ marginTop: 4, color: '#e06a5c' }}><b>缺点：</b>{(st.cons || []).join('；')}</div>
              <div className="tag-list">
                {(st.fitGenres || []).map((g) => <span className="tag accent" key={g}>{g}</span>)}
                {(st.cases || []).map((c) => <span className="tag" key={c}>{c}</span>)}
              </div>
            </div>
          ))}

          {tab === 'cinema' && (
            <>
              <div className="card">
                <div className="card-title">画幅比例</div>
                {k.aspectRatios.map((a) => (
                  <div key={a.id} style={{ marginBottom: 10 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)' }}>{a.name} · {a.label}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}><b>构图：</b>{a.composition}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}><b>镜头：</b>{a.lens}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}><b>叙事：</b>{a.narrative}</div>
                    <div className="card-desc" style={{ fontSize: 11.8, color: 'var(--text-mute)' }}>
                      <b>优势：</b>{a.strength}｜<b>局限：</b>{a.weakness}
                    </div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">摄影机</div>
                {k.cameras.map((c) => (
                  <div key={c.id} style={{ marginBottom: 8 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)' }}>{c.name} · {c.sensor}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>{c.note}</div>
                    <div className="card-desc" style={{ fontSize: 11.8, color: 'var(--text-mute)' }}>心理效应：{c.psychology}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">镜头焦段 · 焦段如何影响心理</div>
                {k.lenses.map((l) => (
                  <div key={l.id} style={{ marginBottom: 8 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)' }}>{l.name} · {l.fov}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>{l.effect}</div>
                    <div className="card-desc" style={{ fontSize: 11.8, color: 'var(--text-mute)' }}>心理：{l.psychology}</div>
                    <div className="tag-list">{(l.cases || []).map((c) => <span className="tag" key={c}>{c}</span>)}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">景别</div>
                {k.shotSizes.map((s2) => (
                  <div key={s2.id} style={{ marginBottom: 6 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)', fontSize: 12 }}>{s2.name}（{s2.en}）</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>情绪：{s2.emotion}｜场景：{s2.scene}</div>
                    <div className="card-desc" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>案例：{(s2.cases || []).join('、')}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">运镜</div>
                {k.movements.map((m) => (
                  <div key={m.id} style={{ marginBottom: 6 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)', fontSize: 12 }}>{m.name}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>情绪：{m.emotion}｜场景：{m.scene}</div>
                    <div className="card-desc" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>案例：{(m.cases || []).join('、')}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'visual' && (
            <>
              <div className="card">
                <div className="card-title">色彩心理</div>
                {k.colors.map((c) => (
                  <div key={c.id} style={{ marginBottom: 9 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)' }}>{c.name}：{c.meaning}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>{c.nuance}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}><b>用法：</b>{c.usage}</div>
                    <div className="card-desc" style={{ fontSize: 11.5, color: '#e06a5c' }}><b>风险：</b>{c.caution}</div>
                    <div className="tag-list">{(c.cases || []).map((x) => <span className="tag" key={x}>{x}</span>)}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">视觉体系（流派）</div>
                {k.visualSystems.map((v) => (
                  <div key={v.id} style={{ marginBottom: 10 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)' }}>{v.name}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>{v.philosophy}</div>
                    <div className="card-desc" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
                      色板：{v.palette}｜光：{v.light}｜材质：{v.material}<br />构图：{v.composition}｜镜头：{v.lens}｜声音：{v.sound}
                    </div>
                    <div className="tag-list">{(v.cases || []).map((c) => <span className="tag" key={c}>{c}</span>)}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">材质肌理</div>
                {k.materials.map((m) => (
                  <div key={m.id} style={{ marginBottom: 5 }}>
                    <div className="card-desc" style={{ fontSize: 12 }}><b style={{ color: 'var(--accent)' }}>{m.name}</b>：{m.desc}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">剧本等级</div>
                {k.scriptLevels.map((l) => (
                  <div key={l.id} style={{ marginBottom: 6 }}>
                    <div className="card-desc" style={{ color: 'var(--accent)', fontSize: 12 }}>Level {l.id} · {l.name}</div>
                    <div className="card-desc" style={{ fontSize: 11.8 }}>{l.desc}</div>
                    <div className="card-desc" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>篇幅：{l.length}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">时长模式</div>
                {k.durationModes.map((d) => (
                  <div key={d.id} style={{ marginBottom: 5 }}>
                    <div className="card-desc" style={{ fontSize: 12 }}>
                      <b style={{ color: 'var(--accent)' }}>{d.label}</b>：{d.scenes} / {d.shots} — {d.note}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'films' && k.films.map((f) => (
            <div className="card" key={f.id}>
              <div className="card-title">{f.title} <span style={{ color: 'var(--text-mute)', fontWeight: 400, fontSize: 11.5 }}>{f.titleEn} · {f.year}</span></div>
              <div className="tag-list">{f.tags.map((t) => <span className="tag accent" key={t}>{t}</span>)}</div>
            </div>
          ))}

          {tab === 'styles' && k.styles.map((st) => (
            <div className="card" key={st.id}>
              <div className="card-title">{st.name} <span className="tag">{st.category}</span></div>
              <div className="card-desc" style={{ marginBottom: 6 }}>{st.summary}</div>
              <div className="card-desc" style={{ color: 'var(--text-mute)', fontSize: 11.8 }}>为什么适合：{st.rationale}</div>
            </div>
          ))}

          {tab === 'platforms' && k.platforms.map((p) => (
            <div className="card" key={p.id}>
              <div className="card-title">{p.name} <span className="tag">{p.type}</span> <span className="tag">{p.lang}</span></div>
              <div className="card-desc"><b>结构：</b>{p.structure.join(' → ')}</div>
              <div className="card-desc" style={{ marginTop: 4 }}><b>要点：</b>{p.notes}</div>
              <div className="card-desc" style={{ marginTop: 4, color: 'var(--text-mute)' }}>{p.negativeHint} · 建议长度 ≤ {p.maxLength}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkillsModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ skills: SkillMeta[]; pipeline: string[] } | null>(null)
  useEffect(() => { api.skills().then(setData).catch(() => {}) }, [])
  if (!data) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">能力清单 · Skill System</span>
          <button className="icon-btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="notice info">
            智能体采用 Planner + Skill Router 架构：由 LLM 规划器判断意图并动态路由技能，
            非固定 if/else 流程。修订请求只重跑受影响的技能，不推翻已有方案。
          </div>
          {data.skills.map((s) => (
            <div className="card" key={s.id}>
              <div className="card-title">
                <span className="stage-badge" style={{ marginRight: 8 }}>{String(s.stage).padStart(2, '0')}</span>
                {s.name}
                <span style={{ color: 'var(--text-mute)', fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>{s.role}</span>
              </div>
              <div className="card-desc">{s.description}</div>
              <div className="tag-list">
                <span className="tag">skills/{s.id}</span>
                {s.triggers.slice(0, 6).map((t) => <span className="tag" key={t}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
