# CQU Link Fix 隐私政策

**生效日期：2026 年 7 月 22 日**  
**最后更新：2026 年 7 月 22 日**

## 1. 适用范围与项目身份

本政策适用于通过 Chrome Web Store、Microsoft Edge Add-ons 或本项目 GitHub 仓库提供的 CQU Link Fix 浏览器扩展。

CQU Link Fix 是独立维护的社区工具，不代表重庆大学、深信服科技有限公司、Google、Microsoft 或相关网站运营方，也不用于绕过任何网站的身份认证或访问控制。

## 2. 扩展的单一用途

CQU Link Fix 的用途是在用户访问重庆大学相关网站时，根据随扩展发布的规则或用户明确启用的规则，在本机修正顶层导航链接，并提供暂停改写和原地址回退控制。

## 3. 在本机处理的信息

为了提供上述功能，扩展会在用户设备上处理：

- 当前顶层导航的 URL 和域名，用于判断是否命中链接修正规则；
- 扩展总开关、内置规则开关和可选的“全部 CQU 域名”模式；
- 用户主动添加的精确 CQU 域名规则与暂停/排除站点；
- 当前标签页的临时改写记录、一次性原地址回退状态和规则协调状态。

这些信息仅用于提供扩展面向用户的链接修正、状态展示、暂停和回退功能。扩展不会查询浏览器的完整历史记录数据库。

## 4. 存储与保留

- 长期设置保存在浏览器提供的 `storage.local` 中，并一直保留到用户修改或重置设置、清除扩展数据，或者卸载扩展。
- 当前导航、一次性回退和权限协调等临时状态保存在 `storage.session` 中，并在对应导航、标签页或浏览器会话结束后清理；扩展也会在相关操作完成时主动清理。

所有上述存储均位于用户自己的浏览器配置中。

## 5. 不传输、不出售、不共享

CQU Link Fix 不提供开发者后端、账号系统、遥测、分析、广告或远程规则服务。扩展不会向开发者服务器、分析平台、广告平台、数据经纪商或其他第三方传输、出售、许可或共享上述信息，也不会将其用于广告、画像、信用评估或与单一用途无关的目的。

扩展执行链接修正后，浏览器会像用户直接访问一样向目标重庆大学或 aTrust 网站发出正常的 HTTPS 导航请求。该请求由目标网站处理，受目标网站自身的隐私政策和访问控制约束；它不是向 CQU Link Fix 开发者传输数据。

## 6. 认证信息保护

扩展不申请 Cookie、浏览历史数据库或请求体权限，也不读取密码、验证码、Cookie、请求体或 CAS ticket 值。

如果当前顶层 URL 包含名为 `ticket` 的 CAS 参数，扩展只判断该参数是否存在，并立即跳过链接改写；它不会读取、记录或保存票据值。编码在 `service` 参数内部的文本不会被当作顶层票据处理。

## 7. 权限用途

- `storage`：在用户设备上保存扩展开关、规则、排除项和临时状态。
- `activeTab`：在用户打开弹窗或主动操作时识别当前标签页，并执行“原地址打开一次”或“暂停当前站点”。
- `declarativeNetRequestWithHostAccess`：对明确授权的顶层请求应用精确重定向、排除和一次性回退规则，不读取请求体、Cookie 或响应正文。
- `webNavigation`：识别顶层导航状态、避免重复改写，并处理用户主动启用且无法由固定规则表达的 CQU 域名模式。
- 必需主机权限：仅覆盖内置规则需要的重庆大学 SSO、团委来源和对应 aTrust 目标。
- 可选主机权限：仅在用户开启全部 CQU 域名模式或添加精确自定义 CQU 域名时，通过浏览器原生授权提示申请。

扩展不会加载或执行远程托管代码；所有可执行代码和字体资源均随安装包发布并接受商店审核。

## 8. 用户控制与删除

用户可以随时：

- 关闭全部链接改写；
- 停用单条内置规则；
- 删除自定义规则或恢复暂停站点；
- 关闭全部 CQU 域名模式并撤销对应可选权限；
- 通过浏览器的扩展管理页面清除扩展数据或卸载扩展。

卸载扩展会由浏览器删除扩展拥有的本地和会话存储。

## 9. 儿童隐私

CQU Link Fix 不面向儿童提供账号、社交、广告或数据收集服务，也不会有意收集儿童个人信息。

## 10. Chrome Web Store Limited Use

使用从 Chrome API 获得的信息将遵守 [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)，包括 Limited Use 要求。

## 11. 政策变更与联系

如果扩展的数据处理方式发生实质变化，本政策会随对应代码版本一同更新，并修改顶部日期。不会通过仅修改本政策来扩大实际数据用途。

