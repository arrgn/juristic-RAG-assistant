#!/bin/sh
# Собирает конфигурацию Nginx из шаблона при запуске контейнера.
# Порт сервера берётся из SERVER_PORT, таймаут прокси — из LLM_TIMEOUT_MS
# с запасом 30 секунд (spec/tech/architecture.md, раздел 8).
# В образе лежит как /docker-entrypoint.d/40-render-config.sh: его запускает
# стандартная точка входа образа nginx перед стартом Nginx.
set -eu

SERVER_PORT="${SERVER_PORT:-3000}"
LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-30000}"

case "$SERVER_PORT" in
  '' | *[!0-9]*) echo "$0: недопустимое значение SERVER_PORT: $SERVER_PORT" >&2; exit 1 ;;
esac
case "$LLM_TIMEOUT_MS" in
  '' | *[!0-9]*) echo "$0: недопустимое значение LLM_TIMEOUT_MS: $LLM_TIMEOUT_MS" >&2; exit 1 ;;
esac

# Секунды с округлением вверх плюс запас на поиск, сеть и разбор ответа модели.
PROXY_TIMEOUT=$(( (LLM_TIMEOUT_MS + 999) / 1000 + 30 ))
export SERVER_PORT PROXY_TIMEOUT

envsubst '${SERVER_PORT} ${PROXY_TIMEOUT}' \
  < /etc/nginx/app/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "$0: /api/ -> server:${SERVER_PORT}, таймаут прокси ${PROXY_TIMEOUT} с"
