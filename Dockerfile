FROM nginx:1.31-alpine-slim

COPY config/nginx.conf /etc/nginx/nginx.conf
COPY html /usr/share/nginx/html
