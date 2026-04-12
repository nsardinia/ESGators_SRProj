FROM python:3.12-slim AS build

WORKDIR /app

RUN pip install --no-cache-dir mkdocs

COPY mkdocs.yml ./
COPY docs ./docs

RUN mkdocs build --site-dir /site

FROM nginx:1.27-alpine

COPY docs-fly/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html

EXPOSE 8080
