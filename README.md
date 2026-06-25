# CyanYi AI Image

静态版 AI 图像生成前端，适合接入 NewAPI 并部署到 Cloudflare Pages。

体验地址：[https://image.cyanyi.com/](https://image.cyanyi.com/)

## 开源来源

本站点基于开源项目 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)（[MIT License](https://github.com/CookSleep/gpt_image_playground/blob/main/LICENSE)）修改。

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

## Docker 镜像

项目已内置多阶段 `Dockerfile`，会先用 Node 20 构建，再用 Nginx 提供静态文件服务。

本地构建镜像：

```bash
docker build -t cyanyi-ai-image:local .
```

本地运行镜像：

```bash
docker run -d --name cyanyi-ai-image -p 9525:80 cyanyi-ai-image:local
```

打开 `http://127.0.0.1:9525` 即可访问。

## GitHub 自动构建镜像

仓库已包含 GitHub Actions 工作流：

- [`.github/workflows/docker-image.yml`](/C:/Users/Administrator/Desktop/HomeCode/cyanyi-ai-image/.github/workflows/docker-image.yml)

它会在以下场景自动构建并推送镜像到 GitHub Container Registry `ghcr.io`：

- 推送到 `main`
- 推送 `v*` 标签
- 手动触发 `workflow_dispatch`

默认镜像名格式：

```txt
ghcr.io/<你的 GitHub 用户名或组织名>/<仓库名>
```

例如：

```txt
ghcr.io/cyanyi/cyanyi-ai-image:latest
```

### 启用 GHCR

1. 把仓库推到 GitHub。
2. 确认仓库的 Actions 已启用。
3. 第一次推送到 `main` 后，到 GitHub 仓库的 `Packages` 查看镜像是否已生成。
4. 如果服务器拉取私有镜像，需要准备一个拥有 `read:packages` 权限的 GitHub Token。

### 可选的构建变量

这个前端在构建镜像时支持以下 GitHub Repository Variables：

- `VITE_DEFAULT_API_URL`
- `VITE_API_PROXY_AVAILABLE`
- `VITE_API_PROXY_LOCKED`
- `VITE_SHOW_DEFAULT_CONFIG_ONLY`

设置位置：

- GitHub 仓库 `Settings -> Secrets and variables -> Actions -> Variables`

如果不设置，就使用工作流里的默认值。

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

## 服务器直接拉镜像部署

如果你不走 Cloudflare Pages，而是想让服务器直接拉 GHCR 镜像部署，可以直接用仓库里的部署文件：

- [`deploy/docker-compose.yml`](/C:/Users/Administrator/Desktop/HomeCode/cyanyi-ai-image/deploy/docker-compose.yml)
- [`deploy/.env.example`](/C:/Users/Administrator/Desktop/HomeCode/cyanyi-ai-image/deploy/.env.example)
- [`deploy/update.sh`](/C:/Users/Administrator/Desktop/HomeCode/cyanyi-ai-image/deploy/update.sh)

### 1. 服务器准备

服务器安装：

- Docker
- Docker Compose Plugin

如果镜像是私有的，先登录 GHCR：

```bash
echo <YOUR_GITHUB_TOKEN> | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
```

Token 需要至少有：

- `read:packages`

### 2. 复制部署文件

把 `deploy` 目录放到服务器，例如：

```bash
/opt/cyanyi-ai-image/
```

然后复制环境文件：

```bash
cp .env.example .env
```

修改 `.env`：

```env
IMAGE_NAME=ghcr.io/your-github-name/cyanyi-ai-image
IMAGE_TAG=latest
CONTAINER_NAME=cyanyi-ai-image
HOST_PORT=9525
```

### 3. 启动容器

```bash
docker compose up -d
```

之后更新镜像时手动执行：

```bash
sh update.sh
```

这会执行：

- `docker compose pull`
- `docker compose up -d`
- 清理未使用旧镜像

### 4. 验证服务

```bash
curl http://127.0.0.1:9525
```

如果能返回首页 HTML，说明容器服务正常。

## 推荐部署链路

如果你的目标是“上传 GitHub 后自动构建镜像，然后服务器手动拉镜像部署”，推荐这样做：

1. 本地推送代码到 GitHub `main`
2. GitHub Actions 自动构建并推送镜像到 `ghcr.io`
3. 服务器手动执行 `sh update.sh` 拉取最新 `latest` 镜像并重启容器
4. 你的隧道映射到服务器 `9525` 端口

## 配置

通过页面设置填写 API Base URL、API Key、模型等信息。

## 版本

当前版本从 `package.json` 读取。
