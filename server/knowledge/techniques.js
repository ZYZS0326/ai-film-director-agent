/**
 * 技术与流程知识库
 * 剪辑手法 / 声音层 / AI 平台规范 / 剧本等级 / 时长模式 / 审查清单 / 提示词禁用词
 */

const EDITING_TECHNIQUES = [
  { id: 'match_cut', name: '匹配剪辑', desc: '用形状/动作/色彩连接两个时空，制造诗意或宿命感', cases: ['2001（骨头→飞船）', '红辣椒（现实层级穿越）'] },
  { id: 'jump_cut', name: '跳切', desc: '省略时间，制造焦躁、节奏感或时间流逝', cases: ['筋疲力尽', '社交网络（开场对话）'] },
  { id: 'cross_cut', name: '交叉剪辑', desc: '两条线并行推进，制造悬念、对比或对位', cases: ['教父（洗礼+屠杀）', '盗梦空间（多层）'] },
  { id: 'cut_on_action', name: '动作剪辑', desc: '在动作进行中切换，使剪辑点不可见，保持连贯', cases: ['绝大多数动作场面', '七武士'] },
  { id: 'smash_cut', name: '硬切冲击', desc: '从静到动、从静默到巨响的突变，制造情绪落差', cases: ['教父（枪声）', '寄生虫（暴雨）'] },
  { id: 'long_take', name: '长镜头', desc: '保留时空完整，制造沉浸、压迫或技艺展示', cases: ['人类之子（车内）', '俄罗斯方舟（全片）'] },
  { id: 'montage', name: '蒙太奇段落', desc: '压缩时间，配乐驱动，用于成长/训练/准备阶段', cases: ['洛奇（训练）', '飞屋环游记（人生）'] },
  { id: 'fade', name: '淡入淡出 / 黑场', desc: '章节分隔与情绪沉淀，让观众有时间呼吸', cases: ['2001（段落分隔）', '现代启示录'] },
  { id: 'dissolve', name: '叠化', desc: '时间流逝与记忆的经典手法，两画面共存制造诗意', cases: ['2001（骨→船）', '教父（结尾）'] },
  { id: 'step_print', name: '抽帧', desc: '让时间黏稠、情绪可感，制造梦幻或焦躁', cases: ['重庆森林', '花样年华'] },
  { id: 'speed_ramp', name: '变速（Speed Ramp）', desc: '在镜头内变速，强调瞬间或制造速度感', cases: ['斯巴达300勇士', '大侦探福尔摩斯'] },
  { id: 'rhythm_cut', name: '节奏剪辑', desc: '剪辑点踩音乐重音，用配乐驱动情绪曲线', cases: ['盗梦空间', '爆裂鼓手'] },
  { id: 'invisible_cut', name: '隐形剪辑', desc: '用遮挡/运动/黑场隐藏剪辑点，制造一镜到底的错觉', cases: ['鸟人', '1917'] },
]

const SOUND_LAYERS = [
  { id: 'drone', name: '低频持续音（Drone）', desc: '制造压迫与不安，几乎不可察觉但持续作用', cases: ['边境杀手', '银翼杀手2049'] },
  { id: 'ambience', name: '环境底噪', desc: '建立空间真实感（风、水、机器、城市）', cases: ['所有电影的基础层'] },
  { id: 'foley', name: '拟音细节', desc: '脚步、衣料、触碰，让画面可触、角色可信', cases: ['谍影重重（打斗拟音）'] },
  { id: 'silence', name: '静默', desc: '最有力的声音设计，用于情感重击前的「听觉失重」', cases: ['星际穿越（太空段落）', '寄生虫（暴雨前）'] },
  { id: 'music_theme', name: '主题旋律', desc: '重复出现建立情绪记忆，变奏标记情绪变化', cases: ['星球大战（主题）', '花样年华'] },
  { id: 'motif_sfx', name: '符号化音效', desc: '钟表、心跳、机械声作为主题符号反复出现', cases: ['盗梦空间（滴答）', '现代启示录（直升机）'] },
  { id: 'sound_bridge', name: '声音桥', desc: '声音先于画面进入下一场，连接时空或预示转折', cases: ['教父', '2001'] },
  { id: 'reverb_space', name: '空间混响', desc: '用混响大小暗示空间尺度与心理状态', cases: ['闪灵（酒店空间）', '潜行者（区域）'] },
  { id: 'subjective_sound', name: '主观声音', desc: '从角色听觉出发（耳鸣、心跳放大、声音失真）表达心理', cases: ['拯救大兵瑞恩（登陆）', '声音之形'] },
  { id: 'off_screen', name: '画外音源', desc: '声源在画面外，迫使观众想象，扩大画外空间', cases: ['闪灵', '厄舍古厦的倒塌'] },
]

