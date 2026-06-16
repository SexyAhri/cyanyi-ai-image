# CyanYi AI Image

静态版 AI 图像生成前端，适合接入 NewAPI 并部署到 Cloudflare Pages。

体验地址：[https://image.cyanyi.com/](https://image.cyanyi.com/)

## CyanYI 中转

项目菜单现已内置 `CyanYI 中转` 入口，也可以直接访问：[https://ai.cyanyi.com/](https://ai.cyanyi.com/)

默认推荐使用 CyanYI 中转，开箱即用会更省心一些；如果你使用的是其他支持 `gpt-image-2`、Responses API 或 `image_generation` 能力的中转站 / 兼容接口，也可以直接接入使用。

## 功能

- 画廊生图
- Agent 对话式生图
- 收藏管理
- Responses 模式接入
- 支持接入兼容 `gpt-image-2` 的中转站和接口
- 适配 Cloudflare Pages 静态部署

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

产物输出到 `dist/`。

## Cloudflare Pages

Cloudflare Pages 构建配置：

```txt
Build command: npm run build
Build output directory: dist
Node.js version: 20
```

`public/_redirects` 和 `public/_headers` 已经准备好，可以直接部署。

## 自动部署

如果你使用 Cloudflare Pages 自带的 GitHub 集成，只需要在 Cloudflare Pages 里连接 GitHub 仓库，并将生产分支设置为 `main`。

之后每次推送到 `main` 分支，Cloudflare Pages 会自动构建并部署。

## 配置

通过页面设置填写 API Base URL、API Key、模型等信息。

## 版本

当前版本从 `package.json` 读取。
