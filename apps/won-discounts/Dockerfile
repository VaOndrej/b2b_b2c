# syntax=docker/dockerfile:1
# Won Discounts — production image (MVP 7, A13). PREPARED, NOT DEPLOYED.
#
# npm-workspaces monorepo: the app consumes @won/core / @won/app-kit as workspace TS SOURCE, so the WHOLE
# workspace must be present and the build CONTEXT is the REPO ROOT:
#
#   docker build -f apps/won-discounts/Dockerfile -t won-discounts .
#
# The image is the admin + webhooks + scheduler (react-router-serve). The discount function and the theme app
# extension are NOT in it: `shopify app deploy` ships those (needs Rust; run from a developer machine or CI).
#
# Database: production is Postgres. prisma/postgres (generated from the SQLite schema by
# scripts/make-postgres-schema.mjs, drift-tested) replaces prisma/ here, so `prisma generate` and
# `prisma migrate deploy` (fly.toml release_command) are Postgres.

FROM node:22-slim
WORKDIR /repo

# Prisma's query engine needs OpenSSL on Debian slim.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Whole workspace: `npm ci` validates every workspace manifest against the lockfile.
COPY . .

# --include=dev: the build needs devDependencies (react-router, vite, prisma, tsx).
RUN npm ci --include=dev

# Postgres schema and migrations in place of the SQLite ones (see the header).
RUN cd apps/won-discounts \
 && cp prisma/postgres/schema.prisma prisma/schema.prisma \
 && sed -i 's#"../../app/generated/prisma"#"../app/generated/prisma"#' prisma/schema.prisma \
 && rm -rf prisma/migrations && cp -r prisma/postgres/migrations prisma/migrations \
 && rm -rf prisma/postgres prisma/dev.sqlite

# Prisma client (prebuild runs `prisma generate`) → server build. A placeholder DATABASE_URL: generate only
# parses the schema, nothing connects at build time.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build -w won-discounts

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /repo/apps/won-discounts
EXPOSE 3000

# Migrations run via Fly's release_command (fly.toml), not here.
CMD ["npm", "run", "start"]