/** AI 视频/图像生成平台规范 */
const PROMPT_PLATFORMS = [
  {
    id: 'seedance',
    name: 'Seedance',
    type: 'video',
    lang: 'zh+en',
    structure: ['主体', '环境', '动作', '时间/时长', '镜头（机位/焦段）', '摄影机运动', '光线', '色彩', '材质', '风格', '情绪', '质量参数', '节奏'],
    maxLength: 800,
    notes: '中文理解强，支持镜头运动描述；建议一句话一信息点，避免堆砌；明确时长与节奏。',
    styleTag: '电影感、胶片质感',
    negativeHint: '避免：画面抖动、主体变形、多余肢体、文字水印',
  },
  {
    id: 'runway',
    name: 'Runway Gen-4',
    type: 'video',
    lang: 'en',
    structure: ['Subject', 'Environment', 'Action', 'Duration', 'Camera & lens', 'Camera movement', 'Lighting', 'Color', 'Material/Texture', 'Style & film stock', 'Emotion', 'Quality'],
    maxLength: 1000,
    notes: '英文效果最佳；强调 camera movement 与 film stock；图生视频时提示词只描述「变化」。',
    styleTag: 'shot on 35mm film, cinematic',
    negativeHint: 'Avoid: morphing, flickering, extra limbs',
  },
  {
    id: 'kling',
    name: 'Kling 可灵',
    type: 'video',
    lang: 'zh',
    structure: ['主体', '动作过程', '场景环境', '镜头运动', '光影氛围', '材质细节', '画面风格', '质量参数'],
    maxLength: 500,
    notes: '中文原生，运动理解强；建议「主体+动作+镜头运动」三段式；避免复杂物理交互。',
    styleTag: '电影级画质，真实光影',
    negativeHint: '避免：畸变、闪烁、主体漂移',
  },
  {
    id: 'sora',
    name: 'Sora',
    type: 'video',
    lang: 'en',
    structure: ['Scene description', 'Subject & action', 'Camera & lens', 'Camera movement', 'Lighting', 'Color palette', 'Material', 'Atmosphere', 'Emotion', 'Duration & pacing', 'Quality'],
    maxLength: 1200,
    notes: '支持长描述与复杂场景；偏好电影术语；可用分镜式描述（shot by shot）。',
    styleTag: 'cinematic, photorealistic, shot on ARRI Alexa',
    negativeHint: 'Avoid: text artifacts, warping',
  },
  {
    id: 'pika',
    name: 'Pika',
    type: 'video',
    lang: 'en',
    structure: ['Subject', 'Action', 'Setting', 'Camera', 'Lighting', 'Material', 'Style', 'Motion strength'],
    maxLength: 400,
    notes: '简短直接；-camera 与 -motion 参数可调；适合短循环与特效镜头。',
    styleTag: 'cinematic lighting',
    negativeHint: 'Avoid: distortion, extra fingers',
  },
  {
    id: 'minimax_h3',
    name: 'MiniMax H3',
    type: 'video+audio',
    lang: 'zh+en',
    structure: [
      '任务类型（t2va / fl2va / ref2va）', '主体', '环境', '动作', '时间/时长',
      '镜头（机位/焦段）', '摄影机运动', '光线', '色彩', '材质',
      '构图', '情绪', '氛围', '音频层（对白/环境声/音乐）', '风格', '质量参数', '节奏',
    ],
    maxLength: 1200,
    notes:
      '开放权重的全模态音视频生成模型：视频与立体声同步生成，不是"先出画面再配音"。' +
      '本地部署的是 H3-Base，输出 4–15 秒 / 24fps / 默认短边 768P / 原生 32kHz 立体声；' +
      '2K 需走官方 H3-Regenerate-2K 托管接口。' +
      '三种任务：t2va（文生音视频）、fl2va（首帧/尾帧/首尾帧控制）、ref2va（全参考：≤9 图 + 3 视频 + 3 音频，素材总数 ≤12，音频不能作为唯一输入）。' +
      '复杂参考任务依赖结构化关系描述（Context-IR），简单堆砌形容词效果差。' +
      '提示词必须显式写出音频层，否则会得到无意义的环境音。' +
      '画幅支持 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16。',
    styleTag: '768P native, 24fps, cinematic, synchronized stereo audio, film grain',
    negativeHint: '避免：画面撕裂、主体漂移、口型不同步、音频与画面对不上、多余肢体、文字水印',
    tasks: [
      { id: 't2va', name: '文生音视频', input: '文本提示词' },
      { id: 'fl2va', name: '首/尾帧生音视频', input: '文本 + 0-2 张关键帧图' },
      { id: 'ref2va', name: '全参考生成/编辑', input: '文本 + 图片/视频/音频参考（≤12 个素材）' },
    ],
    endpoint: {
      local: '/v1/videos（提交返回任务 ID，随后轮询取结果）',
      hosted: 'H3-Context-IR（结构化多模态提示词）、H3-Regenerate-2K（2K 重生成）',
    },
    license:
      'MiniMax H3 Community License Agreement：年收入超过 2000 万美元的商业产品需事先书面授权；' +
      '商业服务界面需显著标注 "MiniMax H3"；不得将 H3 或其输出用于改进其他 AI 模型。',
  },
  {
    id: 'midjourney',
    name: 'Midjourney v7',
    type: 'image',
    lang: 'en',
    structure: ['Subject', 'Environment', 'Composition', 'Lighting', 'Color', 'Material', 'Style', 'Camera & lens', '--ar --style --stylize'],
    maxLength: 600,
    notes: '逗号短语式；参数置于末尾（--ar 16:9 --style raw --stylize 250）；关键词前置更重要。',
    styleTag: 'cinematic still, 35mm film grain',
    negativeHint: '--no text, watermark, extra limbs',
  },
  {
    id: 'flux',
    name: 'Flux',
    type: 'image',
    lang: 'en',
    structure: ['Detailed subject', 'Environment', 'Camera & lens', 'Lighting', 'Color', 'Texture & material', 'Style', 'Quality'],
    maxLength: 800,
    notes: '自然语言长句效果最佳；对材质与光线描述敏感；避免过度堆砌风格词。',
    styleTag: 'photorealistic, cinematic color grading',
    negativeHint: 'Avoid: oversaturation, plastic skin',
  },
  {
    id: 'jimeng',
    name: '即梦 Dreamina',
    type: 'video+image',
    lang: 'zh',
    structure: ['主体', '环境', '动作', '镜头', '光线', '色彩', '材质', '风格', '画质'],
    maxLength: 500,
    notes: '中文原生，支持首尾帧；分镜连贯性建议固定「角色一致性描述」前缀。',
    styleTag: '电影质感，超清画质',
    negativeHint: '避免：模糊、变形、多手多脚',
  },
  {
    id: 'doubao',
    name: '豆包 Doubao',
    type: 'video+image',
    lang: 'zh',
    structure: ['画面内容', '动作描述', '镜头语言', '光影', '色彩', '材质', '风格'],
    maxLength: 500,
    notes: '中文对话式描述友好；可先让模型理解故事再生成；适合快速迭代。',
    styleTag: '电影感，真实光影',
    negativeHint: '避免：文字水印、画面撕裂',
  },
]

