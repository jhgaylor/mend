import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AddRepoForm, AttachToken } from "../App";
import type { GhAuth } from "../lib/ghauth";

// The two places a mender's clone token can be supplied. Both offer to reuse
// the token already connected for pull requests, and both are explicit that
// reusing it hands a write-capable credential to the agent.

const CONNECTED: GhAuth = { token: "ghp_notarealtokenatall000000", login: "octocat" };

describe("AddRepoForm", () => {
  test("offers a token without demanding one", () => {
    const html = renderToString(<AddRepoForm disabled={false} onAdd={() => {}} />);
    expect(html).toContain("private repository? give the mender a token");
    expect(html).not.toContain("type=\"password\"");
  });

  test("never puts a connected token in the markup", () => {
    const html = renderToString(<AddRepoForm disabled={false} connected={CONNECTED} onAdd={() => {}} />);
    expect(html).not.toContain(CONNECTED.token);
  });

  test("the repo field is the only input until a token is asked for", () => {
    const html = renderToString(<AddRepoForm disabled={false} connected={CONNECTED} onAdd={() => {}} />);
    expect(html.match(/<input/g) ?? []).toHaveLength(1);
  });
});

describe("AttachToken", () => {
  test("collapsed until asked for", () => {
    const html = renderToString(<AttachToken disabled={false} onAttach={() => {}} />);
    expect(html).toContain("private? attach a token");
    expect(html).not.toContain("<input");
  });

  test("closed form never carries the connected token either", () => {
    const html = renderToString(<AttachToken disabled={false} connected={CONNECTED} onAttach={() => {}} />);
    expect(html).not.toContain(CONNECTED.token);
  });
});
