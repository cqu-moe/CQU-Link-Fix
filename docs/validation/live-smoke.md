# 真实网络烟测记录

> 日期时区：Asia/Shanghai。本文只记录经过脱敏的可观察结果；不记录账号、凭据、票据、Cookie 或其他身份标识。

## 测试版本与证据边界

- 本页真实网络观察对应运行时代码提交 `e138044f07ca304de2cf81c5d5f935495bf5b17f`（`test: cover browser redirect flows`）。测试使用的 zip SHA-256 为 `b70a43e71517e81e5ad2326d87ac348f26039f789a4ad3e8bb3c1e4145bfe24f`。
- 该版本启动后观察到的 2 条动态规则仅为当时的 SSO 与团委重定向规则。这是历史实测值，不代表后续提交或当前 HEAD 的规则数量。
- 后续 `cc8c1917131d01c5710b7a04071cf1684469d5d2` 与 `82aafd054e88c7c9c538d916d5131e640164fbd5` 增加并校准了顶层 CAS `ticket` 的高优先级 allow 防护；这些改动通过单元测试和 loaded-Chromium E2E 验证，但没有重新执行本页真实网络烟测。因此不得把本页结果表述为最终 HEAD 的 live PASS。
- 2026-07-13 在本文所在提交重新运行 production build + loaded-extension Playwright：16 条自动化用例 PASS，浏览器原生可选权限批准/拒绝的 2 条 headed 人工用例默认 SKIP。新增自动化覆盖链接点击、真实 HTTP 302 响应触发的 CAS 导航、前进/后退无循环、停用内置规则后重启 service worker 仍保留选择，以及 Popup 运行状态。该证据使用本地 fixture，不属于下表的真实网络 PASS。
- 2026-07-22 用户确认团委链接修正规则已在其实际浏览器使用中正常工作。该确认没有附带可公开的网络位置、HTTP 响应或脱敏截图，因此在本文中记为 `USER-VERIFIED`，不反向修改 2026-07-12 特定网络会话的历史 `FAIL` 行，也不表示完整网络矩阵已复跑。
- 2026-07-22 的首次导航修复把默认 SSO/团委规则随安装包作为启用的静态 DNR 规则交给 Chromium，并为可选全 CQU 模式加入默认关闭、仅在权限和设置开启后启用的静态规则集。停用内置规则时还会保留高优先级动态 allow 防护，覆盖静态规则状态在 worker/扩展边界重新加载的窗口。loaded-Chromium 自动化确认空动态规则、残缺动态规则和停用规则后的 worker 重启均不会漏改写、重复改写或恢复已停用规则；这仍是本地 fixture 证据，不是新的真实网络 PASS。

| Date | Network | aTrust client | Original URL | Rewritten URL | Login page | Original service preserved | Client session established | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-12 | 校园网 | 未连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 校外网 | 未连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 校外网 | 已连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 当前网络（校园/校外未独立确认） | 未运行（只读进程检查） | `https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fauthserver%2Fauthentication%2Fcas` | `https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fauthserver%2Fauthentication%2Fcas` | `PASS`：首次 HTTP 200，标题“统一身份认证平台” | `PASS`：前后解码值均为 `https://my.cqu.edu.cn/authserver/authentication/cas` | `NOT RUN`：未登录 | `PARTIAL` |
| 2026-07-12 | 当前网络（校园/校外未独立确认） | 未运行（只读进程检查） | `https://youth.cqu.edu.cn/info/1009/24264.htm` | `https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264` | 不适用 | 不适用 | 不适用 | `FAIL`：规则正确改写，但真实目标响应 HTTP 412，文章不可达 |

## IP:port 规则

未提供任何经授权的 IP:port 测试端点，因此没有拟发布的 IP:port 规则或对应烟测行；内置名单保持为空。

## 当前自动化证据边界

