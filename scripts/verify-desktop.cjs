// Verify the packaged code and run its modules in the exact Electron runtime.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..'), target = path.resolve(process.argv[2] || path.join(root, 'ai-film-director-agent'))
const archive = path.join(target, 'resources', 'app.asar')
// The packager intentionally strips build-only package metadata; compare executable source.
const files = ['server/agent/batched-production.js', 'server/agent/llm.js', 'server/agent/orchestrator.js', 'server/agent/model-policy.js', 'server/config.js']
for (const file of files) assert.ok(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(path.join(root, file))), 'Packaged code mismatch: ' + file)
const names = asar.listPackage(archive)
assert.ok(!names.some(n => /[/\\]server[/\\]data(?:[/\\]|$)/.test(n)), 'User data present in package')
const settings = path.join(process.env.APPDATA, 'AI 电影导演工作站', 'data', 'settings.json')
if (fs.existsSync(settings)) {
  const saved = JSON.parse(fs.readFileSync(settings, 'utf8'))
  if (saved.apiKey) assert.ok(!fs.readFileSync(archive).includes(Buffer.from(saved.apiKey)), 'Private key present in package')
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-installed-batch-'))
try {
  const code = `const assert=require('assert/strict');const batch=require(${JSON.stringify(path.join(archive, 'server/agent/batched-production.js'))});batch.validatePlan([{no:1,start:0,end:6,duration:6,beat:'action'}],6);assert.throws(()=>batch.validatePlan([{no:1,start:0,end:6,duration:6,beat:'action'}],40));console.log(JSON.stringify({runtime:process.versions.electron,version:require(${JSON.stringify(path.join(archive, 'package.json'))}).version,batching:typeof batch.generate==='function'}));`
  const result = spawnSync(path.join(target, 'AI电影导演工作站.exe'), ['-e', code], { encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AI_FILM_DATA_DIR: dir, AIFD_TEST_MODE: '1', LLM_API_KEY: '', ARK_API_KEY: '', LLM_BASE_URL: '', LLM_PROVIDER: '' } })
  assert.equal(result.status, 0, 'Installed runtime failed: ' + result.stderr)
  const runtime = JSON.parse(result.stdout.trim())
  assert.equal(runtime.version, require('../package.json').version)
  assert.equal(runtime.batching, true)
  console.log(JSON.stringify({ passed: true, sourceMatches: files.length, noUserData: true, noPrivateKey: true, ...runtime }, null, 2))
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
