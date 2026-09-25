/**
 * 开发/独立运行入口
 */
const { createApp } = require('./app')

const PORT = Number(process.env.PORT || 8787)
const app = createApp()

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AI 电影导演工作站 · 后端已启动`)
  console.log(`  API:  http://127.0.0.1:${PORT}/api/health`)
  console.log(`  前端: http://localhost:5173  (npm run dev:web)\n`)
})

process.on('SIGTERM', () => server.close())
process.on('SIGINT', () => server.close())

// 进程级兜底：记日志，**不退出**。
// Node 22 默认把未处理的 rejection 当致命错误直接结束进程 ——
// 对一个桌面/本地服务来说，一个请求出错不该让整个服务消失。
// （打包版 electron/main.js 已有同类兜底；这里是独立运行入口的对应保护。）
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', (e && e.stack) || e)
})
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', (e && e.stack) || e)
})

module.exports = { server }
