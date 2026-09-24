FROM docker.1ms.run/library/node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
  PORT=8787 \
  READ_LIFE_DB=/data/read-life.sqlite

VOLUME /data
EXPOSE 8787

CMD ["npx", "tsx", "src/server/index.ts"]
