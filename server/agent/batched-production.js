// Long per-shot products are assembled from validated JSON batches, never unfinished tables.
const crypto = require('crypto')
const llm = require('./llm')
const { extractJSONBlock } = require('../tools')
const round = n => Math.round(n * 1000) / 1000
const jsonText = data => '```json\n' + JSON.stringify(data, null, 2) + '\n```'
function parse(text) {
  const result = extractJSONBlock(text, null, true)
  if (!result || typeof result !== 'object') throw new Error('本批未返回完整 JSON')
  return result
}
function validatePlan(shots, total, start = 0) {
  if (!Array.isArray(shots) || !shots.length || shots.length > 1500) throw new Error('分镜总计划缺少镜头或数量过大')
  let end = start
  for (const [i, s] of shots.entries()) {
    if (s.no !== i + 1 || !Number.isFinite(s.start) || !Number.isFinite(s.end) || !Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 8 || !String(s.beat || s.action || '').trim()) throw new Error(`总计划第 ${i + 1} 镜编号、时长或剧情节拍无效`)
    if (Math.abs(s.start - end) > 0.05 || Math.abs(s.end - s.start - s.duration) > 0.05) throw new Error(`总计划第 ${i + 1} 镜时间码不连续`)
    end = s.end
  }
  if (Math.abs(end - total) > 0.05) throw new Error(`总计划未覆盖完整 ${total} 秒，实际 ${end} 秒`)
}
const shotFields = ['shotSize', 'angle', 'camera', 'lens', 'movement', 'composition', 'subject', 'action', 'expression', 'environment', 'lighting', 'color', 'material', 'sound', 'emotion', 'transition']
function validateShots(rows, plan) {
  if (!Array.isArray(rows) || rows.length !== plan.length) throw new Error('本批镜头缺失或重复')
  for (const [i, s] of rows.entries()) {
    if (s.no !== plan[i].no) throw new Error('本批编号或顺序错误')
    for (const k of ['start', 'end', 'duration']) if (!Number.isFinite(s[k]) || Math.abs(s[k] - plan[i][k]) > 0.05) throw new Error('本批改变了锁定的时间码')
    if (shotFields.some(k => typeof s[k] !== 'string' || !s[k].trim())) throw new Error(`第 ${s.no} 镜缺少制作字段`)
  }
}
async function generate({ skill, messages, ctx, session, inputIdentity, onBatch = () => {}, checkpoint = () => {}, isAborted = () => false }) {
  const id = skill.id
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ id, inputs: inputIdentity ?? messages, continuity: session.continuityData, shots: id === 'prompt_engineering' ? session.shots : null })).digest('hex')
  session.batchJobs = session.batchJobs || {}
  let job = session.batchJobs[id]
  if (!job || job.fingerprint !== fingerprint || !job.completed || typeof job.completed !== 'object' || Array.isArray(job.completed)) job = session.batchJobs[id] = { fingerprint, completed: {}, at: Date.now() }
  const cancelled = () => { if (isAborted()) throw Object.assign(new Error('已停止，已完成的批次已保存；下次继续无需重跑。'), { category: 'STOPPED' }) }
  async function ask(instruction, validate) {
    let reason = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      cancelled()
      const text = await llm.chat([...messages, { role: 'user', content: '【分批制作规范，覆盖上文整案输出格式】只输出本次指定的严格 JSON，不写 Markdown 表格，不重复整案正文。\n' + instruction + (session.continuityData ? '\n完整连续性硬事实（不可改写或删除）：' + JSON.stringify(session.continuityData) : '') + (reason ? '\n上一批校验问题：' + reason + '。修复后重新输出本批。' : '') }],
        { role: id, structured: true, desiredOutputTokens: 8192, timeout: 240000,
          onModelSwitch: event => onBatch({ phase: 'switch', ...event }) })
      try { const data = parse(text); validate(data); return data } catch (e) { reason = e.message }
    }
    throw new Error('批次校验仍未通过：' + reason)
  }
  async function completeSingle(instruction, validate) {
    // Last-resort for one indivisible object on very small output caps: bounded continuation,
    // then parse and validate the entire result before accepting any fields.
    cancelled()
    let truncated = false
    const text = await llm.chat([...messages, { role: 'user', content: '【分批制作规范】只输出以下本批任务的完整严格 JSON，不写 Markdown 或重复整案内容：\n' + instruction + (session.continuityData ? '\n完整连续性硬事实：' + JSON.stringify(session.continuityData) : '') }],
      { role: id, desiredOutputTokens: 8192, maxContinuations: 24, timeout: 240000,
        onContinue: () => { cancelled(); onBatch({ phase: 'batch', from: '单项补全', to: '', total: job.plan?.length || 0 }) },
        onModelSwitch: event => onBatch({ phase: 'switch', ...event }),
        onGenerationResult: result => { truncated = result.generation_truncated } })
    if (truncated) throw Object.assign(new Error('单项内容仍未完整生成；已保留完成批次，稍后可继续。'), { category: 'TRUNCATED' })
    const data = parse(text); validate(data); return data
  }
  async function batch(items, makeInstruction, validate, prefix = 'shot') {
    cancelled()
    const key = prefix + ':' + items.map(x => x.no).join(',')
    if (job.completed[key]) { try { validate(job.completed[key], items); return job.completed[key] } catch { delete job.completed[key]; checkpoint() } }
    async function splitBatch() {
      const split = Math.ceil(items.length / 2)
      const left = await batch(items.slice(0, split), makeInstruction, validate, prefix)
      const right = await batch(items.slice(split), makeInstruction, validate, prefix)
      const merged = Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].filter(k => Array.isArray(left[k]) || Array.isArray(right[k])).map(k => [k, [...(left[k] || []), ...(right[k] || [])]]))
      validate(merged, items); job.completed[key] = merged; checkpoint(); return merged
    }
    // A smaller accepted child is authoritative too. Resume it before asking for the
    // parent again, including after interruption halfway through an adaptive split.
    if (items.length > 1 && Object.keys(job.completed).some(k => k.startsWith(prefix + ':') && k !== key && k.slice(prefix.length + 1).split(',').every(n => items.some(item => String(item.no) === n)))) return splitBatch()
    try {
      onBatch({ phase: prefix === 'asset' ? 'assetBatch' : 'batch', from: items[0].no, to: items.at(-1).no, total: prefix === 'asset' ? job.assetPlan.imageAssets.length : job.plan.length })
      const data = await ask(makeInstruction(items), data => validate(data, items))
      job.completed[key] = data; checkpoint(); return data
    } catch (e) {
      if (['AUTH', 'QUOTA', 'RATE_LIMIT', 'NETWORK', 'TIMEOUT', 'STOPPED', 'MODEL_NOT_AVAILABLE', 'MODEL_NOT_FOUND', 'SAFE_MODE'].includes(e.category) || e.category === 'CONTEXT_LIMIT' && items.length === 1) throw e
      if (items.length === 1) {
        const data = await completeSingle(makeInstruction(items) + '\n必须修正上一轮问题：' + e.message, data => validate(data, items))
        job.completed[key] = data; checkpoint(); return data
      }
      return splitBatch()
    }
  }
  if (id === 'storyboard') {
    const total = Number(ctx.constraints?.duration) || ctx.knowledge.durationMode.requested || ctx.knowledge.durationMode.duration
    if (!job.plan) {
      onBatch({ phase: 'planning', total })
      // The legacy stage prompt includes only the first 4k of screenplay. Read all of a
      // long approved script in bounded pieces so the ending cannot silently disappear.
      const screenplay = session.outputs?.screenplay || ''
      if (screenplay.length > 4000 && !job.storyOutline) {
        job.outlineParts = job.outlineParts || {}
        const count = Math.ceil(screenplay.length / 2200)
        for (let part = 0; part < count; part++) {
          if (job.outlineParts[part]) continue
          onBatch({ phase: 'outline', from: part + 1, total: count })
          const data = await ask(`提取完整剧本的片段概要（${part + 1}/${count}），不续写、不添加情节。保留本段实际发生的必要动作、信息和结局，按原顺序返回 {"events":["具体事件"]}，1至12项。片段边缘可能处于句子中间，不要自行补造。\n剧本片段：\n${screenplay.slice(Math.max(0, part * 2200 - 150), (part + 1) * 2200)}`, d => {
            if (!Array.isArray(d.events) || !d.events.length || d.events.length > 12 || d.events.some(e => typeof e !== 'string' || !e.trim())) throw new Error('剧本片段概要不完整')
          })
          job.outlineParts[part] = data.events; checkpoint()
        }
        job.storyOutline = Array.from({ length: count }, (_, i) => job.outlineParts[i]); checkpoint()
      }
      if (!job.segments) {
        const result = await ask(`先生成全片紧凑剧情段落计划，不写逐镜细节或提示词。${job.storyOutline ? '\n已逐段读取的完整剧本事件（全部覆盖，边缘重叠事件合并一次）：' + JSON.stringify(job.storyOutline) + '\n' : ''}用3至8个主要剧情段落覆盖故事开端到结局，不遗漏必需剧情，总时长精确 ${total} 秒。按故事价值分配时长，不均摊。返回 {"segments":[{"sceneNo":1,"start":0,"end":30,"beat":"该段必须发生的信息和动作"}]}。时间连续，从0到${total}，保持剧情顺序。`, d => {
          if (!Array.isArray(d.segments) || !d.segments.length) throw new Error('全片段落计划缺失')
          let end = 0
          for (const s of d.segments) { if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || Math.abs(s.start - end) > 0.05 || s.end <= s.start || !s.beat) throw new Error('全片段落计划不连续或不完整'); end = s.end }
          if (Math.abs(end - total) > 0.05) throw new Error('段落计划未覆盖全片时长')
        })
        job.segments = result.segments; checkpoint()
      }
      job.segmentPlans = job.segmentPlans || {}
      async function planSegment(segment) {
        const key = `${segment.start}:${segment.end}`
        if (job.segmentPlans[key]) return job.segmentPlans[key]
        if (segment.end - segment.start > 48) {
          const mid = round((segment.start + segment.end) / 2)
          return [...await planSegment({ ...segment, end: mid, beat: segment.beat + '（前半段）' }), ...await planSegment({ ...segment, start: mid, beat: segment.beat + '（后半段）' })]
        }
        try {
          const data = await ask(`只为本段生成紧凑镜头计划，不写摄影细节。全片剧情段落：${JSON.stringify(job.segments)}\n本段：${JSON.stringify(segment)}\n返回 {"shots":[{"no":1,"sceneNo":${segment.sceneNo || 1},"start":${segment.start},"end":${segment.start + Math.min(6, segment.end - segment.start)},"duration":6,"beat":"该镜动作和信息"}]}。本段镜号从1连续编号，时间码使用全片绝对秒数，从${segment.start}到${segment.end}连续无缺口，每镜不超过8秒，时长服从故事价值。`, d => validatePlan(d.shots, segment.end, segment.start))
          job.segmentPlans[key] = data.shots; checkpoint(); return data.shots
        } catch (e) {
          if (e.category && e.category !== 'TRUNCATED' || segment.end - segment.start <= 8) throw e
          const mid = round((segment.start + segment.end) / 2)
          return [...await planSegment({ ...segment, end: mid, beat: segment.beat + '（前半段）' }), ...await planSegment({ ...segment, start: mid, beat: segment.beat + '（后半段）' })]
        }
      }
      const all = []
      for (const segment of job.segments) all.push(...await planSegment(segment))
      job.plan = all.map((s, i) => ({ ...s, no: i + 1 })); checkpoint()
    }
    validatePlan(job.plan, total)
    const shots = []
    for (let i = 0; i < job.plan.length; i += 3) {
      const data = await batch(job.plan.slice(i, i + 3), items => `只展开指定镜头，所有编号/时间码不可改。全片节拍：${JSON.stringify(job.plan.map(s => ({ no: s.no, beat: s.beat || s.action })))}\n本批：${JSON.stringify(items)}\n返回 {"shots":[...]}，每镜包含 no,sceneNo,start,end,duration 及 ${shotFields.join(',')}，全部为具体内容。不要生成 promptZh/promptEn，它们在下一提示词环节单独制作。每个文本字段用紧凑、明确的一至两句。继承同一人物、空间、服装和摄影规格，衔接相邻镜头。`, (d, items) => validateShots(d.shots, items))
      shots.push(...data.shots)
    }
    validateShots(shots, job.plan)
    cancelled(); job.done = true; checkpoint()
    return `## 分镜设计说明\n共 ${shots.length} 镜，完整覆盖 ${round(total)} 秒。已分批校验编号、时间码和制作字段；视频提示词在提示词工程环节生成。\n\n## 全片剧情节拍\n${job.plan.map(s => `- 镜 ${s.no}（${s.start}–${s.end}s）：${s.beat || s.action}`).join('\n')}\n\n${jsonText({ shots })}`
  }
  if (!session.shots?.length) throw new Error('提示词分批制作需要完整且已审核的分镜')
  job.plan = session.shots
  if (!job.assets) {
    onBatch({ phase: 'assets', total: job.plan.length })
    if (!job.assetPlan) job.assetPlan = await ask(`本次只生成全片共用资产目录，不写长图片提示词、逐镜视频或关键帧。全片资产清单依据：${JSON.stringify({ subjects: [...new Set(job.plan.map(s => s.subject))], environments: [...new Set(job.plan.map(s => s.environment))] })}。返回 {"characterLock":{"zh":"...","en":"..."},"sceneAssets":[],"imageAssets":[{"assetId":"CHAR_01","type":"character","name":"角色名","sheet":"character_reference","aspectRatio":"3:4","lockedFacts":[],"allowedChange":"..."}]}。为实际人物/场景/关键道具建立唯一ID，不重复长说明。`, d => {
      if (!d.characterLock?.zh || !d.characterLock?.en || !Array.isArray(d.imageAssets) || !d.imageAssets.length) throw new Error('共用资产或角色锁缺失')
      const ids = new Set()
      for (const a of d.imageAssets) { if (!a.assetId || ids.has(a.assetId) || !a.type || !a.sheet || !a.aspectRatio) throw new Error('资产字段缺失或 ID 重复'); ids.add(a.assetId) }
    })
    if (session.continuityData?.lockZh) job.assetPlan.characterLock.zh = session.continuityData.lockZh
    if (session.continuityData?.lockEn) job.assetPlan.characterLock.en = session.continuityData.lockEn
    checkpoint()
    const imageAssets = []
    const inventory = job.assetPlan.imageAssets.map((a, i) => ({ ...a, no: i + 1 }))
    for (let i = 0; i < inventory.length; i += 2) {
      const data = await batch(inventory.slice(i, i + 2), items => `只展开本批资产图提示词：${JSON.stringify(items)}\n角色锁：${JSON.stringify(job.assetPlan.characterLock)}\n返回 {"imageAssets":[{"assetId":"...","type":"...","sheet":"...","aspectRatio":"...","promptZh":"完整静态中文图像提示词","promptEn":"完整静态英文图像提示词","negative":"...","inheritsFrom":[],"lockedFacts":[],"allowedChange":"..."}]}。保留目录中的ID、身份和空间硬事实，不添加视频运镜。`, (d, items) => {
        if (!Array.isArray(d.imageAssets) || d.imageAssets.length !== items.length) throw new Error('资产图批次漏项')
        for (const [j, a] of d.imageAssets.entries()) if (a.assetId !== items[j].assetId || a.type !== items[j].type || a.sheet !== items[j].sheet || a.aspectRatio !== items[j].aspectRatio || !a.promptZh || !a.promptEn) throw new Error('资产图标识或提示词不完整')
      }, 'asset')
      imageAssets.push(...data.imageAssets)
    }
    job.assets = { ...job.assetPlan, imageAssets }
    if (session.continuityData?.lockZh) job.assets.characterLock.zh = session.continuityData.lockZh
    if (session.continuityData?.lockEn) job.assets.characterLock.en = session.continuityData.lockEn
    checkpoint()
  }
  const assetIds = new Set(job.assets.imageAssets.map(a => a.assetId)), shots = [], keyframes = []
  for (let i = 0; i < job.plan.length; i += 2) {
    const data = await batch(job.plan.slice(i, i + 2), items => `只为本批镜头生成提示词和静态关键帧：${JSON.stringify(items)}\n全片共用资产（禁止重写身份/空间）：${JSON.stringify(job.assetPlan)}\n合法资产ID（只能从中选择）：${JSON.stringify([...assetIds])}\n返回 {"shots":[{"no":${items[0].no},"start":${items[0].start},"end":${items[0].end},"promptZh":"完整中文13要素","promptEn":"完整英文13要素","negative":"...","platform":"..."}],"keyframes":[{"shotNo":${items[0].no},"phase":"master","assetIds":${JSON.stringify([...assetIds].slice(0, 1))},"aspectRatio":"${ctx.constraints.aspect || '16:9'}","promptZh":"静态画面","promptEn":"static frame","negative":"...","motionNote":"后续运动"}]}。以上示例仅展示第一镜的结构，必须覆盖本批全部指定镜头。每镜有唯一视频提示词和至少一张 Master Frame。phase仅使用master/start/middle/end；同一镜相同phase只能有一张。assetIds必须是合法ID字符串数组。跨镜头沿用角色锁；静态图片不能混入运镜/动作序列。`, (d, items) => {
      if (!Array.isArray(d.shots) || d.shots.length !== items.length || !Array.isArray(d.keyframes)) throw new Error('逐镜提示词或关键帧缺失')
      for (const [j, s] of d.shots.entries()) {
        if (s.no !== items[j].no || s.start !== items[j].start || s.end !== items[j].end || !s.promptZh || !s.promptEn) throw new Error('提示词镜号、时间码或正文错误')
        if (!d.keyframes.some(k => k.shotNo === s.no && k.phase === 'master')) throw new Error('该镜 Master Frame 缺失')
      }
      const seen = new Set()
      for (const k of d.keyframes) {
        const key = `${k.shotNo}|${k.phase}`
        if (!items.some(s => s.no === k.shotNo)) throw new Error(`关键帧镜号 ${k.shotNo} 不属于本批`)
        if (seen.has(key)) throw new Error(`关键帧 ${key} 重复，每镜每个phase只能有一张`)
        if (!['master', 'start', 'middle', 'end'].includes(k.phase) || !k.aspectRatio || !k.promptZh || !k.promptEn) throw new Error(`关键帧 ${key} 缺少有效phase、画幅或中英正文`)
        if (!Array.isArray(k.assetIds) || !k.assetIds.length || k.assetIds.some(a => !assetIds.has(a))) throw new Error(`关键帧 ${key} 的assetIds必须从 ${JSON.stringify([...assetIds])} 中选择，不能新增或照抄其它ID`)
        seen.add(key)
      }
    })
    shots.push(...data.shots); keyframes.push(...data.keyframes)
  }
  cancelled(); job.done = true; checkpoint()
  return `## 完整提示词生产包\n共 ${shots.length} 镜，${job.assets.imageAssets.length} 项资产，${keyframes.length} 张关键帧；已逐批检查完整覆盖和资产引用。\n\n${jsonText({ ...job.assets, shots, keyframes })}`
}
module.exports = { generate, validatePlan, validateShots }
