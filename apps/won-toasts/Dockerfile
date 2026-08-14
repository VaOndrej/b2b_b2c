# syntax=docker/dockerfile:1
# Won Toasts — production image.
#
# This is an npm-workspaces monorepo and the app consumes @won/core / @won/app-kit
# / @won/adapter as workspace TS SOURCE (packages export ./src/*.ts, no separate
# package build). Therefore the WHOLE workspace must be present at build time and
# the build CONTEXT is the REPO ROOT, not apps/won-toasts.
#
#   From the repo root:  docker build -f apps/won-toasts/Dockerfile -t won-toasts .
#   (Fly runs this for you — see fly.toml.)
#
# VERIFIED 2026-08-13: `docker build -f apps/won-toasts/Dockerfile .` succeeds end
# to end (npm ci across the workspace → prisma generate on postgres → storefront
# esbuild → react-router build → image export).

FROM node:22-slim
WORKDIR /repo

# Prisma's query engine needs OpenSSL on Debian slim.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Whole workspace: `npm ci` validates every workspace manifest against the
# lockfile, so a partial copy would fail. .dockerignore trims the heavy non-code.
COPY . .

# --include=dev: build needs devDependencies (react-router, vite, esbuild, prisma,
# tsx) even though the runtime is production.
RUN npm ci --include=dev

# Prisma client → storefront asset (esbuild) → server build (react-router).
RUN npm run prisma:generate -w won-toasts \
 && npm run build:storefront -w won-toasts \
 && npm run build -w won-toasts

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /repo/apps/won-toasts
EXPOSE 3000

# Migrations run via Fly's release_command (see fly.toml), not here.
CMD ["npm", "run", "start"]
