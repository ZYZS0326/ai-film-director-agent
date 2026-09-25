/**
 * Tool Calling — 智能体可调用的确定性工具
 * 这些工具为 LLM 提供事实依据与结构化解析能力，避免模型"凭空发挥"。
 */
const kb = require('../knowledge')

const TOOLS = [
  {
    name: 'knowledge.search',
    description: '检索电影知识库全量上下文（类型/情绪/风格/导演/影片/摄影/色彩/结构/画幅/方法论）',
    run({ brief, extraTags = [], aspect, duration, level }) {
      return kb.buildKnowledgeContext({ brief, extraTags, aspect, duration, level })
    },
  },
  {
    name: 'story.analyze',
    description: 'Step1 故事分析：类型 / 情绪 / 核心冲突 / 商业定位',
    run({ brief }) {
      return kb.analyzeBrief(brief)
    },
  },
  {
    name: 'director.match',
    description: 'Step2 匹配最佳导演参考（含命中理由）',
    run({ brief, limit = 3 }) {
      const analysis = kb.analyzeBrief(brief)
      return kb.matchDirectors(analysis, limit)
    },
  },
  {
    name: 'structure.match',
    description: '匹配最佳叙事结构（含命中理由、优点、缺点、案例）',
    run({ brief, limit = 2 }) {
      const analysis = kb.analyzeBrief(brief)
      return kb.matchStructures(analysis, limit)
    },
  },
  {
    name: 'style.match',
    description: '匹配电影风格候选（含适用性理由）',
    run({ brief, limit = 4 }) {
      const analysis = kb.analyzeBrief(brief)
      return { analysis, styles: kb.matchStyles(analysis, limit) }
    },
  },
  {
    name: 'visual.match',
    description: '匹配视觉体系 / 色彩方案 / 材质方向',
    run({ brief, limit = 2 }) {
      const analysis = kb.analyzeBrief(brief)
      return {
        visualSystems: kb.matchVisualSystems(analysis, limit),
        colors: kb.matchColors(analysis, 3),
        materials: kb.matchMaterials(analysis, 3),
      }
    },
  },
  {
    name: 'ratio.apply',
    description: '画幅决策：返回该比例对构图/镜头/叙事的自动调整规则',
    run({ aspect }) {
      return kb.resolveAspectRatio(aspect)
    },
  },
  {
    name: 'spec.resolve',
    description: '解析制作规格：时长模式 + 剧本等级',
    run({ duration, level }) {
      return { durationMode: kb.resolveDurationMode(duration), scriptLevel: kb.resolveScriptLevel(level) }
    },
  },
  {
    name: 'shotlist.parse',
    description: '从分镜输出中解析结构化 Shot List（优先 JSON 块；缺失时回退解析 Markdown 表格）',
    run({ text }) {
      const fromJson = extractJSONBlock(text, 'shots')
      if (Array.isArray(fromJson) && fromJson.length) return { shots: fromJson, source: 'json' }
      const fromTable = parseShotTable(text)
      return { shots: fromTable, source: fromTable.length ? 'table' : 'none' }
    },
  },
  {
    name: 'continuity.parse',
    description: '从连续性输出中解析 Continuity Bible（锁定片段 / 人物 / 环境 / 道具 / 规则）',
    run({ text }) {
      return extractJSONBlock(text, null, true)
    },
  },
  {
    name: 'prompts.parse',
    description: '从提示词输出中解析结构化提示词数据',
    run({ text }) {
      return extractJSONBlock(text, null, true)
    },
  },
  {
    name: 'prompt.validate',
    description: '校验提示词是否含无效词（电影感/高清/大片等），并统计 13 要素覆盖情况',
    run({ text }) {
      const src = String(text || '')
      const lower = src.toLowerCase()
      const banned = kb.BANNED_PROMPT_WORDS.filter((w) => lower.includes(String(w).toLowerCase()))
      const elements = kb.PROMPT_ELEMENTS.map((e) => ({
        id: e.id, name: e.name, present: src.includes(e.name) || src.includes(e.desc),
      }))
      return { banned, elements, covered: elements.filter((e) => e.present).length, total: elements.length }
    },
  },
  {
    name: 'review.parse',
    description: '解析审查输出：按分类汇总评分',
    run({ text }) {
      return { scores: extractScores(text) }
    },
  },
]

/**
 * 尽量把 LLM 吐出的 JSON 解析出来。
 * 真实模型很常见的两种坏习惯：尾随逗号、字符串里带零宽字符/BOM。
 * 直接 JSON.parse 会失败，于是结构化数据整块丢失 —— 表现为「分镜没有输出」。
 */
function tryParseJSON(raw) {
  const s = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
  if (!s) return null
  try { return JSON.parse(s) } catch { /* 继续尝试修复 */ }
  // 去掉对象/数组结尾前的尾随逗号（"a":1,} / [1,2,]）
  const repaired = s.replace(/,(\s*[}\]])/g, '$1')
  try { return JSON.parse(repaired) } catch { /* 放弃 */ }
  return null
}

/** 从 markdown 文本中提取最后一个合法 JSON 代码块 */
function extractJSONBlock(text, key, whole = false) {
  if (!text) return null
  const src = String(text)
  const fences = [...src.matchAll(/```[ \t]*json\s*([\s\S]*?)```/gi)]
  const candidates = fences.length
    ? fences.map((m) => m[1])
    : (() => {
        const s = src.indexOf('{')
        const e = src.lastIndexOf('}')
        return s >= 0 && e > s ? [src.slice(s, e + 1)] : []
      })()
  for (let i = candidates.length - 1; i >= 0; i--) {
    const obj = tryParseJSON(candidates[i])
    if (!obj) continue
    if (whole) return obj
    if (key && Array.isArray(obj[key])) return obj[key]
  }
  return null
}

