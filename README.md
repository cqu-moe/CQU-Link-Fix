# CQU Link Fix

面向 Chromium 的重庆大学链接修正扩展。当前版本是功能性首版，发布门禁仍为 **BLOCKED**；详见[真实网络烟测记录](docs/validation/live-smoke.md)。

## 默认功能

- 统一身份认证入口默认通过 aTrust 打开，但 CAS `service` 回调保持原值；扩展只改写当前导航的外层 SSO 主机。
- 团委 `/info/...htm` 文章默认转换为公网 `content.jsp` 地址。
- “全部 CQU 域名”默认关闭，开启时浏览器会请求额外域名权限。学校未在 aTrust 发布的资源仍可能不可用。
- IP:port 只支持随扩展发布且经过真实验证的名单。当前没有获授权且验证通过的端点，所以内置 IP:port 名单为空。
- 只处理 HTTP(S) 顶层导航，不改写 iframe、XHR、fetch、WebSocket 或请求体。

## 安装

开发版本运行 `pnpm build` 后，在 Chromium 扩展管理页开启开发者模式并加载 `.output/chrome-mv3`。

发布版本运行 `pnpm zip`，解压 WXT 在 `.output` 中生成的 zip 后按相同步骤加载。当前包仅供验证，不应在发布门禁解除前作为正式版本发布。

## 控制与回退

弹窗会显示当前改写规则。用户可以让当前标签页原地址打开一次，也可以暂停当前站点；长期规则、总开关和可选的全 CQU 模式在设置页管理。aTrust 返回错误页时扩展不会静默回退，用户可主动选择原地址。

规则按以下优先级处理，首个终止型规则获胜：

1. 已经位于 `*.atrust.cqu.edu.cn` 的地址停止处理，避免二次代理。
2. 当前标签页的一次性绕过和用户排除项。
3. 用户本地精确规则。
4. 团委等路径修正规则。
5. 核心认证及随版本发布的验证名单。
6. 默认关闭的“全部 CQU 域名”模式。

## 自定义规则限制

首版只接受不带协议、路径、端口或通配符的精确 CQU DNS 域名，并在用户点击添加时申请源站和生成后 aTrust 目标的精确主机权限。IP、IPv6、userinfo、aTrust 源地址和已有规则会被拒绝。首版不支持用户自定义 IP:port；也不会为此申请 `<all_urls>`。

## 权限说明

- `storage`：在本机保存设置、内置规则覆盖、自定义规则和排除项。
- `activeTab`：让弹窗说明当前标签页并执行用户主动触发的一次性原地址打开或暂停操作。
- `declarativeNetRequestWithHostAccess`：在顶层请求发出前应用精确重定向、排除和一次性绕过规则。
- `webNavigation`：记录顶层导航结果，并处理无法由固定规则表达的可选全 CQU 模式。
- 必需主机权限只包含 SSO、团委来源和 SSO aTrust 目标；`cqu.edu.cn`/`*.cqu.edu.cn` 是用户开启全域模式时才请求的可选权限。

生成的 Manifest 不要求 `<all_urls>`，也不声明浏览历史、Cookie 或请求体权限。

## 隐私

扩展不提供遥测或远程规则服务，不读取浏览历史、请求体、凭据、Cookie 或验证码。设置仅保存在 `chrome.storage.local`。用于解释改写和一次性绕过的临时状态保存在浏览器会话存储，并在对应导航或标签页结束后清理。扩展不访问 CAS 票据值；检测到顶层 URL 存在 `ticket` 参数时会跳过全部改写且不创建改写记录，编码在 `service` 值内部的文本不会触发该保护。

## 开发与测试

要求 Node.js 与 pnpm。常用命令：

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

`pnpm test:e2e` 会重新构建并运行 loaded-extension 自动化测试；默认 E2E 使用本地路由 fixture，因此不能替代[真实网络烟测](docs/validation/live-smoke.md)。可选权限的真实 headed 门禁命令为：

```bash
CQU_E2E_PERMISSION_GATE=1 CQU_E2E_HEADED=1 pnpm test:e2e --grep "grants exact custom" --timeout=120000
```

## 验证状态

自动化测试、构建与打包状态应以当前提交重新运行的结果为准。真实网络记录不得由 fixture E2E 代替。当前无需认证的 SSO 外层改写、登录页首次可达、解码后 `service` 保持和无循环检查已取得部分证据；真实客户端登录回调、校园/校外完整矩阵仍未执行，团委文章当前返回 HTTP 412。因此发布状态为 **BLOCKED**。

解除门禁需要用户在可确认的校园网和校外网环境分别操作真实登录，并在校外连接 aTrust 客户端后复测；全过程不得记录账号、密码、验证码、CAS 票据、Cookie 或账户标识。完整步骤与结果见[真实网络烟测记录](docs/validation/live-smoke.md)。

## 已知限制

格式正确的 aTrust 地址仍可能因为学校未发布对应资源而无法访问。首版 UI 只保证功能清楚可用，视觉设计将在功能稳定后重做。真实站点也可能受学校 WAF、网络位置或客户端状态影响；扩展只负责链接改写，不能绕过站点访问控制。
