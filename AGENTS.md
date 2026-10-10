# CQU Link Fix

Chromium 链接修正扩展。开发命令及安装方式见 [README](README.md#开发与测试)，包管理器版本和验证脚本以 `package.json` 为准。

## 行为边界

- 只处理 HTTP(S) 顶层导航；CAS service 回调保持原值。URL 含 ticket 时跳过全部改写且不创建记录。
- 默认权限维持精确主机范围；“全部 CQU 域名”由用户主动开启并授权。自定义规则只接受精确 CQU DNS 域名，IP:port 仅用已授权且实际验证过的随包名单。
- 保留一次性原地址打开、暂停和排除规则优先级；aTrust 错误时由用户决定回退。
- 数据在本机处理，隐私契约见 [PRIVACY.md](PRIVACY.md)。

## 按任务读取与验证

- 修改界面前读 [DESIGN.md](DESIGN.md)；设计来源查 [设计交接](docs/design/README.md)。
- 代码变更运行 `pnpm verify`；导航、权限或扩展交互变更另跑 `pnpm test:e2e`。
- fixture E2E 不代替真实学校登录。网络或权限验收按 [烟测记录](docs/validation/live-smoke.md) 和 README 的原生权限门禁执行，分别报告已验证与待验证场景。
- 商店材料或发布任务先读 [提交清单](docs/store/submission-checklist.md)；打包不等于商店提交或上线。

## Agent skills

- Issue tracker：处理 issue、规格或任务拆分前，读 [GitHub Issues 约定](docs/agents/issue-tracker.md)。
- Triage labels：分类或变更 issue 状态前，读 [标签映射](docs/agents/triage-labels.md)。
- Domain docs：探索领域、命名或设计决策前，读 [领域文档约定](docs/agents/domain.md)。
- 技能按任务选用：排障用 diagnosing-bugs，模块边界用 codebase-design，领域术语与 ADR 用 domain-modeling，代码审查用 code-review，PR 描述用 pr；修改 Agent 文档用 writing-for-agents。已安装 Matt 插件时优先使用 mattpocock-skills 命名空间；技能不可用时按仓库约定完成任务并说明缺失。
