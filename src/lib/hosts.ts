/**
 * Git hosts: what counts as a repo, how to clone it, and how a file becomes
 * a deep link. Pure string work, no network — the agent's clone is the only
 * thing that ever talks to the host. Same three hosts blacklight accepts.
 */

export type Host = "github.com" | "gitlab.com" | "codeberg.org";

const HOSTS: Host[] = ["github.com", "gitlab.com", "codeberg.org"];
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** A repository reference: `host/owner/name`, the app's canonical key. */
export interface RepoRef {
  host: Host;
  owner: string;
  name: string;
}

/** `host/owner/name` */
export function refKey(r: RepoRef): string {
  return `${r.host}/${r.owner}/${r.name}`;
}

/** `owner/name` for GitHub, `host/owner/name` elsewhere — what a human reads. */
export function refLabel(r: RepoRef): string {
  return r.host === "github.com" ? `${r.owner}/${r.name}` : refKey(r);
}

export function repoUrl(r: RepoRef): string {
  return `https://${refKey(r)}`;
}

export function cloneUrl(r: RepoRef): string {
  return `${repoUrl(r)}.git`;
}

/**
 * `owner/name` (GitHub), `host/owner/name`, or a full https URL on one of
 * the three hosts (with or without .git / a trailing path) → a RepoRef.
 * Null when it is not recognisably a repo on a supported host.
 */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^(https?:\/\/|git@)/i, "").replace(/^www\./i, "");
  let host: Host = "github.com";
  const lower = s.toLowerCase();
  const matched = HOSTS.find((h) => lower.startsWith(h + "/") || lower.startsWith(h + ":"));
  if (matched) {
    host = matched;
    s = s.slice(matched.length + 1);
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}[/:]/i.test(s)) {
    return null; // some other host
  }
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const name = parts[1]!.replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  return { host, owner, name };
}

/** `host/owner/name` (as stored in an agent name) → RepoRef, or null. */
export function parseRefKey(key: string): RepoRef | null {
  const parts = key.split("/");
  if (parts.length !== 3) return null;
  const [host, owner, name] = parts as [string, string, string];
  if (!HOSTS.includes(host as Host) || !SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  return { host: host as Host, owner, name };
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * The file URL on the host. Path and branch segments are URL-encoded; the
 * line fragment degrades: start+end → a range, start only → one line,
 * neither → the file. Each host spells the range its own way.
 */
export function fileUrl(r: RepoRef, branch: string, path: string, start?: number, end?: number): string {
  const p = enc(path.replace(/^\/+/, ""));
  const b = enc(branch);
  const range = typeof start === "number" && start > 0;
  const multi = range && typeof end === "number" && end > start;
  switch (r.host) {
    case "gitlab.com":
      return `${repoUrl(r)}/-/blob/${b}/${p}${range ? `#L${start}${multi ? `-${end}` : ""}` : ""}`;
    case "codeberg.org":
      return `${repoUrl(r)}/src/branch/${b}/${p}${range ? `#L${start}${multi ? `-L${end}` : ""}` : ""}`;
    default:
      return `${repoUrl(r)}/blob/${b}/${p}${range ? `#L${start}${multi ? `-L${end}` : ""}` : ""}`;
  }
}
