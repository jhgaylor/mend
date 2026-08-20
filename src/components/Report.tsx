/**
 * The audit, laid out the way a chant report is: counts across the top,
 * quick wins by file, guidance clustered by the standard it cites, hygiene
 * folded away. Every rule id links to its entry in the rules reference.
 */
import { useState } from "react";
import { copyText } from "../lib/download";
import { fileUrl, type RepoRef } from "../lib/hosts";
import { arrangeReport, ruleDocUrl, type AuditReport, type Finding } from "../lib/protocol";
import { coverage } from "../lib/rulesets";
import { LOCAL_AUDIT_COMMAND } from "../lib/spec";

export function Report(props: { report: AuditReport; repo: RepoRef; onMend?: () => void; mendLabel?: string; mendDisabled?: boolean }) {
  const { report, repo } = props;
  const { quickWins, needsReview, reportOnly } = arrangeReport(report);
  const s = report.summary;
  const branch = report.branch ?? "main";
  const [openHygiene, setOpenHygiene] = useState(false);
  const [openHow, setOpenHow] = useState(false);
  const [copied, setCopied] = useState(false);
  const catalogs = coverage(report.findings);
  const spoke = catalogs.filter((c) => c.count > 0).length;

  return (
    <section className="report">
      <div className="chantbar">
        <span className="chantmark">
          <b>chant</b> audit
        </span>
        <span className="fineprint">
          {report.scanned !== undefined ? `read ${report.scanned} files` : "read this repo"}
          {` with all ${catalogs.length} rule catalogs — ${spoke === 0 ? "none had anything to say" : `${spoke} had something to say`}`}
        </span>
        <button className="linkish" onClick={() => setOpenHow((v) => !v)}>
          run this yourself
        </button>
      </div>
      {openHow && (
        <div className="howto">
          <p className="fineprint">
            The audit is a CLI — the agent just ran it on a computer of its own. In any checkout:
          </p>
          <div className="cmdrow">
            <code>{LOCAL_AUDIT_COMMAND}</code>
            <button
              onClick={() =>
                void copyText(LOCAL_AUDIT_COMMAND).then((ok) => {
                  setCopied(ok);
                  window.setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="fineprint">
            Same engine behind <a href="https://blacklight.intentius.io">blacklight</a>. Docs:{" "}
            <a href="https://intentius.io/chant/cli/audit/">chant audit</a> ·{" "}
            <a href="https://intentius.io/chant/lint-rules/audit-rules/">every rule</a>.
          </p>
        </div>
      )}

      <div className="rulesets">
        {catalogs.map((c) => (
          <span
            key={c.id}
            className={c.count > 0 ? "ruleset spoke" : "ruleset quiet"}
            title={
              c.count > 0
                ? `${c.count} finding${c.count === 1 ? "" : "s"} from chant's ${c.prefixes.join("/")}* rules — reads ${c.reads}`
                : `chant ran its ${c.prefixes.join("/")}* rules and found nothing — reads ${c.reads}`
            }
          >
            {c.name}
            <i>{c.prefixes[0]}</i>
            <b>{c.count > 0 ? c.count : "—"}</b>
          </span>
        ))}
      </div>

      <div className="report-head">
        <div className="tiers">
          <Tier n={s.quickWin} label="quick wins" tone="ok" />
          <Tier n={s.needsReview} label="needs review" tone="warn" />
          <Tier n={s.reportOnly} label="hygiene" tone="mute" />
        </div>
        <div className="report-meta">
          {report.scanned !== undefined && <span>{`${report.scanned} files scanned`}</span>}
          <span>{`${s.security} security · ${s.correctness} correctness · ${s.bestPractice} best-practice`}</span>
          {report.commit && (
            <code className="commit" title={report.commit}>{`${branch}@${report.commit.slice(0, 7)}`}</code>
          )}
        </div>
        {props.onMend && (
          <button className="primary mend-btn" onClick={props.onMend} disabled={props.mendDisabled}>
            {props.mendLabel ?? "Mend it"}
          </button>
        )}
      </div>

      {s.total === 0 && <p className="clean">Nothing to fix — chant found no findings in this repo's config.</p>}

      {quickWins.length > 0 && (
        <div className="tier-block">
          <h3>
            Quick wins <span className="fineprint">chant knows the exact fix and ships the diff</span>
          </h3>
          {quickWins.map((qw) => (
            <div key={qw.file} className="filegroup">
              <a className="filename" href={fileUrl(repo, branch, qw.file)} target="_blank" rel="noreferrer">
                <code>{qw.file}</code>
              </a>
              <ul className="findinglist">
                {qw.findings.map((f, i) => (
                  <FindingRow key={`${f.checkId}:${f.entity ?? i}`} finding={f} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {needsReview.length > 0 && (
        <div className="tier-block">
          <h3>
            Needs review <span className="fineprint">chant will not guess — this is the part an agent can do for you</span>
          </h3>
          {needsReview.map((cluster) => (
            <div key={cluster.name} className="cluster">
              <div className="cluster-name">
                {cluster.url ? (
                  <a href={cluster.url} target="_blank" rel="noreferrer">
                    {cluster.name}
                  </a>
                ) : (
                  cluster.name
                )}
              </div>
              {cluster.rules.map((rule) => (
                <div key={rule.checkId} className="rule">
                  <div className="rule-head">
                    <a className="ruleid" href={ruleDocUrl(rule.checkId)} target="_blank" rel="noreferrer">
                      {rule.checkId}
                    </a>
                    <b>{rule.title}</b>
                  </div>
                  {rule.remediation && <p className="remediation">{rule.remediation}</p>}
                  <ul className="findinglist">
                    {rule.findings.map((f, i) => (
                      <li key={`${f.file}:${f.entity ?? i}`} className={`finding sev-${f.severity}`}>
                        <a href={fileUrl(repo, branch, f.file)} target="_blank" rel="noreferrer">
                          <code>{f.file}</code>
                        </a>
                        {f.entity && <span className="entity">{f.entity}</span>}
                        <span className="msg">{f.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {reportOnly.length > 0 && (
        <div className="tier-block">
          <button className="disclosure" onClick={() => setOpenHygiene((v) => !v)}>
            {`${openHygiene ? "▾" : "▸"} Hygiene — ${reportOnly.length} not worth a PR`}
          </button>
          {openHygiene && (
            <ul className="findinglist hygiene">
              {reportOnly.map((f, i) => (
                <FindingRow key={`${f.checkId}:${f.file}:${i}`} finding={f} showFile repo={repo} branch={branch} />
              ))}
            </ul>
          )}
        </div>
      )}

      {report.omitted > 0 && (
        <p className="fineprint omitted">{`${report.omitted} further findings were left out of the report block to keep it small — the full audit is on the mender's computer.`}</p>
      )}
    </section>
  );
}

function FindingRow(props: { finding: Finding; showFile?: boolean; repo?: RepoRef; branch?: string }) {
  const f = props.finding;
  return (
    <li className={`finding sev-${f.severity}`}>
      <a className="ruleid" href={ruleDocUrl(f.checkId)} target="_blank" rel="noreferrer">
        {f.checkId}
      </a>
      <b>{f.title}</b>
      {props.showFile && props.repo && (
        <a href={fileUrl(props.repo, props.branch ?? "main", f.file)} target="_blank" rel="noreferrer">
          <code>{f.file}</code>
        </a>
      )}
      {f.entity && <span className="entity">{f.entity}</span>}
      <span className="msg">{f.message}</span>
    </li>
  );
}

function Tier(props: { n: number; label: string; tone: "ok" | "warn" | "mute" }) {
  return (
    <div className={`tier tone-${props.tone}`}>
      <b>{props.n}</b>
      <span>{props.label}</span>
    </div>
  );
}
