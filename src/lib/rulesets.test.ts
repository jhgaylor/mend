import { describe, expect, test } from "bun:test";
import { rulesetOf, rulesetsIn } from "./rulesets";
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

describe("rulesetOf", () => {
  test("maps each catalog's prefix to its name", () => {
    expect(rulesetOf("GHA033")?.name).toBe("GitHub Actions");
    expect(rulesetOf("WK8203")?.name).toBe("Kubernetes");
    expect(rulesetOf("DKRD012")?.name).toBe("Docker");
    expect(rulesetOf("WHM004")?.name).toBe("Helm");
    expect(rulesetOf("AZR018")?.name).toBe("Azure ARM");
  });

  test("CloudFormation's three id families all read as CloudFormation", () => {
    for (const id of ["WAW018", "COR002", "EXT007"]) expect(rulesetOf(id)?.name).toBe("CloudFormation");
  });

  test("ARGO and FLUX are not shadowed by a shorter prefix", () => {
    expect(rulesetOf("ARGO001")?.name).toBe("Argo CD");
    expect(rulesetOf("FLUX002")?.name).toBe("Flux");
  });

  test("an unknown id is null rather than a wrong guess", () => {
    expect(rulesetOf("ZZZ001")).toBeNull();
    expect(rulesetOf("")).toBeNull();
  });
});

describe("rulesetsIn", () => {
  test("counts findings per catalog, busiest first", () => {
    const out = rulesetsIn(["GHA033", "GHA021", "GHA044", "WK8203", "WK8110", "DKRD012"].map(finding));
    expect(out).toEqual([
      { prefix: "GHA", name: "GitHub Actions", count: 3 },
      { prefix: "WK8", name: "Kubernetes", count: 2 },
      { prefix: "DKRD", name: "Docker", count: 1 },
    ]);
  });

  test("unknown ids are skipped, not bucketed as junk", () => {
    expect(rulesetsIn(["GHA001", "ZZZ001"].map(finding))).toEqual([{ prefix: "GHA", name: "GitHub Actions", count: 1 }]);
  });

  test("no findings, no rulesets", () => {
    expect(rulesetsIn([])).toEqual([]);
  });
});
