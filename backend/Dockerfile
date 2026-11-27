# The base image is pinned by digest. The digest was resolved from the
# official Docker Hub manifest for node:22.13.0-alpine and must be reviewed
# whenever the Node.js version is changed.
ARG NODE_IMAGE=node:22.13.0-alpine@sha256:f2dc6eea95f787e25f173ba9904c9d0647ab2506178c7b5b7c5a3d02bc4af145
FROM ${NODE_IMAGE} AS dependencies

WORKDIR /app
# Apply the signed Alpine security updates that post-date the base-image
# snapshot. The published application image is still scanned as an exact
# digest before release.
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    PORT=5000 \
    UPLOAD_DIR=/app/storage/uploads

WORKDIR /app

# The runtime does not need npm. Removing it also removes npm's bundled
# development tooling from the production image.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup -S -g 1001 sigap \
    && adduser -S -D -H -u 1001 -G sigap -h /app sigap \
    && mkdir -p /app/storage/uploads \
    && chown -R sigap:sigap /app/storage

COPY --from=dependencies --chown=sigap:sigap /app/node_modules ./node_modules
COPY --chown=sigap:sigap package.json ./
COPY --chown=sigap:sigap backend ./backend

USER sigap
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "backend/src/server.js"]
