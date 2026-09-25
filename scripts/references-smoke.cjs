const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-references-'))
process.env.AI_FILM_DATA_DIR = temp
process.env.AIFD_TEST_MODE = '1'
process.env.LLM_API_KEY = ''
const refs = require('../server/knowledge/references')
const kb = require('../server/knowledge')
const { SKILLS } = require('../server/skills')
const { makeCtx } = require('../server/agent/orchestrator')
const server = require('../server/app').createApp().listen(0, '127.0.0.1')
let count = 0, dom
function check(name, fn) { fn(); count++; console.log('PASS ' + name) }
;(async () => {
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  check('参考ID唯一', () => assert.equal(new Set(refs.CARDS.map(c => c.id)).size, refs.CARDS.length))
  check('来源ID唯一', () => assert.equal(new Set(refs.SOURCES.map(s => s.id)).size, refs.SOURCES.length))
  check('至少48卡及12领域', () => assert.ok(refs.CARDS.length >= 48 && refs.DOMAINS.length >= 12))
  for (const domain of refs.DOMAINS) check('领域覆盖 ' + domain.id, () => assert.ok(refs.CARDS.filter(c => c.domain === domain.id).length >= 4))
  for (const card of refs.CARDS) {
    check('卡片结构与来源 ' + card.id, () => {
      for (const field of ['title', 'method', 'deliverable', 'check', 'pitfall', 'provenance']) assert.ok(card[field]?.length > 2)
      assert.ok(refs.DOMAINS.some(d => d.id === card.domain))
      assert.ok(card.stages.length && card.tags.length && card.sourceIds.length)
      for (const stage of card.stages) assert.ok(SKILLS.some(s => s.id === stage))
      for (const id of card.sourceIds) assert.ok(refs.SOURCES.some(s => s.id === id))
    })
  }
  for (const source of refs.SOURCES) check('来源元数据 ' + source.id, () => {
    assert.equal(new URL(source.url).protocol, 'https:')
    assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(source.scope && source.publisher && ['page', 'search-index'].includes(source.verification))
  })
  const brief = '纪录片访谈，房间桌子空间一致，角色表演压抑，交付字幕'
  const knowledge = kb.buildKnowledgeContext({ brief })
  const session = { brief, outputs: {}, constraints: {}, shots: [] }
  for (const skill of SKILLS) {
    const ctx = makeCtx(session, knowledge, '', skill.id)
    check('真实提示词接线 ' + skill.id, () => {
      assert.ok(ctx.knowledge.referenceText.includes('【扩展实操参考】'))
      assert.ok(skill.buildPrompt(ctx).includes(ctx.knowledge.referenceText))
      assert.ok(refs.selectReferences(brief, skill.id).every(c => c.stages.includes(skill.id)))
    })
    check('缩小预算不截断参考 ' + skill.id, () => {
      const small = makeCtx(session, knowledge, '', skill.id, 0.18).knowledge.referenceText
      assert.ok(small.length <= Math.floor(1800 * 0.18))
      assert.ok(!small || small.endsWith('\n'))
    })
  }
  check('空间关键词命中', () => assert.ok(refs.selectReferences('房间 空间 坐标 桌子', 'continuity').some(c => c.id === 'space-lock')))
  check('修订要求参与检索', () => assert.ok(makeCtx({ ...session, brief: '一个故事' }, knowledge, '口述影像 视障 描述', 'sound_design').knowledge.referenceText.includes('audio-description')))
  check('空白搜索全部', () => assert.equal(refs.searchReferences().length, refs.CARDS.length))
  check('未知搜索无结果', () => assert.equal(refs.searchReferences({ query: 'zz-nonexistent-zz' }).length, 0))
  check('组合筛选', () => assert.ok(refs.searchReferences({ query: '字幕', domain: 'access', stage: 'quality_control' }).every(c => c.domain === 'access' && c.stages.includes('quality_control'))))
  check('零预算无残片', () => assert.equal(refs.referenceText(brief, 'continuity', 0), ''))
  check('最大预算有边界', () => assert.ok(refs.referenceText(brief, 'continuity', 99999).length <= 2400))
  const payload = await (await fetch(base + '/api/knowledge')).json()
  check('统计与API资料一致', () => assert.equal(payload.stats.referenceCards, payload.referenceCards.length))
  const results = await (await fetch(base + '/api/knowledge/references?q=' + encodeURIComponent('字幕') + '&domain=access')).json()
  check('检索API命中', () => assert.ok(results.cards.some(c => c.id === 'captions')))
  const malformed = await fetch(base + '/api/knowledge/references?q[a]=x')
  check('结构化查询拒绝', () => assert.equal(malformed.status, 400))
  const tooLong = await fetch(base + '/api/knowledge/references?q=' + 'x'.repeat(501))
  check('超长查询拒绝', () => assert.equal(tooLong.status, 400))

  // Render the real modal against the real local API; no paid model or external page requests.
  const { JSDOM } = require('jsdom')
  const { build } = require('esbuild')
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {KnowledgeModal} from './components/InfoModals'; const root=createRoot(document.getElementById('root')); window.dispose=()=>root.unmount(); root.render(<KnowledgeModal onClose={()=>{}}/>);`, resolveDir: path.join(__dirname, '../src'), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  dom = new JSDOM('<div id="root"></div>', { url: base, runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.fetch = (url, opts) => fetch(new URL(url, base), opts)
  dom.window.eval(bundle.outputFiles[0].text)
  const doc = dom.window.document
  const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 30)) } throw new Error('UI timeout') }
  await until(() => doc.querySelector('.tab'))
  const click = text => [...doc.querySelectorAll('button')].find(b => b.textContent === text).click()
  click('实操参考')
  await until(() => doc.querySelector('input[aria-label="搜索实操参考"]'))
  check('实操参考完整渲染', () => assert.equal(doc.querySelectorAll('details.card').length, refs.CARDS.length))
  const input = doc.querySelector('input')
  const setInput = value => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }
  setInput('字幕')
  await until(() => doc.querySelectorAll('details.card').length < refs.CARDS.length)
  check('搜索实际筛选', () => assert.ok(doc.querySelector('.modal-body').textContent.includes('字幕、说话人')))
  const select = doc.querySelector('select')
  select.value = 'camera'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await until(() => doc.querySelectorAll('details.card').length === 0)
  check('无结果提示', () => assert.ok(doc.body.textContent.includes('没有匹配资料')))
  click('清除筛选')
  await until(() => doc.querySelectorAll('details.card').length === refs.CARDS.length)
  click('来源目录')
  await until(() => doc.querySelectorAll('a.card-title').length === refs.SOURCES.length)
  check('来源链接与核验范围可见', () => {
    assert.ok(doc.body.textContent.includes('索引确认'))
    for (const link of doc.querySelectorAll('a.card-title')) { assert.equal(link.target, '_blank'); assert.ok(link.rel.includes('noopener')); assert.ok(link.href.startsWith('https://')) }
  })
  console.log(`扩展参考资料：${count}项通过`)
})().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => {
  if (dom) { dom.window.dispose?.(); dom.window.close() }
  server.closeAllConnections(); server.close()
  fs.rmSync(temp, { recursive: true, force: true })
})
