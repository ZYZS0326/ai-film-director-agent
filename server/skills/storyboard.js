/**
 * Skill: storyboard — 专业分镜（Shot List）
 * 逐镜输出：编号/时间/景别/角度/机型/焦段/运动/构图/主体/动作/表情/环境/光线/色彩/材质/声音/情绪/转场/AI提示词
 * 末尾输出严格 JSON，供前端渲染分镜卡片。
 */
module.exports = {
  id: 'storyboard',
  name: '分镜设计',
  role: '分镜师',
  stage: 7,
  outputKey: 'storyboard',
  description: '生成专业 Shot List，每镜含完整摄影与情绪参数、材质、AI 提示词，并附可解析 JSON',
  triggers: ['分镜', '镜头', 'shot', 'storyboard', 'shotlist', '分镜头', '镜头表'],
  systemPrompt: `你是分镜师（Storyboard Artist），同时具备剪辑思维。

要求：
1. 每个镜头必须包含：编号、时间码、时长、景别、角度、机型、焦段、运动、构图、主体、动作、表情、环境、光线、色彩、材质、声音、情绪、转场、AI 提示词。
2. **镜头必须有变化与递进**：禁止连续 3 个镜头使用相同景别或相同运动；景别、角度、运动要形成节奏曲线。
3. **每个镜头必须推进信息或情绪**，不允许纯装饰镜头。若某个镜头只能提供"美感"，删掉它。
4. 单镜时长必须适配 AI 生成能力：通常 2-6 秒，最长不超过 8 秒。
5. 必须严格遵守给定的画幅比例——构图描述要体现该比例的特性。
6. 镜头总数必须与时长模式匹配（参考给定的镜头数区间）。
7. 必须在文末输出严格合法的 JSON 代码块（\`\`\`json ... \`\`\`），结构如下：
{
  "shots": [
    {
      "no": 1, "start": 0, "end": 5, "duration": 5,
      "sceneNo": 1, "shotSize": "大远景", "angle": "高机位俯拍",
      "camera": "ARRI Alexa 65", "lens": "32mm", "movement": "固定镜头",
      "composition": "...", "subject": "...", "action": "...", "expression": "...",
      "environment": "...", "lighting": "...", "color": "...", "material": "...",
      "sound": "...", "emotion": "...", "transition": "硬切",
      "promptZh": "...", "promptEn": "..."
    }
  ]
}
JSON 必须能被 JSON.parse 直接解析：不要注释、不要尾随逗号、不要省略号。

输出 Markdown（分镜表 + 设计说明）+ 末尾 JSON 块。不要一级标题。`,
  buildPrompt(ctx) {
    const ar = ctx.knowledge.aspectRatio
    const dm = ctx.knowledge.durationMode
    return `【故事 Brief】
${ctx.brief}

【剧本（分镜必须与之一一对应）】
${(ctx.prior.screenplay || '').slice(0, 4000)}

【摄影方案（规格必须严格遵守）】
${(ctx.prior.cinematography || '').slice(0, 2200)}

【视觉圣经（色彩与材质必须严格遵守）】
${(ctx.prior.visualBible || '').slice(0, 1800)}

【画幅与时长约束】
画幅：${ar.name}（${ar.label}）
构图要求：${ar.composition}
镜头要求：${ar.lens}
时长模式：${dm.label}（${dm.duration}s），建议镜头数 ${dm.shots}

【知识库摄影规格（Shot List 里的机型/焦段/景别/运镜必须从中选择，不要自行编造）】
${ctx.knowledge.contextText}

【制作规格】
${ctx.constraintsText}

请输出：

## 分镜设计说明
- 镜头总数与总时长
- 景别分布曲线（各景别占比）
- 节奏设计：每个段落的镜头语言策略（一句话）
- 与画幅 ${ar.name} 的适配说明

## 景别与运动分布
| 段落 | 镜头数 | 主要景别 | 主要运动 | 节奏 |

## Shot List
| Shot | 场景 | 时间 | 时长 | 景别 | 角度 | 镜头 | 运动 | 画面内容 | 光线/色彩/材质 | 声音 | 情绪 |

## 剪辑与转场设计
说明镜头之间如何连接，并解释节奏设计（哪些地方用硬切、哪些用动作剪辑、哪里留静默）。

## 一致性说明
说明跨镜头必须保持一致的角色/场景/光线/色彩/材质参数。

最后必须输出 JSON 代码块。`
  },
  demo(ctx) {
    const dm = ctx.knowledge.durationMode
    const ar = ctx.knowledge.aspectRatio
    const k = ctx.knowledge
    const total = Number(ctx.constraints?.duration) || dm.requested || dm.duration
    const plan = [
      { size: '大远景', angle: '高机位俯拍', move: '固定镜头', sub: '废弃城市全景，人物是一个小点', emo: '空无', mat: '清水混凝土 / 沙尘' },
      { size: '中景', angle: '平视', move: '缓慢推轨', sub: '人物静止站立，风吹动风衣下摆', emo: '孤独', mat: '粗糙棉布 / 雾' },
      { size: '中近景', angle: '低机位仰拍', move: '低机位跟随', sub: '脚步穿过断裂道路，碎石在鞋下碎裂', emo: '寻找', mat: '碎石 / 锈蚀金属' },
      { size: '特写', angle: '俯拍', move: '固定镜头', sub: '手拾起一件旧物，手指颤抖', emo: '隐痛', mat: '磨损金属 / 灰尘' },
      { size: '中近景', angle: '侧逆光', move: '固定镜头', sub: '光线第一次完全照亮面部，他闭眼', emo: '释然', mat: '皮肤 / 水汽' },
      { size: '大远景', angle: '高机位', move: '缓慢拉轨', sub: '人物缩小为一点，画面切黑', emo: '余韵', mat: '混凝土 / 雾' },
    ]
    const sampleDuration = Math.min(total, 8 * plan.length)
    let t = 0
    const shots = plan.map((p, i) => {
      const start = t
      const end = Math.round(sampleDuration * (i + 1) / plan.length * 1000) / 1000
      t = end
      const isKey = i === 4
      return {
        no: i + 1,
        sceneNo: Math.min(plan.length, i + 1),
        start,
        end,
        duration: end - start,
        shotSize: p.size,
        angle: p.angle,
        camera: k.cameras[0]?.name || 'ARRI Alexa 65',
        lens: p.size === '特写' ? '85mm' : p.size === '大远景' ? '32mm' : '50mm',
        movement: p.move,
        composition: `${ar.name} 画幅；人物位于画面下三分之一，负空间占 40% 以上`,
        subject: '穿着灰蓝风衣的孤独者',
        action: p.sub,
        expression: i < 2 ? '面无表情，视线向下' : i === 3 ? '眉头收紧，屏息' : isKey ? '眼睛缓慢闭合' : '平静',
        environment: '无边界的混凝土废墟，薄雾，悬浮尘埃',
        lighting: isKey ? '3200K 暖色侧逆光，硬光，光比 1:8' : '5600K 冷色散射光，单一动机光源',
        color: isKey ? '琥珀金 + 灰白' : '冷青灰 + 暗赭',
        material: p.mat,
        sound: i === 3 ? '完全静默 2 秒' : isKey ? '极简弦乐单音进入' : '风声 + 低频共振',
        emotion: p.emo,
        transition: i === plan.length - 1 ? '淡出黑场' : '硬切',
        promptZh: `废弃城市废墟中的孤独者，${p.sub}，${p.size}，${p.angle}，${p.move}，${k.cameras[0]?.name || 'ARRI Alexa 65'} 拍摄，${p.size === '特写' ? '85mm' : p.size === '大远景' ? '32mm' : '50mm'} 球面定焦，浅景深 T2.8，${isKey ? '3200K 日出暖色侧逆光' : '5600K 冷青灰散射光'}，材质：${p.mat}，自然雾气，胶片颗粒，${ar.name}，24fps`,
        promptEn: `A lonely figure in a ruined city, ${p.sub}, ${p.size} shot, ${p.angle}, ${p.move}, shot on ARRI Alexa 65, ${p.size === '特写' ? '85mm' : '32mm'} spherical prime, shallow depth of field T2.8, ${isKey ? '3200K warm sunrise backlight' : '5600K cold cyan-grey diffused light'}, materials: ${p.mat}, natural fog, film grain, ${ar.name}, 24fps`,
      }
    })

    const sizeStats = {}
    shots.forEach((s) => { sizeStats[s.shotSize] = (sizeStats[s.shotSize] || 0) + 1 })

    return `## 分镜设计说明
> 演示模板：以下为固定示例镜头，用于展示分镜格式，不是按当前故事创作的完整分镜。接入模型后可生成实际方案。
共 ${shots.length} 个示例镜头，实际合计 ${shots.reduce((sum, s) => sum + s.duration, 0)} 秒；项目目标 ${total} 秒（${dm.label}）。
景别曲线：${plan.map((p) => p.size).join(' → ')}（由远及近再拉远，形成"进入—触动—抽离"的情绪弧线）。
节奏设计：建立段（慢）→ 推进段（中）→ 停顿（静默）→ 爆发（暖光）→ 抽离（极慢）。
**画幅适配**：${ar.name} — ${ar.composition}

## 景别与运动分布
| 段落 | 镜头数 | 主要景别 | 主要运动 | 节奏 |
|---|---|---|---|---|
| 建立 | 2 | 大远景 / 中景 | 固定 + 缓推 | 慢 |
| 推进 | 2 | 中近景 / 特写 | 跟随 + 固定 | 中 |
| 爆发 | 1 | 中近景 | 固定 | 静 |
| 余韵 | 1 | 大远景 | 缓拉 | 极慢 |

## Shot List
| Shot | 场景 | 时间 | 时长 | 景别 | 角度 | 镜头 | 运动 | 画面内容 | 光线/色彩/材质 | 声音 | 情绪 |
|---|---|---|---|---|---|---|---|---|---|---|---|
${shots.map((s) => `| ${String(s.no).padStart(2, '0')} | ${s.sceneNo} | ${s.start}-${s.end}s | ${s.duration}s | ${s.shotSize} | ${s.angle} | ${s.lens} | ${s.movement} | ${s.action} | ${s.color} / ${s.material} | ${s.sound} | ${s.emotion} |`).join('\n')}

## 剪辑与转场设计
全部使用硬切，除结尾淡出黑场。
- Shot 02→03 使用**动作剪辑**（在抬脚瞬间切），使剪辑点不可见
- Shot 03→04 使用**动作剪辑**（在弯腰动作中切到特写），用动作连接景别跳跃
- Shot 04→05 前置 **2 秒完全静默**作为情绪重击点
- Shot 05→06 使用**硬切**，从特写切到大远景，制造情绪落差

## 一致性说明
以下参数跨镜头必须逐字一致：
- **角色**：灰蓝风衣、短乱发、左手腕旧表、清瘦体型
- **场景**：混凝土废墟 + 锈蚀金属，冷青灰主调
- **光线**：所有日戏为单一动机光源 + 雾气；唯一例外是 Shot 05 的暖色侧逆光
- **色彩**：冷青灰基底，仅 Shot 05 引入琥珀金
- **材质**：${[...new Set(shots.map((s) => s.material))].join('、')}
- **画幅**：${ar.name} 全片统一

\`\`\`json
${JSON.stringify({ shots }, null, 2)}
\`\`\``
  },
}
