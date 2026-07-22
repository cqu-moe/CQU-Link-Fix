# CQU Link Fix

面向 Chromium 的重庆大学链接修正扩展。当前版本为 **0.3.0**，弹窗与设置页使用 React 19，底层规则、权限、存储与 service worker 保持 TypeScript / WXT 实现。真实网络验证证据目前为 **PARTIAL**；团委规则已获用户实际使用确认，完整 SSO 登录回调与校园网/校外网矩阵仍未形成可复现记录，详见[真实网络烟测记录](docs/validation/live-smoke.md)。

## 默认功能

- 统一身份认证入口默认通过 aTrust 打开，但 CAS `service` 回调保持原值；扩展只改写当前导航的外层 SSO 主机。
- 团委 `/info/...htm` 文章默认转换为公网 `content.jsp` 地址。
- “全部 CQU 域名”默认关闭，开启时浏览器会请求额外域名权限。学校未在 aTrust 发布的资源仍可能不可用。
- IP:port 只支持随扩展发布且经过真实验证的名单。当前没有获授权且验证通过的端点，所以内置 IP:port 名单为空。
- 只处理 HTTP(S) 顶层导航，不改写 iframe、XHR、fetch、WebSocket 或请求体。

## 安装

开发版本运行 `pnpm build` 后，在 Chromium 扩展管理页开启开发者模式并加载 `.output/chrome-mv3`。

发布版本运行 `pnpm zip`，解压 WXT 在 `.output` 中生成的 zip 后按相同步骤加载。正式提交前应复核[双商店提交清单](docs/store/submission-checklist.md)和真实网络证据边界。

## 界面与设计系统

- [DESIGN.md](DESIGN.md) 是视觉、布局、品牌、组件、动效和文案的生产规范。
- `src/ui/react/design-system.css` 保存 Vercel 基底令牌和共享组件样式。
- `public/fonts/`、`public/brand/` 和 `public/icon/` 保存离线字体、唯一 Logo 源与 Manifest 图标。
- [设计交接](docs/design/README.md) 记录 Open Design 来源映射。日常开发不再依赖 Open Design 项目目录。

## 控制与回退

弹窗会显示当前改写规则。用户可以让当前标签页原地址打开一次，也可以暂停当前站点；长期规则、总开关和可选的全 CQU 模式在设置页管理。aTrust 返回错误页时扩展不会静默回退，用户可主动选择原地址。

规则按以下优先级处理，首个终止型规则获胜：

1. 已经位于 `*.atrust.cqu.edu.cn` 的地址停止处理，避免二次代理。
2. 当前标签页的一次性绕过和用户排除项。
3. 用户本地精确规则。
4. 团委等路径修正规则。
5. 重要站点及随版本发布的验证名单。
6. 默认关闭的“全部 CQU 域名”模式。

## 自定义规则限制

首版只接受不带协议、路径、端口或通配符的精确 CQU DNS 域名，并在用户点击添加时申请源站和生成后 aTrust 目标的精确主机权限。IP、IPv6、userinfo、aTrust 源地址和已有规则会被拒绝。首版不支持用户自定义 IP:port；也不会为此申请 `<all_urls>`。

## 权限说明

- `storage`：在本机保存设置、内置规则覆盖、自定义规则和排除项。
- `activeTab`：让弹窗说明当前标签页并执行用户主动触发的一次性原地址打开或暂停操作。
- `declarativeNetRequestWithHostAccess`：在顶层请求发出前应用内置重定向、用户精确规则、已授权的全 CQU 预置规则、排除和一次性绕过。
- `webNavigation`：记录顶层导航结果，并为带额外查询参数的团委链接、超过预置捕获深度的全 CQU 域名等情况执行后台回退。
- 必需主机权限只包含 SSO、团委来源和 SSO aTrust 目标；`cqu.edu.cn`/`*.cqu.edu.cn` 是用户开启全域模式时才请求的可选权限。

生成的 Manifest 不要求 `<all_urls>`，也不声明浏览历史、Cookie 或请求体权限。

## 隐私

扩展不会查询浏览器的历史记录数据库，也不会把浏览活动发送给开发者或第三方。为完成链接修正，它会在本机处理当前顶层导航的 URL/域名，并在本机保存规则、排除项和临时改写状态。扩展不提供遥测或远程规则服务，不读取请求体、凭据、Cookie、验证码或 CAS 票据值；检测到顶层 URL 存在 `ticket` 参数时会跳过全部改写且不创建改写记录。完整的数据处理、保留和删除说明见[隐私政策](PRIVACY.md)。

## 开发与测试

要求 Node.js 与 pnpm 11。常用命令：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify
pnpm zip
```

`pnpm dev` 会启动 WXT 开发模式；`pnpm build` 生成可直接加载的 `.output/chrome-mv3`；`pnpm zip` 生成带版本号的安装包。

`pnpm test:e2e` 会重新构建并运行 loaded-extension 自动化测试；默认 E2E 使用本地路由 fixture，因此不能替代[真实网络烟测](docs/validation/live-smoke.md)。可选权限批准门需在弹窗中批准两个请求：

```bash
pnpm build
CQU_E2E_PERMISSION_GATE=1 CQU_E2E_HEADED=1 pnpm exec playwright test --grep "grants exact custom" --timeout=120000
```

可选权限拒绝门只请求“全部 CQU 域名”权限；运行后在 Chromium 原生弹窗中点击拒绝。测试会确认全域模式仍关闭、通配权限未授予、核心 SSO 精确规则仍正常：

```bash
pnpm build
CQU_E2E_PERMISSION_DENIAL_GATE=1 CQU_E2E_HEADED=1 pnpm exec playwright test --grep "after prompt rejection" --timeout=120000
```

## 验证状态

自动化测试、构建与打包状态应以当前提交重新运行的结果为准。真实网络记录不得由 fixture E2E 代替。当前无需认证的 SSO 外层改写、登录页首次可达、解码后 `service` 保持和无循环检查已取得部分证据；真实客户端登录回调、校园/校外完整矩阵仍未执行。2026-07-22 用户确认团委规则已在实际使用中正常工作；这项用户验证不等同于对历史测试会话的复跑，证据边界见[真实网络烟测记录](docs/validation/live-smoke.md)。

解除门禁需要用户在可确认的校园网和校外网环境分别操作真实登录，并在校外连接 aTrust 客户端后复测；全过程不得记录账号、密码、验证码、CAS 票据、Cookie 或账户标识。完整步骤与结果见[真实网络烟测记录](docs/validation/live-smoke.md)。

## 已知限制

格式正确的 aTrust 地址仍可能因为学校未发布对应资源而无法访问。设置控制台会在独立标签页中打开，并使用紧凑规则列表管理全局状态、可选权限、自定义规则和暂停站点；扩展弹窗仍只负责当前标签页的快捷操作。真实站点也可能受学校 WAF、网络位置或客户端状态影响；扩展只负责链接改写，不能绕过站点访问控制。
