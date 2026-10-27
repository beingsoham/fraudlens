#!/usr/bin/env bash
# Truncates every application table in the configured development database,
# leaving the Prisma migration history intact, then re-seeds.
#
# Intended for local development only. It does not drop the database and does
# not touch `_prisma_migrations`, so the schema stays exactly as migrated.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Refusing to truncate data with NODE_ENV=production." >&2
  exit 1
fi

node scripts/truncate-tables.js
node prisma/seed.js
