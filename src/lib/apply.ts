/**
 * Applying a unified diff in the browser.
 *
 * The app builds the commit itself (see `gh.ts`), so it has to turn the
 * agent's patch into the new contents of each file. Every context and
 * deletion line is verified against the file as it exists on the host right
 * now: if one does not match, we throw rather than write a file we cannot
 * vouch for. A mismatch means the branch moved under us since the audit —
 * the honest answer there is "re-audit", not "guess".
 */
import { parseDiff, pathOf, type FileDiff, type Hunk } from "./diff";

export class PatchError extends Error {
  constructor(
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = "PatchError";
  }
}

/** One file's worth of change, ready to become a git tree entry. */
export interface FileChange {
  path: string;
  /** The full new contents, or null when the file is deleted. */
  content: string | null;
}

interface Split {
  lines: string[];
  trailingNewline: boolean;
}

function splitLines(text: string): Split {
  if (text === "") return { lines: [], trailingNewline: false };
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body.split("\n"), trailingNewline };
}

const NO_NEWLINE = "\\ No newline at end of file";

/**
 * Apply one file's hunks to its original contents.
 *
 * Hunks are applied in file order, each one anchored at its own `oldStart`,
 * so several fixes' diffs for the same file compose as long as they do not
 * overlap. Overlapping hunks are refused — that is a conflict, not something
 * to resolve silently.
 */
export function applyHunks(original: string, hunks: Hunk[], path = "(file)"): string {
  const { lines, trailingNewline } = splitLines(original);
  const ordered = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

  const out: string[] = [];
  let cursor = 0; // how far through `lines` we have consumed
  let endsWithNewline = trailingNewline;

  for (const hunk of ordered) {
    // A hunk against an empty file reports oldStart 0; everything else is 1-based.
    const start = Math.max(0, hunk.oldStart - 1);
    if (start < cursor) {
      throw new PatchError(`Overlapping changes for ${path} at line ${hunk.oldStart} — the fixes conflict.`, path);
    }
    if (start > lines.length) {
      throw new PatchError(`${path} is shorter than the patch expects (needs line ${hunk.oldStart}, file has ${lines.length}).`, path);
    }
    for (let i = cursor; i < start; i++) out.push(lines[i]!);
    let idx = start;

    for (let li = 0; li < hunk.lines.length; li++) {
      const line = hunk.lines[li]!;
      if (line.kind === "meta") {
        // "\ No newline at end of file" describes the side it follows.
        if (line.text.trim() === NO_NEWLINE.trim() || line.text.startsWith("\\")) {
          const prev = hunk.lines[li - 1];
          if (prev && (prev.kind === "add" || prev.kind === "ctx")) endsWithNewline = false;
        }
        continue;
      }
      if (line.kind === "add") {
        out.push(line.text);
        endsWithNewline = true;
        continue;
      }
      // ctx and del both consume an original line, and both must match it.
      const actual = lines[idx];
      if (actual === undefined) {
        throw new PatchError(`${path} ends before the patch does (expected "${truncate(line.text)}" at line ${idx + 1}).`, path);
      }
      if (actual !== line.text) {
        throw new PatchError(
          `${path} does not match the patch at line ${idx + 1}: expected "${truncate(line.text)}", found "${truncate(actual)}".`,
          path,
        );
      }
      if (line.kind === "ctx") out.push(actual);
      idx++;
    }
    cursor = idx;
  }

  for (let i = cursor; i < lines.length; i++) out.push(lines[i]!);
  if (out.length === 0) return "";
  return out.join("\n") + (endsWithNewline ? "\n" : "");
}

/**
 * Turn a set of file diffs into the changes to commit, fetching each file's
 * current contents through `read` (null for a file that does not exist yet).
 */
export async function buildChanges(
  files: FileDiff[],
  read: (path: string) => Promise<string | null>,
): Promise<FileChange[]> {
  const out: FileChange[] = [];
  for (const file of files) {
    const path = pathOf(file);
    if (file.status === "deleted") {
      out.push({ path, content: null });
      continue;
    }
    const existing = file.status === "added" ? "" : await read(path);
    if (existing === null) {
      throw new PatchError(`${path} is not in the repository — the patch expects it to exist.`, path);
    }
    out.push({ path, content: applyHunks(existing, file.hunks, path) });
  }
  return out;
}

/**
 * Merge several per-fix patches into one set of file diffs, so a selection of
 * fixes that touch the same file becomes one tree entry rather than two.
 */
export function mergePatches(patches: string[]): FileDiff[] {
  const byPath = new Map<string, FileDiff>();
  for (const patch of patches) {
    for (const file of parseDiff(patch)) {
      const path = pathOf(file);
      const existing = byPath.get(path);
      if (!existing) {
        byPath.set(path, { ...file, hunks: [...file.hunks] });
        continue;
      }
      existing.hunks.push(...file.hunks);
      existing.additions += file.additions;
      existing.deletions += file.deletions;
      // A delete or create anywhere in the set wins over a plain modify.
      if (file.status !== "modified") existing.status = file.status;
    }
  }
  return [...byPath.values()];
}

function truncate(s: string, max = 60): string {
  const t = s.replace(/\t/g, "\\t");
  return t.length > max ? t.slice(0, max) + "…" : t;
}
