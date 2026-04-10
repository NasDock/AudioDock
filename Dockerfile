# ==========================================
# Stage 1: Builder (Install dependencies + Build projects)
# ==========================================
FROM node:22-bullseye AS builder

RUN apt-get update \
  && apt-get install -y openssl \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm
WORKDIR /app

# 1. 复制 lock + workspace 配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 2. 复制所有子包 package.json
COPY packages/db/package.json ./packages/db/
COPY packages/utils/package.json ./packages/utils/
COPY packages/ws/package.json ./packages/ws/
COPY packages/services/package.json ./packages/services/
COPY services/api/package.json ./services/api/
COPY apps/desktop/package.json ./apps/desktop/

# 3. 安装依赖
RUN pnpm install --frozen-lockfile

# 4. 复制完整源码
COPY . .

# 5. 构建所有 workspace
RUN cd packages/utils && pnpm run build
RUN cd packages/ws && pnpm run build
RUN cd packages/db && pnpm run build
RUN cd packages/services && pnpm run build

# 6. Prisma generate（生成到 packages/db/generated/client）
RUN cd packages/db && pnpm run generate

# 7. 构建后端 API
RUN cd services/api && pnpm run build

# 8. 构建前端 Web
RUN cd apps/desktop && pnpm run build:web

# ==========================================
# Stage 2: Unified Runner (All-in-one image)
# ==========================================
FROM node:22-bullseye-slim AS runner

WORKDIR /app

# 1. 安装运行环境 (Python3, Nginx, OpenSSL)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nginx \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# 2. 基础环境变量配置
ENV NODE_ENV=production
ENV TXT_BASE_DIR=/txt
ENV AUDIO_BOOK_DIR=/audio
ENV MUSIC_BASE_DIR=/music
ENV CACHE_DIR=/covers
ENV DATABASE_URL="file:/app/packages/db/prisma/dev.db"
ENV PORT=3000

# 3. 复制 Node 项目产物
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/db/dist           ./packages/db/dist
COPY --from=builder /app/packages/db/package.json   ./packages/db/package.json
COPY --from=builder /app/packages/db/prisma         ./packages/db/prisma
COPY --from=builder /app/packages/db/generated      ./packages/db/generated
COPY --from=builder /app/packages/utils/dist        ./packages/utils/dist
COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json
COPY --from=builder /app/packages/ws/dist           ./packages/ws/dist
COPY --from=builder /app/packages/ws/package.json   ./packages/ws/package.json
COPY --from=builder /app/packages/services/dist     ./packages/services/dist
COPY --from=builder /app/packages/services/package.json ./packages/services/package.json
COPY --from=builder /app/services/api/dist          ./services/api/dist
COPY --from=builder /app/services/api/package.json  ./services/api/package.json
COPY --from=builder /app/apps/desktop/dist          /usr/share/nginx/html

# 4. 复制并安装 TTS 和 ASR 服务 (Python)
COPY services/tts /app/services/tts
RUN python3 -m pip install --no-cache-dir -r /app/services/tts/requirements.txt

COPY services/asr /app/services/asr
RUN python3 -m pip install --no-cache-dir -r /app/services/asr/requirements.txt

# 5. 安装 Node 运行时依赖
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile --ignore-scripts

# 6. 复制 Nginx 配置
COPY nginx.conf /etc/nginx/nginx.conf

# 7. 暴露服务端口
# 3000: API, 8000: TTS, 3300: ASR, 9958: Web
EXPOSE 3000 8000 3300 9958

# 8. 启动脚本
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# 1. 确保数据库目录存在 (针对持久化挂载的情况)\n\
mkdir -p /app/packages/db/prisma\n\
\n\
# 2. 确保数据库存在并更新 schema\n\
echo "Running prisma db push..."\n\
cd /app/packages/db && npx prisma@6 db push --accept-data-loss --skip-generate\n\
\n\
# 3. 启动 Nginx (后台运行)\n\
echo "Starting Nginx..."\n\
nginx\n\
\n\
# 4. 启动 Python TTS 服务 (后台运行)\n\
if [ "$DISABLE_TTS" != "true" ]; then\n\
  echo "Starting TTS Service..."\n\
  cd /app/services/tts && python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000 &\n\
else\n\
  echo "TTS Service is disabled."\n\
fi\n\
\n\
# 5. 启动 Python ASR 服务 (后台运行)\n\
if [ "$DISABLE_ASR" != "true" ]; then\n\
  echo "Starting ASR Service..."\n\
  cd /app/services/asr && python3 -m uvicorn src.main:app --host 0.0.0.0 --port 3300 &\n\
else\n\
  echo "ASR Service is disabled."\n\
fi\n\
\n\
# 6. 启动 Node API 服务 (前台运行)\n\
echo "Starting API Service..."\n\
cd /app/services/api && node dist/main.js' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
