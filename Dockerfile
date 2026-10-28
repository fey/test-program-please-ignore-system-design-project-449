# Образ решения содержит инструменты запуска и опытов.
# Каталог /app совпадает с точкой монтирования решения в compose.
FROM node:26-alpine

RUN apk add --no-cache make postgresql-client curl

WORKDIR /app
