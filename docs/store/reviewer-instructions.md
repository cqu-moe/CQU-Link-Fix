# Chrome / Edge 审核测试说明

以下内容可粘贴到 Chrome 的 Test instructions 和 Edge 的 Notes for certification。测试 URL 均为合成或公开示例，不包含真实 CAS ticket、账号或身份信息。

## 中文版

### 前置条件

- 无需扩展账号。
- 不需要、也不应提供个人重庆大学账号、密码、验证码、Cookie 或 CAS ticket。
- 默认内置规则安装后即可测试；“全部 CQU 域名”是默认关闭的可选功能。

### 测试 1：SSO 顶层链接修正

1. 在新标签页打开：`https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcallback`
2. 观察地址栏。扩展应只把外层主机修正为 `sso-cqu-edu-cn-s.atrust.cqu.edu.cn`，并保留路径、查询参数以及解码后的 `service=https://client.example/callback`。
3. 打开扩展弹窗，应看到本次改写状态和对应的 SSO 规则。
4. 点击“原地址打开一次”，该标签页应返回原始 `sso.cqu.edu.cn` 地址，并且这一轮不再次改写。

目标站点的最终 HTTP 响应可能受重庆大学服务、审核网络位置或 aTrust 状态影响。可审核的核心行为是地址转换、参数保留、本地状态和一次性回退；扩展不会代替目标站点完成登录。

### 测试 2：团委文章链接结构修正

1. 打开公开示例：`https://youth.cqu.edu.cn/info/1009/24264.htm`
2. 地址应被修正到同一站点的 `/content.jsp`，并生成与原路径对应的 `urltype=news.NewsContentUrl`、`wbtreeid=1009` 和 `wbnewsid=24264` 参数。
3. 打开弹窗，应显示“团委官网链接”。
4. 可以再次测试“原地址打开一次”。

该规则已由用户在实际使用中确认可用；外部页面的响应仍可能随站点防护或网络环境变化。

### 测试 3：暂停与恢复

1. 在发生改写的标签页打开弹窗，点击“暂停当前站点”。
2. 再次访问该来源站点时，不应改写。
3. 打开扩展设置页，在“暂停站点”中恢复该域名，再次访问时应恢复规则行为。

### 测试 4：可选权限

1. 打开扩展设置页，启用“全部 CQU 域名模式”。
2. 浏览器应显示对 `cqu.edu.cn` 与 `*.cqu.edu.cn` 的原生可选权限提示。
3. 批准后模式开启；关闭模式会撤销该可选权限。
4. 拒绝提示后模式保持关闭，内置 SSO 和团委精确规则仍可运行。

### 安全边界

扩展只处理顶层 HTTP(S) 导航，不读取网页正文、请求体、Cookie、密码、验证码或 CAS ticket 值。若顶层 URL 含 `ticket` 参数，扩展只检查其存在并跳过改写，不读取或保存票据值。

## English version

### Prerequisites

- No extension account is required.
- Do not provide personal CQU credentials, passwords, verification codes, Cookies, or CAS tickets.
- Built-in rules are ready after installation. All-CQU-domain mode is an optional feature and is off by default.

### Test 1: top-level SSO link repair

1. Open `https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcallback` in a new tab.
2. The outer host should change to `sso-cqu-edu-cn-s.atrust.cqu.edu.cn`. The path, query parameters, and decoded `service=https://client.example/callback` value must remain unchanged.
3. Open the extension popup. It should show the rewrite and the matching SSO rule.
4. Select the one-time original-URL action. The tab should return to the original `sso.cqu.edu.cn` URL without being rewritten again for that navigation.

The destination HTTP response can depend on Chongqing University services, the reviewer's network location, or aTrust. The reviewable core behavior is URL transformation, parameter preservation, local status, and one-time rollback. The extension does not perform login on behalf of the user.

### Test 2: Youth League article structure repair

1. Open `https://youth.cqu.edu.cn/info/1009/24264.htm`.
2. The path should change to `/content.jsp`, with `urltype=news.NewsContentUrl`, `wbtreeid=1009`, and `wbnewsid=24264` generated from the source path.
3. The popup should show the Youth League rule.
4. The one-time original-URL action can be tested again.

The rule has been confirmed in normal user operation. The external page response may still vary with site protection or network conditions.

### Test 3: pause and resume

1. Open the popup on a rewritten tab and pause the current site.
2. A new visit to that source site should not be rewritten.
3. Resume the domain from the Paused sites section of the options page; subsequent visits should use the rule again.

### Test 4: optional permission

1. Enable all-CQU-domain mode from the options page.
2. The browser should show its native optional-permission prompt for `cqu.edu.cn` and `*.cqu.edu.cn`.
3. Approval enables the mode; turning it off revokes the optional permission.
4. Rejection leaves the mode off while the exact built-in SSO and Youth League rules continue to work.

### Security boundary

The extension handles only top-level HTTP(S) navigation. It does not read page content, request bodies, Cookies, passwords, verification codes, or CAS ticket values. If a top-level URL contains a `ticket` parameter, the extension checks only its presence and skips rewriting without reading or storing its value.

