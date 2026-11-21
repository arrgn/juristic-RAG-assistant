# Образ Nginx: собирает статику клиента (app/client) и проксирует /api/ на сервер
# (spec/tech/architecture.md, разделы 1 и 8). Контекст сборки — папка app/.

FROM node:24-alpine AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM nginx:stable-alpine
# Стандартный сайт Nginx не нужен: конфигурацию собирает render-config.sh при запуске.
RUN rm -f /etc/nginx/conf.d/default.conf && rm -rf /usr/share/nginx/html/*
COPY nginx/default.conf.template /etc/nginx/app/default.conf.template
COPY nginx/render-config.sh /docker-entrypoint.d/40-render-config.sh
# Переводы строк CRLF (checkout на Windows) ломают shell-скрипт, поэтому они убираются.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-render-config.sh \
 && chmod +x /docker-entrypoint.d/40-render-config.sh
COPY --from=client /client/dist /usr/share/nginx/html
