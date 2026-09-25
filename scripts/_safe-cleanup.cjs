/**
 * 测试收尾用的「尽力而为」清理。
 *
 * 清理失败（文件被占用、权限不足、或沙箱的批量删除守卫拦截）**绝不能让测试套件失败** ——
 * 那是环境问题，不是被测代码的问题。
 *
 * 真实踩坑：`agent-smoke.cjs` 结尾直接调 `memory.deleteSession()`，
 * 沙箱的 safe-delete 守卫按回合累计配额、超过阈值就抛
 * `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，异常一路冒泡把整套测试标成失败，
 * 报错位置还指向 `memory.js` —— 看起来像产品 bug，实际是清理被拦。
 */
const fs = require('fs')

/** 尽力删除文件或目录，永不抛错 */
function safeRm(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** 尽力删除会话，永不抛错 */
function safeDeleteSession(memory, id) {
  try {
    memory.deleteSession(id)
    return true
  } catch {
    return false
  }
}

/** 批量版本：删一批会话 */
function safeDeleteSessions(memory, ids) {
  let ok = 0
  for (const id of ids || []) if (safeDeleteSession(memory, id)) ok += 1
  return ok
}

module.exports = { safeRm, safeDeleteSession, safeDeleteSessions }
