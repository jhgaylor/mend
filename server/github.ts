/**
 * The GitHub App, server-side.
 *
 * This is the only place the App's private key and OAuth client secret exist.
 * Neither is ever sent to a browser or to a sandbox — the whole reason this
 * process exists is that a private key mints installation tokens for *every*
 * installation of the App, which is a far broader credential than anything it
 * hands out.
 *
 * What it hands out instead:
 *   - a **user token**, from "Sign in with GitHub", which acts as the person
 *     and can only touch what they can touch;
 *   - an **installation token**, scoped to one repository and good for an
 *     hour, for the unattended case where no person is present.
 */
import crypto from "node:crypto";

export interface AppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

const API = "https://api.github.com";

/** A signed app JWT, valid for ten minutes — GitHub's maximum. */
export function appJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  // iat is backdated a minute to survive clock skew between us and GitHub.
  const payload = b64({ iat: now - 60, exp: now + 540, iss: String(appId) });
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * A private key pasted through a form or squeezed into an env var often
 * arrives with literal "\n". That fails deep inside OpenSSL with an opaque
 * message, so repair it here where the error can be clear.
 */
export function normalizeKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = raw.includes("\\n") && !raw.includes("\n") ? raw.replace(/\\n/g, "\n") : raw;
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key) ? key.trim() + "\n" : null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function gh<T>(url: string, token: string, init: RequestInit = {}, fetchImpl = fetch): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "mend-doorman",
      "x-github-api-version": "2022-11-28",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 200);
    try {
      detail = (JSON.parse(body) as { message?: string }).message ?? detail;
    } catch {
      // keep the raw body
    }
    throw new GitHubError(detail, res.status);
  }
  return (body ? JSON.parse(body) : null) as T;
}

export interface Deps {
  fetchImpl?: typeof fetch;
  api?: string;
  oauthHost?: string;
}

/** Exchange an OAuth code for a user access token. Needs the client secret, which is why it is here. */
export async function exchangeCode(
  cfg: AppConfig,
  code: string,
  redirectUri: string,
  deps: Deps = {},
): Promise<{ token: string; expiresIn?: number; refreshToken?: string }> {
  const host = deps.oauthHost ?? "https://github.com";
  const res = await (deps.fetchImpl ?? fetch)(`${host}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string; expires_in?: number; refresh_token?: string };
  if (!res.ok || !body.access_token) {
    throw new GitHubError(body.error_description ?? body.error ?? "GitHub refused the sign-in", 400);
  }
  const out: { token: string; expiresIn?: number; refreshToken?: string } = { token: body.access_token };
  if (body.expires_in) out.expiresIn = body.expires_in;
  if (body.refresh_token) out.refreshToken = body.refresh_token;
  return out;
}

export async function viewer(token: string, deps: Deps = {}): Promise<{ login: string }> {
  return gh<{ login: string }>(`${deps.api ?? API}/user`, token, {}, deps.fetchImpl);
}

/** Whether this person may push to this repo — the check before we mint anything for it. */
export async function canPush(token: string, slug: string, deps: Deps = {}): Promise<boolean> {
  try {
    const repo = await gh<{ permissions?: { push?: boolean } }>(`${deps.api ?? API}/repos/${slug}`, token, {}, deps.fetchImpl);
    return repo.permissions?.push === true;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false;
    throw err;
  }
}

/**
 * An installation token for one repository, good for an hour.
 *
 * Scoped deliberately: `repositories` limits it to the single repo even when
 * the installation covers many, so an unattended agent holding it cannot
 * reach anything else the person installed the App on.
 */
export async function installationToken(cfg: AppConfig, slug: string, deps: Deps = {}): Promise<{ token: string; expiresAt: string }> {
  const api = deps.api ?? API;
  const jwt = appJwt(cfg.appId, cfg.privateKey);
  const [owner, repo] = slug.split("/") as [string, string];
  let installation: { id: number };
  try {
    installation = await gh<{ id: number }>(`${api}/repos/${slug}/installation`, jwt, {}, deps.fetchImpl);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      throw new GitHubError(`The GitHub App is not installed on ${slug}.`, 404);
    }
    throw err;
  }
  const token = await gh<{ token: string; expires_at: string }>(
    `${api}/app/installations/${installation.id}/access_tokens`,
    jwt,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositories: [repo], owner }) },
    deps.fetchImpl,
  );
  if (!token?.token) throw new GitHubError("GitHub returned no token", 502);
  return { token: token.token, expiresAt: token.expires_at };
}
