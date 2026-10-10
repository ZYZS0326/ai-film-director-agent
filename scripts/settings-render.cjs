// Run with Electron. Hidden, isolated browser; never opens the user's app or profile.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-settings-render-'))
app.setPath('userData', path.join(temp, 'browser'))
app.disableHardwareAcceleration()
process.env.AI_FILM_DATA_DIR = path.join(temp, 'data')
process.env.AIFD_TEST_MODE = '1'
for (const k of ['ARK_API_KEY', 'ARK_BASE_URL', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER']) delete process.env[k]
const config = require('../server/config')
config.saveSettings({ provider: 'ark', apiKey: '' })
let server, win
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function run() {
  await app.whenReady()
  server = require('../server/app').createApp().listen(0, '127.0.0.1')
  await new Promise(r => server.on('listening', r))
  win = new BrowserWindow({ width: 1280, height: 900, show: false, frame: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  await sleep(500)
  const evaluate = source => win.webContents.executeJavaScript(source)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '设置').click()`)
  await sleep(300)
  const results = []
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    win.setSize(width, height); await sleep(200)
    await evaluate(`Array.from(document.querySelectorAll('details')).find(x => x.textContent.includes('各角色独立选模型')).open = true`)
    const state = await evaluate(`(() => {
      const modal = document.querySelector('.modal'), controls = Array.from(modal.querySelectorAll('input,select')).filter(x => x.getBoundingClientRect().width);
      document.querySelector('#api-model').focus();
      return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        modalOverflow: modal.scrollWidth > modal.clientWidth + 1,
        controlsOutside: controls.some(x => { const r = x.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1 }),
        models: document.querySelectorAll('#model-options option').length,
        roles: document.querySelectorAll('input[id^="role-"]').length,
        focused: document.activeElement.id };
    })()`)
    assert.equal(state.pageOverflow, false, name + ': page overflow')
    assert.equal(state.modalOverflow, false, name + ': modal overflow')
    assert.equal(state.controlsOutside, false, name + ': controls outside viewport')
    assert.equal(state.models, 3); assert.equal(state.roles, 16); assert.equal(state.focused, 'api-model')
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(__dirname, '../build/test-reports/settings-' + name + '.png'), image.toPNG())
    results.push({ name, ...state })
  }
  await evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of [['api-model', 'ep-ui-custom-id'], ['role-planner', 'ep-ui-planner'], ['fallback-models', '']]) {
      const node = document.getElementById(id); setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await sleep(100)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '保存').click()`)
  await sleep(300)
  assert.equal(config.loadSettings().model, 'ep-ui-custom-id')
  assert.equal(config.resolveModel({ role: 'planner' }).model, 'ep-ui-planner')
  assert.deepEqual(config.resolveModel().fallbackModels, [])
  console.log(JSON.stringify({ passed: true, results, persistedCustomModelAndRole: true }, null, 2))
}
run().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => {
  win?.destroy(); server?.close();
  try { fs.rmSync(temp, { recursive: true, force: true }) } catch {}
  app.exit(process.exitCode || 0)
})
