# Node 24 to develop on, matching .node-version; git and curl for checkout and
# tooling, and corepack so the pinned pnpm arrives from the npm registry.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

USER node
