# Image du service Tooling. Construire depuis la racine du dépôt :
#   docker build -f apps/tooling/Dockerfile -t techma-tooling .
# Avant le pilote : épingler les images de base par empreinte (digest).

FROM node:22-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@10.20.0
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @techma/tooling... \
 && pnpm --filter @techma/tooling build \
 && pnpm --filter @techma/tooling deploy --legacy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
ENV TOOLING_HOST=0.0.0.0
ENV TOOLING_PORT=4030
ENV CONTRACTS_DIR=/app/contracts/v1
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /repo/contracts/v1 /app/contracts/v1
USER node
EXPOSE 4030
# Vivacité seulement ; la disponibilité (/ready) est suivie par le proxy.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4030/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/cluster.js"]