如对本政策或扩展行为有疑问，请通过公开的 [GitHub Issues](https://github.com/cqu-moe/CQU-Link-Fix/issues) 联系维护者。提交问题时请勿附带账号、密码、验证码、CAS ticket、Cookie、学号或其他身份信息。

---

# CQU Link Fix Privacy Policy

**Effective date: July 22, 2026**  
**Last updated: July 22, 2026**

## 1. Scope and project identity

This policy applies to the CQU Link Fix browser extension distributed through the Chrome Web Store, Microsoft Edge Add-ons, or this project's GitHub repository.

CQU Link Fix is an independently maintained community tool. It is not affiliated with or endorsed by Chongqing University, Sangfor Technologies, Google, Microsoft, or the operators of related websites. It does not bypass authentication or access controls.

## 2. Single purpose

CQU Link Fix repairs top-level navigation links for Chongqing University websites using rules shipped with the extension or explicitly enabled by the user. It also provides controls to pause rewriting and reopen the original URL.

## 3. Information handled locally

To provide that functionality, the extension handles the following information on the user's device:

- the current top-level navigation URL and domain, to determine whether a repair rule applies;
- the global enable state, built-in rule states, and the optional all-CQU-domain mode;
- exact CQU domain rules and paused or excluded sites added by the user;
- temporary rewrite records, one-time original-URL bypass state, and rule-coordination state for the current tab.

This information is used only for the user-facing link repair, status, pause, and rollback features. The extension does not query the browser's complete history database.

## 4. Storage and retention

- Persistent settings are stored in the browser-provided `storage.local` area until the user changes or resets them, clears extension data, or uninstalls the extension.
- Temporary navigation, one-time bypass, and permission-coordination state is stored in `storage.session`. It is cleared when the corresponding navigation, tab, or browser session ends, and the extension also removes it when the related operation finishes.

All of this storage remains inside the user's browser profile.

## 5. No transmission, sale, or sharing

CQU Link Fix has no developer backend, user account system, telemetry, analytics, advertising, or remote rule service. The extension does not transmit the information described above to the developer, analytics providers, advertising platforms, data brokers, or other third parties. It does not sell, license, or share that information, and does not use it for advertising, profiling, credit assessment, or any purpose unrelated to its single purpose.

After a link is repaired, the browser makes a normal HTTPS navigation request to the selected Chongqing University or aTrust destination, just as it would if the user opened that destination directly. The destination site handles that request under its own privacy policy and access controls; it is not a transfer to the CQU Link Fix developer.

## 6. Authentication safeguards

The extension does not request Cookie, browser-history-database, or request-body permissions. It does not read passwords, verification codes, Cookies, request bodies, or CAS ticket values.

If a top-level URL contains a CAS parameter named `ticket`, the extension checks only that the parameter is present and immediately skips rewriting. It does not read, record, or store the ticket value. Text encoded inside a `service` parameter is not treated as a top-level ticket.

## 7. Permission use

- `storage`: stores extension settings, rules, exclusions, and temporary state on the user's device.
- `activeTab`: identifies the active tab when the user opens the popup or takes an explicit action, and supports reopening the original URL or pausing the current site.
- `declarativeNetRequestWithHostAccess`: applies exact top-level redirect, exclusion, and one-time bypass rules on authorized hosts without reading request bodies, Cookies, or response content.
- `webNavigation`: observes top-level navigation state, prevents repeated rewriting, and handles user-enabled CQU domain behavior that cannot be represented by fixed rules.
- Required host permissions: cover only the Chongqing University SSO, Youth League source, and corresponding aTrust destination needed by built-in rules.
- Optional host permissions: are requested through the browser's native prompt only when the user enables all-CQU-domain mode or adds an exact custom CQU domain.

The extension does not load or execute remotely hosted code. All executable code and font resources are included in the submitted package and reviewed by the browser stores.

## 8. User controls and deletion

Users can disable all rewriting, disable individual built-in rules, delete custom rules, resume paused sites, turn off all-CQU-domain mode, and revoke optional permissions at any time. Users can also clear extension data or uninstall the extension through the browser's extension management page.

When the extension is uninstalled, the browser removes the local and session storage owned by the extension.

## 9. Children's privacy

CQU Link Fix does not provide accounts, social features, advertising, or data-collection services directed at children, and does not knowingly collect children's personal information.

## 10. Chrome Web Store Limited Use

The use of information received from Chrome APIs will comply with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## 11. Changes and contact

If the extension's data practices materially change, this policy will be updated with the corresponding code version and the date above will be revised. The policy will not be changed on its own to expand how the extension actually uses data.

For questions about this policy or the extension's behavior, contact the maintainers through public [GitHub Issues](https://github.com/cqu-moe/CQU-Link-Fix/issues). Do not include account credentials, passwords, verification codes, CAS tickets, Cookies, student IDs, or other identifying information in an issue.
