/**
 * Electron 主进程
 * 开发：加载 ELECTRON_START_URL（Vite dev server）
 * 生产：在进程内启动 Express 后端，加载本地 dist
 */
const { app, BrowserWindow, shell, Menu, dialog, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ── 启动日志（便于排查打包后的问题）─────────────────────
const LOG_FILE = path.join(os.tmpdir(), 'ai-film-director-startup.log')
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch { /* ignore */ }
  try { process.stdout.write(line) } catch { /* ignore */ }
}
try { fs.writeFileSync(LOG_FILE, '') } catch { /* ignore */ }

process.on('uncaughtException', (e) => log('UNCAUGHT:', e && e.stack || e))
process.on('unhandledRejection', (e) => log('UNHANDLED:', e && e.stack || e))

log('--- startup ---')
log('electron', process.versions.electron, '| node', process.versions.node)
log('packaged:', app.isPackaged, '| resourcesPath:', process.resourcesPath)
log('cwd:', process.cwd(), '| __dirname:', __dirname)

// ── GPU 自愈守卫 ─────────────────────────────────────────
// 症状：某些机器（虚拟机 / 远程桌面 / 显卡驱动异常 / 双显卡切换失败）上，
// Chromium 的 GPU 进程会反复初始化失败，最终
//   FATAL:gpu_data_manager_impl_private.cc(423)] GPU process isn't usable. Goodbye.
// 整个应用**直接退出** —— 后端其实已经起来了，但窗口还没显示进程就没了，
// 用户看到的是「双击没反应 / 闪一下就消失」，而且日志里只有一堆 GPU 报错，很难联想到显卡。
//
// 对策：启动时先落下「启动中」标记，窗口真正显示出来之后再清掉。
// 下次启动若发现标记还在，说明上次死在启动阶段 → 本次改用软件渲染。
// 健康机器上标记每次都会被清掉，因此行为完全不变（不影响正常机器的硬件加速）。
const GPU_GUARD = (() => {
  try { return path.join(app.getPath('userData'), '.gpu-guard') }
  catch { return path.join(os.tmpdir(), 'ai-film-director-gpu-guard') }
})()

let gpuSafeMode = false
try {
  if (fs.existsSync(GPU_GUARD)) {
    gpuSafeMode = true
    try { fs.unlinkSync(GPU_GUARD) } catch { /* ignore */ }
  }
} catch { /* ignore */ }

if (process.argv.includes('--disable-gpu') || process.env.AIFD_DISABLE_GPU === '1') {
  gpuSafeMode = true
}
if (gpuSafeMode) {
  // 必须在 app ready 之前调用
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-compositing')
  log('GPU 安全模式：本次使用软件渲染（上次启动未走完，或显式指定了 --disable-gpu）')
}
// 落标记：只有窗口成功显示才会被清除
try { fs.writeFileSync(GPU_GUARD, String(Date.now())) } catch { /* ignore */ }

// 单实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('another instance is running -> quit')
  app.quit()
}

let mainWindow = null
let httpServer = null
let serverPort = 0

/** 在 Electron 主进程内启动后端 */
function startBackend() {
  return new Promise((resolve, reject) => {
    try {
      // 打包后 app.asar 只读：把数据目录指向用户可写目录
      // 允许通过 AI_FILM_DATA_DIR 覆盖（便于受限环境 / 便携部署）
      if (!process.env.AI_FILM_DATA_DIR) {
        let base
        try {
          base = app.getPath('userData')
        } catch (e) {
          base = path.join(os.tmpdir(), 'ai-film-director')
          log('getPath(userData) failed, fallback:', base, e.message)
        }
        process.env.AI_FILM_DATA_DIR = path.join(base, 'data')
      }
      const dataDir = process.env.AI_FILM_DATA_DIR
      log('dataDir:', dataDir)
      try {
        fs.mkdirSync(dataDir, { recursive: true })
        fs.writeFileSync(path.join(dataDir, '.write-test'), 'ok')
        log('dataDir writable: OK')
      } catch (e) {
        log('dataDir NOT writable:', e.message, '-> fallback to tmp')
        process.env.AI_FILM_DATA_DIR = path.join(os.tmpdir(), 'ai-film-director', 'data')
        fs.mkdirSync(process.env.AI_FILM_DATA_DIR, { recursive: true })
        log('fallback dataDir:', process.env.AI_FILM_DATA_DIR)
      }

      const serverEntry = path.join(__dirname, '..', 'server', 'app.js')
      log('requiring server:', serverEntry, '| exists:', fs.existsSync(serverEntry))
      const { createApp } = require(serverEntry)
      const expressApp = createApp()
      log('express app created')

      // 端口 0 => 系统分配空闲端口；可用 AI_FILM_PORT 指定固定端口
      const wanted = Number(process.env.AI_FILM_PORT || 0)
      const srv = expressApp.listen(wanted, '127.0.0.1', () => {
        serverPort = srv.address().port
        httpServer = srv
        log('backend listening on 127.0.0.1:' + serverPort)
        resolve(serverPort)
      })
      srv.on('error', (e) => {
        log('server error:', e.message)
        reject(e)
      })
    } catch (e) {
      log('startBackend threw:', e && e.stack || e)
      reject(e)
    }
  })
}

function createWindow(startUrl) {
  log('creating window ->', startUrl)
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b0d12',
    show: false,
    title: 'AI 电影导演工作站',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    log('ready-to-show -> show')
    mainWindow.show()
    // 走到这里说明 GPU / 渲染链路是通的，清掉自愈标记
    try { fs.unlinkSync(GPU_GUARD) } catch { /* ignore */ }
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)))

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(startUrl)

  if (process.env.ELECTRON_DEV === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

/** 后端失败时也开窗口，显示错误页而不是静默退出 */
function createErrorWindow(message) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>启动失败</title>
<style>body{background:#0b0d12;color:#e7ebf3;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:720px;padding:32px;border:1px solid #232b3c;border-radius:14px;background:#0e1118}
h1{font-size:20px;margin:0 0 12px;color:#e0a75e}pre{white-space:pre-wrap;word-break:break-all;font-size:12.5px;
color:#9aa5ba;background:#141924;padding:14px;border-radius:8px;border:1px solid #232b3c;max-height:50vh;overflow:auto}
p{color:#9aa5ba;font-size:13px;line-height:1.7}</style></head><body><div class="box">
<h1>后端服务无法启动</h1><p>请检查下方错误信息。日志文件：<code>%TEMP%\\ai-film-director-startup.log</code></p>
<pre>${String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>
</div></body></html>`
  mainWindow = new BrowserWindow({
    width: 900, height: 620, backgroundColor: '#0b0d12',
    title: 'AI 电影导演工作站 · 启动失败', autoHideMenuBar: true,
  })
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

async function bootstrap() {
  const devUrl = process.env.ELECTRON_START_URL

  // 生产环境注入 CSP（开发环境交给 Vite，避免影响 HMR）
  if (!devUrl) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; font-src 'self' data:; " +
            "connect-src 'self' http://127.0.0.1:* http://localhost:*",
          ],
        },
      })
    })
  }

  try {
    const port = await startBackend()
    const url = devUrl || `http://127.0.0.1:${port}/`
    createWindow(url)
  } catch (e) {
    const msg = (e && e.stack) || (e && e.message) || String(e)
    log('bootstrap failed:', msg)
    createErrorWindow(msg)
  }
}

app.whenReady().then(() => {
  log('app ready')
  Menu.setApplicationMenu(null)
  bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  log('quitting')
  if (httpServer) {
    try { httpServer.close() } catch { /* ignore */ }
  }
})
