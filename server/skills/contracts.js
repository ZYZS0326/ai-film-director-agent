/**
 * 导演台增强 Skill Pack v1.0 —— 输出契约
 *
 * 每个 Skill 在 buildPrompt 末尾追加自己的契约，强制 LLM 产出**结构化正文**。
 * 契约的作用不是"加要求"，而是把「专业判断」变成**可被检查的字段**——
 * 少任何一项，导演审核就能立刻发现。
 *
 * 通用禁令（所有 Skill 生效）：
 *   禁止输出空泛词（cinematic / beautiful / masterpiece / 电影感 / 高级感）；
 *   所有视觉描述必须解释「为什么这样设计」。
 */

const BAN = `
【通用禁令 · 适用于本次输出】
1. 禁止使用空泛形容词：cinematic、beautiful、masterpiece、epic、电影感、电影级、高级感、大片、高清、唯美、震撼。
   必须用具体参数替代（机型 / 焦段 / 色温 / 光比 / 时间码 / 材质）。
2. 所有视觉决定必须附带「为什么这样设计」——解释它服务哪个主题、情绪或信息。
   例：低机位不是"酷"，而是强化人物的力量感与支配关系。
3. 不要只列标题。每一节都必须写满正文，禁止"此处省略""（略）"。
4. 不要复制参考作品的剧情、人物关系或具体桥段——只学习方法论。
`

/** Skill 01 · 导演视觉分析系统（Concept Diagnosis + Director Intent） */
const DIRECTOR_VISION = `
${BAN}
【必须输出 · Skill 01 概念诊断（Concept Diagnosis）】
## 概念诊断
- **作品核心**：
- **表层故事**：
- **深层主题**：
- **导演想表达**：
- **观众应该感受到**：
- **避免成为**：（明确指出这片子最容易沦为哪种廉价形态，以及如何规避）

六项分析缺一不可：核心主题 / 哲学命题 / 情绪目标 / 观众体验 / 类型定位 / 独特卖点。

【必须输出 · Skill 01 导演意图（Director Intent）】
## 导演意图（模拟导演会议）
- **为什么拍这个故事？**
- **为什么现在拍？**（当下的现实关联）
- **为什么用这种视觉形式？**
- **哪些元素必须保留？**
- **哪些元素应该删除？**
`

/** Skill 02 · 电影参考分析库 */
const FILM_REFERENCE = `
${BAN}
【必须输出 · Skill 02 电影参考分析】
禁止只写"参考《某片》"。每部参考影片必须给出：

## 参考影片：片名（年份）
- **使用元素**：
- **学习什么**：
- **不要复制什么**：
- **如何转化**：

并分维度拆解（每个维度至少 2 条可执行结论）：
### 摄影
- 构图：…
- 镜头运动：…
- 光影：…
### 叙事
- 信息释放：…
- 节奏控制：…
- 角色塑造：…
### 美术
- 材质：…
- 色彩：…
- 世界观：…
### 声音
- 声音空间：…
- 音效设计：…
`

/** Skill 03 · 故事结构诊断（McKee / Save the Cat / Story Circle） */
const STORY_STRUCTURE = `
${BAN}
【必须输出 · Skill 03 故事结构诊断】
## 人物引擎
- **主人公**：
- **欲望（Want）**：（他自以为想要什么）
- **需求（Need）**：（他真正需要什么——与欲望对立才有弧线）
- **缺陷（Flaw）**：
- **冲突**：
- **转变**：

## 幕结构体检
| 幕 | 诊断结论 | 证据 | 风险等级 |
|---|---|---|---|
| 第一幕 | 是否吸引？ | … | 高/中/低 |
| 第二幕 | 是否疲软？ | … | 高/中/低 |
| 第三幕 | 是否合理？ | … | 高/中/低 |

第二幕若判定"疲软"，必须给出具体的补救方案（新增阻力 / 反转 / 方向改变）。
`

