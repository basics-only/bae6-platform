# Builds one workspace app: docker build --build-arg APP=examples/hello .
ARG NODE=node:22.21-alpine@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf

FROM ${NODE} AS deps
ARG APP
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ${APP}/package.json ${APP}/
RUN pnpm install --frozen-lockfile --prod --filter "./${APP}"
RUN mkdir -p "${APP}/node_modules"

FROM ${NODE}
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=deps /src/${APP}/node_modules ./${APP}/node_modules
COPY ${APP} ./${APP}
USER node
WORKDIR /app/${APP}
CMD ["node", "--enable-source-maps", "."]
