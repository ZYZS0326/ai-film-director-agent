/**
 * Skill: continuity — 连续性管理（Continuity Supervisor）
 * 来源：Film Script Supervisor Workflow
 *
 * 位置：分镜之后、提示词之前。
 * 原因：AI 生成的头号失败就是「跨镜头不一致」——
 *       连续性圣经是提示词工程的上游输入，必须在生成提示词之前锁定。
 */

module.exports = {
  id: 'continuity',
  name: '连续性管理',
  role: '场记 / 连续性监督',
  stage: 8,
  outputKey: 'continuity',
  description: '建立 Continuity Bible：人物（外貌/年龄/服装/伤痕）、环境（时间/光线/空间关系）、道具（位置/状态），并输出生成下一镜头前必须检查的连续性规则',
  triggers: ['连续性', '一致', 'continuity', '场记', '穿帮', '角色一致', '连贯'],
  systemPrompt: `你是场记 / 连续性监督（Script Supervisor）。

你的职责是**让这部片子在镜头之间不穿帮**。在真人剧组里，这条纪律由场记用 Continuity Bible 保证；
在 AI 生成流程里，它的重要性被放大十倍——因为 AI 每次生成都是独立的，**稍不描述就会漂移**。

铁律：
1. 记录必须**具体到可被复述的字符串**，不是感觉。
   ❌ "穿深色外套" → ✅ "灰蓝色硬挺风衣，粗糙棉质，下摆及膝，左袖口有 3cm 磨破"
2. 每个条目都要能直接写进提示词——如果写不进去（太抽象），说明记录不合格。
3. 必须标注**变化**：同一个元素在哪些镜头发生了变化（服装变化是人物弧线的证据，不是穿帮）。
4. 必须给出「生成下一镜头前必须检查」的规则清单，供后续环节逐条核对。
5. 禁止空话。禁止"保持一致"——必须说清**保持什么、怎么保持**。

输出 Markdown，不要一级标题。`,

  buildPrompt(ctx) {
    return `【故事 Brief】
${ctx.brief}

【剧本】
${(ctx.prior.screenplay || '').slice(0, 3000)}

【分镜（连续性必须逐镜核对）】
${(ctx.prior.storyboard || '').slice(0, 2500)}

【视觉圣经（色彩/材质/服装）】
${(ctx.prior.visualBible || '').slice(0, 1500)}

【摄影方案（光线与色温必须在镜头间一致）】
${(ctx.prior.cinematography || '').slice(0, 1200)}

【制作规格】
${ctx.constraintsText}


【最后必须输出】
## 提示词复用片段
给出一段**可直接粘贴进每一镜提示词开头**的固定描述（中文 + 英文各一版），
包含人物、服装、关键道具、主场景材质与色彩。
说明：为什么必须逐字复用（同义词替换会导致 AI 编码出不同视觉特征）。

\`\`\`json
{
  "lockZh": "...",
  "lockEn": "...",
  "characters": [{ "name": "", "appearance": "", "age": "", "clothing": "", "marks": "" }],
  "environments": [{ "scene": "", "time": "", "light": "", "spatial": "" }],
  "props": [{ "name": "", "position": "", "state": "", "shots": "" }],
  "rules": ["..."]
}
\`\`\``
  },

  demo(ctx) {
    const k = ctx.knowledge
    const ar = k.aspectRatio
    const shots = ctx.priorShots || []
    const shotRefs = shots.length
      ? shots.map((s) => `Shot ${String(s.no).padStart(2, '0')}`).join('、')
      : '全片各镜'

    const lockZh = '一名 30 多岁的东亚男性，短而凌乱的黑发，胡茬未剃，灰蓝色硬挺风衣（粗糙棉质，下摆及膝，左袖口 3cm 磨破），内搭深灰高领，左手腕戴磨损的旧机械表，体型清瘦，肩线略微下垂'
    const lockEn = 'a man in his 30s, East Asian, short messy black hair, unshaven stubble, a stiff grey-blue trench coat (rough cotton, knee-length hem, 3cm frayed left cuff), dark grey turtleneck, worn vintage mechanical watch on left wrist, lean build, slightly drooping shoulders'

    return `## Continuity Bible

### 人物
| 角色 | 外貌 | 年龄 | 服装 | 伤痕/标记 |
|---|---|---|---|---|
| 主角 | 短乱黑发、胡茬未剃、清瘦、肩线略垂 | 30 代 | 灰蓝硬挺风衣（粗糙棉质，下摆及膝）+ 深灰高领 | 左袖口 3cm 磨破；左手腕旧机械表 |
| 环境人物（若有） | 无个性特征、统一中性灰着装 | 各异 | 化纤质地、无装饰 | 无 |

### 环境
| 场景 | 时间 | 光线 | 空间关系 |
|---|---|---|---|
| 废墟广场 | 黎明 | 5600K 冷色散射光，单一动机光源 | 开阔，人物位于画面下三分之一 |
| 日出光源区 | 日落 | 3200K 琥珀色斜射，长阴影 | 唯一暖色区域，人物第一次被完全照亮 |
| 封闭空间 | 夜 | 单一冷白光源，局部亮区 | 幽闭，墙面紧贴人物 |

### 道具
| 道具 | 位置 | 状态 | 出现镜头 |
|---|---|---|---|
| 旧机械表 | 主角左手腕 | 磨损、表盘细密划痕、皮表带边缘开裂 | ${shotRefs}（全片可见） |
| 风衣 | 主角身上 | 初期扣紧，情绪爆发后解开最上一颗扣 | 全片 |

### 连续性规则（生成下一镜头前必须逐条核对）
1. 主角风衣**必须始终为灰蓝色**，不得因光影变化被渲染成深灰或黑色。
2. 旧机械表在所有镜头中**必须可见于左手腕**，位置与磨损程度一致。
3. 所有日戏为 5600K 冷色散射光；唯一例外是日出段落（3200K），且只能出现一次。
4. 前 4 镜主角面部**不得被完全照亮**——光照进度本身就是叙事。
5. 场景材质固定为清水混凝土 + 锈蚀金属，禁止出现木材或玻璃幕墙。
6. 画幅 ${ar.name} 全片统一，不使用画幅变化。
7. 风衣扣子状态：情绪爆发点之前扣紧，之后解开——这是唯一的服装变化，不得提前。
8. 若使用 AI 生成，每镜提示词**必须逐字复用**下方的锁定片段，不得替换同义词。

## 提示词复用片段

**中文（逐字粘贴到每镜提示词开头）**
${lockZh}

**EN（paste verbatim at the start of every shot prompt）**
${lockEn}

> **为什么必须逐字复用**：AI 模型对描述做的是语义采样，"灰蓝色硬挺风衣"与"深灰色大衣"
> 会被编码成不同的视觉特征向量，导致角色在不同镜头间漂移。
> 一致性靠的是**字符串级别的重复**，不是语义相近。

\`\`\`json
${JSON.stringify({
      lockZh,
      lockEn,
      characters: [
        { name: '主角', appearance: '短乱黑发、胡茬未剃、清瘦、肩线略垂', age: '30 代', clothing: '灰蓝硬挺风衣 + 深灰高领', marks: '左袖口 3cm 磨破；左手腕旧机械表' },
      ],
      environments: [
        { scene: '废墟广场', time: '黎明', light: '5600K 冷色散射光，单一动机光源', spatial: '开阔，人物位于画面下三分之一' },
        { scene: '日出光源区', time: '日落', light: '3200K 琥珀色斜射，长阴影', spatial: '唯一暖色区域' },
      ],
      props: [
        { name: '旧机械表', position: '主角左手腕', state: '磨损、表盘划痕、表带开裂', shots: shotRefs },
        { name: '风衣', position: '主角身上', state: '初期扣紧，爆发后解开一颗扣', shots: '全片' },
      ],
      rules: [
        '风衣始终灰蓝色，不得渲染成深灰或黑色',
        '旧机械表在所有镜头可见且磨损程度一致',
        '日戏 5600K；日出段落 3200K 且仅一次',
        '前 4 镜面部不得被完全照亮',
        '材质固定为清水混凝土 + 锈蚀金属',
        '画幅 ' + ar.name + ' 全片统一',
        '风衣扣子状态：爆发前扣紧、爆发后解开，不得提前',
        '每镜提示词逐字复用锁定片段',
      ],
    }, null, 2)}
\`\`\``
  },
}
