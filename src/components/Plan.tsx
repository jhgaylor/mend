/**
 * What the mender did: fixes grouped by what a human has to do about them —
 * applied (mechanical), proposed (read this), skipped (decide this) — plus
 * the before/after merge-worthy count and the PR description it drafted.
 */
import { useState } from "react";
import { fileUrl, refLabel, type RepoRef } from "../lib/hosts";
import { copyText, planToMarkdown } from "../lib/download";
import { ruleDocUrl, type Fix, type FixStatus, type MendPlan } from "../lib/protocol";

const SECTIONS: Array<{ status: FixStatus; title: string; blurb: string }> = [
  { status: "applied", title: "Applied", blurb: "mechanical fixes, already in the patch" },
  { status: "proposed", title: "Proposed", blurb: "the mender's judgement — read these before you merge" },
  { status: "skipped", title: "Left for you", blurb: "the fix depends on intent it cannot see" },
];

export function Plan(props: { plan: MendPlan; repo: RepoRef; branch: string }) {
  const { plan, repo } = props;
  const [copied, setCopied] = useState<string | null>(null);
  const flash = (what: string) => {
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  };

  const delta = plan.before && plan.after ? plan.before.mergeWorthy - plan.after.mergeWorthy : null;

  return (
    <section className="plan">
      <div className="plan-head">
        <h3>The mend</h3>
        {delta !== null && (
          <span className="delta">
            {`merge-worthy ${plan.before!.mergeWorthy} → `}
            <b>{plan.after!.mergeWorthy}</b>
            {delta > 0 && <i className="down">{`−${delta}`}</i>}
          </span>
        )}
        {plan.pr_url && (
          <a className="prlink" href={plan.pr_url} target="_blank" rel="noreferrer">
            pull request ↗
          </a>
        )}
      </div>

      {SECTIONS.map(({ status, title, blurb }) => {
        const fixes = plan.fixes.filter((f) => f.status === status);
        if (!fixes.length) return null;
        return (
          <div key={status} className={`fixgroup status-${status}`}>
            <div className="fixgroup-head">
              <b>{title}</b>
              <span className="fineprint">{blurb}</span>
              <span className="count">{fixes.length}</span>
            </div>
            {fixes.map((fix) => (
              <FixRow key={`${status}-${fix.id}`} fix={fix} repo={repo} branch={props.branch} />
            ))}
          </div>
        );
      })}

      {plan.pr && (
        <details className="prdraft">
          <summary>
            Pull request description <span className="fineprint">drafted by the mender</span>
          </summary>
          <pre>{plan.pr.body}</pre>
          <button
            onClick={() => void copyText(planToMarkdown(plan, refLabel(repo))).then((ok) => flash(ok ? "pr" : "fail"))}
          >
            {copied === "pr" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy as markdown"}
          </button>
        </details>
      )}
    </section>
  );
}

function FixRow(props: { fix: Fix; repo: RepoRef; branch: string }) {
  const { fix } = props;
  return (
    <div className="fix">
      <div className="fix-head">
        <b>{fix.title}</b>
        {fix.checkIds.map((id) => (
          <a key={id} className="ruleid" href={ruleDocUrl(id)} target="_blank" rel="noreferrer">
            {id}
          </a>
        ))}
      </div>
      {fix.note && <p className="fix-note">{fix.note}</p>}
      {fix.files.length > 0 && (
        <div className="fix-files">
          {fix.files.map((p) => (
            <a key={p} href={fileUrl(props.repo, props.branch, p)} target="_blank" rel="noreferrer">
              <code>{p}</code>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
