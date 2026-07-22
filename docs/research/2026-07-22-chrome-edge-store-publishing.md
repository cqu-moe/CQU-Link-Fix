# CQU Link Fix 上架 Chrome Web Store 与 Microsoft Edge Add-ons 研究

> 核对日期：2026-07-22
>
> 适用版本：CQU Link Fix 0.3.1，Chromium Manifest V3
>
> 来源范围：仅使用 Chrome Developers / Google 官方资料和 Microsoft Learn / Partner Center 官方资料。商店后台可能继续调整字段，以实际账号中显示的表单为最终准绳。

## 结论

CQU Link Fix 不需要为 Edge 重写一套代码。当前 WXT 产物已经是 Manifest V3，ZIP 根目录含 `manifest.json`，扩展名和描述不含 “Chrome”，也没有 `update_url`；Microsoft 官方兼容性表同时列出了本项目使用的 `declarativeNetRequest`、`permissions`、`storage` 和 `webNavigation`，所以同一个发布 ZIP 可以作为 Chrome 和 Edge 的候选包。正式提交前仍必须在 Edge 中侧载验收，因为 Microsoft 明确要求检查 API 支持并在 Edge 中测试。[Chrome 移植 Edge 指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)；[Edge API 支持表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)；[Edge 权限表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/declare-permissions)

项目的 ZIP 技术基础已经满足双商店要求。本轮发布准备已完成 Manifest 本地化、双语隐私政策、商店文案、审核说明、草稿素材、Chromium 全量自动化和 Microsoft Edge 侧载烟测。正式提交前还要处理以下现场事项：

