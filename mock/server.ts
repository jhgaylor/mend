/**
 * A tiny mock Fountain, for developing Mend without a live server: one
 * mender teammate whose canned turns walk the whole protocol (audit →
 * audit-report, then a mend → mend-plan + mend-patch). Run with
 * `bun run mock`, start the app with `FOUNTAIN_PROXY=http://localhost:8789
 * bun run dev`, and paste any string as the API key with
 * http://localhost:5180 as the URL.
 */

const chunk = (text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  });

const tool = (id: string, title: string, path?: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { update: { sessionUpdate: "tool_call", toolCallId: id, title, ...(path ? { locations: [{ path }] } : {}) } },
  });

const toolDone = (id: string, text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text } }],
      },
    },
  });

const REPORT = {
  branch: "main",
  commit: "9f1c4a2b7e05d3118aa6c0f4e2b71d8e5c0a3f22",
  scanned: 14,
  summary: { total: 9, quickWin: 3, needsReview: 4, reportOnly: 2, errors: 2, warnings: 5, infos: 2, security: 6, correctness: 1, bestPractice: 2 },
  findings: [
    { checkId: "GHA033", severity: "error", message: "Workflow grants write-all to every job.", file: ".github/workflows/ci.yml", entity: "build", tier: "merge-worthy", fixKind: "deterministic", category: "security", title: "Blanket write-all permissions", remediation: "Set a least-privilege permissions block.", authority: { name: "OSSF Scorecard — Token-Permissions", url: "https://github.com/ossf/scorecard/blob/main/docs/checks.md#token-permissions" } },
    { checkId: "WK8203", severity: "error", message: "Container runs as root (runAsNonRoot unset).", file: "k8s/deployment.yaml", entity: "web", tier: "merge-worthy", fixKind: "deterministic", category: "security", title: "Container may run as root", remediation: "Set securityContext.runAsNonRoot: true." },
    { checkId: "DKRD012", severity: "warning", message: "Base image nginx:alpine is not pinned to a digest.", file: "Dockerfile", tier: "merge-worthy", fixKind: "deterministic", category: "security", title: "Unpinned base image", remediation: "Pin the image to a digest." },
    { checkId: "GHA021", severity: "warning", message: "actions/checkout@v4 is not pinned to a commit SHA.", file: ".github/workflows/ci.yml", entity: "build", tier: "merge-worthy", fixKind: "guidance", category: "security", title: "Pin actions to a full commit SHA", remediation: "Pin third-party actions to a 40-character SHA.", authority: { name: "OSSF Scorecard — Pinned-Dependencies", url: "https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies" } },
    { checkId: "GHA019", severity: "warning", message: "checkout leaves the credential helper configured for later steps.", file: ".github/workflows/ci.yml", entity: "build", tier: "merge-worthy", fixKind: "guidance", category: "security", title: "Checkout persists credentials", remediation: "Set persist-credentials: false unless a later step pushes.", authority: { name: "OSSF Scorecard — Pinned-Dependencies", url: "https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies" } },
    { checkId: "GHA044", severity: "warning", message: "github.event.pull_request.title is interpolated into a run script.", file: ".github/workflows/pr.yml", entity: "greet", tier: "merge-worthy", fixKind: "guidance", category: "security", title: "Untrusted input in a run script", remediation: "Pass the expression through env: and reference $VAR.", authority: { name: "GitHub Security Hardening", url: "https://docs.github.com/actions/security-guides/security-hardening-for-github-actions" } },
    { checkId: "WK8110", severity: "warning", message: "Pod sets hostNetwork: true.", file: "k8s/deployment.yaml", entity: "web", tier: "merge-worthy", fixKind: "guidance", category: "security", title: "Host network namespace shared", remediation: "Drop hostNetwork unless the workload needs the node's stack." },
    { checkId: "DKRD007", severity: "info", message: "No HEALTHCHECK instruction.", file: "Dockerfile", tier: "report-only", fixKind: "guidance", category: "best-practice", title: "No HEALTHCHECK" },
    { checkId: "WK8402", severity: "info", message: "No resource limits on container web.", file: "k8s/deployment.yaml", entity: "web", tier: "report-only", fixKind: "guidance", category: "best-practice", title: "Missing resource limits" },
  ],
  omitted: 0,
};

