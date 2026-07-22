# CQU Link Fix 双商店提交清单

## 固定发布资料

- 项目主页：https://github.com/cqu-moe/CQU-Link-Fix
- 支持地址：https://github.com/cqu-moe/CQU-Link-Fix/issues
- 隐私政策：https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md
- Manifest 版本：0.3.1
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

## 仓库公开核对

- [x] 将 `cqu-moe/CQU-Link-Fix` 从 Private 改为 Public，不改变默认分支和历史
- [x] 退出 GitHub 登录或使用无痕窗口，确认项目主页、Issues 和 `PRIVACY.md` 均无需登录即可访问
- [x] 确认默认分支是 `main`，隐私政策 URL 能直接显示中英文正文
- [x] 复核草稿截图和宣传图，并采用当前素材完成 Chrome 首次提交

## 发布候选包验证

在最终提交对应的 `main` 上执行：

```bash
pnpm verify
pnpm test:e2e
pnpm store:assets
pnpm zip
unzip -t .output/cqu-link-fix-0.3.1-chrome.zip
shasum -a 256 .output/cqu-link-fix-0.3.1-chrome.zip
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

- [x] `Add new item` 上传 `.output/cqu-link-fix-0.3.1-chrome.zip`
- [x] Store Listing 填写 `listing-copy.md` 的中文内容并添加英文 locale
- [x] 上传 `public/icon/128.png`
- [x] 上传两张 1280×800 全局截图和 440×280 小宣传图
- [x] Privacy 填写 `privacy-and-permissions.md` 的单一用途、权限理由和数据披露
- [x] 数据类型选择后台当前显示的“网络记录”；后台未提供单独的 User-generated content 字段
- [x] Remote code 选择 No
- [x] 填入公开隐私政策 URL
- [x] Test instructions 填入在后台 500 字限制内压缩的 `reviewer-instructions.md` 核心步骤
- [x] Distribution 复核为免费、公开、所有地区
- [ ] Trader/Non-Trader 状态仍需在发布者账号设置中复核
- [x] 提交时关闭自动发布，使用 deferred publishing；审核通过后先复核商店页再手动上线

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

### Chrome Web Store 0.3.1 正式提交

| 项目 | 结果 |
| --- | --- |
| Item ID | `lfipcjgpmiobfbillddkagjojhkdcbhd` |
| 提交时间 | 2026-07-22 13:08 CST |
| 后台状态 | 待审核 |
| 发布方式 | 延迟发布；审核通过后不自动上线 |
| 延迟发布期限 | 审核通过后 30 天内手动发布，逾期失效 |
| 提交包 | 0.3.1，SHA-256 `f5c01d4a6e8d9495c062459bb22a1f991296c517be3bfc46868f63fe6879d3b2` |

### 2026-07-22 版本 0.3.1 候选包（当前）

| 项目 | 结果 |
| --- | --- |
| 候选包来源提交 | `9900e93` |
| ZIP | `.output/cqu-link-fix-0.3.1-chrome.zip` |
| SHA-256 | `f5c01d4a6e8d9495c062459bb22a1f991296c517be3bfc46868f63fe6879d3b2` |
| `pnpm verify` | PASS：22 个测试文件、468 项测试通过，类型检查与生产构建通过 |
| Chromium 扩展 E2E | PASS：21 项通过；2 项原生可选权限批准/拒绝人工门禁按设计跳过 |
| 首次导航边界 | PASS：空动态规则、残缺动态规则、CAS ticket 放行与停用规则后的 worker 重启均通过真实 Chromium 自动化 |
| Microsoft Edge 侧载烟测 | PENDING：此前版本已通过；0.3.1 仍需重新侧载确认 |
| ZIP 完整性 | PASS：`unzip -t` 无错误，Manifest 与两份静态规则文件均位于包内 |

下方 0.3.0 候选包已被当前版本取代，不得再上传旧 SHA-256 对应文件。

### 2026-07-22 首轮候选包（已取代）

| 项目 | 结果 |
| --- | --- |
| 候选包来源提交 | `80a810f5fae40c1e88210d92fe22aaea42ddffdd` |
| ZIP | `.output/cqu-link-fix-0.3.0-chrome.zip` |
| SHA-256 | `1cb02dc2519ef35c2ecb2407f88426f17355ae1370475bb520a6c196db4342ef` |
| `pnpm verify` | PASS：22 个测试文件、462 项测试通过，类型检查与生产构建通过 |
| Chromium 扩展 E2E | PASS：20 项通过；2 项原生可选权限批准/拒绝人工门禁按设计跳过 |
| Microsoft Edge 侧载烟测 | PASS：生产扩展加载成功，动态规则就绪，合成 SSO 导航改写成功，真实设置页与弹窗可打开 |
| ZIP 完整性 | PASS：`unzip -t` 无错误，Manifest 位于根目录，中英文 `_locales` 已包含 |

0.3.1 候选包已提交 Chrome Web Store，但尚未获批或发布。WXT ZIP 包含本次归档时间信息，因此即使源码不变，重新运行 `pnpm zip` 也可能得到不同的整包 SHA-256；若重新打包或修改代码、Manifest、包内资源，必须重新验证并记录实际上传文件的新哈希。

Edge product ID、提交时间和审核结果只能在维护者完成后台操作后写入正式发布记录，不能提前伪造。
