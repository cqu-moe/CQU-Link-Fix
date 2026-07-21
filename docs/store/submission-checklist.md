# CQU Link Fix 双商店提交清单

## 固定发布资料

- 项目主页：https://github.com/cqu-moe/CQU-Link-Fix
- 支持地址：https://github.com/cqu-moe/CQU-Link-Fix/issues
- 隐私政策：https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md
- Manifest 版本：0.3.0
- 主语言：简体中文
- 英文本地化：已包含
- 建议分类：Productivity / 生产力工具

## 已完成的仓库前置工作

- [x] Manifest V3 与中英文 `_locales`
- [x] 中英双语隐私政策源文件
- [x] Chrome/Edge 中英文商店文案
- [x] 单一用途、权限理由、数据披露与 Remote code 说明
- [x] 无需个人账号的审核测试步骤
- [x] 团委规则实际使用确认与历史网络测试证据边界已分开记录
- [x] 自动生成草稿素材的脚本与固定文件名

## 明天公开仓库后先做

- [ ] 将 `cqu-moe/CQU-Link-Fix` 从 Private 改为 Public，不改变默认分支和历史
- [ ] 退出 GitHub 登录或使用无痕窗口，确认项目主页、Issues 和 `PRIVACY.md` 均无需登录即可访问
- [ ] 确认默认分支是 `main`，隐私政策 URL 能直接显示中英文正文
- [ ] 复核草稿截图和宣传图，决定直接使用还是调整文案/配色后重生成

## 发布候选包验证

在最终提交对应的 `main` 上执行：

```bash
pnpm verify
pnpm test:e2e
pnpm store:assets
pnpm zip
unzip -t .output/cqu-link-fix-0.3.0-chrome.zip
shasum -a 256 .output/cqu-link-fix-0.3.0-chrome.zip
```

然后用同一个 ZIP 解压产物分别在 Chrome 与 Edge 侧载，检查：

- [ ] 弹窗状态和设置页正常显示
- [ ] SSO 外层主机改写并保留 CAS `service`
- [ ] 团委文章路径改写
- [ ] 原地址打开一次
- [ ] 暂停当前站点与恢复
- [ ] 单条内置规则开关
- [ ] 全部 CQU 域名可选权限的批准、拒绝与撤销
- [ ] 顶层 `ticket` 参数存在时跳过改写
- [ ] 最终 ZIP 不含账号、票据、Cookie、私钥、环境文件或多余远程代码

## Chrome Web Store

Chrome 开发者账号已由维护者注册。提交时：

- [ ] `Add new item` 上传 `.output/cqu-link-fix-0.3.0-chrome.zip`
- [ ] Store Listing 粘贴 `listing-copy.md` 的中文内容并添加英文 locale
- [ ] 上传 `public/icon/128.png`
- [ ] 上传两张 1280×800 截图和 440×280 小宣传图
- [ ] Privacy 填写 `privacy-and-permissions.md` 的单一用途、权限理由和数据披露
- [ ] 勾选 Web browsing activity，并按后台定义核对 User-generated content
- [ ] Remote code 选择 No
- [ ] 填入公开隐私政策 URL
- [ ] Test instructions 粘贴 `reviewer-instructions.md`
- [ ] Distribution、地区、可见性和 Trader/Non-Trader 状态由维护者复核
- [ ] 首次发布建议选择 deferred publishing，审核通过后先复核商店页再手动上线

## Microsoft Edge Add-ons

- [ ] 注册或确认 Partner Center 的 Microsoft Edge program 开发者账号
- [ ] `Create new extension` 上传与 Chrome 相同的 ZIP
- [ ] Availability 先由维护者决定 Public 或 Hidden 及投放市场
- [ ] Properties / Privacy 填写相同用途、权限理由、数据披露和公开政策 URL
- [ ] 为简体中文和英文分别粘贴详细描述
- [ ] 上传 `edge-logo-300x300.png`、两张截图和 `draft-small-promo-440x280.png`
- [ ] Notes for certification 粘贴 `reviewer-instructions.md`
- [ ] 提交前在本机 Microsoft Edge 中完成上述侧载验收

## 素材文件

- `docs/store/assets/draft-screenshot-options-1280x800.png`
- `docs/store/assets/draft-screenshot-popup-1280x800.png`
- `docs/store/assets/draft-small-promo-440x280.png`
- `docs/store/assets/edge-logo-300x300.png`

这些是首轮草稿，不含真实账号、学号、Cookie、CAS ticket 或个人浏览信息。

## 发布证据

最终交接需记录：候选包来源提交、证据文档提交、ZIP 文件名、SHA-256、Chrome item ID、Edge product ID、两家提交时间和审核结果。商店 ID 与提交时间只能在维护者完成后台操作后填写到发布记录，不能提前伪造。

