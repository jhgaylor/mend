import { afterAll, describe, expect, test } from "bun:test";

// The server also replaces nginx, so the static-file behaviour is worth
// pinning: a real deep link has to boot the SPA rather than 404, and hashed
// assets have to be cacheable or every reload refetches the bundle.

const DIST = `/tmp/mend-serve-test-${process.pid}`;
await Bun.write(`${DIST}/index.html`, "<!doctype html><title>Mend</title>");
await Bun.write(`${DIST}/assets/index-abc123.js`, "console.log(1)");

const proc = Bun.spawn(["bun", "server/index.ts"], {
  env: { ...process.env, PORT: "0", DIST_DIR: DIST },
  stdout: "pipe",
  stderr: "pipe",
});

// The server prints the port it bound; wait for that line.
const reader = proc.stdout.getReader();
let banner = "";
while (!/on :\d+/.test(banner)) {
  const { value, done } = await reader.read();
  if (done) break;
  banner += new TextDecoder().decode(value);
}
const port = Number(/on :(\d+)/.exec(banner)?.[1]);
const base = `http://localhost:${port}`;

afterAll(() => proc.kill());

describe("the static half", () => {
  test("serves the SPA at the root", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Mend</title>");
  });

  test("a deep link falls back to the SPA instead of 404ing", async () => {
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Mend</title>");
  });

  test("hashed assets are cacheable, index.html is not", async () => {
    expect((await fetch(`${base}/assets/index-abc123.js`)).headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/`)).headers.get("cache-control")).toBe("no-cache");
  });

  test("healthz answers for the kubelet", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok\n");
  });

  test("with no app configured, /gh degrades to 503 rather than breaking the page", async () => {
    const res = await fetch(`${base}/gh/token`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    const app = await (await fetch(`${base}/gh/app`)).json();
    expect((app as { configured: boolean }).configured).toBe(false);
  });
});
