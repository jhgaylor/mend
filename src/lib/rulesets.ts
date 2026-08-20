/**
 * Which of chant's rule catalogs actually fired.
 *
 * An audit's breadth is the point and it is otherwise invisible — "9 findings"
 * says nothing about the fact that chant read the workflows, the manifests and
 * the Dockerfile with a different few hundred checks each. Rule ids carry their
 * catalog as a prefix, so the report can name them.
 *
 * The prefix → lexicon mapping is chant 0.44's: ARGO and FLUX rules live in the
 * k8s lexicon, and COR/EXT are core's cross-cutting CloudFormation ids.
 */
import type { Finding } from "./protocol";

export interface Ruleset {
  /** The rule-id prefix, e.g. "GHA". */
  prefix: string;
  /** What a human calls it. */
  name: string;
  /** How many findings in this audit came from it. */
  count: number;
}

const PREFIXES: Array<[string, string]> = [
  ["GHA", "GitHub Actions"],
  ["WGL", "GitLab CI"],
  ["WFJ", "Forgejo Actions"],
  ["WK8", "Kubernetes"],
  ["ARGO", "Argo CD"],
  ["FLUX", "Flux"],
  ["DKRD", "Docker"],
  ["WAW", "CloudFormation"],
  ["COR", "CloudFormation"],
  ["EXT", "CloudFormation"],
  ["AZR", "Azure ARM"],
  ["WGC", "Google Cloud"],
  ["WHM", "Helm"],
  ["FTN", "Fountain"],
];

/** The catalog a rule id belongs to, or null when it is one we do not know. */
export function rulesetOf(checkId: string): { prefix: string; name: string } | null {
  // Longest prefix first, so ARGO/FLUX are not shadowed by a shorter match.
  const sorted = [...PREFIXES].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, name] of sorted) {
    if (checkId.startsWith(prefix)) return { prefix, name };
  }
  return null;
}

/** Every catalog that produced a finding, busiest first. */
export function rulesetsIn(findings: Finding[]): Ruleset[] {
  const byName = new Map<string, Ruleset>();
  for (const f of findings) {
    const rs = rulesetOf(f.checkId);
    if (!rs) continue;
    const existing = byName.get(rs.name);
    if (existing) existing.count++;
    else byName.set(rs.name, { prefix: rs.prefix, name: rs.name, count: 1 });
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
