# Образ сервера NestJS: сборка TypeScript и запуск (spec/tech/architecture.md, раздел 8).
# Контекст сборки — папка app/server.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Корпус: демо-записи, срез для контрольной точки и, когда появится, полный data/articles.json.
COPY data ./data
# Скрипты бенчмарка (сервис benchmark в compose).
COPY benchmark ./benchmark
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
