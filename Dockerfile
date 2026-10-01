FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    ICLOUD_MCP_BIND=0.0.0.0 \
    ICLOUD_MCP_PORT=8788 \
    ICLOUD_MCP_USERS_FILE=/data/users.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
VOLUME ["/data"]
EXPOSE 8788
CMD ["node", "dist/index.js", "serve"]
