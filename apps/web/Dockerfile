# The website's image: the app as one small server with the files it
# reads, and the database package it migrates with before it serves anyone.
# Built from the repo's root, so the workspace comes along. No secret is in
# reach while it is built; the container is given them when it runs.
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production IMAGE_BUILD=1 NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @maslow/web exec next build
RUN pnpm --filter @maslow/db deploy --prod --legacy --no-optional /db

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static apps/web/.next/static
COPY --from=build /repo/apps/web/public apps/web/public
COPY --from=build /db packages/db
COPY --from=build /repo/scripts/migrate.mjs scripts/migrate.mjs
# A database on Amazon's RDS proves itself with a certificate from Amazon's
# own authority, which Node does not know; the app checks it against this.
# It goes in the app's own folder, which exists already: a folder the file
# made would be given the file's permissions and hide the system's.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds.pem
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
EXPOSE 8080
USER node
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node apps/web/server.js"]
