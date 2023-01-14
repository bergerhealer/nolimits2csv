FROM nginx:1.23
RUN apt-get update && apt-get install -y vim && \
    rm -rf /var/lib/apt/lists/*

COPY config/nginx.conf /etc/nginx/nginx.conf
COPY html /usr/share/nginx/html
