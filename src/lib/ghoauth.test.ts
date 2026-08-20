import { beforeEach, describe, expect, test } from "bun:test";
import { isGithubCallback } from "./ghoauth";

// The point of these: Mend completes a *Fountain* OAuth callback on the same
// URL, and both arrive as ?code=…&state=…. If this ever claimed the wrong one,
// signing in to Fountain would silently break, so the disambiguation is pinned.

const STASH = "mend.github.oauth";

function browserAt(search: string, stash?: { state: string }) {
  const store = new Map<string, string>();
  if (stash) store.set(STASH, JSON.stringify({ state: stash.state, redirectUri: "https://mend.test/" }));
  (globalThis as unknown as { window: unknown }).window = { location: { search, origin: "https://mend.test", pathname: "/" } };
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

describe("isGithubCallback", () => {
  beforeEach(() => browserAt(""));

  test("claims a callback whose state it stashed", () => {
    browserAt("?code=abc&state=s1", { state: "s1" });
    expect(isGithubCallback()).toBe(true);
  });

  test("leaves Fountain's callback alone — same shape, different state", () => {
    browserAt("?code=abc&state=fountain-state", { state: "github-state" });
    expect(isGithubCallback()).toBe(false);
  });

  test("leaves a callback alone when this flow never started", () => {
    browserAt("?code=abc&state=s1");
    expect(isGithubCallback()).toBe(false);
  });

  test("a plain page load is not a callback", () => {
    browserAt("", { state: "s1" });
    expect(isGithubCallback()).toBe(false);
  });

  test("claims its own denial so the error can be shown", () => {
    browserAt("?error=access_denied&state=s1", { state: "s1" });
    expect(isGithubCallback()).toBe(true);
  });

  test("a corrupt stash is not a match rather than a crash", () => {
    browserAt("?code=abc&state=s1");
    sessionStorage.setItem(STASH, "not json");
    expect(isGithubCallback()).toBe(false);
  });
});
