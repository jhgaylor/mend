/**
 * Turning a selection of fixes into a pull request, from the browser.
 *
 * Three steps, each one visible: connect a GitHub token, have the agent draft
 * the description for exactly the ticked fixes, then open the PR — the app
 * itself reads the files, applies those fixes' diffs, commits and pushes. The
 * agent writes; the browser acts; the credential is the viewer's own.
 */
import { useEffect, useState } from "react";
import { buildChanges, mergePatches, PatchError } from "../lib/apply";
import { branchName, getViewer, GhError, openPullRequest, readFile, type OpenPrResult } from "../lib/gh";
import { clearGhAuth, loadGhAuth, saveGhAuth, TOKEN_URL, type GhAuth } from "../lib/ghauth";
import { refLabel, type RepoRef } from "../lib/hosts";
import type { Fix, PrDraft } from "../lib/protocol";

type Stage = "idle" | "working" | "done";

export function PrPanel(props: {
  repo: RepoRef;
  selected: Fix[];
  draft: PrDraft | null;
  /** Asks the agent to draft the description for the current selection. */
  onRequestDraft: () => void;
  /** True while the agent is working (drafting, or anything else). */
  agentBusy: boolean;
}) {
  const { repo, selected, draft } = props;
  const [auth, setAuth] = useState<GhAuth | null>(() => loadGhAuth());
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpenPrResult | null>(null);

  // A fresh draft from the agent replaces whatever is in the fields.
  useEffect(() => {
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
      setResult(null);
      setError(null);
    }
  }, [draft]);

  if (props.repo.host !== "github.com") {
    return (
      <section className="prpanel">
        <h3>Pull request</h3>
        <p className="fineprint">
          Opening a PR from the browser is GitHub-only for now — {refLabel(repo)} lives on {repo.host}. Download the
          patch above and apply it yourself.
        </p>
      </section>
    );
  }

  const connect = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setConnecting(true);
    setError(null);
    try {
      const viewer = await getViewer(token);
      const next: GhAuth = { token, login: viewer.login };
      if (viewer.avatarUrl) next.avatarUrl = viewer.avatarUrl;
      saveGhAuth(next);
      setAuth(next);
      setTokenInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    clearGhAuth();
    setAuth(null);
  };

  const open = async () => {
    if (!auth || !title.trim()) return;
    setStage("working");
    setError(null);
    setResult(null);
    try {
      const files = mergePatches(selected.map((f) => f.diff!).filter(Boolean));
      if (files.length === 0) throw new Error("Nothing selected to put in a pull request.");
      setStep("Reading the repository");
      const branch = branchName(Date.now());
      const changes = await buildChanges(files, (path) =>
        readFile(auth.token, `${repo.owner}/${repo.name}`, path, "HEAD"),
      );
      const res = await openPullRequest({
        token: auth.token,
        owner: repo.owner,
        repo: repo.name,
        changes,
        branch,
        title: title.trim(),
        body,
        commitMessage: `${title.trim()}\n\nFrom a chant audit via Mend (https://mend.inevitable.fyi).`,
        onStep: setStep,
      });
      setResult(res);
      setStage("done");
    } catch (err) {
      setStage("idle");
      if (err instanceof PatchError) {
        setError(`${err.message} The branch has moved since the audit — re-audit and mend again, or apply the patch by hand.`);
      } else if (err instanceof GhError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setStep(null);
    }
  };

  const fileCount = new Set(selected.flatMap((f) => f.files)).size;
  const busy = stage === "working";

  return (
    <section className="prpanel">
      <div className="prpanel-head">
        <h3>Pull request</h3>
        <span className="fineprint">
          {selected.length === 0
            ? "nothing selected"
            : `${selected.length} ${selected.length === 1 ? "fix" : "fixes"} · ${fileCount} ${fileCount === 1 ? "file" : "files"} → ${refLabel(repo)}`}
        </span>
      </div>

      {/* 1 — who opens it */}
      {auth ? (
        <div className="ghwho">
          {auth.avatarUrl && <img src={auth.avatarUrl} alt="" width={20} height={20} />}
          <span>
            Opening as <b>{auth.login}</b>
          </span>
          <button className="linkish" onClick={disconnect}>
            disconnect
          </button>
        </div>
      ) : (
        <div className="ghconnect">
          <p className="fineprint">
            The app opens the PR from your browser with your own GitHub token — nothing is stored on a server, and the
            pull request is authored by you.{" "}
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">
              Create one
            </a>{" "}
            with the <code>public_repo</code> scope.
          </p>
          <div className="ghconnect-row">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void connect()}
              placeholder="ghp_… or github_pat_…"
              aria-label="GitHub token"
            />
            <button className="primary" onClick={() => void connect()} disabled={connecting || !tokenInput.trim()}>
              {connecting ? "Checking…" : "Connect"}
            </button>
          </div>
        </div>
      )}

      {/* 2 — the description, written by the agent */}
      {draft === null ? (
        <button
          className="primary"
          onClick={props.onRequestDraft}
          disabled={props.agentBusy || selected.length === 0}
        >
          {props.agentBusy ? "The mender is writing…" : "Draft the PR description"}
        </button>
      ) : (
        <div className="prform">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </label>
          <label>
            Description
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} disabled={busy} />
          </label>
          <div className="prform-actions">
            <button className="linkish" onClick={props.onRequestDraft} disabled={props.agentBusy || busy}>
              redraft for the current selection
            </button>
            <button className="primary" onClick={() => void open()} disabled={!auth || busy || !title.trim() || selected.length === 0}>
              {busy ? step ?? "Working…" : "Open pull request"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="prdone">
          <a className="primary-link" href={result.url} target="_blank" rel="noreferrer">
            Pull request #{result.number} opened ↗
          </a>
          {result.forkedTo && <span className="fineprint">pushed to your fork {result.forkedTo}</span>}
        </div>
      )}
    </section>
  );
}
