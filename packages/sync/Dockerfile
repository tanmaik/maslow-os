# The relay's image: Node with the relay and the shared editor package it
# runs headless, and nothing else. Built from the repo's root, so the
# workspace comes along; pnpm installs only these two packages. It holds
# no disk: a document lives in it only while someone is in it.
FROM node:24-bookworm-slim
RUN npm install -g pnpm@10
WORKDIR /opt/maslow
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/document/package.json packages/document/
COPY packages/sync/package.json packages/sync/
RUN pnpm install --prod --frozen-lockfile --filter @maslow/sync --filter @maslow/document
COPY packages/document/src packages/document/src
COPY packages/sync/src packages/sync/src
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "packages/sync/src/main.ts"]
