# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# FraudLens API
#
# Multi-stage so the runtime image carries production dependencies and source
# only — no build toolchain, no dev dependencies, no test fixtures.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests first, so a source change does not invalidate the
# dependency layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# `--ignore-scripts` keeps Prisma's postinstall from running before the schema
# is present; the client is generated explicitly in the next stage.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.js ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps/api ./apps/api

# Generates the Prisma client into apps/api/src/generated/prisma.
RUN npx prisma generate

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# `tini` reaps zombies and forwards SIGTERM, which is what lets the graceful
# shutdown in server.js actually run when the container is stopped.
RUN apk add --no-cache tini curl

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json /app/prisma.config.js ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

# Drop privileges: the API never writes to the filesystem at runtime.
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/api/v1/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/src/server.js"]
