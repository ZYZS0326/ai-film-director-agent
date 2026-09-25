const assert = require('assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const http = require('http')
function request(url, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-security-'))
process.env.AI_FILM_DATA_DIR = tmp
const server = require('../server/app').createApp().listen(0, '127.0.0.1')
;(async () => {
  await new Promise(r => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const cases = [
    ['同源健康检查', '/api/health', {}, 200],
    ['外站不可读取项目', '/api/sessions', { headers: { Origin: 'https://untrusted.example' } }, 403],
    ['DNS重绑定Host拒绝', '/api/health', { headers: { Host: 'untrusted.example' } }, 403],
    ['null来源拒绝', '/api/settings', { headers: { Origin: 'null' } }, 403],
    ['表单写入拒绝', '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }, 415],
    ['开发前端允许', '/api/health', { headers: { Origin: 'http://localhost:5173' } }, 200],
    ['JSON创建允许', '/api/sessions', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' }, 200],
  ]
  for (const [name, url, opts, status] of cases) { assert.equal(await request(base + url, opts), status, name); console.log('PASS ' + name) }
  console.log('本地API安全边界：7项通过')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { server.closeAllConnections(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }) })
