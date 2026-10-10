// Every suite runs in a child process. Real user settings and API keys are never used.
const { spawnSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path')
const suites = ['batched-production', 'ark-budget', 'provider-regression', 'model-failover', 'agent-smoke', 'ui-smoke', 'llm-smoke', 'llm-hostile', 'prompt-budget', 'llm-continuation', 'parser-smoke', 'pipeline-wiring', 'session-robustness', 'stop-signal', 'knowledge-integrity', 'input-robustness', 'production-checks', 'production-api', 'shot-editor-test', 'security-smoke', 'references-smoke', 'staged-workflow']
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afd-all-'))
const env = { ...process.env, AI_FILM_DATA_DIR: root, AIFD_TEST_MODE: '1', LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '', ARK_API_KEY: '', ARK_BASE_URL: '', LLM_PROVIDER: '' }
let failed = false
const reports = path.join(__dirname, '../build/test-reports')
fs.mkdirSync(reports, { recursive: true })
const summary = []
try {
  for (const name of suites) {
    console.log('\nSUITE ' + name)
    const result = spawnSync(process.execPath, [path.join(__dirname, name + '.cjs')], { encoding: 'utf8', env, timeout: 300000, maxBuffer: 10 * 1024 * 1024 })
    const output = (result.stdout || '') + (result.stderr || '')
    fs.writeFileSync(path.join(reports, name + '.log'), output)
    summary.push({ suite: name, passed: result.status === 0, exitCode: result.status })
    console.log(output.split(/\r?\n/).filter(line => /结果|项通过|全部通过|FAIL|失败/.test(line)).slice(-8).join('\n'))
    if (result.status !== 0) { failed = true; console.error('FAILED ' + name, result.error?.message || ''); break }
  }
} finally {
  fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), passed: !failed && summary.length === suites.length, suites: summary }, null, 2))
  fs.rmSync(root, { recursive: true, force: true })
}
process.exitCode = failed ? 1 : 0
