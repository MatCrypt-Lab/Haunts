# API server image. Build from the repository root:
#   docker build -t unfog-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY mobile/package.json mobile/
RUN npm ci --workspace=@unfog/server --workspace=@unfog/core --include-workspace-root=false
COPY packages/core packages/core
COPY server server
RUN npm run build -w @unfog/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY mobile/package.json mobile/
RUN npm ci --omit=dev --workspace=@unfog/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server/dist/index.js"]