const PLAN = {
  branch: "main",
  base: "9f1c4a2b7e05d3118aa6c0f4e2b71d8e5c0a3f22",
  before: { mergeWorthy: 7 },
  after: { mergeWorthy: 1 },
  fixes: [
    { id: 1, status: "applied", checkIds: ["GHA033"], files: [".github/workflows/ci.yml"], title: "Least-privilege workflow permissions", note: "The build only reads the repo, so contents: read." },
    { id: 2, status: "applied", checkIds: ["WK8203"], files: ["k8s/deployment.yaml"], title: "Run the container as a non-root user", note: "nginx:alpine already ships an unprivileged user." },
    { id: 3, status: "applied", checkIds: ["DKRD012"], files: ["Dockerfile"], title: "Pin the base image to a digest", note: "Resolved nginx:alpine to its current digest; tag kept as a comment." },
    { id: 4, status: "proposed", checkIds: ["GHA021", "GHA019"], files: [".github/workflows/ci.yml"], title: "Pin actions/checkout and stop persisting credentials", note: "Resolved v4 to 11bd719; no later step pushes, so persist-credentials: false is safe." },
    { id: 5, status: "proposed", checkIds: ["GHA044"], files: [".github/workflows/pr.yml"], title: "Move untrusted input into an env var", note: "The PR title now arrives as $PR_TITLE instead of being interpolated." },
    { id: 6, status: "skipped", checkIds: ["WK8110"], files: ["k8s/deployment.yaml"], title: "hostNetwork on the web pod", note: "Might be load-bearing for your ingress path — decide whether the pod needs the node's stack." },
  ],
  pr: {
    title: "ci, k8s: harden config per chant audit",
    body: "A `chant audit` of this repo found 7 merge-worthy findings. This branch clears 6.\n\n**Applied** (mechanical): least-privilege `permissions:` on the CI workflow (GHA033), `runAsNonRoot` on the web container (WK8203), base image pinned to a digest (DKRD012).\n\n**Proposed** (please review): `actions/checkout` pinned to a SHA (GHA021), `persist-credentials: false` (GHA019), and the PR title moved out of the run script into an env var (GHA044).\n\n**Left alone**: `hostNetwork: true` on the web pod (WK8110) — that one needs a call from someone who knows the ingress path.",
  },
};

const PATCH = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 3a1f8c2..8d4e7b1 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,13 +1,17 @@
 name: ci
 on: [push]
-permissions: write-all
+permissions:
+  contents: read
 jobs:
   build:
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
+        with:
+          persist-credentials: false
       - run: npm ci
       - run: npm test
diff --git a/.github/workflows/pr.yml b/.github/workflows/pr.yml
index 55c1a09..b7e2f14 100644
--- a/.github/workflows/pr.yml
+++ b/.github/workflows/pr.yml
@@ -6,5 +6,7 @@ jobs:
   greet:
     runs-on: ubuntu-latest
     steps:
-      - run: echo "Reviewing \${{ github.event.pull_request.title }}"
+      - env:
+          PR_TITLE: \${{ github.event.pull_request.title }}
+        run: echo "Reviewing $PR_TITLE"
diff --git a/Dockerfile b/Dockerfile
index 1c0dd44..9ab3e70 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -1,4 +1,4 @@
-FROM nginx:alpine
+FROM nginx:alpine@sha256:41523187cf7d7a2f2677a80609d9caa14388bf5c1fbca9c410ba3de602aaaab4 # alpine
 COPY nginx.conf /etc/nginx/conf.d/default.conf
 COPY site/ /usr/share/nginx/html/
 EXPOSE 8080
diff --git a/k8s/deployment.yaml b/k8s/deployment.yaml
index 7b2ee31..0f5a1c8 100644
--- a/k8s/deployment.yaml
+++ b/k8s/deployment.yaml
@@ -14,6 +14,11 @@ spec:
     spec:
       containers:
         - name: web
           image: ghcr.io/example/web:sha-0000000
+          securityContext:
+            runAsNonRoot: true
+            runAsUser: 101
+            allowPrivilegeEscalation: false
+            readOnlyRootFilesystem: true
           ports:
             - containerPort: 8080`;


/** One diff per changed fix — what the app ticks on and off to build a PR.
 *  Each applies on its own against the audited commit; none overlap. */
const FIX_DIFFS: Record<number, string> = {
  1: `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,5 +1,6 @@
 name: ci
 on: [push]