/** 提示词 13 要素（生产级最低要求） */
const PROMPT_ELEMENTS = [
  { id: 'subject', name: '主体', desc: '谁/什么，外形特征与一致性锚点' },
  { id: 'environment', name: '环境', desc: '地点、空间尺度、天气、时间' },
  { id: 'action', name: '动作', desc: '正在发生什么，动作的起止状态' },
  { id: 'timeline', name: '时间', desc: '镜头时长、动作节奏、时间点' },
  { id: 'camera', name: '镜头', desc: '机位、角度、景别' },
  { id: 'lens', name: '焦段', desc: '具体毫米数或长焦压缩描述' },
  { id: 'movement', name: '摄影机运动', desc: '推/拉/横移/手持/稳定器/航拍等' },
  { id: 'lighting', name: '光线', desc: '光源、色温、光比、方向' },
  { id: 'color', name: '色彩', desc: '主色、配色关系、调色倾向' },
  { id: 'material', name: '材质', desc: '表面肌理（混凝土/金属/丝绸/水膜）' },
  { id: 'style', name: '风格', desc: '视觉体系或导演参考（具体，非形容词）' },
  { id: 'emotion', name: '情绪', desc: '镜头要传达的情绪' },
  { id: 'quality', name: '质量参数', desc: '分辨率、帧率、颗粒、画幅、渲染质感' },
]

