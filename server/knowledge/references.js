/** Original editorial practice cards. Links are further reading, not quotations or endorsements.
 * Source descriptions reflect the linked resource, not verification of every card recommendation.
 * No runtime web requests: platform-specific behavior must be checked again before production.
 */
const source = (id, title, publisher, url, scope, verification = 'page') => ({ id, title, publisher, url, scope, checkedAt: '2026-09-23', verification })
const SOURCES = [
  source('bfi', 'Filmmaking toolkits', 'BFI', 'https://www.bfi.org.uk/get-funding-support/bfi-network/filmmaking-toolkits', '短片与制片工具包入口；不是所有地区的发行或法律标准'),
  source('arri', 'Lighting Handbook（含中文版入口）', 'ARRI', 'https://www.arri.com/en/learn-help/lighting/lighting-handbook', '摄影灯光学习；实拍设备参数不等于生成模型保证'),
  source('resolve', 'DaVinci Resolve 官方培训', 'Blackmagic Design', 'https://www.blackmagicdesign.com/au/products/davinciresolve/training', '剪辑、调色、声音与后期训练；软件版本须另核对'),
  source('screenskills', 'Scripted film and TV skills checklists', 'ScreenSkills', 'https://www.screenskills.com/skills-checklists/scripted-film-and-tv/', '剧组岗位与技能清单；本轮仅检索索引确认入口', 'search-index'),
  source('wai', 'Planning Audio and Video Media', 'W3C WAI', 'https://www.w3.org/WAI/media/av/planning/', '字幕、描述和文字稿的前期规划；不是对成片的合规认证'),
  source('runway', 'Gen-4 Video Prompting Guide', 'Runway', 'https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide', '指定模型版本的提示词指南，不能泛化为所有平台规则'),
  source('afi', 'AFI Catalog', 'American Film Institute', 'https://aficatalog.afi.com/', '美国电影史档案入口，不代表全球电影史全覆盖', 'search-index'),
  source('academy', 'Screenwriting activities guide', 'Academy of Motion Picture Arts and Sciences', 'https://www.oscars.org/sites/oscars/files/complete_screen_writing_activities_guide.pdf', '历史编剧教学资料；不是最新征稿或投稿规则', 'search-index'),
  source('dawg', 'Framework FAQs', 'Documentary Accountability Working Group', 'https://www.docaccountability.org/frameworkfaqs', '纪录片责任与伦理框架；不是当地法律意见', 'search-index'),
  source('aces', 'About ACES 2', 'ACES Documentation', 'https://docs.acescentral.com/background/about-aces-2/', '色彩管理技术背景；项目须明确采用的版本与变换', 'search-index'),
  source('blender', 'Animation & Rigging — Blender 3.6 Manual', 'Blender', 'https://docs.blender.org/manual/en/3.6/animation/index.html', '版本固定的动画与绑定手册入口；不是最新软件功能清单', 'search-index'),
]
const DOMAINS = [
  ['development', '创意与剧作'], ['research', '电影史与题材研究'], ['performance', '表演与调度'],
  ['camera', '摄影与灯光'], ['art', '美术与视觉资产'], ['storyboard', '分镜与动画'],
  ['continuity', '空间与连续性'], ['ai', 'AI生成与迭代'], ['sound', '声音制作'],
  ['post', '剪辑与调色'], ['production', '制片与交付'], ['access', '可访问性与伦理'],
].map(([id, name]) => ({ id, name }))
const c = (id, title, domain, stages, tags, method, deliverable, check, pitfall, sourceIds) => ({ id, title, domain, stages: stages.split(' '), tags: tags.split(' '), method, deliverable, check, pitfall, sourceIds: sourceIds.split(' '), provenance: '原创实操建议；来源为延伸阅读，不是逐句引文' })
const CARDS = [
  c('goal', '目标、阻碍与代价', 'development', 'director_analysis story_structure screenplay', '目标 冲突 剧情 故事', '用可被拍到的行动说明主角想得到什么、谁阻止他、失败会失去什么；把抽象主题转成选择。', '一句核心冲突和一条不可逆选择。', '删掉主题词后，观众还能从行为理解冲突吗？', '把世界观介绍当作故事推进。', 'academy bfi'),
  c('scene-turn', '场景价值转折', 'development', 'story_structure screenplay', '场景 转折 剧本 节拍', '记录每场开头与结尾的关系、信息或资源差异；没有变化的场次考虑合并。', '场次表：进入状态、争取行动、转折、离开状态。', '这场被删掉后，后续选择是否仍然成立？', '每场都争吵，但人物处境没有改变。', 'academy'),
  c('reveal', '悬念、伏笔与信息差', 'development', 'story_structure screenplay editing', '悬疑 伏笔 反转 惊悚', '分别列角色与观众已知信息；先放可见线索，再延迟解释，反转后检查前文是否可重读。', '线索—出现镜头—误读—回收表。', '反转能被已有证据支持，而非临时增加规则吗？', '靠隐瞒关键画面制造不公平谜底。', 'academy bfi'),
  c('short-form', '短片与竖屏的信息密度', 'development', 'director_analysis story_structure screenplay', '短片 竖屏 广告 短视频 开场', '从正在发生的决定或异常开始；优先保留一次清楚的情绪变化，按叙事价值分配时长。', '开场承诺、核心变化、结尾回响各一句。', '首个有效动作是否被到达、走路、等待拖延？', '把长片结构等比例压缩为说明书。', 'bfi'),
  c('reference-method', '从参考片提取机制而非复制外观', 'research', 'film_history director_analysis', '参考 影片 风格 导演', '分别记录可观察的镜头事实、个人解释及迁移方案；换人物和场景后检查方法是否仍成立。', '参考片段—时间码—观察—推断—本片用法卡。', '能否用镜头关系解释效果，而不仅说像某导演？', '把主观读解写成导演亲口表达。', 'afi bfi'),
  c('history-source', '电影史事实核验', 'research', 'film_history quality_control', '电影史 年代 档案 年份 出品', '片名、年份、版本、主创分别核对；区分首映年与地区上映年，缺证据时保留待核验标记。', '事实条目与档案链接、核验日期。', '作品版本与年份口径是否一致？', '用二手风格描述推断拍摄事实。', 'afi'),
  c('documentary', '纪录片访谈与证据链', 'research', 'film_history screenplay director_analysis', '纪录片 访谈 纪实 真实人物', '区分亲历、转述和推测；围绕具体事件提问，保留原始语境，补画面不能冒充同期证据。', '采访问题、证据来源、需补拍的观察清单。', '剪辑后是否改变受访者原意，重演是否明确标注？', '为戏剧冲突预设真实人物的动机。', 'dawg bfi'),
  c('culture', '地方文化与历史质感', 'research', 'film_history visual_design screenplay', '历史 地方 民俗 方言 时代 文化', '分别建立生活器物、劳动方式、语言和仪式证据；对不熟悉的群体请有经验者复核。', '时代地点表与仍待核实的文化细节。', '人物是否有具体生活，而非仅作为地域符号？', '用单一影片或旅游图像代表整个文化。', 'bfi dawg'),
  c('playable-action', '把情绪改写为可表演动作', 'performance', 'screenplay storyboard director_analysis', '表演 情绪 演员 愤怒 压抑', '用劝服、试探、遮掩、阻止等行动组织表演；以呼吸、握力、停顿和注意力表现强度。', '每个表演节拍的对象、行动与身体证据。', '不写情绪形容词，演员或生成模型还能执行吗？', '只提高音量，把所有强度都写成大喊。', 'screenskills bfi'),
  c('subtext', '对白潜台词与反应', 'performance', 'screenplay storyboard', '对白 潜台词 对话 关系', '写出人物说什么、想让对方做什么、不能承认什么；保留听者的判断与延迟反应。', '对白、真实意图、无声反应三列表。', '关闭字幕后，关系变化还有可见证据吗？', '双方轮流解释设定，没有行动目的。', 'academy'),
  c('blocking', '多人调度与权力关系', 'performance', 'screenplay cinematography storyboard', '调度 多人 群戏 站位 权力', '先画入口、出口和人物站位；让距离、高低和遮挡随关系变化，不让机位替代调度理由。', '场景平面草图与关键站位变化。', '每次移动是否改变信息、关系或动作可见性？', '人物为配合镜头无理由地来回走。', 'screenskills bfi'),
  c('performance-takes', '表演版本与情绪连续', 'performance', 'screenplay continuity quality_control', '表演 版本 情绪 连续 反应', '给关键节拍设计克制、外露等少量可比较版本；记录镜头前后身体状态与情绪余量。', '表演基线、变体、接续条件。', '切到反打时呼吸、疲劳和反应阶段接得上吗？', '每个镜头都达到最大强度，导致没有层次。', 'screenskills'),
  c('lens-distance', '焦段、机距与透视', 'camera', 'cinematography storyboard', '焦段 镜头 透视 特写 广角', '把焦段、机距和主体尺寸一起设计；改变视角时明确是否允许人物比例与背景关系变化。', '关键镜头的机位、景别、焦段意图。', '空间夸张来自视点变化还是仅写了镜头名？', '把某一焦段标签当作固定情绪按钮。', 'arri'),
  c('motivated-light', '有动机的光源与负补光', 'camera', 'cinematography visual_design', '灯光 光源 夜景 室内 阴影', '先标出窗、灯具或天空的方向，再决定柔硬与明暗分区；保留光线对故事信息的选择。', '主光方向图、明暗分区与跨镜头基准。', '人物换机位后光源位置仍合理吗？', '每个方向都补亮，使空间与情绪变平。', 'arri'),
  c('exposure-color', '曝光、肤色与混合光', 'camera', 'cinematography visual_design quality_control', '曝光 肤色 色温 混合光 高光', '先确定要保留的高光和肤色层次，再检查环境光色差；生成图也需逐帧检查面部与窗口细节。', '参考帧和可接受的高光、暗部范围说明。', '亮部是否丢信息，肤色是否在切镜时无理由漂移？', '用整体滤镜掩盖光源逻辑冲突。', 'arri aces'),
  c('camera-motive', '运镜理由与可剪接终点', 'camera', 'cinematography storyboard editing', '运镜 跟拍 推镜 摇镜 长镜头', '每次运动只承担明确的信息揭示或关系变化；设计起点、速度变化、停点与后续接镜。', '运镜路径和运动结束后的有效画面。', '改成固定机位会损失什么叙事信息？', '持续漂移、没有落点，导致后期难接。', 'arri resolve'),
  c('visual-bible', '视觉圣经的固定项与变动项', 'art', 'visual_design continuity', '美术 视觉圣经 材质 风格 色板', '分别定义几何、材料、色板和磨损；哪些永远固定、哪些随剧情变化要分开记录。', '场景与角色视觉基准、禁改项、变化规则。', '风格词能否落实到具体表面与物体？', '只有情绪板，没有可复现的细节。', 'screenskills'),
  c('costume-props', '服装与道具状态台账', 'art', 'visual_design continuity storyboard', '服装 道具 伤痕 污渍 手表', '为重要物件编号，记录持有者、左右手、朝向、磨损与损坏时间；服装以层次和扣合状态描述。', '道具状态表与服装连续照需求。', '道具状态改变是否有明确动作或场次原因？', '把磨损、污渍、伤痕当随机装饰。', 'screenskills'),
  c('asset-views', '角色与场景多视图资产', 'art', 'visual_design prompt_engineering', '资产 三视图 角色 场景 参考图', '先确认正侧背身份一致，再做表情和姿态；场景用平面布局与关键反向视角补足单图盲区。', '角色基准、场景坐标图、物件比例参考。', '反向机位能否解释同一房间，而不是新房间？', '把互相矛盾的九宫格都当真值。', 'blender runway'),
  c('world-material', '世界观的材料与使用痕迹', 'art', 'visual_design film_history', '科幻 奇幻 武侠 废墟 未来 材料', '从生产方式、维修、气候和阶层推导材料与磨损，给幻想世界保留日常使用逻辑。', '材料—用途—维护方式—人物关系表。', '物体为什么在这里，谁使用和修理它？', '只叠加霓虹、齿轮或古纹，世界缺乏因果。', 'screenskills bfi'),
  c('coverage', '覆盖镜头与剪辑保险', 'storyboard', 'storyboard cinematography editing', '分镜 覆盖 主镜 反打 空镜', '先保证动作与空间可理解，再安排反应、插入和转场；补镜必须有明确剪辑用途。', '主镜、动作细节、反应、连接镜头清单。', '每个关键信息是否至少有一个可用镜头？', '景别很多却漏掉决定性动作。', 'bfi resolve'),
  c('screen-direction', '轴线、视线与运动方向', 'storyboard', 'storyboard continuity editing', '轴线 视线 方向 越轴 对话 追逐', '先确定人物关系轴和运动轴；越轴若为有意表达，设计可理解的过渡镜头或运动。', '机位侧别与视线目标表。', '反打时人物是否像看向彼此，追逐方向是否清楚？', '机械禁止越轴，或无意越轴却称为风格。', 'screenskills resolve'),
  c('animatic', '动画预演与时间分配', 'storyboard', 'storyboard editing story_structure', '动画 预演 animatic 节奏 时长', '先用低成本静帧与临时声音验证信息阅读时间；再确定镜头长度和精细生成顺序。', '带时间码的预演版与修改清单。', '只看预演能否理解动作因果和情绪转折？', '精修全部画面后才发现节奏不成立。', 'blender resolve'),
  c('action-phases', '动作拆相与物理接触', 'storyboard', 'storyboard prompt_engineering', '动作 接触 手部 动画 打斗', '拆为准备、接触、受力、结果；明确接触点、重心和物体位移，复杂动作分镜验证。', '动作关键相位与接触状态图。', '接触前后位置、力量方向和物体状态一致吗？', '一个短镜头同时塞进过多互相冲突的动作。', 'blender runway'),
  c('space-lock', '房间坐标与不可变几何', 'continuity', 'continuity storyboard prompt_engineering', '房间 空间 坐标 桌子 几何 一致', '用固定墙面、门窗和家具坐标建立真值；相机移动不改变场景布局，冲突参考图需标记剔除。', '固定布局、机位位置、允许变化的对象。', '所有镜头能否投回同一张平面图？', '每个漂亮镜头都隐含不同房间。', 'screenskills blender'),
  c('state-transition', '人物与物体状态转换', 'continuity', 'continuity storyboard quality_control', '连续性 状态 拿起 放下 手部', '逐镜记录入镜状态、改变状态的动作和出镜状态；新状态必须由上一镜或明确省略建立。', '角色、道具、环境三类状态转移表。', '下一镜开头是否继承上一镜结尾的可见事实？', '只写保持一致，没有记录具体状态。', 'screenskills'),
  c('time-weather', '时间、天气与光照连续', 'continuity', 'continuity cinematography visual_design', '时间 天气 日出 雨 雪 光照', '标记故事时间与拍摄顺序的区别；记录湿度、雨量、积雪、太阳方向和光色变化动机。', '场次时间线与环境状态基准。', '同一时段是否出现没有解释的干湿或影子变化？', '用不同天气增加美感却破坏时间感。', 'arri screenskills'),
  c('identity-lock', '角色身份与跨镜头漂移', 'continuity', 'continuity prompt_engineering quality_control', '角色 身份 一致 脸型 发型 年龄', '固定少量可区分的身份特征和参考资产版本；把姿态、表情、伤痕变化与身份特征分开。', '角色ID、稳定特征、资产版本、变化事件。', '遮住服装后是否仍能认出同一人物？', '依赖同一姓名或随机种子保证所有平台一致。', 'runway screenskills'),
  c('model-contract', '按模型版本核对生成约束', 'ai', 'prompt_engineering director_analysis quality_control', '平台 模型 Seedance Sora 可灵 Runway 生成', '记录实际模型版本、输入类型和已实测限制；参考官方指南，未知参数不编造，先做一镜试验。', '版本、日期、输入、限制、实测结果表。', '限制来自当前模型文档还是旧平台印象？', '把统一提示词模板视为所有模型的协议。', 'runway'),
  c('motion-prompt', '图生视频的动作增量', 'ai', 'prompt_engineering storyboard', '图生视频 动作 提示词 镜头', '先核对输入图已有事实，再描述需要发生的主体、环境或相机运动；避免同时要求相反运动。', '起始状态、单一主要变化、结束状态。', '模型能否区分相机运动和人物运动？', '重复堆砌静态形容词却不说明事件。', 'runway'),
  c('iteration', '单变量迭代与失败记录', 'ai', 'prompt_engineering quality_control', '迭代 失败 重试 测试 生成', '每轮只改变一个主要变量，保存输入资产、完整提示词、参数和失败标签，用一致标准比较。', '候选矩阵与保留、重做、弃用原因。', '本轮改善能否追溯到具体变化？', '同时换模型、参考图和提示词，无法复现。', 'runway bfi'),
  c('text-composite', '文字、界面与复杂细节后期合成', 'ai', 'prompt_engineering visual_design editing', '文字 屏幕 UI 标志 合成', '先生成稳定底板与透视空间，把要求精确的字幕、屏幕文字或标志安排在后期合成。', '底板、遮罩、跟踪点和后期叠加清单。', '精确文本是否可单独修订而不用重做整个镜头？', '不断重抽整镜，只为修正一行字。', 'resolve blender'),
  c('sound-map', '声源、空间与听觉视点', 'sound', 'sound_design screenplay', '声音 声源 空间 听觉 环境', '区分可见声源、画外声与主观听觉；随人物视点决定距离、遮挡和信息优先级。', '对白、环境、动作、音乐分层声音地图。', '闭眼能否理解空间变化与关键动作？', '每层同时抢占前景，主次不明。', 'resolve'),
  c('dialogue-edit', '对白清晰度与房间底噪', 'sound', 'sound_design editing quality_control', '对白 噪声 录音 人声 降噪', '优先保持语义和自然呼吸，再处理噪声；剪点用匹配的房间底声衔接，避免过度降噪。', '对白编辑、底噪与需补录段落清单。', '小音量播放时关键词可懂，剪点不突兀吗？', '追求绝对安静造成声音发水或呼吸断裂。', 'resolve'),
  c('foley', '拟音的材质、重量与动作同步', 'sound', 'sound_design storyboard', '拟音 脚步 道具 接触 材质', '按表面、力度与动作阶段设计拟音；关键接触对齐画面，不同距离保留透视差异。', '接触事件—材质—时间码—声音层表。', '听起来的重量是否与画面物体一致？', '每次接触套同一大音效，失去真实尺度。', 'resolve'),
  c('music-silence', '音乐动机与有意静默', 'sound', 'sound_design editing', '音乐 静默 节奏 情绪 配乐', '先确定哪些情绪由表演承担；用音乐进入、退出和动机变化组织关系，而非全程铺底。', '音乐提示表与需保留的静默段落。', '去掉音乐后，场景自身仍成立吗？', '音乐替人物表演解释每个情绪。', 'resolve bfi'),
  c('cut-intent', '剪点的注意力与因果', 'post', 'editing storyboard', '剪辑 剪点 节奏 反应 匹配', '每次切换回答观众此刻需要看什么；比较动作切、反应切和声音先行对信息理解的影响。', '剪点理由与替代剪法对照。', '每个切点是否推进理解、感受或视点？', '只跟音乐节拍切，忽略人物动作未完成。', 'resolve'),
  c('color-pipeline', '色彩管理与镜头匹配', 'post', 'editing cinematography quality_control', '调色 色彩管理 ACES LUT 色差', '先确认输入、工作与输出色彩空间，再匹配曝光与白平衡，最后做风格处理并检查目标显示环境。', '色彩管线说明和关键镜头匹配参考。', '是否重复应用变换，风格LUT是否被误当校正？', '混用不同来源画面但不记录输入解释方式。', 'aces resolve'),
  c('vfx-handoff', '合成与后期交接', 'post', 'editing visual_design prompt_engineering', '合成 VFX 遮罩 抠像 跟踪', '为需合成的镜头记录帧范围、尺寸、相机运动、遮挡和版本；先用粗合成验证边缘与透视。', '镜头交接单、底板与元素命名规则。', '重新打开项目能否定位每个镜头的正确素材？', '只交一段压缩视频，没有版本和帧范围。', 'resolve blender'),
  c('export-qc', '导出后完整观看与技术检查', 'post', 'editing quality_control', '导出 黑帧 音画同步 帧率 交付', '检查实际导出文件而不只看时间线；核对开尾、字幕、黑帧、音画同步、缺失媒体和播放器兼容性。', '交付文件、版本号、检查日志与发现的问题。', '目标设备上是否从头到尾看过实际文件？', '把渲染成功等同于成片验收。', 'resolve wai'),
  c('scope-budget', '资源约束与镜头优先级', 'production', 'director_analysis story_structure quality_control', '预算 工期 资源 制片 复杂', '按故事价值、失败风险和制作成本排列镜头；先验证最难且不可替代的镜头，再扩大制作。', '必保镜头、可简化镜头、备选方案。', '高风险镜头失败时是否有仍能讲清故事的替代？', '平均分配预算，关键镜头没有返工余量。', 'bfi'),
  c('version-assets', '资产命名、版本与备份', 'production', 'continuity editing quality_control', '版本 备份 文件 资产 管理', '按项目、场次、镜头和版本命名；已确认资产只读保留，交接记录依赖并抽样测试恢复。', '资产清单、版本标识、备份与恢复记录。', '能否从记录复现被批准的那一版？', '最终版、最终版2混用，覆盖唯一原件。', 'screenskills bfi'),
  c('release-package', '发行材料与多版本交付', 'production', 'director_analysis editing quality_control', '发行 电影节 预告 海报 交付', '先向接收方确认当期要求，再准备正片、字幕、剧照、简介和技术说明；不同画幅单独复核。', '交付清单及每个接收方的核对日期。', '材料中的时长、标题、字幕版本是否一致？', '将某个平台的要求当成通用发行标准。', 'bfi wai'),
  c('review-loop', '评审问题转为可验证修改', 'production', 'quality_control director_analysis', '审核 反馈 修改 验收 复核', '把不好看、不感人等反馈拆成具体时间码、观察和假设；修改后按原问题复看，区分偏好与错误。', '问题—证据—修改—复测结果表。', '意见落实后是否引入新的连续性或节奏问题？', '只追求审核分数上涨，不看实际成片。', 'bfi'),
  c('captions', '字幕、说话人和重要声音', 'access', 'editing sound_design quality_control', '字幕 无障碍 聋 听障 文字稿', '在前期预留字幕位置与制作时间；校对对白、说话人及必要声音信息，并在目标屏幕检查遮挡。', '校对字幕、时间轴与文字稿。', '不听声音能否理解必要信息，字幕是否挡住关键动作？', '把自动转写未校对结果直接交付。', 'wai'),
  c('audio-description', '口述影像与视觉信息转述', 'access', 'screenplay sound_design quality_control', '口述影像 视障 描述 无障碍', '在规划阶段识别只能靠画面获得的信息；为描述留空间，优先说明影响理解的动作和变化。', '关键视觉信息表与描述时段计划。', '不看画面能否理解关键选择与结果？', '描述所有装饰细节却漏掉决定性动作。', 'wai'),
  c('consent-context', '真实人物、授权与再现边界', 'access', 'director_analysis screenplay quality_control', '真实人物 授权 同意 纪录片 肖像 声音', '记录素材来源、同意范围和使用条件；拟真再现与重演作清楚区分，发布前由适任人员复核争议项。', '来源与许可待核查台账、再现标识计划。', '是否把未核验的生成画面当成真实事件证据？', '把可下载或能生成误认为已经获得使用许可。', 'dawg bfi'),
  c('inclusive-review', '受众差异与敏感内容复核', 'access', 'film_history director_analysis quality_control', '受众 儿童 文化 刻板 印象 闪烁', '邀请相关经验者复看代表性与理解障碍；识别强闪烁、刺激性声音和敏感主题，按发布环境安排专项检查。', '受众反馈、内容提示和待专业检测项目。', '是否把某个群体简化为单一反派或笑料？', '以主创自认为无害代替实际受众反馈。', 'wai dawg'),
]