- 链接点击与服务器 HTTP 302 均从非 SSO 页面发起，最终主框架被扩展改写到 aTrust SSO 主机，CAS `service` 解码值保持不变。
- 对改写目标执行浏览器后退、再次后退、前进、再次前进，导航在来源页、aTrust 目标与后续页之间稳定切换，没有重复改写循环。
- 通过 Options 的后台 settings mutation 停用 `core-sso`，确认静态规则 ID 已禁用、动态重定向已移除且持久 allow 防护已安装；停止并重新唤醒真实 MV3 service worker 后，原始 SSO 地址仍不改写。
- 默认 SSO/团委规则在安装包内预置，因此首次导航不再依赖 service worker 先完成动态规则重建；自动化同时断言浏览器只产生一次目标导航。
- 权限拒绝的确定性状态变化由单元测试覆盖；Chromium 浏览器 chrome 中的真实拒绝按钮用 `CQU_E2E_PERMISSION_DENIAL_GATE=1 CQU_E2E_HEADED=1 pnpm exec playwright test --grep "after prompt rejection" --timeout=120000` 人工执行。操作员必须在唯一的“全部 CQU 域名”原生提示中点击拒绝；用例随后断言开关关闭、通配权限不存在且核心 SSO 仍改写。
- 上述自动化不提交凭据、不建立真实客户端业务会话，也不能替代校园网/校外网的真实登录回调验证。团委规则已获得后续用户使用确认；2026-07-12 的 HTTP 412 只代表当时测试网络的历史结果。

## 可观察证据

- 使用上述固定提交和 zip 对应的 WXT 生产构建 `.output/chrome-mv3`，以全新临时配置加载到 Chrome for Testing 149；测试没有安装任何路由 fixture，也没有提交凭据。
- 在导航前确认扩展 service worker 已就绪，且 Chromium 中存在 2 条动态 DNR 规则。
- SSO 主框架序列为原始主机 → aTrust 主机；首次 aTrust 响应为 HTTP 200。刷新仍停留在同一 aTrust URL，未返回原始主机或产生重定向环；刷新响应为 HTTP 400，故本记录只把首次登录页可达性记为 PASS。
- 在 2026-07-12 的测试会话中，团委主框架序列为 `/info/1009/24264.htm` → `/content.jsp`，生成的三个参数完全正确；headless 与 headed Chromium 均得到 HTTP 412，故该历史会话的文章可达性记为 FAIL。2026-07-22 的 `USER-VERIFIED` 确认说明该结果不能外推为规则当前不可用。
- `my.cqu.edu.cn` 客户端首页的独立无凭据探测返回 HTTP 412，未取得可用于客户端发起流程的真实跳转；本次只使用设计文档中的无害 CAS 回调地址验证外层登录 URL，不把它当作会话建立证据。
- 当前默认路由存在，但 SSID 名称检查没有确认校园网；因此没有把先前的网络状态声明当成本轮校园网证据。重复的精确进程名检查未发现运行中的 aTrust/Sangfor/EasyConnect 组件。

## 状态解释

- `PASS`：该单元格的可观察条件已经满足。
- `PARTIAL`：无需认证的子步骤通过，但整行缺少真实登录回调/会话证据。
- `FAIL`：已经执行，且期望的真实网络结果未满足。
- `USER-VERIFIED`：用户确认实际功能可用，但没有提供足以复现该会话的脱敏技术记录。
- `NOT RUN`：没有执行，或无法确认执行所需的网络/客户端条件。

## 发布门禁

**PARTIAL**：真实 CAS 登录回调、校园网与校外网组合尚未形成完整的脱敏验证记录。团委规则已获 2026-07-22 用户实际使用确认，不再作为当前已知坏链接；但该确认不能替代历史测试表或其他网络环境的可复现证据。

解除门禁需要用户依次执行：

1. 在可确认的校园网、aTrust 未运行状态下，用无痕测试配置访问真实 CAS 客户端并完成登录，确认原始客户端建立业务会话。
2. 切换到可确认的校外网络且保持 aTrust 未运行，重复完整登录和回调验证。
3. 由用户连接 aTrust 客户端后，在校外网络重复验证，确认无冲突和循环。
4. 如需把团委历史行改为新的技术 `PASS`，在正常人工浏览器会话中记录一条不含身份信息的脱敏可达性证据；在此之前保留 `USER-VERIFIED` 边界。
