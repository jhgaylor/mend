import { describe, expect, test } from "bun:test";
import { parseDiff, pathOf, patchFilename } from "./diff";

const PATCH = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 1111111..2222222 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,6 +1,8 @@
 name: ci
 on: [push]
-permissions: write-all
+permissions:
+  contents: read
 jobs:
   build:
     runs-on: ubuntu-latest
diff --git a/k8s/old.yaml b/k8s/old.yaml
deleted file mode 100644
--- a/k8s/old.yaml
+++ /dev/null
@@ -1,2 +0,0 @@
-apiVersion: v1
-kind: Pod
`;

describe("parseDiff", () => {
  test("splits files, counts the churn, keeps hunk headers", () => {
    const files = parseDiff(PATCH);
    expect(files).toHaveLength(2);
    const ci = files[0]!;
    expect(pathOf(ci)).toBe(".github/workflows/ci.yml");
    expect(ci.status).toBe("modified");
    expect(ci.additions).toBe(2);
    expect(ci.deletions).toBe(1);
    expect(ci.hunks[0]!.header).toBe("@@ -1,6 +1,8 @@");
    expect(ci.hunks[0]!.lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["permissions:", "  contents: read"]);
    expect(ci.hunks[0]!.lines[0]).toEqual({ kind: "ctx", text: "name: ci" });
  });

  test("a deletion keeps the old path and is marked", () => {
    const gone = parseDiff(PATCH)[1]!;
    expect(gone.status).toBe("deleted");
    expect(pathOf(gone)).toBe("k8s/old.yaml");
    expect(gone.newPath).toBeNull();
  });

  test("handles a bare diff -u with no git header", () => {
    const files = parseDiff("--- a/x.yml\n+++ b/x.yml\n@@ -1 +1 @@\n-a\n+b\n");
    expect(files).toHaveLength(1);
    expect(pathOf(files[0]!)).toBe("x.yml");
    expect(files[0]!.additions).toBe(1);
  });

  test("empty and junk input never throw", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("not a patch at all\njust prose\n")).toEqual([]);
  });
});

test("patchFilename slugs the repo label", () => {
  expect(patchFilename("BinaryBourbon/fountain")).toBe("mend-binarybourbon-fountain.patch");
  expect(patchFilename("!!!")).toBe("mend-repo.patch");
});
