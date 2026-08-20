import { describe, expect, test } from "bun:test";
import { CATALOGS, catalogOf, coverage } from "./rulesets";
import { CHANT_PACKAGES } from "./spec";
import type { Finding } from "./protocol";

const finding = (checkId: string): Finding => ({
  checkId,
  severity: "warning",
  message: "",
  file: "f",
  tier: "merge-worthy",
  fixKind: "guidance",
  category: "security",
  title: checkId,
});

describe("CATALOGS", () => {
  test("is exactly the lexicon set the toolkit environment installs", () => {
    const installed = CHANT_PACKAGES.flatMap((p) => p.split("lexicon-")[1] ?? []);
    expect(CATALOGS.map((c) => c.id).sort()).toEqual([...installed].sort());
    expect(CATALOGS).toHaveLength(10);
  });

  test("no prefix is claimed by two catalogs", () => {
    const all = CATALOGS.flatMap((c) => c.prefixes);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("catalogOf", () => {
  test("maps each catalog's prefix to it", () => {
    expect(catalogOf("GHA033")?.name).toBe("GitHub Actions");
    expect(catalogOf("WGL016")?.name).toBe("GitLab CI");
    expect(catalogOf("WFJ003")?.name).toBe("Forgejo Actions");
    expect(catalogOf("DKRD012")?.name).toBe("Docker");
    expect(catalogOf("AZR018")?.name).toBe("Azure ARM");
    expect(catalogOf("WGC004")?.name).toBe("Google Cloud");
    expect(catalogOf("WHM004")?.name).toBe("Helm");
    expect(catalogOf("FTN001")?.name).toBe("Fountain");
  });

  test("Argo and Flux rules belong to the k8s catalog, not catalogs of their own", () => {
    expect(catalogOf("ARGO001")?.id).toBe("k8s");
    expect(catalogOf("FLUX002")?.id).toBe("k8s");
    expect(catalogOf("WK8203")?.id).toBe("k8s");
    expect(CATALOGS.some((c) => c.name === "Argo CD")).toBe(false);
  });

  test("CloudFormation's three id families all fold into one catalog", () => {
    for (const id of ["WAW018", "COR002", "EXT007"]) expect(catalogOf(id)?.id).toBe("aws");
  });

  test("an unknown id is null rather than a wrong guess", () => {
    expect(catalogOf("ZZZ001")).toBeNull();
    expect(catalogOf("")).toBeNull();
  });
});

describe("coverage", () => {
  test("always reports all ten catalogs, even on a clean audit", () => {
    const clean = coverage([]);
    expect(clean).toHaveLength(10);
    expect(clean.every((c) => c.count === 0)).toBe(true);
  });

  test("the ones that found something come first, busiest first", () => {
    const out = coverage(["GHA033", "GHA021", "GHA044", "WK8203", "ARGO001", "DKRD012"].map(finding));
    expect(out.slice(0, 3).map((c) => [c.name, c.count])).toEqual([
      ["GitHub Actions", 3],
      ["Kubernetes", 2], // WK8 + ARGO fold together
      ["Docker", 1],
    ]);
    expect(out).toHaveLength(10);
    expect(out.slice(3).every((c) => c.count === 0)).toBe(true);
  });

  test("the quiet ones keep their usual order", () => {
    const out = coverage([finding("GHA033")]);
    expect(out[0]!.name).toBe("GitHub Actions");
    expect(out.slice(1).map((c) => c.id)).toEqual(["gitlab", "forgejo", "k8s", "docker", "aws", "azure", "gcp", "helm", "fountain"]);
  });

  test("an unknown rule id is not counted against any catalog", () => {
    const out = coverage([finding("ZZZ001")]);
    expect(out.every((c) => c.count === 0)).toBe(true);
  });
});
