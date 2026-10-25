# 默认使用国内镜像，避免拉取 Docker Hub 超时。
# 官方镜像：docker build --build-arg NODE_IMAGE=node:20-bookworm-slim .
ARG NODE_IMAGE=docker.1ms.run/library/node:20-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8787 \
  READ_LIFE_DB=/data/read-life.sqlite

VOLUME /data
EXPOSE 8787

CMD ["npx", "tsx", "src/server/index.ts"]
