# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_DEFAULT_API_URL
ARG VITE_API_PROXY_AVAILABLE=false
ARG VITE_API_PROXY_LOCKED=false
ARG VITE_SHOW_DEFAULT_CONFIG_ONLY=false

ENV VITE_DEFAULT_API_URL=${VITE_DEFAULT_API_URL}
ENV VITE_API_PROXY_AVAILABLE=${VITE_API_PROXY_AVAILABLE}
ENV VITE_API_PROXY_LOCKED=${VITE_API_PROXY_LOCKED}
ENV VITE_SHOW_DEFAULT_CONFIG_ONLY=${VITE_SHOW_DEFAULT_CONFIG_ONLY}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
