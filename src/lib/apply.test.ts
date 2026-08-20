import { describe, expect, test } from "bun:test";
import { parseDiff } from "./diff";
import { applyHunks, buildChanges, mergePatches, PatchError } from "./apply";

const CI = `name: ci
on: [push]
permissions: write-all
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

const PERMS_FIX = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,4 +1,5 @@
 name: ci
 on: [push]
-permissions: write-all
+permissions:
+  contents: read
 jobs:
`;

const PIN_FIX = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -7,3 +7,3 @@ jobs:
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@11bd719 # v4
       - run: npm test
`;

const hunksOf = (patch: string) => parseDiff(patch)[0]!.hunks;

describe("applyHunks", () => {
  test("applies a hunk and leaves the rest of the file alone", () => {
    const out = applyHunks(CI, hunksOf(PERMS_FIX));
    expect(out).toBe(`name: ci
on: [push]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`);
  });

  test("two fixes touching one file compose, with the right line offsets", () => {
    const merged = mergePatches([PERMS_FIX, PIN_FIX]);
    expect(merged).toHaveLength(1);
    const out = applyHunks(CI, merged[0]!.hunks);
    expect(out).toContain("  contents: read");
    expect(out).toContain("actions/checkout@11bd719 # v4");
    expect(out).not.toContain("write-all");
    expect(out).not.toContain("checkout@v4\n");
    // Every other line survives untouched.
    expect(out.split("\n").filter((l) => l.trim() === "- run: npm test".trim() || l.includes("npm test"))).toHaveLength(1);
  });

  test("order of selection does not matter — hunks anchor on their own line numbers", () => {
    const a = applyHunks(CI, mergePatches([PERMS_FIX, PIN_FIX])[0]!.hunks);
    const b = applyHunks(CI, mergePatches([PIN_FIX, PERMS_FIX])[0]!.hunks);
    expect(a).toBe(b);
  });

  test("selecting only one fix applies only that fix", () => {
    const out = applyHunks(CI, hunksOf(PIN_FIX));
    expect(out).toContain("permissions: write-all"); // untouched
    expect(out).toContain("actions/checkout@11bd719 # v4");
  });

  test("refuses a file that drifted since the audit rather than corrupting it", () => {
    const drifted = CI.replace("permissions: write-all", "permissions: read-all");
    expect(() => applyHunks(drifted, hunksOf(PERMS_FIX), "ci.yml")).toThrow(PatchError);
    try {
      applyHunks(drifted, hunksOf(PERMS_FIX), "ci.yml");
    } catch (err) {
      expect((err as PatchError).message).toContain("does not match the patch at line 3");
      expect((err as PatchError).path).toBe("ci.yml");
    }
  });

  test("refuses overlapping hunks instead of applying half of each", () => {
    const overlap = mergePatches([PERMS_FIX, PERMS_FIX]);
    expect(() => applyHunks(CI, overlap[0]!.hunks, "ci.yml")).toThrow(/Overlapping/);
  });

  test("refuses a file shorter than the patch expects", () => {
    expect(() => applyHunks("name: ci\n", hunksOf(PIN_FIX), "ci.yml")).toThrow(PatchError);
  });

  test("preserves a file with no trailing newline", () => {
    const patch = `--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 a
-b
+c
\\ No newline at end of file
`;
    expect(applyHunks("a\nb", hunksOf(patch))).toBe("a\nc");
  });

  test("creates a file from empty", () => {
    const patch = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
    expect(applyHunks("", hunksOf(patch))).toBe("hello\nworld\n");
  });
});

describe("mergePatches", () => {
  test("groups by path and keeps both files' hunks", () => {
    const other = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -1 +1 @@
-FROM nginx:alpine
+FROM nginx:alpine@sha256:abc
`;
    const merged = mergePatches([PERMS_FIX, PIN_FIX, other]);
    expect(merged.map((f) => f.newPath).sort()).toEqual([".github/workflows/ci.yml", "Dockerfile"]);
    const ci = merged.find((f) => f.newPath?.endsWith("ci.yml"))!;
    expect(ci.hunks).toHaveLength(2);
    expect(ci.additions).toBe(3);
  });

  test("an empty selection merges to nothing", () => {
    expect(mergePatches([])).toEqual([]);
  });
});

describe("buildChanges", () => {
  test("reads each file once and returns the patched contents", async () => {
    const reads: string[] = [];
    const changes = await buildChanges(mergePatches([PERMS_FIX]), async (p) => {
      reads.push(p);
      return CI;
    });
    expect(reads).toEqual([".github/workflows/ci.yml"]);
    expect(changes[0]!.content).toContain("contents: read");
  });

  test("a deletion becomes a null content entry", async () => {
    const del = `diff --git a/old.yaml b/old.yaml
deleted file mode 100644
--- a/old.yaml
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;
    const changes = await buildChanges(parseDiff(del), async () => "gone\n");
    expect(changes).toEqual([{ path: "old.yaml", content: null }]);
  });

  test("a missing file is an error, not an empty commit", async () => {
    await expect(buildChanges(mergePatches([PERMS_FIX]), async () => null)).rejects.toThrow(/not in the repository/);
  });
});
