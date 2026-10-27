# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# FraudLens web client
#
# Built with Vite, then served by nginx. The runtime image contains only the
# compiled static bundle: no Node, no source, no dependencies.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts

COPY packages ./packages
COPY apps/web ./apps/web

# The client calls the API through same-origin paths that nginx proxies, so no
# API URL has to be baked into the bundle at build time.
RUN npm run build --workspace @fraudlens/web

# ---------------------------------------------------------------------------

FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