-permissions: write-all
+permissions:
+  contents: read
 jobs:
   build:`,
  2: `diff --git a/k8s/deployment.yaml b/k8s/deployment.yaml
--- a/k8s/deployment.yaml
+++ b/k8s/deployment.yaml
@@ -16,6 +16,11 @@ spec:
         - name: web
           image: ghcr.io/example/web:sha-0000000
+          securityContext:
+            runAsNonRoot: true
+            runAsUser: 101
+            allowPrivilegeEscalation: false
+            readOnlyRootFilesystem: true
           ports:
             - containerPort: 8080`,
  3: `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -1,3 +1,3 @@
-FROM nginx:alpine
+FROM nginx:alpine@sha256:41523187cf7d7a2f2677a80609d9caa14388bf5c1fbca9c410ba3de602aaaab4 # alpine
 COPY nginx.conf /etc/nginx/conf.d/default.conf
 COPY site/ /usr/share/nginx/html/`,
  4: `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -8,7 +8,9 @@ jobs:
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
+        with:
+          persist-credentials: false
       - run: npm ci
       - run: npm test`,
  5: `diff --git a/.github/workflows/pr.yml b/.github/workflows/pr.yml
--- a/.github/workflows/pr.yml
+++ b/.github/workflows/pr.yml
@@ -6,5 +6,7 @@ jobs:
   greet:
     runs-on: ubuntu-latest
     steps:
-      - run: echo "Reviewing \${{ github.event.pull_request.title }}"
+      - env:
+          PR_TITLE: \${{ github.event.pull_request.title }}
+        run: echo "Reviewing $PR_TITLE"`,
};

const fixBlocks = Object.entries(FIX_DIFFS)
  .map(([id, diff]) => `\n\n\`\`\`mend-fix ${id}\n${diff}\n\`\`\``)
  .join("");

const AUDIT_REPLY = `Cloned it and ran \`chant audit\`. This repo has two GitHub Actions workflows, a Dockerfile and a small Kubernetes kustomization — 14 files in scope. Nine findings: three are mechanical, four want a judgement call, two are hygiene. The two errors are a \`write-all\` workflow token and a container with no \`runAsNonRoot\`.

\`\`\`audit-report
${JSON.stringify(REPORT)}
\`\`\``;

const MEND_REPLY = `Applied the three quick wins, proposed three more, and left one for you. Merge-worthy findings go from 7 to 1: the only one left is \`hostNetwork: true\` on the web pod, which I will not guess at — if your ingress terminates on the node it is load-bearing, and if it does not, drop it. Re-ran the audit against the working tree to confirm the count and that every file still parses.

\`\`\`mend-plan
${JSON.stringify(PLAN)}
\`\`\`${fixBlocks}

\`\`\`mend-patch
${PATCH}
\`\`\``;

const now = "2026-08-20T10:05:00.000000Z";
const AUDIT_PROMPT = "Audit the repository now: clone it, run chant audit, and report the audit-report block.";
const MEND_PROMPT = "Mend it: apply the quick wins, propose fixes for the needs-review findings, and report the mend-plan and mend-patch blocks.";

const DRAFT_REPLY = `Drafted a pull request for the three applied fixes.

\`\`\`pr-draft
ci, docker: harden the build per chant audit

A \`chant audit\` of this repo flagged 7 merge-worthy findings; this covers the three mechanical ones.

- **Least-privilege workflow permissions** (GHA033) — the build only reads the repo, so \`contents: read\` is enough.
- **Run the container as a non-root user** (WK8203) — nginx:alpine already ships an unprivileged user.
- **Pin the base image to a digest** (DKRD012) — the \`alpine\` tag is kept as a trailing comment.
\`\`\``;

const DRAFT_PROMPT = "Draft the pull request for exactly these fixes and no others: 1 (Least-privilege workflow permissions), 2 (Run the container as a non-root user), 3 (Pin the base image to a digest). Reply with one short sentence and one pr-draft block.";