/**
 * 解析评分。
 * 真实模型有四种写法，此前只认表格，导致「审核页一片空白」：
 *   ① | 分类 | 审查项 | 8/10 | 结论 |
 *   ② **是否有冲突 8/10**
 *   ③ 是否有冲突：8/10
 *   ④ 评分：8/10
 * 同时必须过滤越界值（曾出现 99/10，会把平均分直接污染）。
 */
function extractScores(text) {
  const src = String(text || '')
  const out = []
  const seen = new Set()

  const push = (name, score) => {
    const n = Number(score)
    if (!Number.isFinite(n) || n < 0 || n > 10) return
    const key = String(name || '').replace(/[*|`]/g, '').trim()
    if (!key || key.length > 30 || seen.has(key)) return
    seen.add(key)
    out.push({ name: key, score: n })
  }

  let m
  // ① 表格行
  const reTable = /\|\s*([^\n|]{2,24}?)\s*\|\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10/g
  while ((m = reTable.exec(src)) !== null) push(m[1], m[2])
  if (out.length) return out

  // ② 加粗小标题：**是否有冲突 8/10**
  const reBold = /\*\*([^*\n|]{2,26}?)\s*[:：]?\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10\*\*/g
  while ((m = reBold.exec(src)) !== null) push(m[1], m[2])
  if (out.length) return out

  // ③ 行内标注：冲突：8/10 / 评分 8/10
  const reLine = /(?:^|\n)[\s>*•\-]*([^\n|:*]{2,26}?)\s*[:：]\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10/g
  while ((m = reLine.exec(src)) !== null) push(m[1], m[2])
  return out
}

/**
 * 兜底：从 Markdown 表格解析 Shot List。
 * 当 LLM 输出被截断（JSON 块没写出来）或干脆没给 JSON 时，
 * 至少把已经写出来的表格还原成结构化分镜，避免「分镜没有输出」。
 *
 * 支持表头含 Shot/镜号、时间、景别、角度、镜头、运动、情绪、画面 等中英文列名。
 */
/** 判断一行是否为表头（含 2 个以上已知列名） */
function isHeaderRow(cells) {
  const KNOWN = /^(shot|镜号|序号|编号|时间|时间码|景别|角度|机位|机型|摄影机|焦段|运动|运镜|构图|主体|画面|动作|表情|环境|光线|光影|色彩|颜色|材质|声音|情绪|转场|time|size|angle|camera|lens|movement|no\.?|#)/i
  const hits = cells.filter((c) => KNOWN.test(String(c).replace(/\*\*/g, '').replace(/^\|/, '').trim())).length
  return hits >= 2
}

function parseShotTable(text) {
  const src = String(text || '')
  const shots = []
  const lines = src.split('\n')
  let header = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith('|')) { if (header && shots.length) break; continue }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (!cells.length) continue
    // 分隔行
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue

    // 第二张表紧跟第一张表时，表头会被当成数据行 ——
    // 结果是把别的表格（场景表/评分表）并进分镜，出现重复镜头号。遇到表头即停。
    if (shots.length && isHeaderRow(cells)) break

    if (!header) { header = cells; continue }

    const col = (...names) => {
      for (const n of names) {
        const idx = header.findIndex((h) => h.includes(n))
        if (idx >= 0 && cells[idx] != null && cells[idx] !== '') return cells[idx].replace(/\*\*/g, '').trim()
      }
      return ''
    }

    const noRaw = col('Shot', '镜号', '编号', '镜头')
    const no = parseInt(String(noRaw).replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(no)) continue
    // 镜头号重复 = 表格重新开始了（或另一张表），停止解析，避免产出重复分镜
    if (shots.some((s) => s.no === no)) break

    const timeRaw = col('时间', '时间码', 'Time')
    const tm = String(timeRaw).match(/(\d+(?:\.\d+)?)\s*[-–~至]\s*(\d+(?:\.\d+)?)/)
    const start = tm ? Number(tm[1]) : (shots.length ? shots[shots.length - 1].end : 0)
    const end = tm ? Number(tm[2]) : start + 5

    shots.push({
      no,
      sceneNo: no,
      start,
      end,
      duration: Math.max(1, end - start),
      shotSize: col('景别', 'Shot Size', 'Size') || '中景',
      angle: col('角度', '机位', 'Angle'),
      camera: col('机型', '摄影机', 'Camera'),
      lens: col('焦段', '镜头焦距', 'Lens', '镜头'),
      movement: col('运动', '运镜', 'Movement') || '固定镜头',
      composition: col('构图', 'Composition'),
      subject: col('主体', 'Subject'),
      action: col('画面内容', '动作', 'Action', '内容'),
      expression: col('表情', 'Expression'),
      environment: col('环境', 'Environment'),
      lighting: col('光线', '光影', 'Lighting'),
      color: col('色彩', '颜色', 'Color'),
      material: col('材质', 'Material'),
      sound: col('声音', 'Sound'),
      emotion: col('情绪', 'Emotion'),
      transition: col('转场', 'Transition') || '硬切',
    })
  }
  return shots
}

function getTool(name) {
  return TOOLS.find((t) => t.name === name)
}

module.exports = { TOOLS, getTool, extractJSONBlock, extractScores, parseShotTable }
