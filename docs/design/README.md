# 设计交接

仓库从 `0.3.0` 开始自带完整的生产设计基线，日常开发不需要再打开 Open Design。

## 权威文件

- `DESIGN.md`：视觉、布局、组件、动效、文案和身份边界。
- `src/ui/react/design-system.css`：生产令牌与共享组件样式。
- `public/brand/cqu-link-fix-mark.svg`：折返路径标的唯一几何源。
- `public/icon/`：Manifest V3 使用的 16 / 32 / 48 / 128px PNG。
- `public/fonts/`：离线 Geist Sans / Geist Mono 可变字体。

## 来源映射

| 生产产物 | Open Design 来源 |
| --- | --- |
| `DESIGN.md` | `7508.../DESIGN.md` |
| 颜色、字体与阴影令牌 | `7508.../colors_and_type.css` |
| 弹窗与设置页 | `cde1.../app/src/pages/` 及 `app/src/styles/` |
| 折返路径标 | `7508.../assets/brand/cqu-link-fix-mark.svg` |
| 运行时图标 | `7508.../build/icons/` |
| Geist 字体 | `7508.../fonts/` |

Open Design 中的评审卡、截图、artifact 元数据和中间预览没有进入生产仓库，因为它们不参与运行和维护。

## 字体授权

Geist 字体来自 `geist@1.3.1`，以 SIL Open Font License 1.1 发布，可随本项目再分发。