/** 禁止在提示词中出现的无效词（空话） */
const BANNED_PROMPT_WORDS = [
  '电影感', '电影级', '高级感', '大片', '大片感', '高清', '超清', '4K 画质', '画质好',
  '好看', '漂亮', '震撼', '炫酷', '史诗级', '顶级', '完美', '唯美', '精美', '质感强',
  'cinematic', 'movie-like', 'high quality', 'beautiful', 'stunning', 'epic', 'masterpiece',
  'best quality', 'ultra detailed quality', 'award winning',
]

/** 剧本等级 */
const SCRIPT_LEVELS = [
  {
    id: 1, key: 'logline', name: '故事梗概',
    desc: '一句话内核 + 200-400 字故事概要。用于快速验证概念。',
    length: '200-400 字',
    contains: ['一句话内核（logline）', '故事概要', '主要人物一句话', '结局方向'],
  },
  {
    id: 2, key: 'outline', name: '场景大纲',
    desc: '按幕/段列出全部场景，每个场景一句话说明。用于结构验证。',
    length: '600-1500 字',
    contains: ['幕/段划分', '逐场一句话（编号+地点+事件）', '情绪曲线标注', '关键转折点'],
  },
  {
    id: 3, key: 'full_script', name: '完整剧本',
    desc: '标准剧本格式：场景标题、动作描述、对白，含片名/类型/主题/人物表/世界观。',
    length: '按场数展开（短片 15-40 场；长片 60-120 场）',
    contains: ['片名/类型/主题', '人物表', '世界观', 'ACT 1/2/3 划分', '逐场：场景编号、时间、地点、环境、人物、动作、对白、心理'],
  },
  {
    id: 4, key: 'pro_script', name: '专业电影剧本',
    desc: '在完整剧本基础上增加：导演备注、摄影建议、声音设计、表演调度、剪辑提示。可直接开机。',
    length: '在 Level 3 基础上每场增加 4 项技术字段',
    contains: ['Level 3 全部', '导演备注', '摄影建议', '声音设计', '表演调度', '剪辑提示'],
  },
  {
    id: 5, key: 'director_cut', name: '导演制作稿',
    desc: '在专业剧本基础上增加：分镜对应关系、AI 生成可行性标注、制作优先级、预算敏感点、拍摄顺序建议。',
    length: '在 Level 4 基础上每场增加制作执行字段',
    contains: ['Level 4 全部', '对应分镜编号', 'AI 生成可行性（可直出/需拆镜/需后期）', '制作优先级', '成本敏感点', '建议拍摄/生成顺序'],
  },
]

