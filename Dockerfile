# syntax=docker/dockerfile:1
FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    DATA_DIR=/app/data

WORKDIR /app

# Packages first, so a code change does not reinstall them.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error \
 && npm cache clean --force

COPY src ./src

# Not root: the WhatsApp session in the volume is the only thing it may write.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]

CMD ["node", "src/container.js"]
