# Static SPA. The bundle is built by CI (bun run build) before docker build,
# so this image is just nginx + dist/ and multi-arch comes for free.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080