const turns = [
  { id: "t1", turn_number: 1, prompt: AUDIT_PROMPT, status: "completed", exit_code: 0, started_at: now, ended_at: now, inserted_at: now },
  { id: "t2", turn_number: 2, prompt: MEND_PROMPT, status: "completed", exit_code: 0, started_at: now, ended_at: now, inserted_at: now },
  // Drop this turn to develop against the pre-draft state (the "Draft the PR
  // description" button) instead of the filled form.
  { id: "t3", turn_number: 3, prompt: DRAFT_PROMPT, status: "completed", exit_code: 0, started_at: now, ended_at: now, inserted_at: now },
];

const eventData = [
  { turn: "t1", data: tool("c1", "Clone", "~/work/repo") },
  { turn: "t1", data: toolDone("c1", "Cloning into '/root/work/repo'... done.") },
  { turn: "t1", data: tool("c2", "chant audit", "--format json") },
  { turn: "t1", data: toolDone("c2", "14 files scanned, 9 findings") },
  { turn: "t1", data: chunk(AUDIT_REPLY) },
  { turn: "t2", data: tool("c3", "git checkout", "-b mend/chant-audit") },
  { turn: "t2", data: toolDone("c3", "Switched to a new branch 'mend/chant-audit'") },
  { turn: "t2", data: tool("c4", "git apply", ".github/workflows/ci.yml") },
  { turn: "t2", data: toolDone("c4", "applied cleanly") },
  { turn: "t2", data: tool("c5", "git ls-remote", "actions/checkout v4") },
  { turn: "t2", data: toolDone("c5", "11bd71901bbe5b1630ceea73d27597364c9af683 refs/tags/v4^{}") },
  { turn: "t2", data: tool("c6", "chant audit", "--format json -o /tmp/after.json") },
  { turn: "t2", data: toolDone("c6", "1 merge-worthy finding remains") },
  { turn: "t2", data: chunk(MEND_REPLY) },
  { turn: "t3", data: chunk(DRAFT_REPLY) },
];

const events = eventData.map((e, i) => ({
  id: i + 1,
  kind: "output",
  stream: "acp",
  data: e.data,
  stage: null,
  state: null,
  turn_id: e.turn,
  ts: now,
}));

const teammate = {
  agent_id: "agent-mend",
  name: "Mend: github.com/example/web",
  agent: {
    id: "agent-mend",
    name: "Mend: github.com/example/web",
    model: "anthropic/claude-sonnet-5",
    runtime: "claude",
    environment_id: "env-toolkit",
    allowed_vault_ids: null,
    allowed_environment_ids: null,
  },
  conversation: {
    id: "c1",
    title: "Mend: github.com/example/web",
    agent_id: "agent-mend",
    vault_id: null,
    environment_id: "env-toolkit",
    runtime: "claude",
    acp: true,
    status: "idle",
    turn_count: turns.length,
    last_active_at: now,
    unread: false,
    inserted_at: now,
    updated_at: now,
  },
  presence: { state: "online", label: "online" },
  unread: false,
  last_turn: null,
};

const environment = { id: "env-toolkit", name: "Mend toolkit", networking_type: "unrestricted", packages: { apt: ["jq"], npm: ["@intentius/chant"] }, agent_count: 1 };

const json = (data: unknown) => Response.json({ data });

Bun.serve({
  port: 8789,
  idleTimeout: 120,
  routes: {
    "/api/auth/me": json({ id: "u1", email: "dev@example.com", role: "user" }),
    "/api/catalog": json({ runtimes: ["claude"], models: { claude: ["anthropic/claude-sonnet-5"] } }),
    "/api/environments": json([environment]),
    "/api/agents": json([teammate.agent]),
    "/api/team": json([teammate]),
    "/api/team/agent-mend": json(teammate),
    "/api/conversations/c1/turns": json(turns),
    "/api/conversations/c1/events": () => Response.json({ data: events, meta: { has_more: false, next_cursor: null } }),
    "/api/conversations/c1/read": new Response(null, { status: 204 }),
    "/api/team/agent-mend/messages": () => Response.json({ status: "queued", conversation_id: "c1" }),
    "/api/team/stream": () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": hello\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  },
  fetch: () => Response.json({ error: "not_found" }, { status: 404 }),
});

console.log("mock Fountain on http://localhost:8789");
