# React UI Redesign Implementation Plan

**Goal:** 将 Open Design 定稿的 Vercel 基底弹窗与设置页迁入真实 WXT 扩展，保留规则、权限、存储与 service worker 逻辑。

**Architecture:** React 负责两个入口的壳层、品牌组件与稳定 DOM；已验证的 TypeScript controller 继续作为业务适配层，将后台状态和操作接回界面。

1. 为规则中文名、状态章色调、总开关联动、设计资产和 0.3.0 版本添加失败测试。
2. 安装 React 19 与 `@wxt-dev/module-react`，把 popup/options 入口切换为 React 组件。
3. 迁移设计令牌、320px 弹窗、1080px 设置布局、开关、状态章、列表和响应式。
4. 将 `DESIGN.md`、Geist 字体、品牌 SVG 和 Manifest 图标放入仓库。
5. 更新 README，执行 unit / typecheck / build / loaded-extension E2E / zip 完整性验证。
6. 重载本机 Chrome 中的 `.output/chrome-mv3`，检查弹窗、设置页、响应式和控制台错误。
