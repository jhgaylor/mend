/**
 * One process: the built SPA, and the handful of endpoints that need a secret.
 *
 * Bun serves `dist/` directly, so there is no nginx and no second process to
 * supervise — and because the API is same-origin with the page, there is no
 * CORS to configure and nothing to get wrong.
 *
 * Everything under /gh exists because it touches the GitHub App's private key
 * or client secret. Nothing else does; the pull-request flow still runs in the
 * browser against api.github.com with the caller's own token.
 */
import { buildRoutes } from "./routes";
import { loadConfig } from "./config";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = process.env.DIST_DIR ?? "dist";

const config = loadConfig(process.env);
const routes = buildRoutes(config);

if (!config.app) {
  console.warn(
    "github app not configured — /gh endpoints will answer 503 and the app falls back to pasted tokens. " +
      "Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET and GRANT_SECRET.",
  );
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") return new Response("ok\n", { headers: { "content-type": "text/plain" } });

    if (url.pathname.startsWith("/gh/")) {
      try {
        return await routes(req, url);
      } catch (err) {
        // Never leak an internal error outward; the secret lives in here.
        console.error(`unhandled ${url.pathname}:`, err);
        return Response.json({ error: "Something went wrong." }, { status: 500 });
      }
    }

    // Static site, with SPA fallback so a deep link still boots the app.
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${DIST}${path}`);
    if (await file.exists()) {
      const immutable = path.startsWith("/assets/");
      return new Response(file, {
        headers: immutable ? { "cache-control": "public, max-age=31536000, immutable" } : { "cache-control": "no-cache" },
      });
    }
    return new Response(Bun.file(`${DIST}/index.html`), { headers: { "cache-control": "no-cache" } });
  },
});

console.log(`mend on :${server.port} (dist=${DIST}, github app ${config.app ? "configured" : "absent"})`);
