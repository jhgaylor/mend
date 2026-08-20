import { describe, expect, test } from "bun:test";
import { arrangeReport, foldThread, parseBlocks, selectableFixes, stripBlocks, ruleDocUrl, type AuditReport, type MendPlan, type ProtocolBlock } from "./protocol";

/** The blocks are a tagged union; these narrow one out or fail the test loudly. */
function reportOf(blocks: ProtocolBlock[], i = 0): AuditReport {
  const b = blocks[i];
  if (b?.kind !== "report") throw new Error(`block ${i} is not a report`);
  return b.report;
}
function planOf(blocks: ProtocolBlock[], i = 0): MendPlan {
  const b = blocks[i];
  if (b?.kind !== "plan") throw new Error(`block ${i} is not a plan`);
  return b.plan;
}
function patchOf(blocks: ProtocolBlock[], i = 0): string {
  const b = blocks[i];
  if (b?.kind !== "patch") throw new Error(`block ${i} is not a patch`);
  return b.patch;
}

const REPORT = `Scanned two workflows and a Dockerfile.

\`\`\`audit-report
{"branch":"main","commit":"abcdef1234567890","scanned":12,
 "summary":{"total":4,"quickWin":1,"needsReview":2,"reportOnly":1,"errors":1,"warnings":2,"infos":1,"security":3,"correctness":0,"bestPractice":1},
 "findings":[
  {"checkId":"GHA033","severity":"error","message":"write-all","file":".github/workflows/ci.yml","entity":"build","tier":"merge-worthy","fixKind":"deterministic","category":"security","title":"Blanket write-all permissions","remediation":"Set least-privilege permissions."},
  {"checkId":"GHA021","severity":"warning","message":"unpinned action","file":".github/workflows/ci.yml","tier":"merge-worthy","fixKind":"guidance","category":"security","title":"Pin actions to a SHA","authority":{"name":"OSSF Scorecard","url":"https://x.test/pinned"}},
  {"checkId":"GHA044","severity":"warning","message":"script injection","file":".github/workflows/pr.yml","tier":"merge-worthy","fixKind":"guidance","category":"security","title":"Untrusted input in run","authority":{"name":"OSSF Scorecard","url":"https://x.test/pinned"}},
  {"checkId":"DKRD007","severity":"info","message":"no healthcheck","file":"Dockerfile","tier":"report-only","fixKind":"guidance","category":"best-practice","title":"No HEALTHCHECK"}],
 "omitted":3}
\`\`\``;

const MEND = `Applied one, proposed two.

\`\`\`mend-plan
{"branch":"main","base":"abcdef1","before":{"mergeWorthy":3},"after":{"mergeWorthy":1},
 "fixes":[{"id":1,"status":"applied","checkIds":["GHA033"],"files":[".github/workflows/ci.yml"],"title":"Least-privilege permissions"},
          {"id":2,"status":"skipped","checkIds":["GHA044"],"files":["./.github/workflows/pr.yml"],"title":"Script injection","note":"needs a decision on the trigger"}],
 "pr":{"title":"ci: harden workflows","body":"Fixes from a chant audit."}}
\`\`\`

\`\`\`mend-patch
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b
\`\`\``;

