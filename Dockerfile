# Образ всего приложения: сервер на tsx и собранный клиент, который сервер раздаёт сам.
# Сервер запускается из исходников TypeScript, как и в dev, поэтому отдельной сборки сервера нет.
FROM node:24-alpine

WORKDIR /app
RUN corepack enable

# Сначала только манифесты: слой с зависимостями пересобирается, лишь когда они меняются.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/server apps/server
RUN pnpm --filter @se/web build

ENV WEB_DIST=/app/apps/web/dist \
    UPLOAD_DIR=/app/uploads \
    PORT=3000
EXPOSE 3000

# Миграции базы применяются при старте сервера.
CMD ["pnpm", "--filter", "@se/server", "start"]
