/**
 * The Mend protocol: how the app reads the agent.
 *
 * The agent embeds machine-readable fenced blocks in its replies —
 * ```audit-report (the chant audit, once per audit), ```mend-plan (what it
 * applied, proposed and skipped) and ```mend-patch (the unified diff) — and
 * the app parses them out of the assistant text. The agent's side of the
 * contract is `spec.ts` — change one, change both.
 */

export type Severity = "error" | "warning" | "info";
export type Tier = "merge-worthy" | "report-only";
export type FixKind = "deterministic" | "guidance";
export type Category = "security" | "correctness" | "best-practice";

export interface Authority {
  name: string;
  url?: string;
}

export interface Finding {
  checkId: string;
  severity: Severity;
  message: string;
  file: string;
  entity?: string;
  tier: Tier;
  fixKind: FixKind;
  category: Category;
  title: string;
  remediation?: string;
  authority?: Authority;
}

export interface Counts {
  total: number;
  quickWin: number;
  needsReview: number;
  reportOnly: number;
  errors: number;
  warnings: number;
  infos: number;
  security: number;
  correctness: number;
  bestPractice: number;
}

export interface AuditReport {
  branch?: string;
  commit?: string;
  scanned?: number;
  summary: Counts;
  findings: Finding[];
  /** findings the agent left out of the block to keep it small */
  omitted: number;
}

export type FixStatus = "applied" | "proposed" | "skipped";

export interface Fix {
  id: number;
  status: FixStatus;
  checkIds: string[];
  files: string[];
  title: string;
  note?: string;
  /** This fix's own diff, from its `mend-fix <id>` block. Absent when the
   *  agent only sent the combined patch — then the fix cannot be selected
   *  individually and the PR has to take the patch whole. */
  diff?: string;
}

export interface MendPlan {
  branch?: string;
  base?: string;
  before?: { mergeWorthy: number };
  after?: { mergeWorthy: number };
  fixes: Fix[];
  pr?: { title: string; body: string };
  pr_url?: string;
}

/** A pull request the agent drafted for a chosen set of fixes. */
export interface PrDraft {
  title: string;
  body: string;
}

export type ProtocolBlock =
  | { kind: "report"; report: AuditReport }
  | { kind: "plan"; plan: MendPlan }
  | { kind: "patch"; patch: string }
  | { kind: "fix"; id: number; diff: string }
  | { kind: "draft"; draft: PrDraft };

/** ```<kind> [arg]\n<body>``` — `arg` carries the fix id on a `mend-fix` block. */
const FENCE = /```(audit-report|mend-plan|mend-patch|mend-fix|pr-draft)(?:[^\S\n]+([^\n]*?))?[^\S\n]*\n([\s\S]*?)```/g;

