```dockerfile
# ==========================================
# Stage 1: Builder
# Node 22 + Debian 12 Bookworm
# ==========================================
FROM node:22-bookworm AS builder

ARG PNPM_VERSION=10.28.1

# 安装构建所需系统依赖
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# 使用国内 npm 镜像
RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm config set registry https://registry.npmmirror.com

WORKDIR /app

# ------------------------------------------
# 1. 复制 lock + workspace 配置
# ------------------------------------------
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ------------------------------------------
# 2. 复制所有 workspace package.json
# ------------------------------------------
COPY packages/db/package.json ./packages/db/
COPY packages/utils/package.json ./packages/utils/
COPY packages/i18e/package.json ./packages/i18e/
COPY packages/ws/package.json ./packages/ws/
COPY packages/services/package.json ./packages/services/
COPY services/api/package.json ./services/api/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mini/package.json ./apps/mini/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/test/package.json ./packages/test/
COPY packages/ui/package.json ./packages/ui/

# ------------------------------------------
# 3. 安装依赖
# ------------------------------------------
RUN pnpm install --frozen-lockfile

# ------------------------------------------
# 4. 复制完整源码
# ------------------------------------------
COPY . .

# ------------------------------------------
# 5. 构建 workspace
# ------------------------------------------
RUN cd packages/utils && pnpm run build
RUN cd packages/i18e && pnpm run build
RUN cd packages/ws && pnpm run build
RUN cd packages/db && pnpm run build
RUN cd packages/services && pnpm run build

# ------------------------------------------
# 6. Prisma generate
# ------------------------------------------
RUN cd packages/db && pnpm run generate

# ------------------------------------------
# 7. 构建后端 API
# ------------------------------------------
RUN cd services/api && pnpm run build

# ------------------------------------------
# 8. 构建 Desktop Web
# ------------------------------------------
RUN cd apps/desktop && pnpm run build:web


# ==========================================
# Stage 1b: Mini H5 Builder
#
# Taro 3.6.34 的 @tarojs/binding
# 没有 linux/arm64 原生包，因此这里固定 amd64。
#
# 最终产物是纯静态文件，可以直接复制到
# arm64 / amd64 最终镜像。
# ==========================================
FROM --platform=linux/amd64 node:22-bookworm AS mini-builder

ARG PNPM_VERSION=10.28.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# 使用国内 npm 镜像
RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm config set registry https://registry.npmmirror.com

WORKDIR /app

# ------------------------------------------
# 1. Workspace 配置
# ------------------------------------------
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ------------------------------------------
# 2. Workspace package.json
# ------------------------------------------
COPY packages/db/package.json ./packages/db/
COPY packages/utils/package.json ./packages/utils/
COPY packages/i18e/package.json ./packages/i18e/
COPY packages/ws/package.json ./packages/ws/
COPY packages/services/package.json ./packages/services/
COPY services/api/package.json ./services/api/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mini/package.json ./apps/mini/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/test/package.json ./packages/test/
COPY packages/ui/package.json ./packages/ui/

# ------------------------------------------
# 3. 安装依赖
# ------------------------------------------
RUN pnpm install --frozen-lockfile

# ------------------------------------------
# 4. 复制源码
# ------------------------------------------
COPY . .

# ------------------------------------------
# 5. 构建 Mini H5
# ------------------------------------------
RUN cd packages/i18e && pnpm run build
RUN cd packages/services && pnpm run build
RUN cd apps/mini && pnpm run build:h5


# ==========================================
# Stage 2: Unified Runner
# Node 22 + Debian 12 Bookworm Slim
# ==========================================
FROM node:22-bookworm-slim AS runner

ARG PNPM_VERSION=10.28.1

WORKDIR /app

# ==========================================
# 1. 安装运行环境
#
# Python
# Nginx
# OpenSSL
# FFmpeg
# virtualenv
# ==========================================
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    nginx \
    openssl \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# ==========================================
# 2. Python virtualenv
#
# Debian 12 对系统 Python 使用 pip 有
# externally-managed-environment 限制，
# 所以统一使用 /opt/venv。
# ==========================================
RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}"

# ==========================================
# 3. 基础环境变量
# ==========================================
ENV NODE_ENV=production
ENV TXT_BASE_DIR=/txt
ENV AUDIO_BOOK_DIR=/audio
ENV MUSIC_BASE_DIR=/music
ENV CACHE_DIR=/covers
ENV DATABASE_URL="file:/app/packages/db/prisma/dev.db"
ENV PORT=3000

# ==========================================
# 4. 复制 Node 项目产物
# ==========================================

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# packages/db
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/generated ./packages/db/generated

# packages/utils
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json

# packages/i18e
COPY --from=builder /app/packages/i18e/package.json ./packages/i18e/package.json
COPY --from=builder /app/packages/i18e/dist ./packages/i18e/dist

# packages/ws
COPY --from=builder /app/packages/ws/dist ./packages/ws/dist
COPY --from=builder /app/packages/ws/package.json ./packages/ws/package.json

# packages/services
COPY --from=builder /app/packages/services/dist ./packages/services/dist
COPY --from=builder /app/packages/services/package.json ./packages/services/package.json

# services/api
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/package.json ./services/api/package.json

# Desktop Web
COPY --from=builder /app/apps/desktop/dist /usr/share/nginx/html/desktop

# Mini H5
COPY --from=mini-builder /app/apps/mini/dist /usr/share/nginx/html/mini


# ==========================================
# 5. Python TTS / ASR / MI
# ==========================================

# TTS
COPY services/tts /app/services/tts

RUN python3 -m pip install \
    --no-cache-dir \
    -r /app/services/tts/requirements.txt

# ASR
COPY services/asr /app/services/asr

RUN python3 -m pip install \
    --no-cache-dir \
    -r /app/services/asr/requirements.txt

# MI
COPY services/mi /app/services/mi

RUN python3 -m pip install \
    --no-cache-dir \
    -r /app/services/mi/requirements.txt


# ==========================================
# 6. 安装 Node 生产依赖
# ==========================================

RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm config set registry https://registry.npmmirror.com \
  && pnpm install \
      --prod \
      --frozen-lockfile \
      --ignore-scripts


# ==========================================
# 7. Nginx
# ==========================================
COPY nginx.conf /etc/nginx/nginx.conf


# ==========================================
# 8. Ports
#
# 3000 API
# 8000 TTS
# 3300 ASR
# 8080 MI
# 9958 Web
# ==========================================
EXPOSE 3000 8000 3300 8080 9958


# ==========================================
# 9. 启动脚本
# ==========================================
RUN cat > /app/start.sh <<'EOF'
#!/bin/bash

set -e

# ------------------------------------------
# 1. 确保数据库目录存在
# ------------------------------------------
mkdir -p /app/packages/db/prisma


# ------------------------------------------
# 2. Prisma schema
# ------------------------------------------
echo "Running prisma db push..."

cd /app/packages/db

npx prisma@6 db push \
  --accept-data-loss \
  --skip-generate


# ------------------------------------------
# 2b. 对齐迁移历史
# ------------------------------------------
echo "Reconciling migration history..."

for migration_dir in /app/packages/db/prisma/migrations/*/; do
  [ -f "${migration_dir}migration.sql" ] || continue

  migration_name=$(basename "$migration_dir")

  echo "  - marking $migration_name as applied"

  npx prisma@6 migrate resolve \
    --applied "$migration_name" \
    2>&1 | grep -v "already" || true
done


# ------------------------------------------
# 3. Nginx
# ------------------------------------------
echo "Starting Nginx..."

nginx


# ------------------------------------------
# 4. TTS
# ------------------------------------------
if [ "$DISABLE_TTS" != "true" ]; then

  echo "Starting TTS Service..."

  cd /app/services/tts

  (
    python3 -m uvicorn \
      src.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      || echo "❌ TTS Service failed to start"
  ) > /var/log/tts.log 2>&1 &

else

  echo "TTS Service is disabled."

fi


# ------------------------------------------
# 5. ASR
# ------------------------------------------
if [ "$DISABLE_ASR" != "true" ]; then

  echo "Starting ASR Service..."

  cd /app/services/asr

  (
    HF_ENDPOINT=https://hf-mirror.com \
    python3 -m uvicorn \
      src.main:app \
      --host 0.0.0.0 \
      --port 3300 \
      || echo "❌ ASR Service failed to start"
  ) > /var/log/asr.log 2>&1 &

else

  echo "ASR Service is disabled."

fi


# ------------------------------------------
# 6. MI
# ------------------------------------------
if [ "$DISABLE_MI" != "true" ]; then

  echo "Starting MI Service..."

  cd /app/services/mi

  (
    python3 -m uvicorn \
      src.main:app \
      --host 0.0.0.0 \
      --port 8080 \
      || echo "❌ MI Service failed to start"
  ) > /var/log/mi.log 2>&1 &

else

  echo "MI Service is disabled."

fi


# ------------------------------------------
# 7. Node API
# ------------------------------------------
echo "Starting API Service..."

cd /app/services/api

exec node dist/main.js
EOF

RUN chmod +x /app/start.sh


# ==========================================
# 10. Start
# ==========================================
CMD ["/app/start.sh"]
```
