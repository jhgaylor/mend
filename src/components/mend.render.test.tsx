import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { foldThread } from "../lib/protocol";
import { Report } from "./Report";
import { Plan } from "./Plan";
import { Patch } from "./Patch";

// Render smoke: the report reads back what chant found, the plan sorts fixes
// by what a human must do about them, and the patch renders as a diff.

const REPO = { host: "github.com", owner: "o", name: "r" } as const;

const REPORT_BLOCK = `\`\`\`audit-report
{"branch":"trunk","commit":"abcdef1234567890","scanned":12,
 "summary":{"total":3,"quickWin":1,"needsReview":1,"reportOnly":1,"errors":1,"warnings":1,"infos":1,"security":2,"correctness":0,"bestPractice":1},
 "findings":[
  {"checkId":"GHA033","severity":"error","message":"write-all is too broad","file":".github/workflows/ci.yml","entity":"build","tier":"merge-worthy","fixKind":"deterministic","category":"security","title":"Blanket write-all permissions"},
  {"checkId":"GHA044","severity":"warning","message":"untrusted input in run","file":".github/workflows/pr.yml","tier":"merge-worthy","fixKind":"guidance","category":"security","title":"Script injection","remediation":"Move the expression into an env var.","authority":{"name":"OSSF Scorecard","url":"https://x.test/si"}},
  {"checkId":"DKRD007","severity":"info","message":"no healthcheck","file":"Dockerfile","tier":"report-only","fixKind":"guidance","category":"best-practice","title":"No HEALTHCHECK"}],
 "omitted":0}
\`\`\``;

const PLAN_BLOCK = `\`\`\`mend-plan
{"branch":"trunk","base":"abcdef1","before":{"mergeWorthy":2},"after":{"mergeWorthy":1},
 "fixes":[{"id":1,"status":"applied","checkIds":["GHA033"],"files":[".github/workflows/ci.yml"],"title":"Least-privilege permissions","note":"contents: read is all the build needs"},
          {"id":2,"status":"skipped","checkIds":["GHA044"],"files":[".github/workflows/pr.yml"],"title":"Script injection","note":"needs a call on the trigger"}],
 "pr":{"title":"ci: harden workflows","body":"Fixes from a chant audit."}}
\`\`\`

\`\`\`mend-patch
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,3 +1,4 @@
 name: ci
-permissions: write-all
+permissions:
+  contents: read
\`\`\``;

const view = foldThread([{ reply: REPORT_BLOCK }, { reply: PLAN_BLOCK }]);

describe("Report", () => {
  const html = renderToString(<Report report={view.report!} repo={REPO} onMend={() => {}} />);

  test("leads with chant: the tool, the breadth, and how to run it yourself", () => {
    expect(html).toContain("chant");
    expect(html).toContain("read 12 files");
    expect(html).toContain("with all 10 rule catalogs — 2 had something to say");
    expect(html).toContain("run this yourself");
  });

  test("shows every catalog chant ran, not only the ones that spoke", () => {
    for (const name of ["GitHub Actions", "GitLab CI", "Forgejo Actions", "Kubernetes", "Docker", "CloudFormation", "Azure ARM", "Google Cloud", "Helm", "Fountain"]) {
      expect(html).toContain(name);
    }
    expect(html.match(/class="ruleset /g) ?? []).toHaveLength(10);
  });

  test("the two that found something are marked apart from the eight that did not", () => {
    expect(html.match(/class="ruleset spoke"/g) ?? []).toHaveLength(2);
    expect(html.match(/class="ruleset quiet"/g) ?? []).toHaveLength(8);
    expect(html).toContain("chant ran its WHM* rules and found nothing");
  });

  test("tier counts, provenance and the scanned file count", () => {
    expect(html).toContain("quick wins");
    expect(html).toContain("needs review");
    expect(html).toContain("12 files scanned");
    expect(html).toContain("trunk@abcdef1");
    expect(html).toContain("2 security");
  });

  test("quick wins group under their file, linked to the host", () => {
    expect(html).toContain("https://github.com/o/r/blob/trunk/.github/workflows/ci.yml");
    expect(html).toContain("Blanket write-all permissions");
    expect(html).toContain("build");
  });

  test("guidance clusters under its authority, rule ids link to the reference", () => {
    expect(html).toContain("OSSF Scorecard");
    expect(html).toContain("https://x.test/si");
    expect(html).toContain("https://intentius.io/chant/lint-rules/audit-rules/#gha044");
    expect(html).toContain("Move the expression into an env var.");
  });

  test("hygiene stays folded away until asked for", () => {
    expect(html).toContain("Hygiene — 1 not worth a PR");
    expect(html).not.toContain("No HEALTHCHECK");
  });

  test("a clean repo says so and offers no mend", () => {
    const clean = renderToString(
      <Report report={{ summary: { total: 0, quickWin: 0, needsReview: 0, reportOnly: 0, errors: 0, warnings: 0, infos: 0, security: 0, correctness: 0, bestPractice: 0 }, findings: [], omitted: 0 }} repo={REPO} />,
    );
    expect(clean).toContain("Nothing to fix");
    expect(clean).not.toContain("Mend it");
  });
});

describe("Plan", () => {
  const html = renderToString(<Plan plan={view.plan!} repo={REPO} branch="trunk" />);

  test("groups fixes by what the human has to do", () => {
    expect(html).toContain("Applied");
    expect(html).toContain("Left for you");
    expect(html).toContain("contents: read is all the build needs");
    expect(html).toContain("needs a call on the trigger");
  });

  test("shows the merge-worthy delta and the drafted PR", () => {
    expect(html).toContain("2");
    expect(html).toContain("−1");
    expect(html).toContain("Fixes from a chant audit.");
  });
});

describe("Patch", () => {
  test("renders the diff with churn counts and an apply hint", () => {
    const html = renderToString(<Patch patch={view.patch!} repo={REPO} />);
    expect(html).toContain("mend-o-r.patch");
    expect(html).toContain("+2");
    expect(html).toContain("−1");
    expect(html).toContain("contents: read");
    expect(html).toContain("@@ -1,3 +1,4 @@");
  });

  test("an empty patch says there is nothing to apply", () => {
    expect(renderToString(<Patch patch="" repo={REPO} />)).toContain("nothing to apply");
  });
});
