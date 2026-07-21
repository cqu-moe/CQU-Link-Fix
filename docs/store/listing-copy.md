# CQU Link Fix 商店文案

本页内容可直接用于 Chrome Web Store 和 Microsoft Edge Add-ons。中英文版本描述同一组功能；不要在单个商店里扩写为“支持所有重庆大学网站”。

## 固定链接

- Homepage URL: https://github.com/cqu-moe/CQU-Link-Fix
- Support URL: https://github.com/cqu-moe/CQU-Link-Fix/issues
- Privacy policy URL: https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md
- 推荐分类：生产力工具（Productivity）

## 简体中文

### 名称

CQU Link Fix

### 简短描述

在本机修正重庆大学相关网站的顶层导航链接，并提供暂停与原地址回退。

### 详细描述

CQU Link Fix 是一个独立维护的社区浏览器扩展，用于修正重庆大学相关网站中因入口、代理或页面结构变化而无法正常打开的顶层导航链接。

当前版本提供：

- 修正重庆大学统一身份认证（SSO）入口的外层主机，同时保留原始 CAS `service` 回调；
- 修正已知的团委官网文章链接结构；
- 在弹窗中显示当前标签页是否发生改写及命中的规则；
- 一次性打开改写前的原地址；
- 暂停当前站点，或单独停用某条内置规则；
- 经用户主动授权后，为指定的重庆大学域名添加精确规则，或启用“全部 CQU 域名”模式。

扩展只处理顶层 HTTP(S) 导航，不读取网页正文、请求体、Cookie、密码、验证码或 CAS ticket 值。设置和临时改写状态仅保存在用户自己的浏览器中；扩展没有开发者后台、账号、遥测、广告或远程规则服务，也不会加载远程托管代码。

目标网站仍会执行自己的登录、网络环境和访问权限检查。CQU Link Fix 只修正链接，不代理流量，也不会绕过身份认证或授予额外访问权限。部分资源是否可访问仍取决于重庆大学网站、校园网、aTrust 和用户自身权限。

本项目是独立社区项目，与重庆大学、深信服科技有限公司、Google、Microsoft 或相关网站运营方不存在隶属或官方背书关系。问题反馈与源代码请访问项目主页。

### 商店宣传短句

链接走对路，登录和访问控制仍由原网站负责。

## English

### Name

CQU Link Fix

### Short description

Repair top-level navigation links for CQU sites with local pause and rollback controls.

### Detailed description

CQU Link Fix is an independently maintained community browser extension that repairs known top-level navigation links for Chongqing University websites when an entry point, proxy host, or page structure has changed.

The current release can:

- repair the outer host of Chongqing University SSO links while preserving the original CAS `service` callback;
- repair known Youth League article URL structures;
- show whether the active tab was rewritten and which rule matched;
- reopen the original URL once;
- pause rewriting for the current site or disable an individual built-in rule;
- add an exact CQU domain rule, or enable all-CQU-domain mode, only after the user approves the browser's native optional-permission prompt.

The extension handles only top-level HTTP(S) navigation. It does not read page content, request bodies, Cookies, passwords, verification codes, or CAS ticket values. Settings and temporary rewrite state remain in the user's browser. There is no developer backend, extension account, telemetry, advertising, remote rule service, or remotely hosted executable code.

Destination websites still enforce their own authentication, network, and authorization requirements. CQU Link Fix repairs links; it does not proxy traffic, bypass authentication, or grant access. Availability may still depend on Chongqing University services, the campus network, aTrust, and the user's own permissions.

Independent community project. Not affiliated with or endorsed by Chongqing University, Sangfor Technologies, Google, Microsoft, or the operators of related websites. Source code and support are available from the project homepage.

### Promotional line

Repair the route. Keep authentication with the original site.

## 素材对应关系

- Chrome/Edge 截图 1：`docs/store/assets/draft-screenshot-options-1280x800.png`
- Chrome/Edge 截图 2：`docs/store/assets/draft-screenshot-popup-1280x800.png`
- Chrome/Edge 小宣传图：`docs/store/assets/draft-small-promo-440x280.png`
- Edge 商店 Logo：`docs/store/assets/edge-logo-300x300.png`
- Chrome 商店图标：`public/icon/128.png`

