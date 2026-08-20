import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { foldThread, selectableFixes } from "../lib/protocol";
import { Plan, type Selection } from "./Plan";
import { PrPanel } from "./PrPanel";
import type { AppInfo } from "../lib/ghoauth";

const APP: AppInfo = { configured: true, slug: "fountain-rounds", clientId: "Iv23lib", installUrl: "https://github.com/apps/fountain-rounds/installations/new" };

// Render smoke for the pull-request flow: which fixes can be ticked, and the
// three states of the panel (connect → draft → open).

const REPO = { host: "github.com", owner: "o", name: "r" } as const;

const REPLY = `\`\`\`mend-plan
{"before":{"mergeWorthy":3},"after":{"mergeWorthy":1},
 "fixes":[{"id":1,"status":"applied","checkIds":["GHA033"],"files":[".github/workflows/ci.yml"],"title":"Least-privilege permissions"},
          {"id":2,"status":"proposed","checkIds":["GHA044"],"files":[".github/workflows/pr.yml"],"title":"Untrusted input"},
          {"id":3,"status":"skipped","checkIds":["WK8110"],"files":["k8s/deployment.yaml"],"title":"hostNetwork","note":"needs a call"}]}
\`\`\`

\`\`\`mend-fix 1
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1 +1 @@
-permissions: write-all
+permissions: {}
\`\`\`

\`\`\`mend-fix 2
diff --git a/.github/workflows/pr.yml b/.github/workflows/pr.yml
--- a/.github/workflows/pr.yml
+++ b/.github/workflows/pr.yml
@@ -1 +1 @@
-run: echo x
+run: echo $X
\`\`\``;

const view = foldThread([{ reply: REPLY }]);
const selectable = selectableFixes(view.plan);
const ids = new Set(selectable.map((f) => f.id));

function selection(selected: number[]): Selection {
  return { selected: new Set(selected), selectable: ids, onToggle: () => {}, onAll: () => {} };
}

describe("Plan selection", () => {
  test("offers a tick box on fixes that carry a diff", () => {
    const html = renderToString(<Plan plan={view.plan!} repo={REPO} branch="main" selection={selection([1, 2])} />);
    expect(html.match(/add to PR/g) ?? []).toHaveLength(2);
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(2);
    expect(html).toContain("all");
    expect(html).toContain("none");
  });

  test("a skipped fix cannot be ticked", () => {
    expect(selectable.map((f) => f.id)).toEqual([1, 2]);
    const html = renderToString(<Plan plan={view.plan!} repo={REPO} branch="main" selection={selection([1, 2])} />);
    expect(html).toContain("pick-none"); // the placeholder shown for fix 3
  });

  test("unticked fixes render unchecked", () => {
    const html = renderToString(<Plan plan={view.plan!} repo={REPO} branch="main" selection={selection([1])} />);
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1);
  });

  test("without a selection the plan renders exactly as before", () => {
    const html = renderToString(<Plan plan={view.plan!} repo={REPO} branch="main" />);
    expect(html).not.toContain("add to PR");
    expect(html).not.toContain("checkbox");
  });
});

describe("PrPanel — the two tokens", () => {
  test("with no connection, says what this token is and is not for", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} />);
    expect(html).toContain("the mender never sees the credential");
  });

  test("when the repo clones anonymously it says a private one needs its own token", () => {
    const html = renderToString(
      <PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} clonesWithOwnToken={false} />,
    );
    expect(html).toContain("authored by your account");
  });
});

describe("PrPanel", () => {
  test("asks for a credential before it can open anything", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} />);
    expect(html).toContain("authored by your account");
    expect(html).toContain("public_repo");
    expect(html).toContain("Connect");
  });

  test("with no App configured there is no sign-in button, only the paste path", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} appInfo={{ configured: false, slug: null, clientId: null, installUrl: null }} />);
    expect(html).not.toContain("Sign in with GitHub");
    expect(html).toContain("Connect");
  });

  test("with an App configured it leads with sign-in, and still allows a pasted token", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} appInfo={APP} />);
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("fountain-rounds");
    expect(html).toContain(".github/workflows");
    expect(html).toContain("Or paste a token");
    expect(html).toContain("installations/new");
  });

  test("before a draft exists, the action is to ask the agent for one", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} />);
    expect(html).toContain("Draft the PR description");
    expect(html).toContain("2 fixes · 2 files");
  });

  test("while the agent works the button says so", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy />);
    expect(html).toContain("The mender is writing…");
  });

  test("an empty selection is reported and cannot be drafted", () => {
    const html = renderToString(<PrPanel repo={REPO} selected={[]} draft={null} onRequestDraft={() => {}} agentBusy={false} />);
    expect(html).toContain("nothing selected");
    expect(html).toContain("disabled");
  });

  test("a repo off GitHub says so instead of offering a broken button", () => {
    const html = renderToString(
      <PrPanel repo={{ host: "gitlab.com", owner: "g", name: "p" }} selected={selectable} draft={null} onRequestDraft={() => {}} agentBusy={false} />,
    );
    expect(html).toContain("GitHub-only");
    expect(html).toContain("gitlab.com/g/p");
    expect(html).not.toContain("Draft the PR description");
  });
});
