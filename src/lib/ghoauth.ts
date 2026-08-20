/**
 * "Sign in with GitHub", against our own GitHub App.
 *
 * The browser sends the person to GitHub, GitHub sends them back here with a
 * code, and the code is handed to /gh/callback — which is the only part that
 * needs the client secret, and therefore the only part that cannot happen in a
 * page.
 *
 * The complication worth naming: Mend already completes a *Fountain* OAuth
 * callback on this same URL, and both arrive as `?code=…&state=…`. So each
 * flow stashes its own state under its own key and only claims a callback
 * whose state it recognises. Whichever one stashed the state gets the code;
 * the other leaves it alone.
 */

const STASH = "mend.github.oauth";

export interface GhLogin {
  token: string;
  login: string;
  /** Seconds until expiry, when the App expires user tokens. */
  expiresIn: number | null;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** This page, with no query or hash — must match a redirect URI on the App. */
export function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

/** Send the browser to GitHub. Never returns. */
export function beginGithubLogin(clientId: string): void {
  const state = randomState();
  sessionStorage.setItem(STASH, JSON.stringify({ state, redirectUri: redirectUri() }));
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), state });
  window.location.href = `https://github.com/login/oauth/authorize?${q}`;
}

/** True when the URL carries a callback this flow started — and not Fountain's. */
export function isGithubCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  if (!params.get("code") && !params.get("error")) return false;
  const stashed = sessionStorage.getItem(STASH);
  if (!stashed || !state) return false;
  try {
    return (JSON.parse(stashed) as { state?: string }).state === state;
  } catch {
    return false;
  }
}

/**
 * Complete the flow if this page load is our callback. Returns null when it is
 * not — including when it is Fountain's callback, which is left untouched.
 */
export async function completeGithubLoginIfCallback(): Promise<GhLogin | null> {
  if (!isGithubCallback()) return null;
  const params = new URLSearchParams(window.location.search);
  const stashed = sessionStorage.getItem(STASH);
  sessionStorage.removeItem(STASH);
  clearParams();

  const error = params.get("error");
  if (error) {
    throw new Error(error === "access_denied" ? "GitHub sign-in was declined." : `GitHub sign-in failed: ${error}`);
  }
  const code = params.get("code");
  if (!code || !stashed) return null;
  const { redirectUri: used } = JSON.parse(stashed) as { redirectUri: string };

  const res = await fetch(`/gh/callback?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(used)}`);
  const body = (await res.json().catch(() => ({}))) as { token?: string; login?: string; expiresIn?: number | null; error?: string };
  if (!res.ok || !body.token || !body.login) {
    throw new Error(body.error ?? "GitHub sign-in could not be completed.");
  }
  return { token: body.token, login: body.login, expiresIn: body.expiresIn ?? null };
}

/** Strip the OAuth parameters without reloading. */
function clearParams(): void {
  const url = new URL(window.location.href);
  for (const k of ["code", "state", "error", "error_description", "installation_id", "setup_action"]) {
    url.searchParams.delete(k);
  }
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export interface AppInfo {
  configured: boolean;
  slug: string | null;
  clientId: string | null;
  installUrl: string | null;
}

/** What this deployment's GitHub App is, or a not-configured answer. */
export async function fetchAppInfo(): Promise<AppInfo> {
  try {
    const res = await fetch("/gh/app");
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as AppInfo;
  } catch {
    return { configured: false, slug: null, clientId: null, installUrl: null };
  }
}
