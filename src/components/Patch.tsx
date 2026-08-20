/**
 * The patch: one collapsible block per file, hunks rendered as a diff, and
 * the whole thing copyable or downloadable — `git apply` on your machine is
 * the last step, and it happens on your machine, not ours.
 */
import { useState } from "react";
import { copyText, triggerDownload } from "../lib/download";
import { parseDiff, pathOf, patchFilename, type FileDiff } from "../lib/diff";
import { refLabel, type RepoRef } from "../lib/hosts";

export function Patch(props: { patch: string; repo: RepoRef }) {
  const files = parseDiff(props.patch);
  const [copied, setCopied] = useState(false);

  if (props.patch.trim() === "" || files.length === 0) {
    return (
      <section className="patch">
        <div className="patch-head">
          <h3>Patch</h3>
          <span className="fineprint">nothing to apply</span>
        </div>
      </section>
    );
  }

  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const label = refLabel(props.repo);

  return (
    <section className="patch">
      <div className="patch-head">
        <h3>Patch</h3>
        <span className="fineprint">
          {`${files.length} ${files.length === 1 ? "file" : "files"} · `}
          <i className="plus">{`+${additions}`}</i>{" "}
          <i className="minus">{`−${deletions}`}</i>
        </span>
        <div className="patch-actions">
          <button
            onClick={() =>
              void copyText(props.patch).then((ok) => {
                setCopied(ok);
                window.setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="primary" onClick={() => triggerDownload(patchFilename(label), "text/x-patch", props.patch + "\n")}>
            Download .patch
          </button>
        </div>
      </div>
      <p className="apply-hint">
        <code>{`git apply ${patchFilename(label)}`}</code> in a clean checkout of <code>{label}</code>.
      </p>
      {files.map((f, i) => (
        <FileBlock key={pathOf(f) + i} file={f} defaultOpen={files.length <= 3} />
      ))}
    </section>
  );
}

function FileBlock(props: { file: FileDiff; defaultOpen: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen);
  const f = props.file;
  return (
    <div className="filediff">
      <button className="filediff-head" onClick={() => setOpen((v) => !v)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <code>{pathOf(f)}</code>
        {f.status !== "modified" && <span className={`fstatus ${f.status}`}>{f.status}</span>}
        <span className="counts">
          <i className="plus">{`+${f.additions}`}</i> <i className="minus">{`−${f.deletions}`}</i>
        </span>
      </button>
      {open && (
        <div className="hunks">
          {f.hunks.map((h, i) => (
            <div key={i} className="hunk">
              <div className="hunk-header">{h.header}</div>
              {h.lines.map((l, j) => (
                <div key={j} className={`dline ${l.kind}`}>
                  <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span className="dtext">{l.text || " "}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
