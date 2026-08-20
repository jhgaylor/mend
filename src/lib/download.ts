/**
 * Handing work back to the user: the patch as a file, and anything copyable
 * to the clipboard. Nothing leaves the browser.
 */
import type { MendPlan } from "./protocol";

export function triggerDownload(name: string, type: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The PR description the agent wrote, as markdown you can paste into a PR. */
export function planToMarkdown(plan: MendPlan, label: string): string {
  const out: string[] = [];
  out.push(`# ${plan.pr?.title ?? `Mend: ${label}`}`, "");
  if (plan.pr?.body) out.push(plan.pr.body, "");
  const section = (title: string, status: string) => {
    const fixes = plan.fixes.filter((f) => f.status === status);
    if (!fixes.length) return;
    out.push(`## ${title}`, "");
    for (const f of fixes) {
      const ids = f.checkIds.length ? ` (${f.checkIds.join(", ")})` : "";
      out.push(`- **${f.title}**${ids}${f.note ? ` — ${f.note}` : ""}`);
      if (f.files.length) out.push(`  - ${f.files.map((p) => `\`${p}\``).join(", ")}`);
    }
    out.push("");
  };
  section("Applied", "applied");
  section("Proposed — review these", "proposed");
  section("Left for a human", "skipped");
  if (plan.before && plan.after) {
    out.push(`Merge-worthy findings: ${plan.before.mergeWorthy} → ${plan.after.mergeWorthy}.`, "");
  }
  out.push("---", "Audited with [chant](https://intentius.io/chant/cli/audit/) and mended by an agent on [Fountain](https://github.com/BinaryBourbon/fountain) — https://mend.inevitable.fyi");
  return out.join("\n");
}
