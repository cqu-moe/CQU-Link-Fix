# 真实网络烟测记录

> 日期时区：Asia/Shanghai。本文只记录经过脱敏的可观察结果；不记录账号、凭据、票据、Cookie 或其他身份标识。

| Date | Network | aTrust client | Original URL | Rewritten URL | Login page | Original service preserved | Client session established | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-12 | 校园网 | 未连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 校外网 | 未连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 校外网 | 已连接 | `https://my.cqu.edu.cn/`（真实客户端入口） | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` | `NOT RUN` |
| 2026-07-12 | 当前网络（校园/校外未独立确认） | 未运行（只读进程检查） | `https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fauthserver%2Fauthentication%2Fcas` | `https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fauthserver%2Fauthentication%2Fcas` | `PASS`：首次 HTTP 200，标题“统一身份认证平台” | `PASS`：前后解码值均为 `https://my.cqu.edu.cn/authserver/authentication/cas` | `NOT RUN`：未登录 | `PARTIAL` |
| 2026-07-12 | 当前网络（校园/校外未独立确认） | 未运行（只读进程检查） | `https://youth.cqu.edu.cn/info/1009/24264.htm` | `https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264` | 不适用 | 不适用 | 不适用 | `FAIL`：规则正确改写，但真实目标响应 HTTP 412，文章不可达 |

## IP:port 规则

未提供任何经授权的 IP:port 测试端点，因此没有拟发布的 IP:port 规则或对应烟测行；内置名单保持为空。

## 可观察证据

- 使用 WXT 生产构建 `.output/chrome-mv3`，以全新临时配置加载到 Chrome for Testing 149；测试没有安装任何路由 fixture，也没有提交凭据。
- 在导航前确认扩展 service worker 已就绪，且 Chromium 中存在 2 条动态 DNR 规则。
- SSO 主框架序列为原始主机 → aTrust 主机；首次 aTrust 响应为 HTTP 200。刷新仍停留在同一 aTrust URL，未返回原始主机或产生重定向环；刷新响应为 HTTP 400，故本记录只把首次登录页可达性记为 PASS。
- 团委主框架序列为 `/info/1009/24264.htm` → `/content.jsp`，生成的三个参数完全正确；headless 与 headed Chromium 均得到 HTTP 412，故文章可达性记为 FAIL。
- `my.cqu.edu.cn` 客户端首页的独立无凭据探测返回 HTTP 412，未取得可用于客户端发起流程的真实跳转；本次只使用设计文档中的无害 CAS 回调地址验证外层登录 URL，不把它当作会话建立证据。
- 当前默认路由存在，但 SSID 名称检查没有确认校园网；因此没有把先前的网络状态声明当成本轮校园网证据。重复的精确进程名检查未发现运行中的 aTrust/Sangfor/EasyConnect 组件。

## 状态解释

- `PASS`：该单元格的可观察条件已经满足。
- `PARTIAL`：无需认证的子步骤通过，但整行缺少真实登录回调/会话证据。
- `FAIL`：已经执行，且期望的真实网络结果未满足。
- `NOT RUN`：没有执行，或无法确认执行所需的网络/客户端条件。

## 发布门禁

**BLOCKED**：真实 CAS 登录回调、校园网与校外网组合尚未验证，团委文章在当前网络返回 HTTP 412。未完成全部必需行之前不得宣称可发布。

解除门禁需要用户依次执行：

1. 在可确认的校园网、aTrust 未运行状态下，用无痕测试配置访问真实 CAS 客户端并完成登录，确认原始客户端建立业务会话。
2. 切换到可确认的校外网络且保持 aTrust 未运行，重复完整登录和回调验证。
3. 由用户连接 aTrust 客户端后，在校外网络重复验证，确认无冲突和循环。
4. 在正常人工浏览器会话中复测团委示例文章；只有公网 `content.jsp` 正文真实可读后才能把该行改为 PASS。