/** Skill 04 · 场景设计（Scene Construction） */
const SCENE_DESIGN = `
${BAN}
【必须输出 · Skill 04 场景设计】
每一个场景都必须包含以下七项，缺一不可：

### 场景 XX
- **Scene Goal（场景目标）**：
- **角色目标**：
- **隐藏冲突**：（表面在做什么 vs 实际在争什么）
- **视觉信息**：（观众通过画面知道什么，不用台词）
- **情绪变化**：（进入时 → 离开时）
- **场景转折**：
- **离开时观众知道什么**：

【场景规则】
每个场景必须满足至少一项：① 改变人物状态 ② 提供新的信息。
两条都不满足的场景必须合并或删除——并在文末说明你删掉了哪些场景。
`

/** Skill 05 · 摄影指导（ASC） */
const CINEMATOGRAPHY = `
${BAN}
【必须输出 · Skill 05 摄影设计】
## Camera（每个关键镜头/镜头组）
- **Lens**：
- **Camera Height**：
- **Movement**：
- **Composition**：
- **Depth of Field**：

## Lighting
- **Light Source**：
- **Color Temperature**：
- **Contrast（光比）**：
- **Mood**：

## Visual Meaning（为什么这样拍）
逐条解释上面的决定。格式必须是「不是…而是…」：
- 例：低机位——不是"酷"，而是强化人物的力量感，让观众处于被支配的视角。
- 例：长焦压缩——不是"虚化背景"，而是把人物压在环境之上，表达他无处可逃。
`

/** Skill 06 · 美术指导（Production Design） */
const PRODUCTION_DESIGN = `
${BAN}
【必须输出 · Skill 06 Visual Bible】
## World Design（世界观）
- **Architecture**（建筑）：
- **Material**（材质）：
- **Technology**（技术）：
- **Social Structure**（社会结构）：
- **Color Language**（色彩语言，含色相倾向与出现场景）：

## Character Design（人物）
| 角色 | Silhouette（剪影） | Shape Language（形状语言） | Clothing（服装） | Texture（肌理） | Symbol（象征） |
|---|---|---|---|---|---|

## Prop Design（关键道具）
逐个分析道具的**叙事意义**（不是外观描述）：
- **道具名**：承担什么叙事功能？出现时机？在片首/中/尾的状态变化？
`

/** Skill 07 · 分镜导演（Pixar / Disney） */
const STORYBOARD = `
${BAN}
【必须输出 · Skill 07 分镜】
禁止直接"生成画面"。流程必须是：**剧本 → 镜头目的 → 分镜**。
每个镜头先回答"这一镜要解决什么问题"，再写画面。

每个镜头必须包含：
- **Shot Number**：
- **Purpose（镜头目的）**：（必须回答：它推进了哪条信息或情绪）
- **Shot Size**：
- **Camera**：
- **Character Action**：
- **Emotion**：
- **Transition**：

文末必须输出严格合法 JSON 代码块（\`\`\`json），结构：
{"shots":[{"no":1,"start":0,"end":5,"duration":5,"sceneNo":1,"shotSize":"","angle":"","camera":"","lens":"","movement":"","composition":"","subject":"","action":"","expression":"","environment":"","lighting":"","color":"","material":"","sound":"","emotion":"","transition":"","promptZh":"","promptEn":""}]}
JSON 必须能被 JSON.parse 直接解析：不要注释、不要尾随逗号、不要省略号。
`

/** Skill 08 · AI 视频提示词工程 */
const AI_PROMPT = `
${BAN}
【核心原则】Prompt 不是描述画面，Prompt 是**控制生成**。
结构（顺序不可乱）：
Subject + Action + Environment + Camera + Lighting + Motion + Material + Atmosphere + Quality

【视频必须增加 Timeline 分段】
每个视频镜头都要写出时间轴，描述三件事：人物动作变化 / 摄影机运动 / 环境变化。
- **Timeline 0-3s**：…
- **3-6s**：…
- **6-10s**：…

【提示词必须可直接粘贴使用】
不要写"电影感镜头"这类无效词——写 "ARRI Alexa 65，32mm 球面定焦，T2.8，浅景深，24fps，2.39:1，胶片颗粒"。
`

