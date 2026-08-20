/**
 * A small unified-diff reader for the patch viewer: `git diff` output →
 * files → hunks → lines. Tolerant of what it does not understand (binary
 * notes, mode lines, renames): anything outside a hunk that is not a file
 * header is kept as the file's preamble and otherwise ignored.
 */

export type LineKind = "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  kind: LineKind;
  text: string;
}

export interface Hunk {
  header: string;
  /** 1-based first line of the hunk in the original file (0 for an empty file). */
  oldStart: number;
  /** How many original lines the hunk consumes. */
  oldCount: number;
  /** 1-based first line in the patched file. */
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

/** The path a file diff is about: the new path, or the old one for a deletion. */
export function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? "(unknown)";
}

function stripPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

/** `@@ -oldStart,oldCount +newStart,newCount @@` — counts are optional and default to 1. */
const HUNK_RANGE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(patch: string): FileDiff[] {
  const out: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  // The final newline of the patch leaves a trailing "" element. Left in, it
  // becomes a phantom empty context line on the last hunk — invisible when
  // rendering, but it makes the hunk claim one more original line than it has
  // and every apply fails at the end of the file.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      file = { oldPath: m?.[1] ?? null, newPath: m?.[2] ?? null, status: "modified", hunks: [], additions: 0, deletions: 0 };
      hunk = null;
      out.push(file);
      continue;
    }
    if (line.startsWith("--- ")) {
      if (!file) {
        // A diff without the git header (plain `diff -u`) — start a file here.
        file = { oldPath: null, newPath: null, status: "modified", hunks: [], additions: 0, deletions: 0 };
        out.push(file);
      }
      file.oldPath = stripPrefix(line.slice(4).split("\t")[0]!);
      if (file.oldPath === null) file.status = "added";
      hunk = null;
      continue;
    }
    if (line.startsWith("+++ ") && file) {
      file.newPath = stripPrefix(line.slice(4).split("\t")[0]!);
      if (file.newPath === null) file.status = "deleted";
      continue;
    }
    if (file && line.startsWith("rename from ")) file.status = "renamed";
    if (file && line.startsWith("new file mode")) file.status = "added";
    if (file && line.startsWith("deleted file mode")) file.status = "deleted";
    if (line.startsWith("@@") && file) {
      const r = HUNK_RANGE.exec(line);
      hunk = {
        header: line,
        oldStart: r ? Number(r[1]) : 0,
        oldCount: r ? (r[2] === undefined ? 1 : Number(r[2])) : 0,
        newStart: r ? Number(r[3]) : 0,
        newCount: r ? (r[4] === undefined ? 1 : Number(r[4])) : 0,
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk || !file) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1) });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: line.slice(1) });
      file.deletions++;
    } else if (line.startsWith("\\")) {
      hunk.lines.push({ kind: "meta", text: line });
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ kind: "ctx", text: line.slice(1) });
    }
  }
  return out.filter((f) => f.hunks.length > 0 || f.status !== "modified");
}

/** A filename for the downloaded patch: `mend-owner-name.patch`. */
export function patchFilename(label: string): string {
  return `mend-${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "repo"}.patch`;
}
