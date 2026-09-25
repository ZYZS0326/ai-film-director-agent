/**
 * 项目参数面板 — 时长 / 剧本等级 / 画幅 / 目标平台
 * 用户可自由选择，改动实时写入会话。
 */
import { Constraints, DurationMode, ScriptLevel, KnowledgeStats } from '../types'
import { IconChevron } from './Icons'

const ASPECTS = [
  { id: '21:9', label: '21:9 宽银幕' },
  { id: '16:9', label: '16:9 标准' },
  { id: '9:16', label: '9:16 竖屏' },
  { id: '1:1', label: '1:1 方形' },
]

interface Props {
  constraints: Constraints
  knowledge: KnowledgeStats | null
  disabled?: boolean
  onChange: (patch: Partial<Constraints>) => void
}

export default function ParamsBar({ constraints, knowledge, disabled, onChange }: Props) {
  const durations: DurationMode[] = knowledge?.durationModes?.length
    ? knowledge.durationModes
    : [
      { id: 'd60', duration: 60, label: '1 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
      { id: 'd180', duration: 180, label: '3 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
      { id: 'd300', duration: 300, label: '5 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
      { id: 'd600', duration: 600, label: '10 分钟短片', mode: 'short', scenes: '', shots: '', note: '' },
      { id: 'd1800', duration: 1800, label: '30 分钟中片', mode: 'medium', scenes: '', shots: '', note: '' },
      { id: 'd3600', duration: 3600, label: '60 分钟长片', mode: 'feature', scenes: '', shots: '', note: '' },
      { id: 'd5400', duration: 5400, label: '90 分钟电影', mode: 'feature', scenes: '', shots: '', note: '' },
      { id: 'd7200', duration: 7200, label: '120 分钟电影', mode: 'feature', scenes: '', shots: '', note: '' },
    ]
  const levels: ScriptLevel[] = knowledge?.scriptLevels?.length
    ? knowledge.scriptLevels
    : [1, 2, 3, 4, 5].map((n) => ({
      id: n, key: '', name: ['故事梗概', '场景大纲', '完整剧本', '专业电影剧本', '导演制作稿'][n - 1],
      desc: '', length: '', contains: [],
    }))
  const platforms = knowledge?.platforms || []

  // 当前时长若不在预设列表里（LLM 从口语里抽出的非标值，或旧项目残留），
  // 必须补一个临时选项 —— 否则 <select> 找不到匹配项会回落到第一项，
  // 界面显示「1 分钟短片」而实际约束是 45 秒，用户看到的和生效的不一致。
  const curDuration = constraints.duration ?? 300
  const durOptions: DurationMode[] = durations.some((d) => d.duration === curDuration)
    ? durations
    : [...durations, {
        id: 'd_current', duration: curDuration, label: `${curDuration} 秒（当前值）`,
        mode: 'short', scenes: '', shots: '', note: '',
      }]

  const curLevel = constraints.level ?? 4
  const curAspect = ASPECTS.some((a) => a.id === constraints.aspect) ? constraints.aspect : '21:9'

  return (
    <div className="params-bar">
      <label className="param">
        <span className="param-label">时长</span>
        <span className="param-select">
          <select
            value={curDuration}
            disabled={disabled}
            onChange={(e) => onChange({ duration: Number(e.target.value) })}
          >
            {durOptions.map((d) => (
              <option key={d.id} value={d.duration}>{d.label}</option>
            ))}
          </select>
          <IconChevron dir="down" size={11} />
        </span>
      </label>

      <label className="param">
        <span className="param-label">剧本等级</span>
        <span className="param-select">
          <select
            value={curLevel}
            disabled={disabled}
            onChange={(e) => onChange({ level: Number(e.target.value) })}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>L{l.id} · {l.name}</option>
            ))}
          </select>
          <IconChevron dir="down" size={11} />
        </span>
      </label>

      <label className="param">
        <span className="param-label">画幅</span>
        <span className="param-select">
          <select
            value={curAspect}
            disabled={disabled}
            onChange={(e) => onChange({ aspect: e.target.value })}
          >
            {ASPECTS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <IconChevron dir="down" size={11} />
        </span>
      </label>

      <div className="param param-platforms">
        <span className="param-label">目标平台</span>
        <div className="platform-chips">
          {platforms.map((p) => {
            const on = (constraints.platforms || []).includes(p.id)
            return (
              <button
                key={p.id}
                className={`platform-chip ${on ? 'on' : ''}`}
                disabled={disabled}
                title={`${p.notes || ''}${p.license ? '\n\n许可证：' + p.license : ''}`}
                onClick={() => {
                  const next = on
                    ? (constraints.platforms || []).filter((x) => x !== p.id)
                    : [...(constraints.platforms || []), p.id]
                  onChange({ platforms: next })
                }}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
