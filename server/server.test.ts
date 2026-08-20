import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { appJwt, normalizeKey } from "./github";
import { issueGrant, readGrant } from "./grant";
import { buildRoutes } from "./routes";
import { loadConfig } from "./config";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SECRET = "grant-signing-secret";

// ── a fake GitHub, so the whole flow is exercised without the network ───────
interface FakeOpts {
  pushable?: string[];
  installedOn?: string[];
}
function fakeGitHub(opts: FakeOpts = {}) {
  const pushable = new Set(opts.pushable ?? ["o/r"]);
  const installed = new Set(opts.installedOn ?? ["o/r"]);
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);

    if (path === "/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { code?: string };
      if (body.code !== "good-code") return Response.json({ error: "bad_verification_code", error_description: "The code is incorrect." }, { status: 200 });
      return Response.json({ access_token: "gho_usertoken", expires_in: 28800 });
    }
    if (path === "/user") return Response.json({ login: "octocat" });
    if (path.startsWith("/repos/") && path.endsWith("/installation")) {
      const slug = path.slice("/repos/".length, -"/installation".length);
      return installed.has(slug) ? Response.json({ id: 99 }) : Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (path.startsWith("/repos/")) {
      const slug = path.slice("/repos/".length);
      return Response.json({ permissions: { push: pushable.has(slug) } });
    }
    if (path === "/app/installations/99/access_tokens") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { repositories?: string[] };
      return Response.json({ token: `ghs_for_${body.repositories?.[0]}`, expires_at: "2026-08-20T10:00:00Z" }, { status: 201 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ENV = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_OAUTH_CLIENT_ID: "Iv1.abc",
  GITHUB_OAUTH_CLIENT_SECRET: "supersecret",
  GRANT_SECRET: SECRET,
  GITHUB_APP_SLUG: "mend-bot",
};

function routesWith(fake: ReturnType<typeof fakeGitHub>, env = ENV) {
  return buildRoutes(loadConfig(env), { fetchImpl: fake.impl, api: "https://api.github.com", oauthHost: "https://github.com" });
}

const call = (routes: ReturnType<typeof buildRoutes>, path: string, init?: RequestInit) => {
  const url = new URL(`https://mend.test${path}`);
  return routes(new Request(url, init), url);
};

describe("appJwt", () => {
  test("verifies against the app's public key and stays inside GitHub's window", () => {
    const now = 1_760_000_000;
    const [h, p, s] = appJwt("123", privateKey, now).split(".") as [string, string, string];
    expect(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { iat: number; exp: number };
    expect(claims.iat).toBe(now - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });
});

describe("normalizeKey", () => {
  test("repairs a key flattened into literal backslash-n", () => {
    const fixed = normalizeKey(privateKey.trim().replace(/\n/g, "\\n"));
    expect(fixed).toContain("-----BEGIN PRIVATE KEY-----\n");
    expect(() => appJwt("1", fixed!)).not.toThrow();
  });

  test("refuses anything that is not a PEM key", () => {
    expect(normalizeKey("ghp_atokennotakey")).toBeNull();
    expect(normalizeKey(undefined)).toBeNull();
  });
});

describe("grants", () => {
  test("round-trip", () => {
    const g = { login: "octocat", repo: "o/r", issuedAt: 1000 };
    expect(readGrant(issueGrant(g, SECRET), SECRET)).toEqual(g);
  });

  test("a grant edited to name another repo is rejected", () => {
    const token = issueGrant({ login: "octocat", repo: "o/r", issuedAt: 1000 }, SECRET);
    const [prefix, , signature] = token.split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ login: "octocat", repo: "victim/secrets", issuedAt: 1000 })).toString("base64url");
    expect(readGrant(`${prefix}.${forged}.${signature}`, SECRET)).toBeNull();
  });

  test("a grant signed with another secret is rejected", () => {
    expect(readGrant(issueGrant({ login: "a", repo: "o/r", issuedAt: 1 }, "other"), SECRET)).toBeNull();
  });

  test("junk and truncation are rejected without throwing", () => {
    for (const bad of ["", "nope", "mendg1.only-two", "x.y.z", undefined]) {
      expect(readGrant(bad, SECRET)).toBeNull();
    }
  });

  test("age can be enforced when a caller wants it", () => {
    const old = issueGrant({ login: "a", repo: "o/r", issuedAt: Math.floor(Date.now() / 1000) - 7200 }, SECRET);
    expect(readGrant(old, SECRET, 3600)).toBeNull();
    expect(readGrant(old, SECRET)).not.toBeNull();
  });
});

describe("loadConfig", () => {
  test("trims whitespace off every secret — a trailing newline is the classic", () => {
    const cfg = loadConfig({
      ...ENV,
      GITHUB_APP_ID: "123\n",
      GITHUB_OAUTH_CLIENT_ID: "Iv1.abc\n",
      GITHUB_OAUTH_CLIENT_SECRET: "supersecret\n",
      GRANT_SECRET: " sec ",
      GITHUB_APP_SLUG: "mend-bot\n",
    });
    expect(cfg.app).toMatchObject({ appId: "123", clientId: "Iv1.abc", clientSecret: "supersecret" });
    expect(cfg.grantSecret).toBe("sec");
    expect(cfg.slug).toBe("mend-bot");
  });

  test("a value that is only whitespace counts as absent", () => {
    expect(loadConfig({ ...ENV, GITHUB_OAUTH_CLIENT_SECRET: "   " }).app).toBeNull();
  });
});

describe("GET /gh/app", () => {
  test("advertises the app without leaking a secret", async () => {
    const res = await call(routesWith(fakeGitHub()), "/gh/app");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      configured: true,
      slug: "mend-bot",
      clientId: "Iv1.abc",
      installUrl: "https://github.com/apps/mend-bot/installations/new",
    });
    expect(JSON.stringify(body)).not.toContain("supersecret");
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  });

  test("an unconfigured deployment says so, and every other route 503s", async () => {
    const routes = routesWith(fakeGitHub(), { ...ENV, GITHUB_APP_ID: undefined } as unknown as typeof ENV);
    expect(((await (await call(routes, "/gh/app")).json()) as { configured: boolean }).configured).toBe(false);
    expect((await call(routes, "/gh/token", { method: "POST", body: "{}" })).status).toBe(503);
  });
});