/** 时长模式 */
const DURATION_MODES = [
  { id: 'short_1', duration: 60, label: '1 分钟短片', mode: 'short', scenes: '4-8 场', shots: '10-20 镜', note: '单一情境 + 一次情绪转折；必须无对白或极少对白' },
  { id: 'short_3', duration: 180, label: '3 分钟短片', mode: 'short', scenes: '8-15 场', shots: '25-45 镜', note: '可容纳一个小型三幕；建议单一主角与单一冲突' },
  { id: 'short_5', duration: 300, label: '5 分钟短片', mode: 'short', scenes: '12-20 场', shots: '40-70 镜', note: '可容纳完整三幕 + 一个次要人物' },
  { id: 'short_10', duration: 600, label: '10 分钟短片', mode: 'short', scenes: '20-35 场', shots: '70-120 镜', note: '可容纳多线或一次结构性反转' },
  { id: 'mid_30', duration: 1800, label: '30 分钟中片', mode: 'medium', scenes: '35-60 场', shots: '200-350 镜', note: '完整三幕 + 配角弧线；需节奏段落设计' },
  { id: 'feature_60', duration: 3600, label: '60 分钟长片', mode: 'feature', scenes: '60-90 场', shots: '400-700 镜', note: '标准电视电影/流媒体规格' },
  { id: 'feature_90', duration: 5400, label: '90 分钟电影', mode: 'feature', scenes: '90-120 场', shots: '600-1000 镜', note: '标准院线规格；需完整人物弧线与副线' },
  { id: 'feature_120', duration: 7200, label: '120 分钟电影', mode: 'feature', scenes: '120-160 场', shots: '900-1500 镜', note: '史诗/群像规格；需多线结构与节奏管理' },
]

/** 导演审核清单（三分类） */
const QUALITY_CHECKS = [
  // ── 剧情 ──
  { id: 'conflict', category: '剧情', name: '是否有冲突', question: '每一场戏是否都有明确的冲突（人与人 / 人与环境 / 人与自我）？有没有「谁都不想要什么」的无效场景？', weight: 1.3 },
  { id: 'motivation', category: '剧情', name: '人物是否有动机', question: '主角的每个关键行动是否都有可被观众理解的动机？动机是内在的还是靠外部事件推动？', weight: 1.3 },
  { id: 'pacing', category: '剧情', name: '节奏是否合理', question: '情绪曲线是否有起伏？是否存在连续多场同强度导致观众疲劳？是否有必要的呼吸段落？', weight: 1.2 },
  { id: 'arc', category: '剧情', name: '人物弧线', question: '主角在片尾与片首是否是不同的人？变化是否有具体事件作为支点？', weight: 1.1 },
  { id: 'logic', category: '剧情', name: '因果逻辑', question: '事件之间的因果是否自洽？有没有靠巧合强行推进的转折？', weight: 1.1 },
  // ── 视觉 ──
  { id: 'style_serves_theme', category: '视觉', name: '视觉是否服务主题', question: '每个视觉决定（色彩/光线/构图/镜头）是否都能回答「它服务哪个主题或情绪」？有没有纯装饰性的漂亮画面？', weight: 1.3 },
  { id: 'shot_variety', category: '视觉', name: '镜头是否重复', question: '是否存在连续同景别/同机位/同运动？景别与运动的分布是否形成递进而非平铺？', weight: 1.1 },
  { id: 'style_consistency', category: '视觉', name: '风格是否统一', question: '色彩体系、光线逻辑、质感在镜头之间是否一致？有没有突然的调性断裂？', weight: 1.2 },
  { id: 'narrative_density', category: '视觉', name: '是否只有画面没有叙事', question: '每个镜头是否推进了信息或情绪？能否指出每个镜头「为什么必须存在」？', weight: 1.3 },
  // ── AI 生成 ──
  { id: 'feasibility', category: 'AI生成', name: '是否现实可制作', question: '镜头复杂度、角色一致性、物理交互、单镜时长是否在目标平台能力范围内？哪些镜头需要拆解或后期替代？', weight: 1.2 },
  { id: 'character_consistency', category: 'AI生成', name: '角色一致性可控性', question: '是否提供了可复用的角色一致性前缀？跨镜头的角色描述是否严格一致？', weight: 1.1 },
  { id: 'prompt_quality', category: 'AI生成', name: '提示词生产级', question: '提示词是否包含 13 要素？是否出现「电影感/高清/大片」等无效词？是否可直接粘贴使用？', weight: 1.2 },
  { id: 'continuity', category: 'AI生成', name: '跨镜连贯性', question: '场景/光线/色彩/道具在镜头之间是否连贯？有无跳变？', weight: 1.0 },
]

module.exports = {
  EDITING_TECHNIQUES,
  SOUND_LAYERS,
  PROMPT_PLATFORMS,
  PROMPT_ELEMENTS,
  BANNED_PROMPT_WORDS,
  SCRIPT_LEVELS,
  DURATION_MODES,
  QUALITY_CHECKS,
}
