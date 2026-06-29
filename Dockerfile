# Real-Time Deal Room — zero-dependency Node app, so the image is tiny and the
# build is just "copy the source". No npm install, no build step, no lockfile.
FROM node:20-alpine

WORKDIR /app

# Copy the application source (.dockerignore keeps the 100 MB video, the audio
# narration, .env, and .git out of the image).
COPY . .

# Bind to all interfaces inside the container so the mapped port is reachable
# from the host; the app still defaults to 127.0.0.1 when run outside Docker.
ENV HOST=0.0.0.0 \
    PORT=5173 \
    NODE_ENV=production

EXPOSE 5173

# Drop to the built-in non-root user — the server only ever reads files.
USER node

# Liveness check hits the health endpoint (loopback works inside the container).
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5173/api/health || exit 1

CMD ["node", "server.mjs"]
