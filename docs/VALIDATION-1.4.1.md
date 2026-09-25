# 1.4.1 验证记录

日期：2026-09-23。环境：Windows、Node.js 24.18.0。

本文件记录首次源码发布候选的基线验证。后续资料库扩充见 `REFERENCE-LIBRARY.md`；最新全量结果请读本地 `build/test-reports/summary.json`，不要把下方基线3015项当成新增功能的测试证据。

## 已通过

- TypeScript 类型检查、Vite 生产构建。
- `npm test`：16组、3015项检查全部通过。机器报告保存在本地 `build/test-reports/summary.json`，详细日志位于同目录。
- 编辑回归42项，包含时间线空隙、前置锁定镜头不变、历史说明保留、异常模型输出及过长上下文拒绝。
- 本地API安全边界7项，包含外站Origin、DNS重绑定Host、null来源及非JSON写入。
- `npm audit --audit-level=high`：0个已知依赖漏洞，包含开发依赖。这不是无未知漏洞保证。
- 白名单源码副本独立执行 `npm ci --ignore-scripts`、类型检查和生产构建成功。安装脚本未在此检查中执行；不代表桌面安装成功。

测试使用隔离数据和本地模型模拟，不消耗真实模型额度；不验证真实模型创作质量。

## 未完成的发布门槛

- 首次基线的Electron 44.4.3下载曾因 `UND_ERR_CONNECT_TIMEOUT` 失败。迁移至D盘后的工作区已有该运行时，本轮资料库扩充已通过真实Electron界面回归（包括编辑、锁定、恢复、资料搜索和来源目录）。尚未重新构建并验收包含新增资料的安装包。
- Windows/Linux GitHub Actions已配置，尚未在远程仓库运行。
- 仓库名称、公开/私有选择、LICENSE及材料权利归属需所有者确认。
- 尚未创建远程仓库、推送源码或发布Release。

结论：可审查的源码发布候选，不是已验收的正式桌面发行版。
