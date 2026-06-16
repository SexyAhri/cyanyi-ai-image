# CyanYi AI Image

静态版 AI 图像生成前端，适合接入 NewAPI 并部署到 Cloudflare Pages。

## 功能

- 画廊生图
- Agent 对话式生图
- 收藏管理
- Responses 模式接入
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

仓库已包含 GitHub Actions 配置：`.github/workflows/cloudflare-pages.yml`。

需要在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

然后在 Cloudflare Pages 创建项目名 `cyanyi-ai-image`。之后每次推送到 `main` 分支，GitHub Actions 会自动构建并部署到 Cloudflare Pages。

如果你使用 Cloudflare Pages 自带的 GitHub 集成，也可以不用 Actions，只需要在 Cloudflare Pages 里连接 GitHub 仓库并开启自动部署。

## 配置

通过页面设置填写 API Base URL、API Key、模型等信息。

## 版本

当前版本从 `package.json` 读取。