describe("GET /gh/callback", () => {
  test("exchanges the code and returns the user's own token", async () => {
    const fake = fakeGitHub();
    const res = await call(routesWith(fake), "/gh/callback?code=good-code&redirect_uri=https%3A%2F%2Fmend.test%2F");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "gho_usertoken", login: "octocat", expiresIn: 28800 });
    expect(fake.calls).toContain("POST /login/oauth/access_token");
  });

  test("a bad code is reported as the caller's problem, without exposing the client secret", async () => {
    const res = await call(routesWith(fakeGitHub()), "/gh/callback?code=nope");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("The code is incorrect.");
    expect(text).not.toContain("supersecret");
  });

  test("a missing code is a 400", async () => {
    expect((await call(routesWith(fakeGitHub()), "/gh/callback")).status).toBe(400);
  });
});

describe("POST /gh/grant", () => {
  const post = (routes: ReturnType<typeof buildRoutes>, body: unknown) =>
    call(routes, "/gh/grant", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  test("issues a grant for a repo the caller can push to", async () => {
    const res = await post(routesWith(fakeGitHub()), { token: "gho_usertoken", repo: "o/r" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grant: string; login: string };
    expect(body.login).toBe("octocat");
    expect(readGrant(body.grant, SECRET)).toMatchObject({ login: "octocat", repo: "o/r" });
  });

  test("refuses a repo the caller cannot push to — the whole point of the check", async () => {
    const res = await post(routesWith(fakeGitHub({ pushable: [] })), { token: "gho_usertoken", repo: "victim/secrets" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain("cannot push");
  });

  test("refuses when the App is not installed, rather than issuing a grant that fails later unattended", async () => {
    const res = await post(routesWith(fakeGitHub({ pushable: ["o/r"], installedOn: [] })), { token: "gho_usertoken", repo: "o/r" });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("not installed");
  });

  test("rejects a malformed repo before calling GitHub at all", async () => {
    const fake = fakeGitHub();
    const res = await post(routesWith(fake), { token: "t", repo: "../../etc/passwd" });
    expect(res.status).toBe(400);
    expect(fake.calls).toEqual([]);
  });
});

describe("POST /gh/token", () => {
  const post = (routes: ReturnType<typeof buildRoutes>, body: unknown) =>
    call(routes, "/gh/token", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  test("trades a grant for a token scoped to that repo only", async () => {
    const grant = issueGrant({ login: "octocat", repo: "o/r", issuedAt: Math.floor(Date.now() / 1000) }, SECRET);
    const res = await post(routesWith(fakeGitHub()), { grant });
    expect(res.status).toBe(200);
    // the fake echoes the repositories it was asked to scope to
    expect(await res.json()).toEqual({ token: "ghs_for_r", expiresAt: "2026-08-20T10:00:00Z", repo: "o/r" });
  });

  test("an invalid or forged grant gets nothing", async () => {
    expect((await post(routesWith(fakeGitHub()), { grant: "mendg1.aaa.bbb" })).status).toBe(401);
    expect((await post(routesWith(fakeGitHub()), {})).status).toBe(401);
  });

  test("the repo comes from the signed grant, never from the request", async () => {
    const fake = fakeGitHub();
    const grant = issueGrant({ login: "octocat", repo: "o/r", issuedAt: 1 }, SECRET);
    await post(routesWith(fake), { grant, repo: "victim/secrets" });
    expect(fake.calls).toContain("GET /repos/o/r/installation");
    expect(fake.calls.join(" ")).not.toContain("victim");
  });

  test("an uninstalled App reports 404 so a round can say why it did nothing", async () => {
    const grant = issueGrant({ login: "octocat", repo: "o/r", issuedAt: 1 }, SECRET);
    const res = await post(routesWith(fakeGitHub({ installedOn: [] })), { grant });
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  test("an allowed origin is echoed; an unknown one gets no header", async () => {
    const routes = buildRoutes(loadConfig({ ...ENV, ALLOWED_ORIGINS: "https://rounds.inevitable.fyi" }), { fetchImpl: fakeGitHub().impl });
    const url = new URL("https://mend.test/gh/app");
    const ok = await routes(new Request(url, { headers: { origin: "https://rounds.inevitable.fyi" } }), url);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://rounds.inevitable.fyi");
    const no = await routes(new Request(url, { headers: { origin: "https://evil.test" } }), url);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});
