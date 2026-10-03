FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk-typescript/package.json packages/sdk-typescript/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci
FROM dependencies AS build
COPY . .
RUN npm run build:server
FROM dependencies AS runtime-dependencies
RUN npm prune --omit=dev
FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS production
# Runtime executes Node directly; package managers and their dependency trees are unnecessary.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v1.22.22 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/health.mjs ./scripts/health.mjs
COPY --from=build /app/scripts/storage-init.mjs ./scripts/storage-init.mjs
USER node
CMD ["node","dist/apps/api/src/main.js"]
