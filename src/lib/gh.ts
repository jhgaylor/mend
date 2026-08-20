/**
 * Opening the pull request from the browser.
 *
 * api.github.com sends permissive CORS headers and accepts an Authorization
 * header from a page, so the app can do the whole thing itself: read the
 * files, build a tree, commit it, push a branch and open the PR. That keeps
 * Mend a static site with no backend and no shared credential — the token is
 * the viewer's own, lives in their browser, and the PR is authored by them.
 *
 * (The one thing a browser cannot do is exchange an OAuth code for a token —
 * that endpoint has no CORS — which is why this takes a PAT rather than
 * offering "Sign in with GitHub".)
 */
import type { FileChange } from "./apply";

const API = "https://api.github.com";

export class GhError extends Error {
  constructor(
    message: string,
    public status: number,
    public docUrl?: string,
  ) {
    super(message);
    this.name = "GhError";
  }
}

export interface Viewer {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  /** Whether the token may push directly (otherwise we fork). */
  canPush: boolean;
  archived: boolean;
}

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GhError("Could not reach GitHub from the browser. Check your connection.", 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) throw new GhError(describe(res, body), res.status, docUrlOf(body));
  return body as T;
}

function describe(res: Response, body: unknown): string {
  const msg = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
    ? (body as { message: string }).message
    : `${res.status} ${res.statusText}`;
  switch (res.status) {
    case 401:
      return "GitHub rejected that token. It may be expired or mistyped.";
    case 403:
      if (res.headers.get("x-ratelimit-remaining") === "0") return "GitHub rate limit reached — try again in a few minutes.";
      return `GitHub refused the request: ${msg}. The token likely lacks the right scope (it needs repo / public_repo).`;
    case 404:
      return `Not found: ${msg}. Either the repository does not exist or the token cannot see it.`;
    case 422:
      return `GitHub rejected the request: ${msg}`;
    default:
      return `GitHub error (${res.status}): ${msg}`;
  }
}

function docUrlOf(body: unknown): string | undefined {
  const u = typeof body === "object" && body !== null ? (body as { documentation_url?: unknown }).documentation_url : undefined;
  return typeof u === "string" ? u : undefined;
}

// ── base64, UTF-8 safe ───────────────────────────────────────────────────────

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── the calls ────────────────────────────────────────────────────────────────

export async function getViewer(token: string): Promise<Viewer> {
  const u = await gh<{ login: string; name?: string; avatar_url?: string }>(token, "/user");
  const v: Viewer = { login: u.login };
  if (u.name) v.name = u.name;
  if (u.avatar_url) v.avatarUrl = u.avatar_url;
  return v;
}

export async function getRepo(token: string, owner: string, name: string): Promise<RepoInfo> {
  const r = await gh<{ full_name: string; default_branch: string; archived: boolean; permissions?: { push?: boolean } }>(
    token,
    `/repos/${owner}/${name}`,
  );
  return {
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    canPush: r.permissions?.push === true,
    archived: r.archived,
  };
}

/** The file's contents at a ref, or null when it does not exist there. */
export async function readFile(token: string, fullName: string, path: string, ref: string): Promise<string | null> {
  try {
    const r = await gh<{ content?: string; encoding?: string; type: string }>(
      token,
      `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (r.type !== "file" || typeof r.content !== "string") return null;
    return decodeBase64(r.content);
  } catch (err) {
    if (err instanceof GhError && err.status === 404) return null;
    throw err;
  }
}

/** Fork the repo to the viewer's account and wait for it to become usable. */
export async function ensureFork(token: string, owner: string, name: string, login: string): Promise<string> {
  const forkName = `${login}/${name}`;
  try {
    await gh(token, `/repos/${forkName}`);
    return forkName;
  } catch (err) {
    if (!(err instanceof GhError) || err.status !== 404) throw err;
  }
  await gh(token, `/repos/${owner}/${name}/forks`, { method: "POST" });
  // Forking is asynchronous; poll until the repo answers.
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    try {
      await gh(token, `/repos/${forkName}`);
      return forkName;
    } catch (err) {
      if (!(err instanceof GhError) || err.status !== 404) throw err;
    }
  }
  throw new GhError("GitHub is still preparing the fork — try again in a moment.", 202);
}

export interface OpenPrOptions {
  token: string;
  owner: string;
  repo: string;
  /** Files already patched by `buildChanges`. */
  changes: FileChange[];
  branch: string;
  title: string;
  body: string;
  commitMessage: string;
  /** Reports each step so the UI can narrate the wait. */
  onStep?: (step: string) => void;
}

export interface OpenPrResult {
  url: string;
  number: number;
  /** Set when the branch had to go to a fork. */
  forkedTo?: string;
}

/**
 * The whole flow: resolve the base, fork if we cannot push, build a tree from
 * the patched files, commit it, create the branch and open the PR.
 */
export async function openPullRequest(opts: OpenPrOptions): Promise<OpenPrResult> {
  const { token, owner, repo, changes } = opts;
  const step = opts.onStep ?? (() => {});

  step("Checking the repository");
  const base = await getRepo(token, owner, repo);
  if (base.archived) throw new GhError(`${base.fullName} is archived — it cannot take a pull request.`, 422);

  const viewer = await getViewer(token);
  let headRepo = base.fullName;
  let forkedTo: string | undefined;
  if (!base.canPush) {
    step("Forking the repository");
    headRepo = await ensureFork(token, owner, repo, viewer.login);
    forkedTo = headRepo;
  }

  step("Reading the base commit");
  const ref = await gh<{ object: { sha: string } }>(token, `/repos/${base.fullName}/git/ref/heads/${encodeURIComponent(base.defaultBranch)}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(token, `/repos/${base.fullName}/git/commits/${baseSha}`);

  step(`Building ${changes.length} file${changes.length === 1 ? "" : "s"}`);
  const tree: Array<Record<string, unknown>> = [];
  for (const change of changes) {
    if (change.content === null) {
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await gh<{ sha: string }>(token, `/repos/${headRepo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: encodeBase64(change.content), encoding: "base64" }),
    });
    tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  step("Creating the commit");
  const newTree = await gh<{ sha: string }>(token, `/repos/${headRepo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });
  const commit = await gh<{ sha: string }>(token, `/repos/${headRepo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: opts.commitMessage, tree: newTree.sha, parents: [baseSha] }),
  });

  step("Pushing the branch");
  await gh(token, `/repos/${headRepo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${opts.branch}`, sha: commit.sha }),
  });

  step("Opening the pull request");
  const head = forkedTo ? `${viewer.login}:${opts.branch}` : opts.branch;
  const pr = await gh<{ html_url: string; number: number }>(token, `/repos/${base.fullName}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title: opts.title, body: opts.body, head, base: base.defaultBranch }),
  });

  const result: OpenPrResult = { url: pr.html_url, number: pr.number };
  if (forkedTo) result.forkedTo = forkedTo;
  return result;
}

/** A branch name that will not collide with a previous attempt. */
export function branchName(seed: number): string {
  return `mend/chant-audit-${seed.toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
