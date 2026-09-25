/**
 * 解析器与导出 回归测试
 *
 * 覆盖那些「静默失败」的地方 —— 解析失败不会报错，只会让某个面板变空：
 *   · LLM 的 JSON 尾随逗号 / 零宽字符
 *   · 分镜表格兜底（截断、多张表相连）
 *   · 审核评分的四种写法 + 越界值
 *   · 导出 Markdown 的章节完整性
 *
 * 运行：node scripts/parser-smoke.cjs
 */
const path = require('path')
const { safeRm, safeDeleteSession, safeDeleteSessions } = require('./_safe-cleanup.cjs')
const os = require('os')
const fs = require('fs')

const DATA_DIR = path.join(os.tmpdir(), 'afd-parser-smoke')
process.env.AI_FILM_DATA_DIR = DATA_DIR
safeRm(DATA_DIR)
fs.mkdirSync(DATA_DIR, { recursive: true })

const { getTool } = require('../server/tools')
const memory = require('../server/agent/memory')
const orchestrator = require('../server/agent/orchestrator')

let pass = 0
let fail = 0
const fails = []
function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`) } else {
    fail += 1
    fails.push(`${name} — ${extra}`)
    console.log(`  ✗ ${name} — ${extra}`)
  }
}

const shot = getTool('shotlist.parse')
const review = getTool('review.parse')
const prompts = getTool('prompts.parse')
const continuity = getTool('continuity.parse')

;(async () => {
  console.log('\n=== 解析器与导出 回归测试 ===\n')

  console.log('[1] JSON 容错（尾随逗号 / 零宽字符 / 代码块标记变体）…')
  const jsonCases = [
    ['标准', 'x\n```json\n{"shots":[{"no":1}]}\n```', 1],
    ['大写 JSON 标记', 'x\n```JSON\n{"shots":[{"no":1}]}\n```', 1],
    ['标记后带空格', 'x\n``` json\n{"shots":[{"no":1}]}\n```', 1],
    ['数组尾随逗号', 'x\n```json\n{"shots":[{"no":1},]}\n```', 1],
    ['对象尾随逗号', 'x\n```json\n{"shots":[{"no":1,}]}\n```', 1],
    ['零宽字符污染', 'x\n```json\n{"shots":[{"no":1}]}\u200b\n```', 1],
    ['无围栏裸 JSON', '说明 {"shots":[{"no":1}]} 结束', 1],
    ['多个 JSON 块取最后一个', '```json\n{"shots":[{"no":9}]}\n```\n```json\n{"shots":[{"no":1},{"no":2}]}\n```', 2],
  ]
  for (const [name, text, expect] of jsonCases) {
    const r = shot.run({ text })
    check(`JSON：${name}`, r.source === 'json' && (r.shots || []).length === expect,
      `source=${r.source} n=${(r.shots || []).length}`)
  }

  console.log('\n[2] 分镜表格兜底（JSON 缺失时的最后一道防线）…')
  const tableCases = [
    ['截断 JSON + 表格', '## 分镜\n| Shot | 时间 | 景别 |\n|---|---|---|\n| 01 | 0-5s | 远景 |\n| 02 | 5-10s | 特写 |\n\n```json\n{"shots":[{"no":1', 2],
    ['两张表相连不串味', '| Shot | 时间 |\n|---|---|\n| 01 | 0-5s |\n| Shot | 景别 |\n|---|---|\n| 01 | 远景 |', 1],
    ['分镜表后接场景表', '| Shot | 时间 |\n|---|---|\n| 01 | 0-5s |\n| 02 | 5-10s |\n\n| 场景 | 地点 |\n|---|---|\n| 01 | 废墟 |', 2],
  ]
  for (const [name, text, expect] of tableCases) {
    const r = shot.run({ text })
    const n = (r.shots || []).length
    const nos = (r.shots || []).map((s) => s.no)
    check(`表格：${name}`, r.source === 'table' && n === expect && new Set(nos).size === n,
      `source=${r.source} n=${n} nos=${JSON.stringify(nos)}`)
  }

  console.log('\n[3] 审核评分（四种写法 + 越界过滤）…')
  const scoreCases = [
    ['表格行', '| 剧情 | 是否有冲突 | 8/10 | 通过 |', 1, 8],
    ['加粗小标题', '**是否有冲突 8/10**\n- 问题：xx\n\n**人物是否有动机 7/10**', 2, 8],
    ['行内冒号', '是否有冲突：8/10\n人物动机：7/10', 2, 8],
    ['越界值应被过滤', '| 视觉 | 风格 | 99/10 | x |', 0, 0],
    ['重复项去重', '| a | b | 8/10 |\n| a | b | 8/10 |', 1, 8],
    ['空输入', '', 0, 0],
  ]
  for (const [name, text, count, first] of scoreCases) {
    const sc = review.run({ text }).scores
    check(`评分：${name}`, sc.length === count && (count === 0 || sc[0].score === first),
      `n=${sc.length} ${JSON.stringify(sc)}`)
  }

  console.log('\n[4] 提示词 / 连续性解析…')
  const pd = prompts.run({ text: '```json\n{"characterLock":{"zh":"a","en":"b"},"shots":[{"no":1,"promptZh":"x"}]}\n```' })
  check('提示词：可解析 characterLock + shots', !!pd && !!pd.characterLock && pd.shots.length === 1)
  const cd = continuity.run({ text: '```json\n{"lockZh":"风衣","lockEn":"coat","rules":["a"]}\n```' })
  check('连续性：可解析 lock + rules', !!cd && cd.lockZh === '风衣' && cd.rules.length === 1)

  console.log('\n[5] 约束白名单化（LLM 抽出的约束不可信）…')
  const planner = require('../server/agent/planner')
  const sc = [
    ['越界时长被剔除', { duration: -5 }, (r) => r.duration === undefined],
    ['越界等级被剔除', { level: 9 }, (r) => r.level === undefined],
    ['口语画幅被规范化', { aspect: '2.39:1' }, (r) => r.aspect === '21:9'],
    ['未知画幅被剔除', { aspect: 'bogus' }, (r) => r.aspect === undefined],
    ['平台大小写归一', { platforms: ['Seedance'] }, (r) => r.platforms[0] === 'seedance'],
    ['平台别名归一', { platforms: ['mj', 'h3'] }, (r) => r.platforms.join() === 'midjourney,minimax_h3'],
    ['未知平台被剔除', { platforms: ['unknown_x'] }, (r) => r.platforms === undefined],
    ['非法语言归一为 zh', { language: 'EN' }, (r) => r.language === 'zh'],
    ['合法值原样保留', { duration: 300, aspect: '9:16', level: 4 }, (r) => r.duration === 300 && r.aspect === '9:16'],
  ]
  for (const [name, input, ok] of sc) {
    const r = planner.sanitizeConstraints(input)
    check(`约束：${name}`, ok(r), JSON.stringify(r))
  }
  check('Planner JSON 支持尾随逗号',
    !!planner.safeParseJSON('{"intent":"new_brief","skills":["director_analysis",],}'))
  check('Planner JSON 支持零宽字符',
    !!planner.safeParseJSON('\u200b{"intent":"chat"}\u200b'))

  console.log('\n[6] 导出 Markdown 章节完整性…')
  const s = memory.createSession()
  await orchestrator.run(s, '一个人在城市废墟中看日出，5分钟宽银幕', () => {})
  const { createApp } = require('../server/app')
  const app = createApp()
  await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', async () => {
      const port = srv.address().port
      try {
        const md = await (await fetch(`http://127.0.0.1:${port}/api/sessions/${s.id}/export`)).text()
        const h1 = md.split('\n').filter((l) => /^# [^#]/.test(l))
        // 演示数据不可把模板审核包装成真实质量评分。
        check('演示导出一级标题 = 项目名 + 11 环节', h1.length === 12, `实际 ${h1.length}`)
        check('演示导出不含虚假审核分数', !md.includes('导演审核平均分') && !/^# .*导演审核/m.test(md))
        for (const nm of ['叙事结构设计', '摄影方案', '连续性管理']) {
          check(`导出含环节「${nm}」`, md.includes(nm))
        }
        check('导出正文无越界一级标题', !/^# 《/m.test(md))
        check('导出含分镜 JSON 之后的正文', md.includes('Shot'))
      } catch (e) {
        check('导出请求成功', false, String(e.message))
      }
      srv.close()
      resolve()
    })
  })
  safeDeleteSession(memory, s.id)

  // ── [7] 导出章节编号：某个环节缺产出时不能跳号 ──────────
  // 曾经用 ordered 的下标当编号，一旦中间某个环节没有产出，
  // 导出大纲就会变成「一、二、四、五」——编号与章节数对不上。
  console.log('\n[7] 导出章节编号（缺环节时不跳号）…')
  {
    const { buildExportMarkdown } = require('../server/app')
    const { SKILLS } = require('../server/skills')
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

    const mk = (skipKeys = []) => {
      const o = {}
      for (const sk of SKILLS) {
        if (skipKeys.includes(sk.outputKey)) continue
        o[sk.outputKey] = '正文内容'
      }
      return { title: 'T', brief: 'b', outputs: o, pipeline: [], constraints: {} }
    }

    const full = buildExportMarkdown(mk())
    const fullCh = full.split('\n').filter((l) => /^# [一二三四五六七八九十]+、/.test(l))
    check('完整时 12 个章节', fullCh.length === 12, `实际 ${fullCh.length}`)
    check('完整时编号连续到十二', fullCh[11] && fullCh[11].startsWith('# 十二、'), fullCh[11])

    // 抽掉第 2 个环节（film_history → references）
    const gap = buildExportMarkdown(mk(['references']))
    const gapCh = gap.split('\n').filter((l) => /^# [一二三四五六七八九十]+、/.test(l))
    check('缺 1 个环节时章节数为 11', gapCh.length === 11, `实际 ${gapCh.length}`)
    const nums = gapCh.map((l) => l.match(/^# ([一二三四五六七八九十]+)、/)[1])
    const expected = CN.slice(0, 11)
    check('编号连续无跳号', JSON.stringify(nums) === JSON.stringify(expected),
      `实际 ${nums.join('、')}`)

    // 只留最后 1 个环节
    const one = buildExportMarkdown(mk(SKILLS.slice(0, 11).map((s2) => s2.outputKey)))
    const oneCh = one.split('\n').filter((l) => /^# [一二三四五六七八九十]+、/.test(l))
    check('只留 1 个环节时编号为「一」', oneCh.length === 1 && oneCh[0].startsWith('# 一、'), oneCh[0])

    // 完全没有产出：不应出现任何环节章节
    const none = buildExportMarkdown(mk(SKILLS.map((s2) => s2.outputKey)))
    check('无产出时不含环节章节', !/^# [一二三四五六七八九十]+、/m.test(none))
  }

  // ── [8] 增量修改后导出仍要完整 ────────────────────────
  // `session.pipeline` 只存**最近一次**技能链（增量修改后只剩被重跑的那几个环节），
  // 而 `session.outputs` 保留全部历史产出。导出必须按 outputs 走，
  // 否则「改了一下」之后再导出，方案就只剩两三节了。
  console.log('\n[8] 增量修改后导出完整性…')
  {
    const { buildExportMarkdown } = require('../server/app')
    const { SKILLS } = require('../server/skills')

    const outputs = {}
    for (const sk of SKILLS) outputs[sk.outputKey] = `【${sk.name}】正文`
    // 模拟：跑完完整流水线后，用户发了一条修订，只重跑了 3 个环节
    const revised = {
      title: 'T', brief: 'b', outputs, constraints: {},
      pipeline: ['director_analysis', 'visual_design', 'quality_control'],
      skillHistory: SKILLS.map((s2) => s2.id),
      memory: { revisions: [{ instruction: '不要赛博朋克，改成东方神话', at: Date.now() }] },
    }
    const md = buildExportMarkdown(revised)
    const ch = md.split('\n').filter((l) => /^# [一二三四五六七八九十]+、/.test(l))
    check('[8] 修订后 12 个章节仍在', ch.length === 12, `实际 ${ch.length}`)
    for (const sk of SKILLS) check(`[8] 修订后仍含「${sk.name}」`, md.includes(sk.name))
    // 头部不能只列最近一次的子集，否则读起来像「整个方案只有 3 个环节产出」
    const chainLine = md.split('\n').find((l) => l.includes('已执行技能链')) || ''
    check('[8] 头部列出历史并集而非最近子集', chainLine.includes('quality_control') && chainLine.includes('film_history'),
      chainLine.slice(0, 80))
    check('[8] 头部标注增量修改次数', /增量修改：1 次/.test(md), (md.match(/- 增量修改：.*/) || [''])[0].slice(0, 60))
  }

  safeRm(DATA_DIR)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (fail) {
    console.log('\n失败项：')
    for (const f of fails) console.log('  - ' + f)
    process.exit(1)
  }
})().catch((e) => { console.error(e); process.exit(1) })
