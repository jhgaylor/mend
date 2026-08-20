# One process: Bun serves the built SPA and the handful of /gh endpoints that
# need the GitHub App's secrets. No nginx, so nothing to supervise, and the API
# is same-origin with the page — no CORS to get wrong.
#
# The bundle is built by CI (bun run build) before docker build, and the server
# is plain TypeScript that Bun runs directly, so the image is the runtime plus
# source and multi-arch comes for free. It needs no dependencies at runtime:
# the server imports only Bun and node: builtins.
FROM oven/bun:1-alpine
WORKDIR /app
COPY server/ ./server/
COPY dist/ ./dist/
USER bun
EXPOSE 8080
CMD ["bun", "server/index.ts"]