/** Every well-formed protocol block in one reply, in order. Malformed JSON is skipped. */
export function parseBlocks(text: string): ProtocolBlock[] {
  const out: ProtocolBlock[] = [];
  for (const m of text.matchAll(FENCE)) {
    const kind = m[1]!;
    const arg = m[2];
    const body = m[3]!;
    if (kind === "mend-patch") {
      out.push({ kind: "patch", patch: body.replace(/\n$/, "") });
      continue;
    }
    if (kind === "mend-fix") {
      const id = Number(arg);
      if (Number.isFinite(id) && body.trim()) out.push({ kind: "fix", id, diff: body.replace(/\n$/, "") });
      continue;
    }
    if (kind === "pr-draft") {
      // Commit-message shape: the first non-empty line is the title, the rest
      // is the body. Far kinder to an LLM than newline-escaped JSON.
      const draft = asDraft(body);
      if (draft) out.push({ kind: "draft", draft });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (kind === "audit-report") {
      const report = asReport(parsed);
      if (report) out.push({ kind: "report", report });
    } else {
      const plan = asPlan(parsed);
      if (plan) out.push({ kind: "plan", plan });
    }
  }
  return out;
}

function asDraft(body: string): PrDraft | null {
  const lines = body.replace(/\n+$/, "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const title = lines[i]?.replace(/^#+\s*/, "").trim();
  if (!title) return null;
  return { title, body: lines.slice(i + 1).join("\n").trim() };
}

/** The reply with protocol blocks removed — what the chat bubble shows as prose. */
export function stripBlocks(text: string): string {
  return text.replace(FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface MendView {
  /** the newest audit the mender has reported, if any */
  report: AuditReport | null;
  reportTurnIndex: number | null;
  /** the newest plan (fixes carrying their own diffs), and its patch */
  plan: MendPlan | null;
  patch: string | null;
  planTurnIndex: number | null;
  /** the newest pull request the agent drafted, if one is outstanding */
  draft: PrDraft | null;
}

const EMPTY_VIEW: MendView = {
  report: null,
  reportTurnIndex: null,
  plan: null,
  patch: null,
  planTurnIndex: null,
  draft: null,
};

/**
 * Fold a thread (oldest-first replies) into the current state. Newest wins: a
 * re-audit clears the plan, a new plan clears the draft, and a later reply may
 * revise the patch or a single fix's diff without resending the plan.
 */
export function foldThread(turns: Array<{ reply: string }>): MendView {
  const view: MendView = { ...EMPTY_VIEW };
  turns.forEach((turn, i) => {
    let planHere: MendPlan | null = null;
    let patchHere: string | null = null;
    let draftHere: PrDraft | null = null;
    const diffs = new Map<number, string>();

    for (const block of parseBlocks(turn.reply)) {
      switch (block.kind) {
        case "report":
          view.report = block.report;
          view.reportTurnIndex = i;
          view.plan = null;
          view.patch = null;
          view.planTurnIndex = null;
          view.draft = null;
          break;
        case "plan":
          planHere = block.plan;
          break;
        case "patch":
          patchHere = block.patch;
          break;
        case "fix":
          diffs.set(block.id, block.diff);
          break;
        case "draft":
          draftHere = block.draft;
          break;
      }
    }

    if (planHere) {
      view.plan = withDiffs(planHere, diffs);
      view.planTurnIndex = i;
      view.patch = patchHere;
      view.draft = null; // a fresh plan invalidates a draft written for the old one
    } else if (view.plan) {
      if (patchHere !== null) view.patch = patchHere;
      if (diffs.size > 0) view.plan = withDiffs(view.plan, diffs);
    }
    if (draftHere) view.draft = draftHere;
  });
  return view;
}

function withDiffs(plan: MendPlan, diffs: Map<number, string>): MendPlan {
  if (diffs.size === 0) return plan;
  return {
    ...plan,
    fixes: plan.fixes.map((f) => {
      const diff = diffs.get(f.id);
      return diff ? { ...f, diff } : f;
    }),
  };
}

/** The fixes a pull request can be assembled from: changed, and carrying a diff. */
export function selectableFixes(plan: MendPlan | null): Fix[] {
  if (!plan) return [];
  return plan.fixes.filter((f) => f.status !== "skipped" && typeof f.diff === "string" && f.diff.trim() !== "");
}

// ── the report, arranged the way blacklight shows it ─────────────────────────

export interface QuickWinFile {
  file: string;
  findings: Finding[];
}

export interface GuidanceCluster {
  name: string;
  url?: string;
  rules: Array<{ checkId: string; title: string; remediation?: string; findings: Finding[] }>;
}

export interface ReportView {
  quickWins: QuickWinFile[];
  needsReview: GuidanceCluster[];
  reportOnly: Finding[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings(a: Finding, b: Finding): number {
  const sev = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
  if (sev !== 0) return sev;
  if (a.checkId !== b.checkId) return a.checkId < b.checkId ? -1 : 1;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

/** Quick wins by file, guidance clustered by authority, hygiene flat — the blacklight layout. */
export function arrangeReport(report: AuditReport): ReportView {
  const sorted = [...report.findings].sort(sortFindings);
  const byFile = new Map<string, Finding[]>();
  const byAuthority = new Map<string, Finding[]>();
  const reportOnly: Finding[] = [];
  for (const f of sorted) {
    if (f.tier === "report-only") reportOnly.push(f);
    else if (f.fixKind === "deterministic") push(byFile, f.file, f);
    else push(byAuthority, f.authority?.name ?? "General hardening", f);
  }
  const quickWins = [...byFile.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([file, findings]) => ({ file, findings }));
  const needsReview = [...byAuthority.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, group]) => {
      const byRule = new Map<string, Finding[]>();
      for (const f of group) push(byRule, f.checkId, f);
      return {
        name,
        url: group[0]?.authority?.url,
        rules: [...byRule.entries()].map(([checkId, findings]) => ({
          checkId,
          title: findings[0]!.title,
          remediation: findings[0]!.remediation,
          findings,
        })),
      };
    });
  return { quickWins, needsReview, reportOnly };
}

function push<K>(map: Map<K, Finding[]>, key: K, f: Finding): void {
  const list = map.get(key);
  if (list) list.push(f);
  else map.set(key, [f]);
}

/** Link from a rule id to its reference entry (same scheme the CLI report uses). */
export function ruleDocUrl(id: string): string {
  return `https://intentius.io/chant/lint-rules/audit-rules/#${id.toLowerCase()}`;
}

// ── shape guards: tolerate a sloppy agent, never a crashing UI ─────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const EMPTY_COUNTS: Counts = { total: 0, quickWin: 0, needsReview: 0, reportOnly: 0, errors: 0, warnings: 0, infos: 0, security: 0, correctness: 0, bestPractice: 0 };

function asCounts(v: unknown): Counts {
  if (!isObj(v)) return { ...EMPTY_COUNTS };
  const out = { ...EMPTY_COUNTS };
  for (const k of Object.keys(EMPTY_COUNTS) as Array<keyof Counts>) {
    const n = num(v[k]);
    if (n !== undefined) out[k] = Math.max(0, Math.floor(n));
  }
  return out;
}

function asFinding(v: unknown): Finding | null {
  if (!isObj(v)) return null;
  const checkId = str(v.checkId);
  const file = str(v.file);
  if (!checkId || !file) return null;
  const f: Finding = {
    checkId,
    file: file.replace(/^\.?\/+/, ""),
    severity: oneOf(v.severity, ["error", "warning", "info"] as const, "warning"),
    message: str(v.message) ?? "",
    tier: oneOf(v.tier, ["merge-worthy", "report-only"] as const, "report-only"),
    fixKind: oneOf(v.fixKind, ["deterministic", "guidance"] as const, "guidance"),
    category: oneOf(v.category, ["security", "correctness", "best-practice"] as const, "best-practice"),
    title: str(v.title) ?? checkId,
  };
  const entity = str(v.entity);
  if (entity) f.entity = entity;
  const remediation = str(v.remediation);
  if (remediation) f.remediation = remediation;
  if (isObj(v.authority)) {
    const name = str(v.authority.name);
    if (name) {
      f.authority = { name };
      const url = str(v.authority.url);
      if (url) f.authority.url = url;
    }
  }
  return f;
}

function asReport(v: unknown): AuditReport | null {
  if (!isObj(v)) return null;
  if (!isObj(v.summary) && !Array.isArray(v.findings)) return null;
  const findings = Array.isArray(v.findings) ? v.findings.map(asFinding).filter((f): f is Finding => f !== null) : [];
  // A summary the agent forgot is recomputed from what it did send.
  const summary = isObj(v.summary)
    ? asCounts(v.summary)
    : {
        total: findings.length,
        quickWin: findings.filter((f) => f.tier === "merge-worthy" && f.fixKind === "deterministic").length,
        needsReview: findings.filter((f) => f.tier === "merge-worthy" && f.fixKind === "guidance").length,
        reportOnly: findings.filter((f) => f.tier === "report-only").length,
        errors: findings.filter((f) => f.severity === "error").length,
        warnings: findings.filter((f) => f.severity === "warning").length,
        infos: findings.filter((f) => f.severity === "info").length,
        security: findings.filter((f) => f.category === "security").length,
        correctness: findings.filter((f) => f.category === "correctness").length,
        bestPractice: findings.filter((f) => f.category === "best-practice").length,
      };
  const report: AuditReport = { summary, findings, omitted: Math.max(0, Math.floor(num(v.omitted) ?? 0)) };
  const branch = str(v.branch);
  if (branch) report.branch = branch;
  const commit = str(v.commit);
  if (commit) report.commit = commit;
  const scanned = num(v.scanned);
  if (scanned !== undefined) report.scanned = Math.floor(scanned);
  return report;
}

function asFix(v: unknown, i: number): Fix | null {
  if (!isObj(v)) return null;
  const title = str(v.title);
  if (!title) return null;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.length > 0) : []);
  const fix: Fix = {
    id: num(v.id) ?? i + 1,
    status: oneOf(v.status, ["applied", "proposed", "skipped"] as const, "proposed"),
    checkIds: strs(v.checkIds),
    files: strs(v.files).map((p) => p.replace(/^\.?\/+/, "")),
    title,
  };
  const note = str(v.note);
  if (note) fix.note = note;
  return fix;
}

function asPlan(v: unknown): MendPlan | null {
  if (!isObj(v) || !Array.isArray(v.fixes)) return null;
  const plan: MendPlan = { fixes: v.fixes.map(asFix).filter((f): f is Fix => f !== null) };
  const branch = str(v.branch);
  if (branch) plan.branch = branch;
  const base = str(v.base);
  if (base) plan.base = base;
  const before = isObj(v.before) ? num(v.before.mergeWorthy) : undefined;
  if (before !== undefined) plan.before = { mergeWorthy: before };
  const after = isObj(v.after) ? num(v.after.mergeWorthy) : undefined;
  if (after !== undefined) plan.after = { mergeWorthy: after };
  if (isObj(v.pr)) {
    const title = str(v.pr.title);
    const body = str(v.pr.body);
    if (title) plan.pr = { title, body: body ?? "" };
  }
  const prUrl = str(v.pr_url);
  if (prUrl && /^https?:\/\//.test(prUrl)) plan.pr_url = prUrl;
  return plan;
}
