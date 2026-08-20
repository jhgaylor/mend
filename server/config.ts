/**
 * What the process needs to act as the GitHub App — and nothing else.
 *
 * All of it is optional: with none of it set the app still works exactly as it
 * did before, with pasted tokens. That keeps the deployment honest, because a
 * missing secret degrades to the old path instead of a blank page.
 */
import { normalizeKey, type AppConfig } from "./github";

export interface Config {
  /** Null when the App is not configured — /gh then answers 503. */
  app: AppConfig | null;
  /** HMAC secret for grants. Null disables grant issuing. */
  grantSecret: string | null;
  /** Origins allowed to call /gh cross-origin. Same-origin needs no entry. */
  allowedOrigins: string[];
  /** Public app slug, for the "install it" link. */
  slug: string | null;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const appId = env.GITHUB_APP_ID;
  const privateKey = normalizeKey(env.GITHUB_APP_PRIVATE_KEY);
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;

  const complete = Boolean(appId && privateKey && clientId && clientSecret);
  if (appId && !privateKey) {
    console.warn("GITHUB_APP_PRIVATE_KEY is set but is not a PEM private key — the app will not be used.");
  }

  return {
    app: complete ? { appId: appId!, privateKey: privateKey!, clientId: clientId!, clientSecret: clientSecret! } : null,
    grantSecret: env.GRANT_SECRET ?? null,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    slug: env.GITHUB_APP_SLUG ?? null,
  };
}
