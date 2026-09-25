# 扩展参考资料库

资料库采用“来源目录 + 原创实操卡 + 按创作环节检索”的结构。外部链接供进一步阅读，不复制整本教材，也不将编辑建议表述成来源原文。

覆盖目标：创意开发、剧本、表演、摄影灯光、美术、分镜、连续性、AI生成、声音、剪辑调色、制作交付与可访问性。广覆盖不等于穷尽所有电影史、文化传统或制作标准。

## 本轮新增

48张原创实操卡，12个领域，每个领域4张；11个延伸阅读入口。旧导演、影片、风格等档案保留，并未把新卡数量冒充新增影片数量。

| 领域 | 覆盖主题 |
| --- | --- |
| 创意与剧作 | 目标阻碍代价、场景转折、悬念伏笔、短片竖屏 |
| 电影史与研究 | 参考机制提取、档案核验、纪录片证据、地方文化 |
| 表演与调度 | 可执行动作、潜台词、多人站位、表演版本 |
| 摄影与灯光 | 焦段机距、光源动机、曝光混合光、运镜落点 |
| 美术与资产 | 视觉圣经、服化道、多视图资产、世界观材料 |
| 分镜与动画 | 镜头覆盖、轴线视线、动画预演、动作接触 |
| 空间与连续性 | 房间坐标、状态转换、时间天气、角色身份 |
| AI生成与迭代 | 模型版本约束、图生视频动作、单变量迭代、文字合成 |
| 声音制作 | 声音地图、对白底噪、拟音同步、音乐静默 |
| 剪辑与调色 | 剪点意图、色彩管线、后期交接、导出检查 |
| 制片与交付 | 资源优先级、资产版本、发行材料、评审闭环 |
| 可访问性与伦理 | 字幕、口述影像、同意与再现、受众复核 |

每张卡包含方法、应产出、验收问题、常见误区、标签、适用环节、延伸阅读和内容性质说明。

## 使用方式

- 界面：知识库 → 实操参考，输入关键词或选择领域。展开卡片看完整建议；来源目录可查看机构、范围与核验程度。
- 检索API：`GET /api/knowledge/references?q=字幕&domain=access&stage=quality_control`。空查询返回全部卡片，不命中返回空列表，不假装命中。
- 生成：根据故事、修订要求和平台文字，在当前环节候选中匹配关键词，最多选3张卡。只传完整卡片，最多1800字符，并随上下文预算缩小；预算不足则省略参考，不截断链接或句子。
- 所有12个环节通过统一 `buildPrompt` 入口接收参考，预算测量和实际发送使用相同提示词；不是只在界面展示。
- 全部卡片离线可读；外部链接需要联网。运行生成不自动抓取网页，不增加外部付费调用。
- 演示模式仍使用演示模板；不宣称演示结果已吸收新卡片，也不保证模型一定遵循建议。

## 来源与核验范围

核验日期：2026-09-23。“页面”表示已读取入口页，并不表示读完其链接的所有教材；“索引”表示本轮检索索引确认，不冒充全文阅读。

| 资料入口 | 范围 | 核验 |
| --- | --- | --- |
| [BFI Filmmaking toolkits](https://www.bfi.org.uk/get-funding-support/bfi-network/filmmaking-toolkits) | 短片和制片资源目录 | 页面 |
| [ARRI Lighting Handbook](https://www.arri.com/en/learn-help/lighting/lighting-handbook) | 灯光手册，入口含中文版 | 页面 |
| [DaVinci Resolve 培训](https://www.blackmagicdesign.com/au/products/davinciresolve/training) | 剪辑、调色及声音训练 | 页面 |
| [ScreenSkills 岗位清单](https://www.screenskills.com/skills-checklists/scripted-film-and-tv/) | 剧组技能与交接 | 索引 |
| [W3C WAI 音视频规划](https://www.w3.org/WAI/media/av/planning/) | 媒体可访问性规划 | 页面 |
| [Runway Gen-4 视频指南](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide) | 指定模型版本的提示词方法 | 页面 |
| [AFI Catalog](https://aficatalog.afi.com/) | 美国电影史档案入口 | 索引 |
| [Academy 编剧教学资料](https://www.oscars.org/sites/oscars/files/complete_screen_writing_activities_guide.pdf) | 历史教学资料，非当前征稿规则 | 索引 |
| [DAWG Framework FAQs](https://www.docaccountability.org/frameworkfaqs) | 纪录片责任与伦理 | 索引 |
| [ACES 2 背景文档](https://docs.acescentral.com/background/about-aces-2/) | 色彩管理技术背景 | 索引 |
| [Blender 3.6 动画手册](https://docs.blender.org/manual/en/3.6/animation/index.html) | 固定版本的动画与绑定入口 | 索引 |

资料卡是本项目原创实践建议，不是上述机构背书或教材摘要。版权保留在原来源，仅提供链接；现有旧资料并未因此自动获得来源认证。平台规格、发行要求与授权条件均需在实际使用时重新核对。

## 维护与边界

本轮验证（2026-09-23）：17组、3128项全量检查通过，其中新增参考资料专项113项；TypeScript类型检查与前端生产构建通过。Electron 44.4.3真实界面验证通过搜索、来源目录、窄窗口及原有编辑/锁定/恢复流程，截图位于本地 `build/ui-preview/references.png`。未重新发行安装包，未测试外部模型创作质量；源码改动不会自动更新已安装的旧版exe。

数据在 `server/knowledge/references.js`。新增卡需提供唯一ID、合法领域和环节、具体方法与验收条件，以及有效的延伸阅读ID。避免只堆导演名、情绪词或平台宣传语。修改后运行 `node scripts/references-smoke.cjs`、完整测试及类型检查。

后续仍需扩充中国与非欧美电影档案的直接来源、更多类型片逐场案例、各视频模型的版本化实测。当前检索为确定性关键词匹配，不是向量检索，也不代表已经完整收录所有教材。安全动作、专业录音交付、法律许可和正式无障碍合规需要相应专业复核。
