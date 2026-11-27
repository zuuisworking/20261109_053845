# Both base images are pinned by digest. The digests were resolved from the
# official Docker Hub manifests and must be reviewed whenever a version is
# changed.
ARG NODE_IMAGE=node:22.13.0-alpine@sha256:f2dc6eea95f787e25f173ba9904c9d0647ab2506178c7b5b7c5a3d02bc4af145
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1-alpine3.24@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
FROM ${NODE_IMAGE} AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime

# The base image intentionally runs unprivileged. Temporarily switch to root
# only to apply the signed Alpine security updates, then restore UID 101.
USER root
RUN apk upgrade --no-cache
USER 101

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
