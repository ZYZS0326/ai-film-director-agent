import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  /** 出错时显示的标题（说明是哪一块坏了） */
  label?: string
  /** 是否铺满（顶层用），否则只占自身区域 */
  full?: boolean
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 错误边界。
 *
 * 为什么必须有：这个界面渲染的是**任意 LLM 输出**（Markdown、JSON 解析出的结构化数据、
 * 各环节产出）。任何一处形状异常（字段缺失、类型不对、数组里混进 null）都会让组件在
 * render 阶段抛错 —— 而 React 遇到未捕获的渲染错误会**卸载整棵树**，
 * 用户看到的是一个纯白窗口：没有报错、没有入口、也没法回到上一屏。
 *
 * 更糟的是会话是持久化的：如果崩溃源于某个已保存项目的数据，重开那个项目会立刻再崩，
 * 表现就是「这个项目永远打不开了」。
 *
 * 所以：顶层包一层（避免白屏，给出可操作提示），
 * 各面板/卡片再各包一层（坏一块只坏一块，其余照常可用）。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留到控制台，方便用户反馈时抓取
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '(未命名区域)', error, info?.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const { label, full } = this.props
    return (
      <div className={full ? 'eb eb-full' : 'eb'}>
        <div className="eb-title">这一块渲染失败了{label ? `：${label}` : ''}</div>
        <div className="eb-msg">{String(error.message || error)}</div>
        <div className="eb-hint">
          其余部分不受影响，可以继续使用。若是打开某个项目后才出现，多半是该项目里存了异常数据。
        </div>
        <div className="eb-actions">
          <button className="btn ghost" onClick={this.reset}>重试渲染</button>
          <button className="btn ghost" onClick={() => window.location.reload()}>重新加载应用</button>
        </div>
      </div>
    )
  }
}
