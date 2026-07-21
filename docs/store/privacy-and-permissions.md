# 商店隐私与权限填写稿

本页是商店后台的填写口径，完整法律性说明以仓库根目录的 `PRIVACY.md` 为准。实际勾选项必须与上传包和当时后台字段一致。

## 公开隐私政策

https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md

仓库公开后，先用未登录浏览器确认该地址可访问，再粘贴到两家商店。

## Single purpose

### 中文

在用户访问重庆大学相关网页时，按内置规则或用户明确启用的规则修正顶层导航链接，并提供本地状态、暂停和原地址回退控制。

### English

Repair top-level navigation links for Chongqing University sites using built-in or user-enabled rules, with local status, pause, and original-URL rollback controls.

## 权限逐项说明

### `storage`

在用户设备的 `storage.local` 中保存总开关、内置规则开关、自定义 CQU 域名规则和暂停站点；在 `storage.session` 中短期保存当前标签页的改写、一次性回退和规则协调状态。数据不会同步到开发者服务器。

### `activeTab`

仅在用户打开扩展弹窗或主动点击操作时识别当前标签页，用于展示改写状态、一次性打开原地址或暂停当前站点。不用于查询浏览器的完整历史记录数据库。

### `declarativeNetRequestWithHostAccess`

在已授权主机的顶层请求发出前应用精确重定向、排除和一次性回退规则。扩展不读取请求体、Cookie 或响应正文。

### `webNavigation`

识别顶层导航状态、避免重复改写，并处理用户主动启用而无法仅用固定规则表达的 CQU 域名行为。不处理 iframe、XHR、fetch 或 WebSocket 流量。

### 必需主机权限

`sso.cqu.edu.cn`、`youth.cqu.edu.cn` 和 `sso-cqu-edu-cn-s.atrust.cqu.edu.cn` 只用于随包发布的 SSO 与团委链接修正规则。SSO 规则保留原始 CAS `service` 回调；检测到顶层 `ticket` 参数时跳过改写。

### 可选主机权限

`cqu.edu.cn` 与 `*.cqu.edu.cn` 默认未授予。只有在用户主动开启“全部 CQU 域名”模式或添加精确自定义 CQU 域名时，扩展才通过浏览器原生提示申请。拒绝后，用户选择保持关闭，内置精确规则仍可使用。

## 数据披露

### Web browsing activity

选择此类别。扩展在本机处理当前顶层导航 URL 和域名，按规则决定是否修正链接，并在浏览器会话中短期保存原始 URL、目标 URL 和命中规则，以便显示状态和执行一次性回退。

### User-generated content

如果当前后台将“用户主动填写的精确域名规则或暂停站点”归入此类别，则选择并说明：这些设置仅保存在用户浏览器的 `storage.local`，只用于链接修正和暂停功能，不传输给开发者或第三方。若后台对该类别的定义不包含本地扩展设置，不应为求稳而虚假扩大披露；提交前以后台帮助文字逐项核对。

### 数据使用认证

- 数据仅用于扩展单一用途和面向用户的本地功能；
- 不出售、不共享给广告商、数据经纪商或其他第三方；
- 不用于广告、画像、信用评估、借贷或与单一用途无关的目的；
- 不向开发者后端或分析服务传输；
- 不读取密码、验证码、Cookie、请求体或 CAS ticket 值；
- 用户可在设置中删除规则和暂停站点，也可通过卸载扩展删除全部扩展数据。

### Remote code

选择 **No**。扩展不加载或执行远程托管的 JavaScript、WebAssembly、字体或规则；全部可执行代码和字体资源均包含在提交 ZIP 中。

## Chrome Limited Use 声明

The use of information received from Chrome APIs will comply with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 一致性检查

每次提交前，用生成的 `manifest.json` 重新核对权限清单。如果后台出现包内没有的权限，先检查是否上传错包；如果包内出现本文未说明的权限，先修改代码或本文并重新审核，不能临时编造用途。

