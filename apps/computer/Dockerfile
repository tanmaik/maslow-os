# The bootstrap: enough to mount the volume and answer for it. The pty is
# native code, built here and copied in, so the machine carries no
# compiler.
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /computer
COPY package.json .
RUN npm install --omit=dev

FROM node:24-slim
WORKDIR /computer
COPY --from=build /computer/node_modules node_modules
COPY package.json server.mjs ./
CMD ["node", "server.mjs"]
