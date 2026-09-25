// Real Electron renderer verification with isolated data. No external model calls.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const assert = require('assert/strict')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-ui-'))
process.env.AI_FILM_DATA_DIR = data
process.env.AIFD_TEST_MODE = '1'
app.disableHardwareAcceleration()
let server
app.whenReady().then(async () => {
  server = require('../server/app').createApp().listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } })
  const js = code => win.webContents.executeJavaScript(code)
  const settle = () => new Promise(r => setTimeout(r, 700))
  const capture = async () => { await win.webContents.capturePage(); await settle(); return (await win.webContents.capturePage()).toPNG() }
  const out = path.join(__dirname, '../build/ui-preview')
  fs.mkdirSync(out, { recursive: true })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  for (let i = 0; i < 40; i++) { if (await js(`!!document.querySelector('.example-card')`)) break; await settle() }
  assert(await js(`!!document.querySelector('.example-card')`))
  assert(await js(`document.querySelector('.hero-still img').complete && document.querySelector('.hero-still img').naturalWidth > 0`))
  fs.writeFileSync(path.join(out, 'editorial-light.png'), await capture())
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='设置').click()`)
  for (let i = 0; i < 40; i++) { if (await js(`!!document.querySelector('.api-guide')`)) break; await settle() }
  assert(await js(`!!document.querySelector('.api-guide')`))
  await js(`document.querySelector('.api-guide').open = true`)
  await settle()
  assert(await js(`document.querySelector('.modal').scrollWidth <= document.querySelector('.modal').clientWidth + 1`))
  assert(await js(`document.querySelector('.api-guide').textContent.includes('火山方舟')`))
  fs.writeFileSync(path.join(out, 'api-guide.png'), await capture())
  await js(`document.querySelector('.modal-head button').click()`)
  await settle()
  win.setSize(390, 844)
  await settle()
  assert(await js(`document.documentElement.scrollWidth <= innerWidth`))
  fs.writeFileSync(path.join(out, 'editorial-mobile.png'), await capture())
  win.setSize(1440, 960)
  await settle()
  await js(`document.querySelector('.example-card').click()`)
  await settle()
  assert(await js(`document.querySelector('textarea').value.includes('宇宙') && !document.querySelector('.msg-user')`))
  for (const theme of ['dark', 'light']) {
    await js(`document.documentElement.dataset.theme='${theme}'`)
    await settle()
    fs.writeFileSync(path.join(out, theme + '.png'), await capture())
  }
  win.setSize(760, 860)
  for (const label of ['成果', '项目', '创作']) {
    await js(`Array.from(document.querySelectorAll('.view-switch button')).find(b=>b.textContent==='${label}').click()`)
    await settle()
    const selector = label === '成果' ? '.right' : label === '项目' ? '.left' : '.center'
    assert(await js(`getComputedStyle(document.querySelector('${selector}')).display !== 'none'`))
    assert(await js(`document.documentElement.scrollWidth <= innerWidth`))
  }
  fs.writeFileSync(path.join(out, 'compact.png'), await capture())
  // Exercise real editing controls against the local API, not mocked fetch.
  const memory = require('../server/agent/memory')
  const fixture = memory.createSession('单镜编辑验收')
  fixture.brief = '一个人在日出时拾起旧表'
  fixture.outputs = { storyboard: '原分镜' }
  fixture.shots = [{ no: 1, start: 0, end: 5, duration: 5, shotSize: '特写', action: '拾起旧表', promptZh: '手指握住旧表' }]
  memory.saveSession(fixture)
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  const until = async code => { for (let i = 0; i < 40; i++) { if (await js(code)) return; await settle() } throw new Error('UI timeout: ' + code) }
  await until(`!!document.querySelector('.shot-editor')`)
  const click = async (selector, text) => { await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`); await settle() }
  await click('.view-switch button', '成果')
  await click('.shot-editor button', '编辑')
  await js(`{ const el = document.querySelector('.shot-edit-fields textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '直接握紧旧表'); el.dispatchEvent(new Event('input', {bubbles:true})); }`)
  await settle()
  await click('.shot-editor button', '预览手动修改')
  await until(`!!document.querySelector('.revision-preview')`)
  assert.equal(memory.loadSession(fixture.id).shots[0].action, '拾起旧表')
  win.setSize(1440, 960)
  await settle()
  fs.writeFileSync(path.join(out, 'shot-edit-preview.png'), await capture())
  await click('.shot-editor button', '确认应用')
  await until(`!document.querySelector('.revision-preview')`)
  assert.equal(memory.loadSession(fixture.id).shots[0].action, '直接握紧旧表')
  await click('.shot-editor button', '锁定镜头')
  await until(`document.querySelector('.shot-actions').textContent.includes('已锁定')`)
  assert.equal(memory.loadSession(fixture.id).shots[0].locked, true)
  assert(await js(`document.querySelector('.shot-actions button').disabled`))
  await js(`window.confirm = () => true; document.querySelector('.version-history').open = true`)
  await click('.version-row:last-child button', '恢复')
  await until(`document.querySelector('.shot-card').textContent.includes('拾起旧表') && !document.querySelector('.shot-actions').textContent.includes('已锁定')`)
  assert.equal(memory.loadSession(fixture.id).shots[0].action, '拾起旧表')
  await click('.view-switch button', '项目')
  await click('.skill-row', '电影知识库')
  await until(`!!document.querySelector('.modal .tabs')`)
  await click('.modal .tab', '实操参考')
  await until(`document.querySelectorAll('details.card').length === 48`)
  await js(`const input = document.querySelector('input[aria-label="搜索实操参考"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '空间'); input.dispatchEvent(new Event('input', {bubbles:true}))`)
  await until(`document.querySelectorAll('details.card').length > 0 && document.querySelectorAll('details.card').length < 48`)
  assert(await js(`Array.from(document.querySelectorAll('details.card')).some(c=>c.textContent.includes('房间坐标'))`))
  await js(`document.querySelector('details.card').open = true`)
  assert(await js(`document.querySelector('.modal').scrollWidth <= document.querySelector('.modal').clientWidth + 1`))
  fs.writeFileSync(path.join(out, 'references.png'), await capture())
  await click('.modal .tab', '来源目录')
  await until(`document.querySelectorAll('a.card-title').length === 11`)
  assert(await js(`document.querySelector('.modal-body').textContent.includes('索引确认')`))
  console.log('PASS Electron: editable example, both themes, compact navigation, no document overflow')
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, themes: ['dark', 'light'], compactViews: ['成果', '项目', '创作'], editableExample: true, shotEditPreviewApplyLockRestore: true, referenceSearchAndSources: true }))
  win.destroy()
}).catch(e => {
  console.error(e)
  fs.writeFileSync(path.join(__dirname, '../build/ui-preview/error.txt'), String(e.stack || e))
  process.exitCode = 1
}).finally(() => {
  if (server) server.close()
  // Exact temporary directory created above, never a user project.
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})
