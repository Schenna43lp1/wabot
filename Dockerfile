# syntax=docker/dockerfile:1
# Debian instead of Alpine: the optional speech recognition needs glibc.
FROM node:24-slim

# SPEECH=an in .env also builds the speech recognition into the image (about 700 MB more).
ARG SPEECH=

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    DATA_DIR=/app/data

WORKDIR /app

# Packages first, so a code change does not reinstall them.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error \
 && npm cache clean --force

COPY speech/package.json speech/package-lock.json speech/.npmrc speech/index.js ./speech/
RUN case "$SPEECH" in \
      ""|aus|off|false|0|nein) echo "Spracherkennung: aus" ;; \
      *) npm ci --prefix speech --no-audit --no-fund --loglevel=error && npm cache clean --force ;; \
    esac

COPY src ./src

# Not root: the WhatsApp session in the volume is the only thing it may write.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]

CMD ["node", "src/container.js"]
