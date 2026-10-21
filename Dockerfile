# syntax=docker/dockerfile:1
# Imagen de producción: la API sirve la web compilada. Se construye en el
# propio servidor (DonWeb, amd64) y en la CI. Funciona también en arm64. Ver infra/README.md.

# Debian (glibc) para usar los binarios precompilados de argon2.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# El CLI de Prisma (generate, migrate) detecta la versión de OpenSSL.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

# Dependencias, en una capa que solo cambia con el lockfile o el schema.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# El postinstall de la API genera el cliente de Prisma.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Personalización del ticket; se fijan al compilar la web.
ARG VITE_NOMBRE_KIOSCO=Kiosco
ARG VITE_ANCHO_TICKET=80
ENV VITE_NOMBRE_KIOSCO=$VITE_NOMBRE_KIOSCO VITE_ANCHO_TICKET=$VITE_ANCHO_TICKET
COPY . .
RUN pnpm build
# Solo las dependencias de producción de la API, sin enlaces al workspace.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm deploy --filter api --prod --legacy /out \
  && node apps/api/scripts/podar-node-modules.mjs /out

# Aplica las migraciones pendientes: el CLI de Prisma es dependencia de
# desarrollo, así que vive en esta imagen y no en la final.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/Argentina/Buenos_Aires PORT=3000
# server.js busca la web en ../../web/dist respecto de apps/api/dist.
WORKDIR /app/api
# Archivos de root: el proceso (usuario node) los lee pero no los puede modificar.
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist /app/web/dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