1. [真实网络烟测记录](../validation/live-smoke.md)中的 2026-07-12 团委 HTTP 412 是特定网络会话的历史结果；2026-07-22 用户已确认团委规则在实际使用中正常工作，因此它不再作为当前已知坏链接。完整 CAS 登录回调与校园网/校外网矩阵仍缺少可复现记录；仓库已经准备了无需个人凭据的审核步骤，并明确区分 URL 转换与目标站点响应。[Edge 开发者政策 1.1.3 与 1.3](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#113-functionality)；[Chrome 发布前准备](https://developer.chrome.com/docs/webstore/prepare)
2. 仓库已公开，根目录 `PRIVACY.md`、Issues 与项目主页已经完成无需登录的访问复核，可作为首次提交使用的项目与隐私政策 URL。
3. 两张 1280×800 截图、440×280 小宣传图和 300×300 Edge Logo 已生成，明天由维护者决定直接使用还是调整第二版。
4. Chrome 账号已由维护者注册；两步验证、联系邮箱、Trader/Non-Trader、分发地区和 Edge program 账号类型仍需在实际后台核对或选择。

因此，下一步顺序是：**公开仓库并复核政策 URL，确认草稿素材，在两家后台核对账号/法律字段，然后上传同一个已验证 ZIP。**

## 1. 当前仓库就绪度

| 检查项 | 现状 | 上架判断 |
| --- | --- | --- |
| Manifest | [`wxt.config.ts`](../../wxt.config.ts)声明 Manifest V3；当前生成 Manifest 版本为 0.3.1 | 满足两家商店的 Chromium/MV3 技术基础 |
| 发布包 | 0.3.1 将生成 `.output/cqu-link-fix-0.3.1-chrome.zip`；`manifest.json` 位于 ZIP 根目录 | 正式提交前必须重新构建、测试和校验 |
| 权限 | `storage`、`activeTab`、`declarativeNetRequestWithHostAccess`、`webNavigation`，以及精确必需/可选主机权限 | 权限范围已经相对克制，但后台必须逐项解释用途；Microsoft 官方权限表支持这些权限。[Edge 权限表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/declare-permissions) |
| 远程代码 | 当前 JS、React、字体和图片均随 ZIP 打包，Manifest 未声明远程执行入口 | 提交时应选择“不使用远程代码”；MV3 禁止加载并执行远程托管代码。[Chrome MV3 远程代码规则](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)；[Edge 发布隐私字段](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#declare-any-use-of-remote-code) |
| Edge 迁移 | 当前 Manifest 没有 `update_url`，名称/描述也不含 “Chrome”；生产包已在本机 Microsoft Edge 加载并完成规则、设置页和弹窗烟测 | 不需要 Edge 专用源码分支；提交前仍建议人工复核原生可选权限提示。[Edge 移植指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension) |
| 商店素材 | 128/300 px Logo、两张 1280×800 截图和 440×280 小宣传图已生成 | 首轮草稿完成；维护者明天复核视觉后即可上传或重生成 |
| 隐私政策 | 根目录中英双语 `PRIVACY.md` 已完成 | 内容完成；仓库公开后必须从未登录窗口确认 URL 可访问 |
| 发布验收 | 0.3.1 的自动化、ZIP 哈希与 Edge 侧载结果以提交清单中的最新候选包记录为准 | 完整 SSO 网络矩阵仍属于证据边界 |

### Edge 功能性政策要求准确描述证据边界

Microsoft Edge Add-ons 的 1.1.3 Functionality 要求扩展完全可用，不应有 broken URLs 或 blocked webpage links；1.3 Product is testable 又要求扩展可完整测试，并在提交时给出所有测试步骤。[Edge 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#113-functionality)

仓库中的 2026-07-12 HTTP 412 不能外推为团委规则当前不可用：用户已在 2026-07-22 确认实际使用正常。与此同时，用户确认也不能被扩写成未取得的网络和 HTTP 证据。首发前需要采用以下可验证方式：

1. 完成真实网络矩阵，确认所有首发宣称功能在审核员可复现的环境中正常，并把限制写入 certification notes；或
2. 在 certification notes 中提供无需真实 CQU 凭据的团委 URL 转换步骤，并说明外部网站响应可能随网络环境变化；或
3. 若某项受限来自明确的账号或网络前置条件，确保核心链接修正仍可测试，并在 certification notes 提供完整步骤和预期结果。

不能采用的做法是把历史失败或用户确认中的任一方写成没有证据支持的绝对结论。Microsoft 要求提交时功能、测试步骤和实际行为都可验证。[Edge 功能性与可测试性政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#13-product-is-testable)；[Edge 认证备注](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-8-enter-certification-testing-notes-and-submit-the-extension)

正式候选包不要直接沿用历史 `.output` 文件。应在发布提交对应的提交上重新运行：

```bash
pnpm verify
pnpm test:e2e
pnpm zip
unzip -t .output/cqu-link-fix-<版本>-chrome.zip
```

然后把同一 ZIP 分别侧载到 `chrome://extensions` 和 `edge://extensions`，完成弹窗、设置页、必需权限、可选权限批准/拒绝、SSO 改写、团委改写、一次性回退和暂停站点验收。Chrome 官方要求上传前以生产形态本地测试；Microsoft 也要求移植后在 Edge 中侧载测试。[Chrome 发布前准备](https://developer.chrome.com/docs/webstore/prepare)；[Edge 侧载要求](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)

## 2. 账号、费用与身份验证

### Chrome Web Store

1. 使用一个长期可维护的 Google 账号进入 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)，同意开发者协议并注册。Google 官方说明开发者账号要支付一次性注册费，官方注册页当前展示的示例截图仍写 **US$5**，但截图较旧，最终金额、币种和支付方式必须以实际付款页为准。[Chrome 开发者注册](https://developer.chrome.com/docs/webstore/register)
2. 开发者账号邮箱创建后不能直接更换；若团队长期维护，先决定是专用发布账号还是共享 publisher group，不要临时用以后可能离开的个人邮箱。[Chrome 开发者注册](https://developer.chrome.com/docs/webstore/register)
3. 在 Account 页面填写 publisher name，并验证联系邮箱；联系邮箱验证是新开发者账号的必需步骤。[Chrome 账号设置](https://developer.chrome.com/docs/webstore/set-up-account)
4. Google 账号必须开启两步验证，否则不能首次发布，也不能更新已有扩展。[Chrome 两步验证政策](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
5. 所有开发者都要声明自己是 Trader 还是 Non-Trader。若选择 Trader，需要验证法律名称、联系电话和地址；验证后的 Trader 信息会展示在商店页，电话会通过短信验证。这个分类涉及实际主体身份，应由发布者自己判断。[Chrome Trader 验证 FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
6. 若希望商店页显示“已验证发布者”及官方网站，可以在 Google Search Console 验证自有站点，再在 Store Listing 里选择 official URL；这不是首次上架的硬性前置条件。[Chrome 商店资料](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#display-your-verified-publisher-status)

### Microsoft Edge Add-ons

1. 在 Partner Center 注册 Microsoft Edge program。官方明确说明 **提交 Edge 扩展没有注册费**。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
2. Primary Owner 必须是个人 Microsoft account（MSA）。Microsoft Edge program 不支持直接用工作或学校账号注册；可先用 Outlook/Live/Hotmail 账号注册，再关联 Microsoft Entra tenant。个人 GitHub 账号也可以用于登录，系统会据此创建 MSA。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account#types-of-accounts-related-to-publishing-microsoft-edge-extensions)
3. 注册时必须选 `Individual` 或 `Company`，账号国家/地区和账号类型完成注册后都不能更改。若准备由 cqu-moe 组织长期持有，应该先决定主体，不要先随手注册个人账号再期待无损转换。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account#account-type)
4. Individual 验证较短，主要确认 publisher display name 可用。Company 验证会核验注册企业名称、组织邮箱和授权联系人，可能要求清晰且与法律资料一致的水电账单、DUNS ID 或政府记录，并可能由微软验证合作方致电；官方给出的时长是数天到数周。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account#company-account)
5. publisher display name 最长 50 个字符；Company 必须使用注册企业名称。公司账号验证完成后可以给团队成员分配 Edge program 权限。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account#publisher-display-name-company-name)

## 3. 打包与 Manifest 要求

### 两家共用的发布包

Chrome 要求上传包含全部扩展文件的 ZIP，`manifest.json` 必须直接位于 ZIP 根目录；Manifest 中的名称、版本、图标和不超过 132 字符的简短描述应在上传前检查。每次更新都必须提高 Manifest 版本号。[Chrome 发布前准备](https://developer.chrome.com/docs/webstore/prepare)

Edge 同样上传 `.zip`，包中要包含 Manifest、图片和运行所需文件；Manifest 的名称与简短描述会进入商店页，变更这些只读字段需要重新打包上传。[Edge 发布流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-1-prepare-the-extension-to-be-submitted)

对本项目，首发前应完成以下包级检查：

- 保持 Manifest V3；所有 JavaScript/WASM/字体等执行资源随包提交，不从 CDN 或服务器加载执行代码。[Chrome MV3 远程代码规则](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- 不添加 `<all_urls>`；继续保持精确必需主机权限和用户手势触发的可选 CQU 域名权限。两家商店都要求最小权限并逐项说明。[Chrome Privacy 字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#list-and-justify-any-permissions)；[Edge Privacy 字段](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#justify-any-permissions)
- Edge 包不得出现 `update_url`。若名称或描述出现 “Chrome”，Edge 版必须重新品牌化；当前 “CQU Link Fix” 不触发这项修改。[Edge 移植指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- 不要用混淆掩盖代码。Chrome 允许压缩，但指出代码量大、难审阅或混淆会延长审核，混淆本身不允许。[Chrome 审核流程](https://developer.chrome.com/docs/webstore/review-process#notable-factors-that-increase-review-time)

### 中文本地化

当前 Manifest 已使用消息引用，并以 `zh_CN` 为默认语言、保留英文：

- Manifest 使用 `__MSG_extName__`、`__MSG_extDescription__`；
- `default_locale` 为 `zh_CN`；
- `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json` 包含一致功能范围的名称与简短描述；
- Chrome/Edge 商店页分别填写中文详细描述和截图，英文页描述的功能范围必须与中文一致。

Chrome 会按包中的 `_locales` 提供本地化商店资料入口，并要求不同语言描述的功能集合保持一致。[Chrome 本地化商店页](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize-your-listing)；Edge 也依赖 Manifest i18n 引用识别包内语言。[Edge 多语言说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#if-a-single-locale-appears-but-the-package-includes-multiple-languages)

## 4. 商店资料和图像规格

### Chrome Web Store

Chrome 当前官方列表页列出以下素材；除 1400×560 marquee 明确标为可选外，页面把其余项目列在应提供的 graphic assets 中。实际后台是否把 YouTube 视频设为必填，以提交时 Dashboard 校验为准。[Chrome 商店资料](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#graphic-assets)

| 项目 | 规格 |
| --- | --- |
| 商店图标 | 128×128 px |
| 截图 | 至少 1 张，最多 5 张；每张 1280×800 px |
| 小宣传图 | PNG/JPEG，440×280 px |
| Marquee 宣传图 | PNG/JPEG，1400×560 px；官方明确可选 |
| 视频 | YouTube 功能展示视频链接；本地化语言可分别提供 |
| 文字 | Manifest 简短描述不超过 132 字符；另填详细描述、分类和主语言 |
| 可选链接 | 官方网站、Homepage、Support URL |

### Microsoft Edge Add-ons

Edge 的每个商店语言页都要填详细描述和 Logo；其它视觉素材是可选，但建议首发仍提供截图，以便审核者和用户理解改写逻辑。[Edge 商店资料](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#enter-properties-for-a-language)

| 项目 | 规格 |
| --- | --- |
| 详细描述 | 每种语言 250–10,000 字符，必须完整说明全部功能 |
| Extension logo | 1:1；推荐 300×300 px，最低 128×128 px；每种语言必填 |
| 小宣传图 | 可选，440×280 px |
| 大宣传图 | 可选，PNG 1400×560 px |
| 截图 | 可选，最多 6 张；640×480 或 1280×800 px |
| YouTube 视频 | 可选；如果提供，必须符合商店政策并关闭广告 |
| 搜索词 | 可选；最多 7 个词组、总计最多 21 个单词，每项不超过 30 字符 |

本轮已按以下最小素材集生成首轮草稿：

1. 一张无浏览器个人信息、账号、CAS ticket、Cookie 或真实学号的 1280×800 功能截图；建议实际准备 3–5 张，覆盖弹窗、设置页、改写成功、可选权限与回退。
2. 一张 440×280 小宣传图，可同时复用两家商店，但要分别上传。
3. 从现有矢量品牌源导出 128×128 Chrome 商店图标和 300×300 Edge 商店 Logo；不要只把 128 图标粗暴拉伸后就提交。
4. 可选的 1400×560 大宣传图。若首发时间紧，它不是最小上架门槛。
5. 中文详细描述、英文详细描述、支持 URL、项目主页 URL；不要把未经验证的“适用于所有 CQU 网站”等承诺写进商店文案。

## 5. 隐私、数据披露与权限说明

### 本项目不能申报“完全不处理用户数据”

Google 把域名、URL 和用户与网站交互的信息列为 web browsing activity，并明确规定：数据即使只在用户设备本地处理或保存，也必须披露。CQU Link Fix 读取当前顶层导航 URL、按 URL/域名决定是否改写、短期保存原始/目标 URL，并持久化自定义域名与暂停/排除设置，所以应申报其处理了与核心功能直接相关的浏览活动数据；不能因为“无遥测、无服务器”就选择完全不处理数据。[Chrome 用户数据 FAQ 第 2–6、14 问](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

建议在两家商店共用一份公开隐私政策，至少写清：

- 处理的数据：当前顶层导航 URL/域名、用户主动添加的 CQU 域名规则、排除站点、扩展开关与权限状态、一次性改写/回退状态；
- 用途：仅用于识别并修正重庆大学相关链接、显示当前改写结果、执行用户主动回退或暂停；
- 存储：设置位于浏览器本地存储，临时导航状态位于浏览器会话存储；说明清理时机和用户如何删除数据；
- 不处理的内容：不读取 Cookie、请求体、密码、验证码或 CAS ticket 值；检测到顶层 `ticket` 参数时跳过改写；
- 传输与共享：扩展本身不向开发者服务器、分析服务、广告平台或第三方传输这些数据，不出售、不用于广告或画像；
- 远程代码：不加载或执行远程托管代码；
- 联系方式、政策生效日期和变更方式。

Chrome 要求所有处理用户数据的产品在 Dashboard 提供准确且最新的隐私政策，并披露收集、使用和共享方式。[Chrome 隐私政策要求](https://developer.chrome.com/docs/webstore/program-policies/privacy) Edge 当前 Privacy 页面也要求单一用途、权限理由、远程代码、数据使用认证和隐私政策；若访问、收集或传输个人信息，必须给出可访问的隐私政策 URL。[Edge Privacy 流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-6-enter-privacy-information)

最终在 Dashboard 勾选具体数据类别时，应以当时的字段名称逐项映射。至少要审查 `Web browsing activity`，并根据后台定义判断用户自定义规则/排除项是否还需勾选 `User-generated content`。披露、公开隐私政策和实际代码行为必须完全一致；Google 明确指出不一致可能导致账号下所有项目被暂停。[Chrome 用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#simplifying-privacy-practices-for-our-users)

### 建议的单一用途说明

中文：

> 在用户访问重庆大学相关网页时，按内置规则或用户明确启用的规则修正顶层导航链接，并提供本地控制、暂停和原地址回退。

英文：

> Repair top-level navigation links for Chongqing University sites using built-in or user-enabled rules, with local controls to pause rewriting or reopen the original URL.

两家商店都要求用途清晰、狭窄且容易理解。[Chrome 单一用途字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#state-the-extensions-purpose)；[Edge 单一用途字段](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#state-the-extensions-purpose)

### 建议的权限解释

| 权限 | 给审核员的说明 |
| --- | --- |
| `storage` | 在用户设备本地保存总开关、内置规则开关、自定义 CQU 域名规则、排除站点与清理状态；会话存储只短期保存当前标签页的改写/回退状态。 |
| `activeTab` | 用户打开弹窗或主动点击操作时，识别当前标签页并执行“原地址打开一次”或“暂停当前站点”；不用于读取完整浏览历史。 |
| `declarativeNetRequestWithHostAccess` | 在顶层请求发出前应用精确的重定向、排除和一次性回退规则；不读取请求体、Cookie 或响应内容。 |
| `webNavigation` | 监听顶层导航状态，记录改写是否成功，并处理无法用固定 DNR 规则表达、且由用户主动启用的“全部 CQU 域名”模式。 |
| 必需主机权限 | 只覆盖 `sso.cqu.edu.cn`、`youth.cqu.edu.cn` 和对应的 CQU aTrust 目标，用于内置 SSO/团委链接修正规则。 |
| 可选主机权限 | `cqu.edu.cn` 与 `*.cqu.edu.cn` 只在用户开启全域模式或添加精确自定义 CQU 域名时按用户手势申请；拒绝后核心精确规则仍可运行。 |

这些理由要与代码和商店描述保持一致；若后台列出实际未使用的权限，应先从 Manifest 删除并重新上传，而不是编造理由。[Chrome 权限说明要求](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#list-and-justify-any-permissions)；[Edge 权限说明要求](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#justify-any-permissions)

## 6. 审核与首次发布操作

### Chrome 操作路径

1. 完成账号注册、邮箱验证、两步验证和 Trader/Non-Trader 声明。[Chrome 注册](https://developer.chrome.com/docs/webstore/register)；[Chrome 账号设置](https://developer.chrome.com/docs/webstore/set-up-account)
2. Dashboard 点击 `Add new item`，上传 ZIP。Chrome 当前最大支持 2 GB 的扩展包；本项目远低于该限制。[Chrome 首次发布](https://developer.chrome.com/docs/webstore/publish#upload-your-item)
3. 填写 Store Listing、Privacy、Distribution 和 Test instructions。若某些功能需要账号、地区或特殊步骤，要在 Test instructions 提供测试说明和必要凭据；CQU Link Fix 自身没有扩展账号，不应提交个人 CQU 凭据。[Chrome 首次发布](https://developer.chrome.com/docs/webstore/publish#fill-out-information-about-your-item)
4. 提交审核。可选择审核通过后自动发布，也可选择 deferred publishing。若延迟发布，审核通过后最多 30 天内必须手动发布，否则会退回草稿并需重新审核。[Chrome 延迟发布](https://developer.chrome.com/docs/webstore/publish#deferred-publishing-option)
5. Chrome 官方当前特别提示：自 2026 年 4 月起提交量激增、审核时间延长。通常多数扩展数天完成，但可能数周；等待超过三周且没有重大改动时可联系支持。新开发者、新扩展、危险权限、广泛主机权限或重大代码改动会增加审核时间。[Chrome 审核流程](https://developer.chrome.com/docs/webstore/review-process#review-times)

### Edge 操作路径

1. 完成 Partner Center Edge program 注册和账号验证。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
2. Partner Center 的 Edge workspace 点击 `Create new extension`，上传同一个冻结的 ZIP，并解决包校验问题。[Edge 上传包](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-3-upload-the-package-for-the-extension)
3. 填 Availability：Public 或 Hidden，以及投放 markets。Hidden 不会出现在搜索/浏览中，但可通过商店链接分发，适合先做小范围商店安装验证。[Edge Availability](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-4-enter-availability-information)
4. 填 Properties、Privacy 和每种语言的 Store Listings；Edge 独立 Privacy 页面是 2026 年分阶段上线的新流程，若账号仍显示旧 UI，隐私政策字段可能仍在 Properties 中。[Edge Privacy 流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-6-enter-privacy-information)
5. 在 Notes for certification 中写清无需扩展账号、建议测试 URL、预期改写、可选权限触发方式、如何暂停/回退、哪些真实 CQU 资源受校园网/aTrust/WAF 状态影响。若提交更新，还要列变更内容。不要提供真实学生账号、密码、验证码、Cookie 或 CAS ticket。[Edge 认证说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-8-enter-certification-testing-notes-and-submit-the-extension)
6. 点击 Publish 进入认证。Microsoft 官方给出的认证上限是提交后最多 7 个工作日；通过后状态变为 `In the Store`。[Edge 认证说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-8-enter-certification-testing-notes-and-submit-the-extension)

### CQU Link Fix 的认证备注重点

审核员需要理解这是“链接修正”而不是代理或绕过访问控制：

- 扩展只处理 HTTP(S) 顶层导航，不处理 iframe、XHR、fetch、WebSocket、请求体、Cookie 或认证凭据；
- SSO 规则只替换外层主机，保留 CAS `service` 回调；顶层 URL 带 `ticket` 时跳过改写；
- aTrust 目标仍由重庆大学的访问控制决定，扩展不能授予用户任何原本没有的权限；
- “全部 CQU 域名”默认关闭，并通过用户手势申请可选权限；
- 用户可以对当前站点暂停，也可以原地址打开一次。

这不是商店官方固定模板，而是根据本扩展行为给出的审核沟通建议。它能帮助审核员理解主机权限与重定向的必要性，但不能代替真实网络发布验收。

## 7. 上架后更新

### Chrome

每次代码、Manifest 或包内资源更新，都要提高 Manifest 版本，重新生成包含全部文件的 ZIP，在 Package 页点击 `Upload New Package`，按需更新商店元数据，然后再次提交审核；新项目和更新都进入相同审核系统。[Chrome 更新流程](https://developer.chrome.com/docs/webstore/update)；[Chrome 审核流程](https://developer.chrome.com/docs/webstore/review-process#review-times)

首次流程稳定后可以使用 Chrome Web Store API 自动上传和发布，但 API 不会免除隐私、列表资料或审核要求。[Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)

### Edge

Edge 的每个更新都是新 submission，也要重新认证。初次创建产品和修改描述等元数据仍必须使用 Partner Center；已有扩展的包更新可在 Partner Center 手工完成，也可以启用 v1.1 Add-ons API，用 Client ID 与 API key 完成上传、查询上传状态、发布和查询发布状态。[Edge Add-ons 更新 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)

不要把两家商店的版本号分叉成难以维护的两套节奏。若相同代码同时发布，建议使用相同 Manifest 版本和同一构建提交，分别记录：

- Git commit；
- ZIP SHA-256；
- Chrome item ID / Edge product ID；
- 两家提交时间、审核结果和实际上线时间；
- 商店文案与隐私披露版本。

## 8. 建议执行清单

### A. 提交前

- [ ] 选择 Chrome publisher 和 Edge Individual/Company 主体，确认长期所有权。
- [ ] 注册 Chrome 开发者账号，完成实际付款、邮箱验证、两步验证和 Trader/Non-Trader 声明。
- [ ] 注册 Edge program；若选 Company，提前准备组织资料与公司 approver。
- [ ] 完成校园网/校外网/aTrust 的真实网络烟测，解除仓库发布门禁。
- [x] 在 Edge certification notes 中说明团委规则已获用户实际使用确认、历史 HTTP 412 的网络边界，以及无需个人凭据的复现步骤。[Edge 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#113-functionality)
- [x] 增加 `zh_CN`/英文 Manifest 本地化，并冻结中英文名称与短描述。
- [ ] 发布公开隐私政策 URL；内容与代码、Chrome/Edge Dashboard 勾选完全一致。
- [x] 准备 128×128 图标、300×300 Edge Logo、两张 1280×800 截图和 440×280 小宣传图；1400×560 大图为可选项。
- [x] 准备中英文详细描述、支持 URL、主页 URL、单一用途与逐项权限说明。
- [x] 重新运行验证、打包、ZIP 完整性检查，并在 Chromium 与 Microsoft Edge 完成自动化/侧载烟测。
- [x] 检查最终 ZIP，确认没有远程执行代码、秘密、测试凭据、Source Map 中的敏感信息或多余权限。

### B. 提交与审核

- [ ] Chrome 上传 ZIP，完成 Listing、Privacy、Distribution、Test instructions，选择自动发布或 deferred publishing。
- [ ] Edge 上传同一 ZIP，完成 Availability、Properties、Privacy、各语言 Listing 和 certification notes。
- [ ] 保留两家提交截图、包哈希和审核邮件。
- [ ] 若被拒绝，按具体政策逐条修复；不要用换文案掩盖实际权限或数据行为。

### C. 通过后

- [ ] 先用商店安装包在真实 Chrome/Edge 各做一次验收，而不是继续使用开发者侧载包。
- [ ] 检查商店页隐私披露、支持链接、截图和版本号。
- [ ] 建立双商店版本与审核记录；之后每次更新同时提高 Manifest 版本并重新提交。

## 9. 提交时仍需现场确认的事项

1. **Chrome 实际费用和支付可用性**：官方文档只承诺“一次性注册费”；当前页面配图显示 US$5，但配图可能滞后，付款页金额、币种、税务信息和中国大陆支付方式需要登录账号后确认。[Chrome 开发者注册](https://developer.chrome.com/docs/webstore/register)
2. **Chrome 视频/宣传图的后台必填状态**：当前官方列表页把 128 图标、截图、YouTube 视频和 440×280 小图列在应提供项中，仅把 1400×560 marquee 明确为可选；最终以当前 Dashboard 的字段校验为准。[Chrome 商店资料](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#graphic-assets)
3. **Trader/Non-Trader 分类**：这是发布主体的法律事实，不能由项目代码推断；选择 Trader 会公开经过验证的联系信息。[Chrome Trader FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
4. **Edge 账号类型**：Individual 与 Company 注册后不能更换；若要组织持有，必须在注册前确认是否有合适的法律主体和授权人。[Edge 开发者注册](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account#account-type)
5. **Edge Privacy 页面形态**：官方称独立 Privacy 页计划于 2026 年 5 月底覆盖所有开发者，但文档仍保留旧 Properties UI 的兼容说明；以实际 Partner Center 账号为准。[Edge Privacy 流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-6-enter-privacy-information)
6. **最终数据类别**：确定会处理 Web browsing activity；用户自定义域名与排除项是否还要同时归入 User-generated content，要按提交当天 Dashboard 定义核对。[Chrome 用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
7. **真实网络证据边界**：团委规则已有 2026-07-22 用户使用确认；完整 SSO 认证回调与校园/校外矩阵仍缺脱敏记录。这些事实不能由 fixture E2E 或文档研究互相替代。
8. **Edge 功能性认证**：如果审核员环境出现外部网站阻塞，需要依靠准确的 certification notes 区分扩展 URL 转换结果与目标网站响应，并提供审核员可复现的步骤。[Edge 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#113-functionality)

## 官方资料索引

### Chrome / Google

- [注册开发者账号](https://developer.chrome.com/docs/webstore/register)
- [设置账号与验证邮箱](https://developer.chrome.com/docs/webstore/set-up-account)
- [两步验证](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [Trader/Non-Trader 验证 FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
- [发布前准备与 ZIP 结构](https://developer.chrome.com/docs/webstore/prepare)
- [首次发布](https://developer.chrome.com/docs/webstore/publish)
- [商店资料与图像规格](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy practices 字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [隐私政策要求](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [审核流程和当前积压提示](https://developer.chrome.com/docs/webstore/review-process)
- [更新扩展](https://developer.chrome.com/docs/webstore/update)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)

### Microsoft

- [注册 Microsoft Edge 扩展开发者](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
- [发布 Microsoft Edge 扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [从 Chrome 移植到 Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [Edge 扩展 API 支持表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)
- [Edge Manifest 权限表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/declare-permissions)
- [Edge Add-ons 更新 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)
- [Edge Add-ons 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)