describe("parseBlocks", () => {
  test("reads an audit report and strips it from the prose", () => {
    const blocks = parseBlocks(REPORT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("report");
    const report = reportOf(blocks);
    expect(report.branch).toBe("main");
    expect(report.summary.quickWin).toBe(1);
    expect(report.findings).toHaveLength(4);
    expect(report.omitted).toBe(3);
    expect(stripBlocks(REPORT)).toBe("Scanned two workflows and a Dockerfile.");
  });

  test("reads a plan and a patch, in order, patch verbatim", () => {
    const blocks = parseBlocks(MEND);
    expect(blocks.map((b) => b.kind)).toEqual(["plan", "patch"]);
    const plan = planOf(blocks);
    expect(plan.fixes).toHaveLength(2);
    expect(plan.fixes[1]!.status).toBe("skipped");
    expect(plan.fixes[1]!.files).toEqual([".github/workflows/pr.yml"]); // leading ./ normalised
    expect(plan.pr!.title).toBe("ci: harden workflows");
    expect(patchOf(blocks, 1)).toContain("@@ -1 +1 @@");
  });

  test("malformed JSON is skipped, not crashed on", () => {
    expect(parseBlocks("```audit-report\n{not json\n```")).toEqual([]);
    expect(parseBlocks("```mend-plan\n{\"fixes\":\"nope\"}\n```")).toEqual([]);
  });

  test("a finding missing fields falls back instead of vanishing", () => {
    const report = reportOf(parseBlocks('```audit-report\n{"findings":[{"checkId":"X1","file":"a.yml"},{"file":"b.yml"}]}\n```'));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!).toMatchObject({ checkId: "X1", severity: "warning", tier: "report-only", title: "X1" });
    expect(report.summary.total).toBe(1); // recomputed when the agent omits it
  });

  test("an unknown status or severity falls back to the safe value", () => {
    const plan = planOf(parseBlocks('```mend-plan\n{"fixes":[{"title":"t","status":"YOLO"}]}\n```'));
    expect(plan.fixes[0]).toMatchObject({ id: 1, status: "proposed", checkIds: [], files: [] });
  });

  test("a non-https pr_url is dropped", () => {
    const plan = planOf(parseBlocks('```mend-plan\n{"fixes":[],"pr_url":"javascript:alert(1)"}\n```'));
    expect(plan.pr_url).toBeUndefined();
  });
});

describe("foldThread", () => {
  test("newest report wins and a re-audit clears the old plan", () => {
    const view = foldThread([{ reply: REPORT }, { reply: MEND }, { reply: REPORT }]);
    expect(view.report).not.toBeNull();
    expect(view.reportTurnIndex).toBe(2);
    expect(view.plan).toBeNull();
    expect(view.patch).toBeNull();
  });

  test("the plan and the patch from the same reply travel together", () => {
    const view = foldThread([{ reply: REPORT }, { reply: MEND }]);
    expect(view.planTurnIndex).toBe(1);
    expect(view.plan!.fixes).toHaveLength(2);
    expect(view.patch).toContain("+b");
  });

  test("a revised patch replaces the old one, keeping the plan", () => {
    const view = foldThread([{ reply: MEND }, { reply: "```mend-patch\ndiff --git a/y b/y\n```" }]);
    expect(view.plan!.fixes).toHaveLength(2);
    expect(view.patch).toBe("diff --git a/y b/y");
  });

  test("nothing at all folds to an empty view", () => {
    expect(foldThread([{ reply: "just prose" }])).toEqual({ report: null, reportTurnIndex: null, plan: null, patch: null, planTurnIndex: null, draft: null });
  });
});

describe("arrangeReport", () => {
  test("quick wins by file, guidance by authority, hygiene apart", () => {
    const { quickWins, needsReview, reportOnly } = arrangeReport(reportOf(parseBlocks(REPORT)));
    expect(quickWins.map((q) => q.file)).toEqual([".github/workflows/ci.yml"]);
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0]!.name).toBe("OSSF Scorecard");
    expect(needsReview[0]!.url).toBe("https://x.test/pinned");
    expect(needsReview[0]!.rules.map((r) => r.checkId)).toEqual(["GHA021", "GHA044"]);
    expect(reportOnly.map((f) => f.checkId)).toEqual(["DKRD007"]);
  });

  test("guidance with no authority lands in a general cluster", () => {
    const report = reportOf(parseBlocks('```audit-report\n{"findings":[{"checkId":"WK8001","file":"k8s/a.yaml","tier":"merge-worthy","fixKind":"guidance","title":"Privileged"}]}\n```'));
    expect(arrangeReport(report).needsReview[0]!.name).toBe("General hardening");
  });
});

