/**
 * chant's rule catalogs — one per format, ten of them installed here.
 *
 * The breadth is the point and it is otherwise invisible: "9 findings" never
 * conveys that chant carries a separate few-hundred-check catalog for CI, for
 * manifests, for Dockerfiles, for each cloud's templates, and ran every one it
 * had. So the report shows all ten and marks which ones had something to say.
 *
 * The prefixes are chant 0.44's. Two subtleties: ARGO and FLUX rules ship
 * inside the k8s lexicon rather than as catalogs of their own, and COR/EXT are
 * core's cross-cutting CloudFormation ids — so all of those fold into their
 * owning catalog rather than posing as extras.
 */
import type { Finding } from "./protocol";

export interface Catalog {
  /** The lexicon package suffix, e.g. "github" for @intentius/chant-lexicon-github. */
  id: string;
  /** What a human calls it. */
  name: string;
  /** Rule-id prefixes this catalog owns. */
  prefixes: string[];
  /** What chant reads for this catalog — shown so the coverage is concrete. */
  reads: string;
}

/** The ten catalogs the Mend toolkit installs — the same set blacklight runs. */
export const CATALOGS: Catalog[] = [
  { id: "github", name: "GitHub Actions", prefixes: ["GHA"], reads: ".github/workflows/*.yml" },
  { id: "gitlab", name: "GitLab CI", prefixes: ["WGL"], reads: ".gitlab-ci.yml" },
  { id: "forgejo", name: "Forgejo Actions", prefixes: ["WFJ"], reads: ".forgejo/workflows/*.yml" },
  { id: "k8s", name: "Kubernetes", prefixes: ["WK8", "ARGO", "FLUX"], reads: "manifests, Argo CD and Flux resources" },
  { id: "docker", name: "Docker", prefixes: ["DKRD"], reads: "Dockerfiles and Compose files" },
  { id: "aws", name: "CloudFormation", prefixes: ["WAW", "COR", "EXT"], reads: "CloudFormation templates" },
  { id: "azure", name: "Azure ARM", prefixes: ["AZR"], reads: "ARM deployment templates" },
  { id: "gcp", name: "Google Cloud", prefixes: ["WGC"], reads: "Config Connector YAML" },
  { id: "helm", name: "Helm", prefixes: ["WHM"], reads: "charts, as a bundle" },
  { id: "fountain", name: "Fountain", prefixes: ["FTN"], reads: "fountain.dev/v1 manifests" },
];

/** The catalog a rule id belongs to, or null for one we do not know. */
export function catalogOf(checkId: string): Catalog | null {
  if (!checkId) return null;
  // Longest prefix first, so ARGO/FLUX are not shadowed by a shorter match.
  const pairs = CATALOGS.flatMap((c) => c.prefixes.map((p) => [p, c] as const)).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, catalog] of pairs) {
    if (checkId.startsWith(prefix)) return catalog;
  }
  return null;
}

export interface CatalogCoverage extends Catalog {
  /** Findings this audit attributed to the catalog. */
  count: number;
}

/**
 * Every catalog that ran, with what it found — the ones that spoke first, in
 * order of how much they had to say, then the quiet ones in their usual order.
 */
export function coverage(findings: Finding[]): CatalogCoverage[] {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const c = catalogOf(f.checkId);
    if (c) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  const withCounts = CATALOGS.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
  const spoke = withCounts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const quiet = withCounts.filter((c) => c.count === 0);
  return [...spoke, ...quiet];
}
