# 导演台视觉系统

本文件记录导演台已在代码中落地的规则；具体数值以 `src/styles/global.css` 为准。

## 来源与适用范围

- 设计系统源：项目现有 React 组件与手写 CSS，无外部组件库。
- 主题切换：根元素 `data-theme="dark"`；默认纸白主题，用户已保存的主题继续生效。
- 图标源：`src/components/Icons.tsx`，不混用 emoji 或外部图标。
- 应用外壳：`src/App.tsx` 的顶栏、工作区导航和三栏布局；创作空态与输入框在 `src/components/ChatPanel.tsx`。

## 基础规则

- 色彩：通过 `--bg*`、`--text*`、`--border*`、`--accent` 和 `--accent-ink` 绑定语义角色；冷青色用于当前状态与主要动作，不作大面积装饰。
- 字体：正文用 `--sans`；空态主标题用 `--serif`；编号与小型元信息用 `--mono`。不要把衬线体用于密集的结果正文。
- 表面：纸白工作面配深色顶栏；深色主题保持同一层级关系，不把图片或边框变成发光效果。
- 形状：创作区使用细分隔线与小圆角，避免所有内容都装入卡片。焦点保持 2px 可见轮廓。
- 布局：桌面保留项目栏、创作区及可选成果栏；1100px 以下通过视图切换访问三栏；600px 以下空态图片隐藏，输入与主动作优先。

## 组件使用

- `view-switch`：同级工作区视图，当前项用下划线和字重表示，不只靠颜色。
- `example-card`：示例填入输入框供编辑，不直接启动生成；视觉上是编号文字行，不是功能卡片。
- `composer-box`：当前任务的唯一主要动作。空态有常驻“故事想法”标签；运行中保留停止入口。
- `session-item`：当前项目由浅色底和左侧强调线标记；删除仍走现有确认流程。

## 验证

`npm run typecheck`、`npm run test:ui`、`npm run build -- --emptyOutDir false` 与 `scripts/workspace-visual.cjs`。真实窗口截图位于 `build/ui-preview/`；检查桌面、390px 窄屏、深浅主题、示例填入、成果及项目视图。