/** Skill 09 · 连续性管理（Continuity Supervisor） */
const CONTINUITY = `
${BAN}
【必须输出 · Skill 09 Continuity Bible（连续性圣经）】
## 人物
| 角色 | 外貌 | 年龄 | 服装 | 伤痕/标记 |
|---|---|---|---|---|

## 环境
| 场景 | 时间 | 光线 | 空间关系 |
|---|---|---|---|

## 道具
| 道具 | 所在位置 | 状态 | 在哪些镜头出现 |
|---|---|---|---|

## 连续性规则
列出生成下一镜头前**必须检查**的 6-8 条规则（例如"主角左手腕的旧表在所有镜头中必须存在且位置一致"）。
`

/** Skill 10 · 声音设计（Walter Murch） */
const SOUND = `
${BAN}
【必须按六层拆分】Dialogue / Environment / Foley / Atmosphere / Music / Silence
每层说明：本片该层**做什么**、**不做什么**、出现位置。

【核心原则】声音必须服务叙事，不是加音效。
反例：未来城市 ≠ 加入机械声。
正例：未来城市 = "没有人的城市中，自动系统持续运转的声音"——空无本身才是信息。

## 声音设计
每一层给出：设计意图 / 具体做法 / 出现时间码。
`

/** Skill 11 · 剪辑导演（Walter Murch + 苏联蒙太奇） */
const EDITING = `
${BAN}
【必须按六个剪辑因素逐条分析】
1. Emotion（情绪）
2. Story（故事）
3. Rhythm（节奏）
4. Eye Trace（视线轨迹）
5. Screen Direction（画面方向 / 轴线）
6. Continuity（连续性）

【每个关键剪辑点必须给出】
| Shot Duration | Cut Reason | Emotional Effect | Transition Method |
|---|---|---|---|
`

/** Skill 12 · 导演审核 Agent */
const REVIEW = `
${BAN}
【必须输出 · Skill 12 导演审核】
五项评分，每项 /10，并给出理由与证据：

| 维度 | 评分 | 理由（必须引用方案中的具体内容） |
|---|---|---|
| **Story**（故事） | /10 | … |
| **Direction**（导演） | /10 | … |
| **Visual**（视觉） | /10 | … |
| **Emotion**（情感） | /10 | … |
| **Originality**（原创性） | /10 | … |

规则：
- 任一维度低于 7/10，**必须**提出具体修改方案（改哪个镜头 / 哪个参数 / 为什么）。
- 必须引用方案中的具体内容作为证据，禁止"建议进一步优化"这类空话。
- 必须给出信心指数与最严重的 3 个问题。
`

/** Skill id → 输出契约（由编排器在调用前统一注入，避免各 Skill 重复内联） */
const CONTRACT_BY_SKILL = {
  director_analysis: DIRECTOR_VISION,
  film_history: FILM_REFERENCE,
  story_structure: STORY_STRUCTURE,
  cinematography: CINEMATOGRAPHY,
  visual_design: PRODUCTION_DESIGN,
  screenplay: SCENE_DESIGN,
  storyboard: STORYBOARD,
  continuity: CONTINUITY,
  prompt_engineering: AI_PROMPT,
  sound_design: SOUND,
  editing: EDITING,
  quality_control: REVIEW,
}

module.exports = {
  CONTRACT_BY_SKILL,
  BAN,
  DIRECTOR_VISION,
  FILM_REFERENCE,
  STORY_STRUCTURE,
  SCENE_DESIGN,
  CINEMATOGRAPHY,
  PRODUCTION_DESIGN,
  STORYBOARD,
  AI_PROMPT,
  CONTINUITY,
  SOUND,
  EDITING,
  REVIEW,
}
