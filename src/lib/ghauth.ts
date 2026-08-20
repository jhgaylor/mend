/**
 * The viewer's own GitHub credential, kept in this browser only.
 *
 * Deliberately not a shared token: Mend is a public page, so anything the app
 * could read, every visitor could read. The PR is opened as whoever is sitting
 * here, with a token they control and can revoke.
 */

const KEY = "mend.github";

export interface GhAuth {
  token: string;
  login: string;
  avatarUrl?: string;
  /** How it was obtained — an App sign-in can be renewed by signing in again. */
  via?: "paste" | "app";
}

export function loadGhAuth(): GhAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GhAuth>;
    if (typeof parsed.token !== "string" || typeof parsed.login !== "string") return null;
    const auth: GhAuth = { token: parsed.token, login: parsed.login };
    if (typeof parsed.avatarUrl === "string") auth.avatarUrl = parsed.avatarUrl;
    if (parsed.via === "app" || parsed.via === "paste") auth.via = parsed.via;
    return auth;
  } catch {
    return null;
  }
}

export function saveGhAuth(auth: GhAuth): void {
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function clearGhAuth(): void {
  localStorage.removeItem(KEY);
}

/** Where to mint a token, with the scope preselected. */
export const TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=public_repo&description=Mend%20(mend.inevitable.fyi)";
