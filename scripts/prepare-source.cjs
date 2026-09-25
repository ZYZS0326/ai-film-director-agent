// Explicit source allowlist: never copy workspace history, settings, or releases.
const fs = require('fs'), path = require('path')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'publish-source', 'candidate-' + Date.now())
const files = ['package.json', 'package-lock.json', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'RELEASE-NOTES-1.4.2.md', '.gitignore', '.npmrc', '.env.example', 'index.html', 'tsconfig.json', 'vite.config.ts', 'build/icon.png']
const dirs = ['src', 'server', 'electron', 'scripts', 'docs', '.github']
function collect(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name
    if (rel === 'server/data' || rel.startsWith('server/data/')) continue
    if (entry.isSymbolicLink()) throw new Error('Refusing symbolic link: ' + rel)
    if (entry.isDirectory()) collect(rel)
    else if (entry.isFile()) files.push(rel)
  }
}
dirs.forEach(collect)
for (const rel of files) {
  if (/\.(exe|asar|log|pem|key|pfx|p12)$/i.test(rel)) throw new Error('Unexpected artifact: ' + rel)
  if (!rel.endsWith('.png')) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{32,}/.test(text)) throw new Error('Potential credential in ' + rel)
    if (/([A-Z]:\\Users\\[^\\\s"']+|[A-Z]:\\AIGC-编导)/i.test(text)) throw new Error('Potential local path in ' + rel)
  }
}
fs.mkdirSync(out, { recursive: true })
for (const rel of files) {
  const target = path.join(out, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(root, rel), target, fs.constants.COPYFILE_EXCL)
}
console.log(`${files.length} source files copied to ${out}`)
console.log('Personal author metadata and local paths are excluded. Review LICENSE and third-party asset rights before publishing.')
