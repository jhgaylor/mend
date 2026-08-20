/**
 * "Sign in with Fountain": OAuth 2.0 authorization code + PKCE (S256), public
 * client. The token we get back is a Fountain API key, so the rest of the app
 * is unchanged — it just did not have to be pasted.
 *
 * Fountain registers this client by id and by exact redirect URI
 * (OAUTH_CLIENTS on the server), so the client_id and redirect must match
 * what is registered there. The redirect is this app's own page.
 */
import { normalizeBaseUrl } from "./settings";

const CLIENT_ID = "mend";
const STASH = "mend.oauth";

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a.buffer);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(digest);
}

/**
 * The redirect URI: this app's page with the hash cleared. Must match a
 * `redirect_uris` entry registered for the client on the server.
 */
export function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

/** Begin the flow: stash verifier + state, send the browser to Fountain's consent page. */
export async function beginLogin(baseUrl: string): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  const challenge = await challengeFor(verifier);
  const base = normalizeBaseUrl(baseUrl);
  sessionStorage.setItem(STASH, JSON.stringify({ verifier, state, baseUrl: base }));
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  window.location.href = `${base}/oauth/authorize?${q}`;
}

export interface CallbackResult {
  baseUrl: string;
  apiKey: string;
}

/**
 * If the URL is an OAuth redirect back from Fountain, complete it: verify
 * state, exchange the code for a key, and return {baseUrl, apiKey}. Returns
 * null when this is not a callback. Throws with a message on a real failure.
 */
export async function completeLoginIfCallback(): Promise<CallbackResult | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");
  const state = params.get("state");
  if (!code && !error) return null;

  const stashed = sessionStorage.getItem(STASH);
  sessionStorage.removeItem(STASH);
  clearOAuthParams();

  if (error) throw new Error(error === "access_denied" ? "Sign-in was denied." : `Sign-in failed: ${error}`);
  if (!stashed) throw new Error("Sign-in could not be completed (no pending request in this browser).");

  const { verifier, state: expected, baseUrl } = JSON.parse(stashed) as { verifier: string; state: string; baseUrl: string };
  if (!state || state !== expected) throw new Error("Sign-in state did not match — try again.");

  const res = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT_ID, redirect_uri: redirectUri() }),
  });
  if (!res.ok) throw new Error("Fountain rejected the sign-in. Try again.");
  const body = (await res.json()) as { access_token: string };
  return { baseUrl, apiKey: body.access_token };
}

/** Best-effort revoke on sign-out. */
export async function revoke(baseUrl: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/oauth/revoke`, { method: "POST", headers: { authorization: `Bearer ${apiKey}` } });
  } catch {
    // ignore — signing out locally is what matters
  }
}

/** Strip ?code/?state/?error from the URL without a reload. */
function clearOAuthParams(): void {
  const url = new URL(window.location.href);
  ["code", "state", "error", "error_description"].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
