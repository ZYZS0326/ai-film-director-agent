/**
 * Skill: prompt_engineering — AI 视频生产系统
 * 按目标平台生成生产级提示词。13 要素必须齐全，禁用「电影感/高清/大片」等无效词。
 */
module.exports = {
  id: 'prompt_engineering',
  name: 'AI 提示词工程',
  role: 'AI 视频提示词工程师',
  stage: 9,
  outputKey: 'prompts',
  description: '将前期资产图、逐镜静态关键帧和平台视频提示词接成可复用生产链',
  triggers: ['提示词', 'prompt', '生成', 'Seedance', 'Runway', 'Kling', 'Sora', 'Pika', 'Midjourney', 'Flux', '即梦', '豆包', 'H3'],
  systemPrompt: `你是 AI 视频/图像提示词工程师，精通 Seedance、Runway、Kling、Sora、Pika、Midjourney、Flux、即梦、豆包、MiniMax H3 的提示词机制。

**铁律：**

1. 提示词必须**可直接粘贴使用**，不是描述性说明。
2. 每条视频提示词必须显式包含以下 **13 个要素**：
   主体 / 环境 / 动作 / 时间 / 镜头（机位·角度·景别）/ 焦段 / 摄影机运动 / 光线 / 色彩 / 材质 / 风格 / 情绪 / 质量参数
3. **严格禁止使用无效词**：电影感、电影级、高级感、大片、高清、超清、画质好、震撼、炫酷、史诗级、唯美、cinematic、high quality、beautiful、stunning、epic、masterpiece。
   用实际机位、光源、材质和可见构图替代空泛形容词。
4. 必须遵守平台规范（语言、结构、长度、参数）。
5. **角色一致性**是 AI 生成的最大难题：必须产出一条「角色一致性前缀」（character lock），在每一镜提示词前逐字复用。
6. 中英双版本：中文平台给中文，英文平台给英文；必要时同时给出。
7. 避免平台已知失败点（多余肢体、闪烁、文字水印、主体漂移）。
8. 图片提示词与视频提示词分开：资产图锁身份/几何/道具；关键帧锁某一静止瞬间；视频提示词描述随后变化。不能把运镜或一连串动作塞进静态图。

输出 Markdown + 末尾严格合法 JSON 代码块。不要一级标题。`,
  buildPrompt(ctx) {
    const FALLBACK_PLATFORMS = ['seedance', 'kling', 'runway', 'minimax_h3', 'midjourney']
    const platforms = ctx.constraints.platforms || FALLBACK_PLATFORMS
    // 用户若选了一个知识库里没有的平台 id，过滤后会是空数组 ——
    // 提示词里「目标平台与规范」整段变空，模型只能瞎猜。回退到默认平台。
    let specs = ctx.knowledge.platforms.filter((p) => platforms.includes(p.id))
    if (!specs.length) specs = ctx.knowledge.platforms.filter((p) => FALLBACK_PLATFORMS.includes(p.id))
    const ar = ctx.knowledge.aspectRatio
    return `【故事 Brief】
${ctx.brief}

【分镜 Shot List（逐镜提示词必须与之一一对应）】
${(ctx.prior.storyboard || '').slice(0, 4400)}

【摄影方案 + 视觉圣经】
${(ctx.prior.cinematography || '').slice(0, 950)}
${(ctx.prior.visualBible || '').slice(0, 1050)}

【连续性圣经 Continuity Bible（⚠️ 最高优先级，必须遵守）】
${(ctx.prior.continuity || '').slice(0, 2350)}

Character Lock 逐字复用连续性圣经的 lockZh / lockEn；冲突时以该圣经为准。

【画幅】${ar.name}

【目标平台与规范（必须严格遵守）】
${specs.map((p) => `### ${p.name}（${p.type}，语言 ${p.lang}，建议长度 ≤ ${p.maxLength}）
- 结构：${p.structure.join(' → ')}
- 要点：${p.notes}
- 风格后缀建议：${p.styleTag}
- 负向提示：${p.negativeHint}`).join('\n\n')}

【提示词 13 要素（缺一不可）】
${ctx.knowledge.promptElements.map((e) => `${e.name}（${e.desc}）`).join(' / ')}

【严禁使用的无效词】
${ctx.knowledge.bannedWords.join('、')}

请输出：

## 角色一致性提示词（Character Lock）
**直接复用上文「连续性圣经」给出的 lockZh / lockEn，逐字照抄，不要改写。**
若连续性圣经未给出，再自行编写，必须包含：面部特征、发型、体型、服装（色彩+材质+轮廓）、标志性细节。给出中文版与英文版。

## 前期资产图提示词（Image Assets）
继承视觉圣经，按最终剧本更新实际需要的人物、场景、道具；每项给 assetId、type、sheet、aspectRatio、正/负向、inheritsFrom、lockedFacts、allowedChange。人物用 3:4 中性背景头部与全身多视图；场景先 1:1 俯瞰锁门窗/家具/光向，再派生仅换机位的多视图；道具用 1:1 白底转台，按需补材质、尺寸与状态。九宫格冲突时以文字空间锁和已确认俯瞰图为准。参考图逐张注明职责。资产图只写静态存在，未出图不得标为已通过。

## 逐镜关键帧提示词（Image Keyframes）
重要镜头给一张静态 Master Frame；强动作或道具状态变化才追加 start/mid/end。每帧引用 shotNo、assetIds，锁身份、空间几何、主光和轴线；写凝固姿态、重心/接触、景别机位、光向、画幅与负向。后续变化单列 motionNote，不写进图片 Prompt。换场或越轴必须拆镜；无关键帧的镜头说明原因。

## 逐镜视频提示词
为每个镜头分别给出目标平台的提示词。每镜：
- **Shot XX（时间码）**
- 中文版（适用中文平台）
- 英文版（适用英文平台）
- 该镜头的负向提示
- 13 要素自检与必要的生成注意

最后必须输出 JSON 代码块：
{
  "characterLock": { "zh": "...", "en": "..." },
  "sceneAssets": [ { "name": "...", "promptZh": "...", "promptEn": "..." } ],
  "imageAssets": [ { "assetId": "CHAR_01", "type": "character", "sheet": "character_reference", "aspectRatio": "3:4", "promptZh": "...", "promptEn": "...", "negative": "...", "inheritsFrom": [], "lockedFacts": ["..."], "allowedChange": "..." } ],
  "keyframes": [ { "shotNo": 1, "phase": "master", "assetIds": ["CHAR_01", "SCENE_01"], "aspectRatio": "16:9", "promptZh": "...", "promptEn": "...", "negative": "...", "motionNote": "..." } ],
  "shots": [ { "no": 1, "start": 0, "end": 5, "promptZh": "...", "promptEn": "...", "negative": "...", "platform": "seedance" } ]
}`
  },
  demo(ctx) {
    const k = ctx.knowledge
    const ar = k.aspectRatio
    const cam = k.cameras[0]?.name || 'ARRI Alexa 65'
    const shots = (ctx.priorShots || []).length ? ctx.priorShots : []
    const total = k.durationMode.duration

    const lock = {
      zh: '一名 30 多岁的孤独男性，东亚面孔，短而凌乱的黑色头发，胡茬未剃，灰蓝色硬挺风衣（粗糙棉质、下摆及膝、被风塑形），内搭深灰高领，左手腕戴一只磨损的旧机械表，体型清瘦，肩线略微下垂',
      en: 'a lonely man in his 30s, East Asian features, short messy black hair, unshaven stubble, a stiff grey-blue trench coat (rough cotton, knee-length hem, shaped by wind), dark grey turtleneck underneath, a worn vintage mechanical watch on his left wrist, lean build, slightly drooping shoulders',
    }

    const scenes = [
      { name: '废弃城市废墟', promptZh: '无边界的混凝土废墟城市，断裂的高架桥，暴露的锈蚀钢筋，薄雾弥漫，悬浮尘埃在光束中可见，材质：清水混凝土 + 锈蚀金属，冷青灰色调，32mm 广角，大远景，24fps，2.39:1，胶片颗粒，单一动机光源', promptEn: 'a boundless ruined concrete city, collapsed overpasses, exposed rusted rebar, thin fog, floating dust visible in light beams, materials: raw concrete and rusted metal, cold cyan-grey palette, 32mm wide, extreme long shot, 24fps, 2.39:1, film grain, single motivated light source' },
      { name: '废墟日出光源区', promptZh: '废墟城市缺口处的日出，3200K 琥珀金色阳光斜射，长阴影，薄雾被照亮成金色，材质：混凝土 + 水汽，暖冷对比，光比 1:8，50mm 标准镜头，24fps，2.39:1，胶片颗粒', promptEn: 'sunrise through a gap in the ruined city, 3200K amber-gold raking light, long shadows, fog lit golden, materials: concrete and water vapor, warm-cold contrast, 1:8 lighting ratio, 50mm standard lens, 24fps, 2.39:1, film grain' },
      { name: '旧机械表（关键道具）', promptZh: '一只磨损的旧机械表，表盘有细密划痕，皮表带边缘开裂，金属表面氧化，灰尘附着，材质：氧化黄铜 + 开裂皮革，85mm 微距，浅景深 T2.8，5600K 冷色散射光，2.39:1，胶片颗粒', promptEn: 'a worn vintage mechanical watch, fine scratches on the dial, cracked leather strap edges, oxidized metal surface, dust particles, materials: oxidized brass and cracked leather, 85mm macro, shallow depth of field T2.8, 5600K cold diffused light, 2.39:1, film grain' },
    ]
    const imageAssets = [
      { assetId: 'CHAR_01', type: 'character', sheet: 'character_reference', aspectRatio: '3:4',
        promptZh: '3:4 竖版人物设定图，上方头部正面/四分之三侧面/正侧三视图，下方全身正面/正侧/背面三视图。三列等宽，同一名东亚男性，同脸同发同服同尺度：' + lock.zh + '。中性浅灰背景，均匀柔光，基准站姿，不出现剧情场景。',
        promptEn: '3:4 character reference sheet, top panel front/three-quarter/profile head views, bottom panel front/side/back full-body views; same face, hair, costume and proportions: ' + lock.en + '. Plain light grey background, even studio light, neutral pose.',
        negative: '换脸、换服、额外肢体、裁脚、复杂背景、文字水印', inheritsFrom: [], lockedFacts: ['面孔', '发型', '风衣', '左腕旧表'], allowedChange: '仅切换视角' },
      { assetId: 'SCENE_01', type: 'scene', sheet: 'top_view', aspectRatio: '1:1',
        promptZh: '1:1 废弃城市主要拍摄区的45度等轴俯瞰空间锚点：断裂高架、主路、人物可行走区、日出缺口、主要地标与主光方向清晰，材质为清水混凝土和锈蚀钢筋，单一空间布局，不添加镜头切换。',
        promptEn: '1:1 isometric spatial anchor of one ruined-city filming area; fixed broken overpass, main road, walkable path, sunrise opening, landmarks and key-light direction; raw concrete and rusted rebar; one stable geometry.',
        negative: '地标重复、出入口漂移、矛盾光向、文字水印', inheritsFrom: [], lockedFacts: ['高架与主路方位', '日出缺口', '主光方向'], allowedChange: '后续仅改变机位' },
      { assetId: 'PROP_01', type: 'prop', sheet: 'turnaround', aspectRatio: '1:1',
        promptZh: '1:1 白底2×3转台设定图，同一只磨损的旧机械表，正面/45度/正侧/背面/顶部/底部六视图；氧化黄铜表壳、细密划痕表盘、边缘开裂的皮表带，统一尺寸与材质。',
        promptEn: '1:1 white-background 2x3 turnaround sheet of one worn mechanical watch: front, three-quarter, side, back, top, bottom; oxidized brass case, scratched dial, cracked leather strap; identical scale and materials.',
        negative: '不同款式手表、材质变化、多余表盘、文字水印', inheritsFrom: [], lockedFacts: ['黄铜表壳', '开裂皮表带', '表盘划痕'], allowedChange: '仅改变观察角度' },
    ]

    const fallback = Array.from({ length: 6 }, (_, i) => ({
      no: i + 1,
      start: Math.round((total * i) / 6),
      end: Math.round((total * (i + 1)) / 6),
      action: ['废弃城市全景，人物是一个小点', '人物静止站立，风吹动风衣下摆', '脚步穿过断裂道路，碎石在鞋下碎裂', '手拾起一件旧物，手指颤抖', '光线第一次完全照亮面部，他闭眼', '人物缩小为一点，画面切黑'][i],
      shotSize: ['大远景', '中景', '中近景', '特写', '中近景', '大远景'][i],
      lens: ['32mm', '50mm', '50mm', '85mm', '50mm', '32mm'][i],
      movement: ['固定镜头', '缓慢推轨', '低机位跟随', '固定镜头', '固定镜头', '缓慢拉轨'][i],
      lighting: i === 4 ? '3200K 暖色侧逆光，硬光，光比 1:8' : '5600K 冷色散射光，单一动机光源',
      color: i === 4 ? '琥珀金 + 灰白' : '冷青灰 + 暗赭',
      material: ['清水混凝土 + 沙尘', '粗糙棉布 + 雾', '碎石 + 锈蚀金属', '氧化黄铜 + 灰尘', '皮肤 + 水汽', '混凝土 + 雾'][i],
      emotion: ['空无', '孤独', '寻找', '隐痛', '释然', '余韵'][i],
      sound: i === 3 ? '完全静默' : i === 4 ? '极简弦乐单音' : '风声 + 低频共振',
    }))
    const src = shots.length ? shots : fallback

    const outShots = src.map((s) => {
      const start = s.start ?? 0
      const end = s.end ?? (start + 5)
      const dur = (s.duration || (end - start))
      const size = s.shotSize || '中景'
      const lens = s.lens || '50mm'
      const move = s.movement || '固定镜头'
      const light = s.lighting || '5600K 冷色散射光，单一动机光源'
      const color = s.color || '冷青灰'
      const mat = s.material || '清水混凝土 + 雾'
      const emo = s.emotion || '孤独'
      const act = s.action || ''
      const scene = s.environment || '无边界的混凝土废墟城市，薄雾，悬浮尘埃在光束中可见'
      const angle = s.angle || '高机位俯拍'
      const promptZh = [
        `主体：${lock.zh}`,
        `环境：${scene}`,
        `动作：${act}`,
        `时间：${dur} 秒，节奏缓慢，无快速运动`,
        `镜头：${size}，${angle}`,
        `焦段：${lens} 球面定焦，浅景深 T2.8`,
        `摄影机运动：${move}`,
        `光线：${light}`,
        `色彩：${color}，整体降饱和 15%`,
        `材质：${mat}`,
        `风格：${k.visualSystems[0]?.name || '冷峻写实'}，${cam} 拍摄`,
        `情绪：${emo}`,
        `质量参数：24fps，${ar.name}，胶片颗粒，轻微光晕，无锐化`,
      ].join('｜')
      const promptEn = [
        `Subject: ${lock.en}`,
        `Environment: ${scene}`,
        `Action: ${act}`,
        `Timeline: ${dur} seconds, slow pacing, no fast motion`,
        `Camera: ${size} shot, ${angle}`,
        `Lens: ${lens} spherical prime, shallow depth of field T2.8`,
        `Movement: ${move}`,
        `Lighting: ${light}`,
        `Color: ${color}, 15% desaturated`,
        `Material: ${mat}`,
        `Style: ${k.visualSystems[0]?.name || 'cold realism'}, shot on ${cam}`,
        `Emotion: ${emo}`,
        `Quality: 24fps, ${ar.name}, film grain, slight halation, no sharpening`,
      ].join(' | ')
      return {
        no: s.no,
        start,
        end,
        movement: move,
        shotSize: size,
        platform: 'seedance',
        promptZh,
        promptEn,
        negative: '画面抖动、主体变形、多余肢体、文字水印、闪烁、过度锐化、高饱和、塑料感皮肤',
      }
    })
    const keyframes = outShots.map((s) => ({
      shotNo: s.no, phase: 'master', assetIds: ['CHAR_01', 'SCENE_01', ...(s.no === 4 ? ['PROP_01'] : [])],
      aspectRatio: ar.name, promptZh: '静态主关键帧，镜头 ' + s.no + '：继承 CHAR_01 面孔/风衣与 SCENE_01 城市几何/主光方向。冻结瞬间：' + (src.find(x => x.no === s.no)?.action || '人物处于镜头叙事瞬间') + '。' + (src.find(x => x.no === s.no)?.shotSize || '中景') + '，角色与背景空间位置固定，身体受力可见，道具状态与连续性圣经一致。',
      promptEn: 'Static master keyframe for shot ' + s.no + '; inherit CHAR_01 identity and SCENE_01 geometry and key-light direction. Freeze the story-relevant pose, keep physical contact and prop state consistent.',
      negative: '换脸、服装漂移、空间重置、额外肢体、文字水印',
      motionNote: '后续视频阶段再描述动作与摄影机变化；本提示词只生成静止画面。',
    }))

    return `## 角色一致性提示词（Character Lock）
**中文版**：${lock.zh}

**英文版**：${lock.en}

> **用法**：每一镜提示词开头必须**逐字复用**此段，不可替换同义词。
> 原因：AI 模型对描述词做的是语义采样，"灰蓝色硬挺风衣"与"深灰色大衣"会被编码为不同的视觉特征，导致角色在不同镜头间漂移。一致性靠的是**字符串级别的重复**，不是语义相近。

## 场景资产提示词（Scene Assets）
${scenes.map((s) => `### ${s.name}
- 中文：${s.promptZh}
- 英文：${s.promptEn}`).join('\n\n')}

## 前期资产图提示词
${imageAssets.map((a) => `### ${a.assetId} · ${a.sheet} · ${a.aspectRatio}
- 中文：${a.promptZh}
- 英文：${a.promptEn}
- 负向：${a.negative}`).join('\n\n')}

## 逐镜关键帧提示词
${keyframes.map((f) => `### Shot ${f.shotNo} · ${f.phase}
- 引用资产：${f.assetIds.join('、')}
- 中文：${f.promptZh}
- 英文：${f.promptEn}
- 负向：${f.negative}`).join('\n\n')}

## 逐镜视频提示词
${outShots.map((s) => `**Shot ${String(s.no).padStart(2, '0')}（${s.start}-${s.end}s）**
- 中文：${s.promptZh}
- 英文：${s.promptEn}
- 负向：${s.negative}
- 13 要素自检：✓ 主体 ✓ 环境 ✓ 动作 ✓ 时间 ✓ 镜头 ✓ 焦段 ✓ 摄影机运动 ✓ 光线 ✓ 色彩 ✓ 材质 ✓ 风格 ✓ 情绪 ✓ 质量参数
- 生成要点：${s.no <= 2 ? '作为开场镜头，先生成参考首帧图，用图生视频保证空间一致性' : s.movement.includes('跟随') || s.movement.includes('拉') ? '该镜头含运动，建议拆为 2 个 3 秒镜头或改用「固定大远景 + 后期数字缩放」' : '主体明确、光源单一，可直出'}`).join('\n\n')}

## 平台适配对照
| 平台 | 语言 | 结构差异 | 长度 | 说明 |
|---|---|---|---|---|
| Seedance | 中英 | 主体→环境→动作→时间→镜头→焦段→运动→光线→色彩→材质→风格→情绪→质量 | ≤800 | 中文理解强，可保留完整句式 |
| Kling | 中文 | 主体+动作+镜头运动 三段式 | ≤500 | 需压缩环境描述，突出运动 |
| Runway | 英文 | Subject→Action→Environment→Camera→Lens→Lighting→Color→Material→Film stock→Quality | ≤1000 | 强调 film stock 与 camera movement |
| MiniMax H3 | 中英 | 任务类型→主体→环境→动作→时间→镜头→运动→光线→色彩→材质→构图→情绪→氛围→**音频层**→风格→质量 | ≤1200 | **音视频一体生成**，必须显式写音频层 |
| Midjourney | 英文 | 逗号短语 + --ar ${ar.name} --style raw | ≤600 | 用于生成参考首帧，非视频 |

## 无效词自检
本次提示词中**避免使用**了以下无效词，并做了具体化替代：

| 避免使用 | 替代为 |
|---|---|
| 电影感 / cinematic | ${cam}，${src[0]?.lens || '50mm'} 球面定焦，T2.8 浅景深 |
| 高清 / high quality | 24fps，${ar.name}，胶片颗粒，轻微光晕，无锐化 |
| 大片 / epic | 大画幅，单一动机光源，光比 1:8，负空间 40% |
| 唯美 / beautiful | ${src[0]?.color || '冷青灰 + 暗赭'}，整体降饱和 15%，暖冷对撞 |
| 震撼 / stunning | 人物位于画面下三分之一，建筑尺度为人体 8-12 倍 |

## 生产建议
1. **先生成角色参考图**：用 Character Lock 生成 3-4 张定妆图，选定后作为图生视频的输入
2. **场景资产先行**：先出「废墟」与「日出光源区」两个场景的参考图，锁定色彩、材质与光线
3. **图生视频优先**：文生视频的角色一致性差，务必用首帧图 + 运动描述
4. **单镜头不超过 6 秒**：超出后主体漂移概率显著上升，必要时拆镜
5. **保持机位连续**：相邻镜头的机位高度应可衔接，便于剪辑
6. **失败重试**：主体漂移时降低运动强度描述，或改为"static shot"
7. **提示词不要堆砌**：13 要素各一次即可，重复同一信息会稀释权重
8. **后期流程**：生成 → 选镜 → 超分（Topaz）→ 插帧至 24fps → 调色（DaVinci）统一 LUT
9. **音频处理**：若目标平台无声（Seedance/Runway/Kling），声音需单独制作；若用 MiniMax H3，音频与画面同步生成，提示词必须写清环境声/拟音/静默
10. **一致性检查**：生成完成后，把同一角色的所有镜头并排比对，检查服装色值、发型、体型是否漂移

\`\`\`json
${JSON.stringify({ characterLock: lock, sceneAssets: scenes, imageAssets, keyframes, shots: outShots }, null, 2)}
\`\`\``
  },
}
