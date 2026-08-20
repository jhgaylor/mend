/**
 * Grants: the credential an unattended agent carries.
 *
 * A rounds-style agent has no person present to sign in, so it needs
 * something durable. Handing it a GitHub token would mean a standing
 * credential sitting in a vault; instead it carries a **grant** — a signed
 * statement that "<login> authorised work on <repo>" — and trades it for a
 * one-hour installation token each time it runs.
 *
 * Deliberately stateless: the grant is HMAC-signed rather than stored, so
 * this process keeps no database. Revocation is not lost by that choice, it
 * just lives where it belongs — uninstall the App, or drop the repo from the
 * installation, and the mint fails at GitHub. That is the revocation people
 * actually expect, and it cannot drift out of sync with a table of our own.
 */
import crypto from "node:crypto";

export interface Grant {
  /** The GitHub login that authorised it. */
  login: string;
  /** owner/repo it is good for, and nothing else. */
  repo: string;
  /** Seconds since the epoch. */
  issuedAt: number;
}

const PREFIX = "mendg1";

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `mendg1.<payload>.<signature>` */
export function issueGrant(grant: Grant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${PREFIX}.${payload}.${sign(payload, secret)}`;
}

/**
 * Verify and decode. Returns null for anything that is not a grant we issued,
 * including one whose payload has been edited to name a different repository —
 * which is the attack this exists to stop.
 */
export function readGrant(token: string | undefined, secret: string, maxAgeSeconds = 0): Grant | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, payload, signature] = parts as [string, string, string];

  const expected = sign(payload, secret);
  // Constant-time compare; mismatched lengths are rejected before timingSafeEqual,
  // which throws on unequal buffers.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { login, repo, issuedAt } = parsed as Record<string, unknown>;
  if (typeof login !== "string" || typeof repo !== "string" || typeof issuedAt !== "number") return null;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  if (maxAgeSeconds > 0 && Date.now() / 1000 - issuedAt > maxAgeSeconds) return null;
  return { login, repo, issuedAt };
}
