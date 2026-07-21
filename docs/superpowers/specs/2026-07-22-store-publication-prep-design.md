# CQU Link Fix 商店发布前置准备设计

**日期：** 2026-07-22

**状态：** 已批准

**范围：** Chrome Web Store 与 Microsoft Edge Add-ons 首次发布前的仓库材料、隐私披露、本地化、视觉草稿和可复现发布包

## 1. 背景与目标

CQU Link Fix 已经是可构建的 Chromium Manifest V3 扩展，Chrome 开发者账号也已注册。用户将在仓库准备完成后把当前私有 GitHub 仓库改为公开，并使用公开仓库页面作为项目主页、支持入口和隐私政策承载地址。

本轮目标是把无需商店账号交互即可完成的前置工作全部放进仓库，使用户明天只需要：公开仓库、确认商店素材方向、在两个商店后台粘贴资料并上传最终 ZIP。

团委规则由用户在真实使用中确认可用。本轮不再把历史 HTTP 412 观察当作当前功能失败；验证文档会保留当时的网络证据，同时补充用户确认和证据边界。

## 2. 方案比较与选择

### 方案 A：仓库作为唯一发布资料源（采用）

- 在根目录维护中英双语 `PRIVACY.md`。
- 在 `docs/store/` 维护商店文案、隐私/权限填写稿、审核说明、提交清单和视觉草稿。
- Manifest 使用 WXT 官方 i18n 结构提供简体中文与英文名称/短描述。
- GitHub 仓库公开后直接使用稳定的 `blob/main/PRIVACY.md`、README 和 Issues URL。

优点是最快、可版本化、隐私政策与发布代码同一提交，且不依赖额外网站部署。缺点是 GitHub 页面视觉较朴素，但不影响首次提交。

### 方案 B：先建设 `cqu.moe` 发布站点

隐私政策、产品主页和支持页面均部署到独立站点。品牌感更完整，但需要新增站点设计、部署、域名与长期可用性验证，超出“明天可提交”的最小范围。

### 方案 C：只在商店后台维护文案

仓库仅增加隐私政策，其余文字直接填进 Chrome/Edge 后台。工作量最少，但两家文案容易漂移，更新时缺乏可审查历史，不采用。

## 3. 交付结构

```text
PRIVACY.md
public/_locales/en/messages.json
public/_locales/zh_CN/messages.json
docs/store/
  listing-copy.md
  privacy-and-permissions.md
  reviewer-instructions.md
  submission-checklist.md
  assets/
    draft-screenshot-options-1280x800.png
    draft-screenshot-popup-1280x800.png
    draft-small-promo-440x280.png
    edge-logo-300x300.png
```

视觉文件是供明天讨论的初稿，不宣称是最终商店素材。截图必须来自真实构建后的扩展页面，不能包含账号、学号、CAS ticket、Cookie、浏览器个人资料或其他身份信息。宣传图可以使用生成式视觉草稿，但必须叠加或保留项目现有的准确品牌标识，不伪造重庆大学或深信服官方背书。

## 4. 隐私政策

`PRIVACY.md` 使用中文为主、英文完整镜像，覆盖 Chrome 和 Microsoft Edge 版本，至少说明：

- 扩展为独立社区工具，不代表重庆大学、深信服或浏览器厂商；
- 为完成链接修正，扩展在本机处理当前顶层导航 URL、域名、规则设置、排除站点和临时改写状态；
- 本地持久设置保存在 `storage.local`，临时状态保存在 `storage.session`，并说明删除与保留方式；
- 不向开发者服务器、分析平台、广告平台或其他第三方传输、出售或共享这些数据；
- 不读取 Cookie、请求体、密码、验证码或 CAS ticket 值；检测到顶层 `ticket` 参数时只判断其存在并跳过改写，不保存票据；
- 不使用遥测、广告、画像、远程规则或远程执行代码；
- 列出权限用途、用户控制方式、政策变更方式和 GitHub Issues 联系入口；
- 包含 Chrome Web Store Limited Use 合规声明。

README 的隐私段落不能再用“完全不读取浏览历史”模糊代替本地 URL 处理事实。改为区分：扩展不查询浏览器历史数据库，也不上传浏览活动；但会在核心功能所需范围内本地处理当前顶层 URL。

## 5. 商店文案与后台填写稿

`listing-copy.md` 提供 Chrome 和 Edge 可直接粘贴的中英文内容：

- 名称、短描述、详细描述；
- 单一用途；
- 核心功能、已知限制和独立项目声明；
- 建议分类、主页 URL、支持 URL、隐私政策 URL；
- 不使用“适用于全部 CQU 网站”“保证绕过访问限制”等无法验证的表述。

`privacy-and-permissions.md` 逐项映射 `storage`、`activeTab`、`declarativeNetRequestWithHostAccess`、`webNavigation`、必需主机权限和可选主机权限，明确远程代码选择为“否”。Chrome 数据类别至少按官方本地处理定义审查并披露 Web browsing activity；用户自定义域名是否同时归入 User-generated content，保留提交当天按后台字段文字复核的醒目标记。

`reviewer-instructions.md` 提供无需个人 CQU 凭据的测试路径，解释 SSO 外层主机替换、CAS `service` 保持、团委路径修正、可选权限、暂停和原地址回退。审核说明不得包含真实账号、密码、验证码、Cookie 或票据。

## 6. Manifest 本地化

遵循 WXT 官方 i18n 结构：

- `wxt.config.ts` 使用 `__MSG_extName__`、`__MSG_extDescription__`；
- `default_locale` 设为 `zh_CN`；
- 在 `public/_locales/zh_CN/messages.json` 和 `public/_locales/en/messages.json` 提供相同消息键；
- 中文短描述面向重庆大学用户，英文短描述保持功能范围一致；
- 名称继续使用中性的 `CQU Link Fix`，不冒充官方产品。

本轮只本地化 Manifest 商店基础字段，不重构现有中文界面或引入全 UI i18n。

## 7. 视觉草稿

首轮提供三项可比较素材：

1. 1280×800 设置页真实截图，展示总开关、内置规则和本地控制；
2. 1280×800 弹窗功能展示图，把真实弹窗置于克制的商店演示画布中；
3. 440×280 小宣传图，采用现有黑白折返标识、暖白/墨色基底和少量 CQU 红，不使用学校官方 Logo。

另从现有 512×512 图标无损导出 300×300 Edge Logo。草稿不追求最终营销文案，重点是尺寸正确、无敏感信息、可供明天讨论方向。

## 8. 验证与发布包

自动化先增加能失败的契约测试，锁定：

- Manifest 使用消息引用并声明 `default_locale`；
- 中英文消息文件存在、键一致、短描述满足 Manifest 长度限制；
- 隐私政策、商店文案、权限说明和审核说明包含关键声明且没有占位符；
- 最终构建产物包含 `_locales`，ZIP 根目录仍有 `manifest.json`。

实现后运行：

```bash
pnpm verify
pnpm test:e2e
pnpm zip
unzip -t .output/cqu-link-fix-0.3.0-chrome.zip
git diff --check
```

视觉素材逐张检查像素尺寸并人工查看。最终交付记录 ZIP 路径与 SHA-256。

## 9. 边界

- 不公开 GitHub 仓库；该操作由用户明天执行。
- 不登录或提交 Chrome/Edge 商店；账号字段、Trader/Non-Trader 和最终发布按钮由用户确认。
- 不改写现有链接业务逻辑或权限范围。
- 不把今晚的视觉草稿当成最终品牌决定。
- 不把用户报告扩写成未取得的网络、账号或浏览器测试证据。
