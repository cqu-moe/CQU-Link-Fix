# 商店素材草稿

本目录的正式尺寸 PNG 由仓库根目录执行 `pnpm store:assets` 生成。脚本先构建生产扩展，再在临时 Chromium 配置中加载真实扩展页面；不会使用个人浏览资料或真实认证信息。

- `draft-screenshot-options-1280x800.png`：真实设置页首屏。
- `draft-screenshot-popup-1280x800.png`：真实弹窗嵌入的商店说明构图。
- `draft-small-promo-440x280.png`：两家商店可用的小宣传图草稿。
- `edge-logo-300x300.png`：从仓库 512 px 图标确定性渲染的 Edge Logo。
- `draft-ai-promo-concept.png`：图像生成得到的讨论用构图灵感，不满足上传尺寸，也不应直接上传。

图片里的 SSO 示例使用 `client.example` 合成回调，目标响应由本机测试路由生成。素材不含账号、密码、验证码、Cookie、CAS ticket、学号或真实浏览记录。
