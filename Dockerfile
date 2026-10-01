# Privatekonomi (see docs/DRIFT.md). Built where it runs:
# docker compose up -d --build. Debian, not Alpine: sharp's prebuilt binary
# is for glibc. better-sqlite3's install script runs node-gyp, which needs a
# compiler in the build stage (only there: the image that runs has none).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The web app is built, then the build tools go: tsx runs the server and is a dependency.
RUN npm run build:web && npm prune --omit=dev

FROM node:24-bookworm-slim
# The commit this image is built from, for /api/health: the deploy waits for its own.
ARG GIT_COMMIT=unknown
# Settings, not secrets. The secrets come from env_file in compose.yml only.
ENV TZ=Europe/Stockholm \
    SERVE_WEB=1 \
    HOST=0.0.0.0 \
    API_PORT=3001 \
    DATABASE_PATH=/data/finance.db \
    GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