function searchReferences({ query = '', stage = '', domain = '', limit = 48 } = {}) {
  const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 20)
  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(CARDS.length, Math.floor(Number(limit)))) : 48
  return CARDS.filter(card => (!stage || card.stages.includes(stage)) && (!domain || card.domain === domain))
    .map(card => {
      const text = [card.title, ...card.tags, card.method, card.deliverable, card.check, card.pitfall].join(' ').toLowerCase()
      const hits = terms.filter(term => text.includes(term))
      return { ...card, score: hits.length, hits }
    }).filter(card => !terms.length || card.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, cap)
}

function selectReferences(brief, stage, limit = 3) {
  const text = String(brief || '').toLowerCase()
  const pool = CARDS.filter(card => card.stages.includes(stage))
  return pool.map(card => ({ ...card, score: card.tags.reduce((sum, tag) => sum + (text.includes(tag.toLowerCase()) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.min(5, limit)))
}

function referenceText(brief, stage, budget = 1800) {
  const cap = Number.isFinite(budget) ? Math.max(0, Math.min(2400, Math.floor(budget))) : 1800
  const heading = '【扩展实操参考】以下为原创编辑建议，不是来源原文。按本片约束取舍，不把参考当成事实或平台保证。\n'
  let text = heading
  for (const card of selectReferences(brief, stage)) {
    const sources = card.sourceIds.map(id => SOURCES.find(s => s.id === id)).filter(Boolean)
    const block = `\n[${card.id}] ${card.title}\n方法：${card.method}\n交付：${card.deliverable}\n检查：${card.check}\n误区：${card.pitfall}\n延伸阅读：${sources.map(s => `${s.title} ${s.url}`).join('；')}\n`
    if (text.length + block.length <= cap) text += block
  }
  return text === heading ? '' : text
}
module.exports = { SOURCES, DOMAINS, CARDS, searchReferences, selectReferences, referenceText }
