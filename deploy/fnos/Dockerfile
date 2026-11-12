FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/playwright DISPLAY=:99 HOME=/data/home
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify tini fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/windows/workbench
COPY windows/workbench/package.json windows/workbench/package-lock.json ./
COPY windows/workbench/config.json ./config.json
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts \
    && npx --no-install playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright && rm -rf /var/lib/apt/lists/* /root/.npm
COPY windows/workbench/core ./core
COPY windows/workbench/desktop ./desktop
COPY windows/workbench/nas ./nas
COPY windows/workbench/scripts ./scripts
COPY deploy/fnos/entrypoint.sh /app/entrypoint.sh
COPY deploy/fnos/healthcheck.mjs /app/healthcheck.mjs
COPY scripts/fnos-backup.mjs /app/scripts/fnos-backup.mjs
RUN chmod 755 /app/entrypoint.sh && mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
EXPOSE 18761 18762
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
