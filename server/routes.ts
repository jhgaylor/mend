/**
 * The endpoints that need a secret. Four of them.
 *
 *   GET  /gh/app                     what the App is, so the UI can offer to install it
 *   GET  /gh/callback?code&state     finish "Sign in with GitHub"; hands back a user token
 *   POST /gh/grant   {token, repo}   mint a durable grant for an unattended agent
 *   POST /gh/token   {grant}         trade a grant for a one-hour, one-repo token
 *
 * The two that mint anything both verify the caller can actually push to the
 * repository first. That check is the whole security model: without it, a
 * grant request would be a way to borrow the App's access to somebody else's
 * repository.
 */
import { canPush, exchangeCode, GitHubError, installationToken, viewer, type Deps } from "./github";
import { issueGrant, readGrant } from "./grant";
import type { Config } from "./config";

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type Routes = (req: Request, url: URL) => Promise<Response>;

export function buildRoutes(config: Config, deps: Deps = {}): Routes {
  const cors = (req: Request): Record<string, string> => {
    const origin = req.headers.get("origin");
    if (!origin || !config.allowedOrigins.includes(origin)) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      vary: "origin",
    };
  };

  const json = (req: Request, body: unknown, status = 200) =>
    Response.json(body, { status, headers: cors(req) });

  return async (req, url) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

    if (url.pathname === "/gh/app") {
      // Public, deliberately: it says what the App is and what it wants, and
      // carries nothing secret.
      return json(req, {
        configured: config.app !== null,
        slug: config.slug,
        clientId: config.app?.clientId ?? null,
        installUrl: config.slug ? `https://github.com/apps/${config.slug}/installations/new` : null,
      });
    }

    if (!config.app) {
      return json(req, { error: "This deployment has no GitHub App configured. Use a token instead." }, 503);
    }
    const app = config.app;

    try {
      if (url.pathname === "/gh/callback" && req.method === "GET") {
        const code = url.searchParams.get("code");
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        if (!code) return json(req, { error: "Missing code" }, 400);
        const { token, expiresIn } = await exchangeCode(app, code, redirectUri, deps);
        const who = await viewer(token, deps);
        return json(req, { token, login: who.login, expiresIn: expiresIn ?? null });
      }

      if (url.pathname === "/gh/grant" && req.method === "POST") {
        if (!config.grantSecret) return json(req, { error: "Grants are not enabled on this deployment." }, 503);
        const body = (await req.json().catch(() => ({}))) as { token?: string; repo?: string };
        if (!body.token || !body.repo || !SLUG.test(body.repo)) {
          return json(req, { error: "Send {token, repo} where repo is owner/name." }, 400);
        }
        // The person must be able to push there, or this would be a way to
        // borrow the App's access to a repository that is not theirs.
        const who = await viewer(body.token, deps);
        if (!(await canPush(body.token, body.repo, deps))) {
          return json(req, { error: `${who.login} cannot push to ${body.repo}.` }, 403);
        }
        // And the App has to be installed on it, or the grant is a dud that
        // only fails later, on a schedule, where nobody is watching.
        await installationToken(app, body.repo, deps);
        return json(req, {
          grant: issueGrant({ login: who.login, repo: body.repo, issuedAt: Math.floor(Date.now() / 1000) }, config.grantSecret),
          login: who.login,
          repo: body.repo,
        });
      }

      if (url.pathname === "/gh/token" && req.method === "POST") {
        if (!config.grantSecret) return json(req, { error: "Grants are not enabled on this deployment." }, 503);
        const body = (await req.json().catch(() => ({}))) as { grant?: string };
        const grant = readGrant(body.grant, config.grantSecret);
        if (!grant) return json(req, { error: "That grant is not valid." }, 401);
        // Scoped to the repo named in the grant — never to one the caller asks for.
        const minted = await installationToken(app, grant.repo, deps);
        return json(req, { token: minted.token, expiresAt: minted.expiresAt, repo: grant.repo });
      }
    } catch (err) {
      if (err instanceof GitHubError) {
        // Anything GitHub blames on the request is the caller's to fix, and
        // saying so is more useful than a blanket 502; 403 is folded into 401
        // because from here both mean "your credential will not do this".
        const status = err.status === 403 ? 401 : err.status >= 400 && err.status < 500 ? err.status : 502;
        return json(req, { error: err.message }, status);
      }
      throw err;
    }

    return json(req, { error: "Not found" }, 404);
  };
}
