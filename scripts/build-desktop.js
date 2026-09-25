// Build into a fresh directory. Never remove previous releases or user data.
const { spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')
const ROOT = path.join(__dirname, '..')
if (process.argv.includes('--clean-only')) {
  console.log('自动清理已禁用。请确认不再需要后，手动删除指定的 buildout-* 构建目录。')
  process.exit(0)
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + process.pid
process.env.BUILD_STAMP = stamp
const out = path.join(ROOT, 'buildout-' + stamp)
if (fs.existsSync(out)) throw new Error('Output already exists: ' + out)
const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (r.status !== 0) process.exit(r.status || 1)
}
run(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build'])
const builder = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js')
run(builder, ['--win', '--x64', ...(process.argv.includes('--dir') ? ['--dir'] : []), '--config.directories.output=' + out])
const release = path.join(ROOT, 'release')
fs.mkdirSync(release, { recursive: true })
for (const name of fs.readdirSync(out)) {
  if (/\.(exe|blockmap)$/i.test(name)) fs.copyFileSync(path.join(out, name), path.join(release, name), fs.constants.COPYFILE_EXCL)
}
console.log('Build complete: ' + out + '\nPrevious builds were preserved.')