test("ruleDocUrl points at the rules reference", () => {
  expect(ruleDocUrl("GHA033")).toBe("https://intentius.io/chant/lint-rules/audit-rules/#gha033");
});

describe("per-fix diffs and PR drafts", () => {
  const PLAN_WITH_FIXES = `\`\`\`mend-plan
{"fixes":[{"id":1,"status":"applied","checkIds":["GHA033"],"files":["a.yml"],"title":"Permissions"},
          {"id":2,"status":"proposed","checkIds":["GHA021"],"files":["a.yml"],"title":"Pin"},
          {"id":3,"status":"skipped","checkIds":["WK8110"],"files":["k.yaml"],"title":"hostNetwork"}]}
\`\`\`

\`\`\`mend-fix 1
diff --git a/a.yml b/a.yml
--- a/a.yml
+++ b/a.yml
@@ -1 +1 @@
-permissions: write-all
+permissions: {}
\`\`\`

\`\`\`mend-fix 2
diff --git a/a.yml b/a.yml
--- a/a.yml
+++ b/a.yml
@@ -5 +5 @@
-  uses: actions/checkout@v4
+  uses: actions/checkout@sha
\`\`\``;

  test("attaches each fix's diff by id", () => {
    const view = foldThread([{ reply: PLAN_WITH_FIXES }]);
    expect(view.plan!.fixes[0]!.diff).toContain("permissions: {}");
    expect(view.plan!.fixes[1]!.diff).toContain("actions/checkout@sha");
    expect(view.plan!.fixes[2]!.diff).toBeUndefined();
  });

  test("selectableFixes drops skipped fixes and any without a diff", () => {
    const view = foldThread([{ reply: PLAN_WITH_FIXES }]);
    expect(selectableFixes(view.plan).map((f) => f.id)).toEqual([1, 2]);
    expect(selectableFixes(null)).toEqual([]);
  });

  test("a later reply can revise one fix's diff without resending the plan", () => {
    const view = foldThread([
      { reply: PLAN_WITH_FIXES },
      { reply: "Revised.\n\n```mend-fix 2\ndiff --git a/a.yml b/a.yml\n--- a/a.yml\n+++ b/a.yml\n@@ -5 +5 @@\n-old\n+newer\n```" },
    ]);
    expect(view.plan!.fixes[1]!.diff).toContain("+newer");
    expect(view.plan!.fixes[0]!.diff).toContain("permissions: {}"); // untouched
  });

  test("a pr-draft reads as title + body, commit-message style", () => {
    const view = foldThread([
      { reply: PLAN_WITH_FIXES },
      { reply: "Drafted.\n\n```pr-draft\nci: harden the build workflow\n\nTwo findings from a chant audit.\n\n- GHA033\n```" },
    ]);
    expect(view.draft).toEqual({ title: "ci: harden the build workflow", body: "Two findings from a chant audit.\n\n- GHA033" });
  });

  test("a title-only draft has an empty body, and a blank draft is ignored", () => {
    expect(parseBlocks("```pr-draft\njust a title\n```")).toEqual([{ kind: "draft", draft: { title: "just a title", body: "" } }]);
    expect(parseBlocks("```pr-draft\n\n```")).toEqual([]);
  });

  test("a new plan clears a draft written for the old one", () => {
    const view = foldThread([
      { reply: PLAN_WITH_FIXES },
      { reply: "```pr-draft\nold title\n```" },
      { reply: PLAN_WITH_FIXES },
    ]);
    expect(view.draft).toBeNull();
  });

  test("a re-audit clears plan, patch and draft together", () => {
    const view = foldThread([{ reply: PLAN_WITH_FIXES }, { reply: "```pr-draft\nt\n```" }, { reply: REPORT }]);
    expect(view.plan).toBeNull();
    expect(view.draft).toBeNull();
    expect(view.patch).toBeNull();
  });

  test("a malformed fix id is skipped", () => {
    expect(parseBlocks("```mend-fix notanumber\ndiff\n```")).toEqual([]);
  });
});
