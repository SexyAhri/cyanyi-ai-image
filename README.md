# CyanYi AI Image

CyanYi AI Image 是一个面向生图、Agent 创作和视频生成的 AI 创作前端，适合接入 NewAPI / 中转站 / OpenAI 兼容接口后部署使用。

体验地址：[https://image.cyanyi.com/](https://image.cyanyi.com/)

## 开源来源

本站点基于开源项目 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) ([MIT](https://github.com/CookSleep/gpt_image_playground/blob/main/LICENSE)) 修改。

## CyanYI 中转

项目菜单已内置 `CyanYI 中转` 入口，也可以直接访问：[https://ai.cyanyi.com/](https://ai.cyanyi.com/)

如果你还没有可用的模型接口，推荐优先使用 CyanYI 中转，开箱配置会更省心；如果你已经有自己的 NewAPI、中转站或 OpenAI 兼容接口，也可以在设置页里直接接入。

## 主要功能

- 画廊生图：支持文生图、图生图、参考图、多图输入、生成历史、图片预览和下载。
- Agent 对话：支持对话式生成图片和视频，生成结果可在消息中直接预览、下载和重试。
- 视频创作台：支持视频模型配置、参考图输入、生成记录和视频下载。
- 多接口配置：支持 OpenAI Images、OpenAI Responses、Gemini / 自定义兼容接口、NewAPI 中转站等调用方式。
- 流式与非流式兼容：可测试接口是否支持流式返回，并根据结果调整默认模式。
- 电商创作工具：支持系列基准图、固定人物 / 产品 / 画风、套图任务包、SKU 命名、平台合规预设、文案和卖点生成。
- 创作资产管理：可保存系列基准图历史，并在后续创作中快速复用参考图。
- 部署友好：内置 Dockerfile、GitHub Actions、服务器 Docker Compose 部署文件。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

常用检查：

```bash
npm run typecheck
npm test
npm run build
```

构建产物输出到 `dist/`。

## 页面配置说明

进入站点后，打开设置页面，根据你自己的中转站或模型服务填写配置。

常用配置项：

- `Base URL`：接口地址，例如 `https://你的中转站域名/v1`。
- `API Key`：中转站或模型服务提供的密钥。
- `模型名称`：例如你的中转站里配置的生图、对话或视频模型名称。
- `调用格式`：根据接口选择 OpenAI Images、OpenAI Responses、Gemini / 自定义等格式。
- `NewAPI 分组 / group`：只有你的中转站模型确实需要分组时再填写。
- `流式传输`：建议先用测试连接功能检测，支持流式就开启，不支持就关闭。

如果生图、对话、视频使用的不是同一套 Key，需要分别在对应配置里填写，不要混用。

## Docker 镜像

本地构建镜像：

```bash
docker build -t cyanyi-ai-image:local -f Dockerfile.runtime .
```

本地运行：

```bash
docker run -d --name cyanyi-ai-image -p 9525:80 cyanyi-ai-image:local
```

访问：

```txt
http://127.0.0.1:9525
```

## GitHub 自动构建镜像

仓库已包含 GitHub Actions 工作流：

- `.github/workflows/docker-image.yml`

推送到 `main` 分支后会自动：

1. 安装依赖
2. 运行测试
3. 构建前端
4. 使用 `Dockerfile.runtime` 构建运行镜像
5. 推送到 GitHub Container Registry

当前仓库对应镜像地址：

```txt
ghcr.io/sexyahri/cyanyi-ai-image:latest
```

如果仓库是私有的，服务器拉取镜像前需要登录 GHCR：

```bash
echo <YOUR_GITHUB_TOKEN> | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
```

Token 至少需要 `read:packages` 权限。

## 服务器 Docker Compose 部署

服务器上可以直接使用 `deploy/` 目录里的文件。

目录结构：

```txt
deploy/
  docker-compose.yml
  .env.example
  update.sh
```

复制环境文件：

```bash
cp .env.example .env
```

推荐 `.env` 内容：

```env
IMAGE_NAME=ghcr.io/sexyahri/cyanyi-ai-image
IMAGE_TAG=latest
CONTAINER_NAME=cyanyi-ai-image
HOST_PORT=9525
```

启动：

```bash
docker compose up -d
```

更新：

```bash
sh update.sh
```

容器内部使用 Nginx 监听 `80` 端口，服务器通过 `HOST_PORT=9525` 映射到宿主机 `9525` 端口。

## Nginx 反代建议

如果通过 Nginx 反代到本项目，建议把超时时间调大，避免长时间生图或视频生成被过早断开。

示例：

```nginx
server {
    server_name image.example.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:9525;

        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 900s;
        proxy_read_timeout 900s;
        send_timeout 900s;

        proxy_buffering off;
        proxy_cache off;
    }
}
```

## Cloudflare Pages 部署

如果选择静态部署到 Cloudflare Pages，可以使用：

```txt
Build command: npm run build
Build output directory: dist
Node.js version: 22
```

如果生图或视频请求耗时较长，更推荐服务器 Docker + Nginx 反代，避免平台或隧道超时限制影响生成结果。

## 构建变量

GitHub Actions 构建时支持以下 Repository Variables：

- `VITE_DEFAULT_API_URL`
- `VITE_API_PROXY_AVAILABLE`
- `VITE_API_PROXY_LOCKED`
- `VITE_SHOW_DEFAULT_CONFIG_ONLY`

设置位置：

```txt
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> Variables
```

不设置也可以，项目会使用默认行为。

## 上传前注意

不要上传本地密钥文件。

项目已忽略：

- `.env`
- `.env.*`
- `deploy/.env`
- `node_modules/`
- `dist/`

服务器实际使用的 `deploy/.env` 只保留在服务器或本地，不要提交到 GitHub。

## License

本项目修改自 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)，原项目使用 [MIT License](https://github.com/CookSleep/gpt_image_playground/blob/main/LICENSE)。
