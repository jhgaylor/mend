/**
 * Mend: a rail of repositories, each with one mender (a Fountain teammate on
 * a computer that has chant and every audit lexicon installed) and one
 * conversation. The audit, the plan and the patch are all derived from turns
 * + protocol blocks; localStorage holds only settings and choices.
 * Streaming/reconnect follows jhgaylor/repo-sage / dns-desk.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, describeError, FountainClient } from "./api/client";
import type { Catalog, LogEvent, TeamEvent, Teammate, Turn } from "./api/types";
import { blocksForTurn } from "./lib/acp";
import { parseRepoInput, refKey, refLabel, repoUrl, type RepoRef } from "./lib/hosts";
import { completeLoginIfCallback, revoke } from "./lib/oauth";
import { foldThread, stripBlocks } from "./lib/protocol";
import { loadSelected, reconcileRepos, saveRepo, saveSelected } from "./lib/repos";
import { clearSettings, loadSettings, saveSettings, type Settings } from "./lib/settings";
import {
  agentDescription,
  agentName,
  AUDIT_PROMPT,
  ENVIRONMENT_NAME,
  environmentSpec,
  MEND_PROMPT,
  refOfAgentName,
  STARTERS,
  systemPrompt,
} from "./lib/spec";
import { Connect } from "./components/Connect";
import { Patch } from "./components/Patch";
import { Plan } from "./components/Plan";
import { Report } from "./components/Report";
import { Work, type ThreadEntry } from "./components/Work";

const STREAMS = ["acp", "stdout", "stage"];
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

type Phase = "boot" | "connect" | "app";

interface Mender {
  ref: RepoRef;
  key: string;
  teammate: Teammate;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [connectError, setConnectError] = useState<string | null>(null);

  const [team, setTeam] = useState<Teammate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const client = useMemo(() => (settings ? new FountainClient(settings) : null), [settings]);
  const catalogRef = useRef<Catalog | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 6000);
  }, []);

  // ── boot: OAuth callback, stored settings ─────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const cb = await completeLoginIfCallback();
        if (cb) {
          const s: Settings = { baseUrl: cb.baseUrl, apiKey: cb.apiKey, via: "oauth" };
          saveSettings(s);
          setSettings(s);
          return;
        }
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : String(err));
      }
      const stored = loadSettings();
      if (stored) setSettings(stored);
      else setPhase("connect");
    })();
  }, []);

  useEffect(() => {
    if (!settings) return;
    setSelected(loadSelected(settings.baseUrl));
    setPhase("app");
  }, [settings]);

  const signOut = useCallback(() => {
    if (settings?.via === "oauth") void revoke(settings.baseUrl, settings.apiKey);
    clearSettings();
    setSettings(null);
    setTeam(null);
    setSelected(null);
    setPhase("connect");
  }, [settings]);

  // ── the roster: every teammate named "Mend: host/owner/name" ─────────────

  const menders: Mender[] = useMemo(() => {
    const out: Mender[] = [];
    for (const t of team ?? []) {
      const ref = refOfAgentName(t.name);
      if (ref) out.push({ ref, key: refKey(ref), teammate: t });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }, [team]);

  const current = selected ? menders.find((m) => m.key === selected) ?? null : null;
  const convId = current?.teammate.conversation.id ?? null;
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = convId;

  const refreshTeam = useCallback(async () => {
    if (!client || !settings) return;
    try {
      const roster = await client.listTeam();
      setTeam(roster);
      const live: Record<string, string> = {};
      for (const t of roster) {
        const ref = refOfAgentName(t.name);
        if (ref) live[refKey(ref)] = t.agent_id;
      }
      reconcileRepos(settings.baseUrl, live);
    } catch (err) {
      say(describeError(err));
    }
  }, [client, settings, say]);

  useEffect(() => {
    if (phase === "app") void refreshTeam();
  }, [phase, refreshTeam]);

  // First roster in: land on the remembered repo, or the first mender.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (team === null || pickedRef.current) return;
    pickedRef.current = true;
    if (!selected && menders.length > 0) setSelected(menders[0]!.key);
  }, [team, menders, selected]);

  const select = useCallback(
    (key: string) => {
      setSelected(key);
      setTurns([]);
      setEvents([]);
      if (settings) saveSelected(settings.baseUrl, key);
    },
    [settings],
  );

  // ── the selected mender's thread ──────────────────────────────────────────

  const reloadThread = useCallback(async () => {
    if (!client || !convId) return;
    try {
      const [t, e] = await Promise.all([client.listTurns(convId), client.listAllEvents(convId, STREAMS)]);
      setTurns(t);
      setEvents(e);
    } catch (err) {
      say(describeError(err));
    }
  }, [client, convId, say]);

  useEffect(() => {
    if (convId) void reloadThread();
  }, [convId, reloadThread]);

  // ── stream: append live events, resync on turn boundaries ────────────────

  useEffect(() => {
    if (!client || phase !== "app") return;
    const ctrl = new AbortController();
    let lastEventId: string | null = null;
    let backoff = 1000;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      void client.streamTeam({
        lastEventId,
        streams: STREAMS,
        signal: ctrl.signal,
        onOpen: () => {
          setConnected(true);
          backoff = 1000;
          void refreshTeam();
          void reloadThread();
        },
        onMessage: (msg) => {
          if (msg.id) lastEventId = msg.id;
          if (msg.event === "team") {
            void refreshTeam();
            return;
          }
          let ev: TeamEvent;
          try {
            ev = JSON.parse(msg.data) as TeamEvent;
          } catch {
            return;
          }
          if (msg.id) ev.id = Number(msg.id);
          if (ev.conversation_id !== convIdRef.current) {
            // Another mender's turn ended → its unread flag moved; a new
            // conversation for the open mender (fresh computer) → re-point.
            if (ev.kind === "stage" && ev.stage === "turn" && ev.state !== "started") void refreshTeam();
            return;
          }
          setEvents((es) => (es.some((e) => e.id === ev.id) ? es : [...es, ev]));
          if (ev.kind === "stage" && ev.stage === "turn") {
            void client.listTurns(ev.conversation_id).then(setTurns).catch(() => undefined);
            if (ev.state !== "started") {
              void client.markRead(ev.conversation_id).catch(() => undefined);
              void refreshTeam();
            }
          }
        },
        onClose: () => {
          setConnected(false);
          if (stopped) return;
          window.setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 15000);
        },
      });
    };
    connect();
    return () => {
      stopped = true;
      ctrl.abort();
    };
  }, [client, phase, refreshTeam, reloadThread]);

  // ── derived: blocks per turn, the audit / plan / patch ─────────────────────

  const runtime = current?.teammate.conversation.runtime ?? "claude";
  const thread: ThreadEntry[] = useMemo(() => {
    const sorted = [...turns].sort((a, b) => a.turn_number - b.turn_number);
    const byTurn = new Map<string, LogEvent[]>();
    for (const ev of events) {
      if (!ev.turn_id) continue;
      const list = byTurn.get(ev.turn_id);
      if (list) list.push(ev);
      else byTurn.set(ev.turn_id, [ev]);
    }
    return sorted.map((turn) => {
      const blocks = blocksForTurn(byTurn.get(turn.id) ?? [], runtime);
      const reply = blocks
        .filter((b): b is Extract<(typeof blocks)[number], { kind: "text" }> => b.kind === "text")
        .map((b) => b.body)
        .join("");
      return { turn, blocks, reply };
    });
  }, [turns, events, runtime]);

  const view = useMemo(() => foldThread(thread), [thread]);
  const working = thread.some((t) => t.turn.ended_at === null && t.turn.status !== "failed");
  const settled = thread.length > 0 && !working;
  const auditFailed = view.report === null && settled;

  // ── actions ───────────────────────────────────────────────────────────────

  /** Send a prompt, retrying through 503s while the computer provisions. */
  const drive = useCallback(
    async (agentId: string, prompt: string, patience = 24) => {
      if (!client) return;
      setBusy(true);
      try {
        for (let i = 0; i < patience; i++) {
          try {
            await client.sendMessage(agentId, prompt);
            await Promise.all([refreshTeam(), reloadThread()]);
            return;
          } catch (err) {
            if (err instanceof ApiError && err.status === 503) {
              await sleep(Math.min(err.retryAfter ?? 10, 15) * 1000);
              continue;
            }
            throw err;
          }
        }
        say("The mender's computer took too long to start — try again in a moment.");
      } catch (err) {
        say(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [client, refreshTeam, reloadThread, say],
  );

  /** The shared toolkit environment: chant + every lexicon, made once per Fountain. */
  const ensureEnvironment = useCallback(async (): Promise<string | undefined> => {
    if (!client) return undefined;
    try {
      const existing = (await client.listEnvironments()).find((e) => e.name === ENVIRONMENT_NAME);
      if (existing) return existing.id;
      return (await client.createEnvironment(environmentSpec())).id;
    } catch (err) {
      // A mender without the toolkit still works — it falls back to npx.
      say(`Could not set up the ${ENVIRONMENT_NAME} environment (${describeError(err)}); the mender will fetch chant with npx instead.`);
      return undefined;
    }
  }, [client, say]);

  const addRepo = useCallback(
    async (input: string) => {
      if (!client || !settings) return;
      const ref = parseRepoInput(input);
      if (!ref) {
        say("That doesn't look like a repo — use owner/name, or a URL on github.com, gitlab.com or codeberg.org. Public repos only.");
        return;
      }
      const key = refKey(ref);
      if (menders.some((m) => m.key === key)) {
        select(key);
        return;
      }
      setAdding(key);
      try {
        const name = agentName(ref);
        // Reuse an agent left over from an earlier run; otherwise create one.
        let agent = (await client.listAgents(name)).find((a) => a.name === name);
        const environmentId = await ensureEnvironment();
        if (!agent) {
          if (!catalogRef.current) catalogRef.current = await client.getCatalog().catch(() => null);
          const models = Object.values(catalogRef.current?.models ?? {}).flat();
          const model = models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models.find((m) => m.startsWith("anthropic/")) ?? DEFAULT_MODEL;
          agent = await client.createAgent({
            name,
            description: agentDescription(ref),
            model,
            runtime: "claude",
            system: systemPrompt(ref),
            ...(environmentId ? { environment_id: environmentId } : {}),
          });
        }
        await client.addTeammate({ agent_id: agent.id, name, ...(environmentId ? { environment_id: environmentId } : {}) });
        saveRepo(settings.baseUrl, key, agent.id);
        await refreshTeam();
        select(key);
        void drive(agent.id, AUDIT_PROMPT);
      } catch (err) {
        say(describeError(err));
      } finally {
        setAdding(null);
      }
    },
    [client, settings, menders, select, refreshTeam, ensureEnvironment, drive, say],
  );

  const retire = useCallback(
    async (mender: Mender) => {
      if (!client || !settings) return;
      if (!window.confirm(`Retire the mender for ${refLabel(mender.ref)}? Its computer, clone and patch go away; the conversation stays in Fountain.`)) return;
      try {
        await client.removeTeammate(mender.teammate.agent_id);
        if (selected === mender.key) {
          setSelected(null);
          saveSelected(settings.baseUrl, null);
        }
        await refreshTeam();
      } catch (err) {
        say(describeError(err));
      }
    },
    [client, settings, selected, refreshTeam, say],
  );

  // ── render ────────────────────────────────────────────────────────────────

  if (phase === "boot") return <div className="setup" />;
  if (phase === "connect" || !settings || !client)
    return (
      <Connect
        error={connectError}
        onPaste={(s) => {
          saveSettings(s);
          setConnectError(null);
          setSettings(s);
        }}
      />
    );

  const pendingKey = adding && !menders.some((m) => m.key === adding) ? adding : null;
  const agentId = current?.teammate.agent_id ?? null;
  const canDrive = !busy && !working && agentId !== null;

  return (
    <div className="app">
      <aside className="rail">
        <div className="wordmark small">
          Mend<span>.</span>
        </div>
        <nav className="repolist">
          {menders.map((m) => (
            <button key={m.key} className={m.key === selected ? "repobtn active" : "repobtn"} onClick={() => select(m.key)}>
              <code>{refLabel(m.ref)}</code>
              <span className="repostate">
                {m.teammate.unread && m.key !== selected && <i className="unread" />}
                {m.teammate.presence.state === "working" ? "working" : ""}
              </span>
            </button>
          ))}
          {pendingKey && (
            <div className="repobtn pending">
              <code>{pendingKey}</code>
              <span className="repostate">hiring…</span>
            </div>
          )}
          {team !== null && menders.length === 0 && !pendingKey && <p className="fineprint">No repos yet.</p>}
        </nav>
        <AddRepoForm disabled={adding !== null} onAdd={(v) => void addRepo(v)} />
        <div className="rail-foot">
          <span className={connected ? "dot on" : "dot"} title={connected ? "live" : "reconnecting"} />
          <button className="linkish" onClick={signOut}>
            sign out
          </button>
          <p className="fineprint">
            Audits by <a href="https://intentius.io/chant/cli/audit/">chant</a> · runs on{" "}
            <a href="https://github.com/BinaryBourbon/fountain">Fountain</a> ·{" "}
            <a href="https://github.com/jhgaylor/mend">source</a>
          </p>
        </div>
      </aside>

      <main className="main">
        {toast && <div className="toast">{toast}</div>}
        {current ? (
          <>
            <header className="repo-head">
              <a href={repoUrl(current.ref)} target="_blank" rel="noreferrer">
                <code>{refLabel(current.ref)}</code>
              </a>
              <span className="fineprint">{working ? "working…" : current.teammate.presence.label}</span>
              {view.report && (
                <button className="linkish" disabled={!canDrive} onClick={() => agentId && void drive(agentId, AUDIT_PROMPT)}>
                  re-audit
                </button>
              )}
              <button className="linkish" onClick={() => void retire(current)}>
                retire
              </button>
            </header>

            <div className="scroll">
              {view.report === null && !settled && (
                <div className="status-card">
                  <p>
                    The mender is getting a computer, cloning <code>{refLabel(current.ref)}</code>, and running{" "}
                    <code>chant audit</code> over its CI, manifests and templates. The report lands here when it is done.
                  </p>
                </div>
              )}
              {auditFailed && (
                <div className="status-card failed">
                  <p>{lastProse(thread) || "The mender could not audit this repository."}</p>
                  <div className="status-actions">
                    <button className="primary" disabled={!canDrive} onClick={() => agentId && void drive(agentId, AUDIT_PROMPT)}>
                      Retry
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void retire(current)}>
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {view.report && (
                <Report
                  report={view.report}
                  repo={current.ref}
                  onMend={
                    view.report.summary.quickWin + view.report.summary.needsReview > 0
                      ? () => agentId && void drive(agentId, MEND_PROMPT)
                      : undefined
                  }
                  mendLabel={view.plan ? "Mend again" : "Mend it"}
                  mendDisabled={!canDrive}
                />
              )}

              {view.plan && <Plan plan={view.plan} repo={current.ref} branch={view.report?.branch ?? "main"} />}
              {view.patch !== null && <Patch patch={view.patch} repo={current.ref} />}

              <Work thread={thread} working={working} />

              {view.plan && !working && (
                <div className="starters">
                  {STARTERS.map((q) => (
                    <button key={q} className="starter" disabled={!canDrive} onClick={() => agentId && void drive(agentId, q, 1)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Composer
              disabled={busy || working || agentId === null}
              working={working}
              placeholder={
                view.plan
                  ? "Ask for a change — “drop fix 3”, “explain the riskiest one”, “open a PR”"
                  : `Ask about the audit of ${refLabel(current.ref)}`
              }
              onSend={(text) => agentId && void drive(agentId, text, 1)}
            />
          </>
        ) : (
          <div className="hero">
            <div className="hero-card">
              <h1>Find the misconfigurations. Then fix them.</h1>
              <p>
                Name a public repo. A mender — an agent on its own computer — clones it, runs a{" "}
                <a href="https://intentius.io/chant/cli/audit/">chant audit</a> over the CI workflows, Kubernetes
                manifests, Dockerfiles, Helm charts and cloud templates, then applies the mechanical fixes, reasons
                through the judgement calls, and hands you one patch.
              </p>
              <AddRepoForm big disabled={adding !== null} onAdd={(v) => void addRepo(v)} />
              {pendingKey && (
                <p className="fineprint">
                  Hiring a mender for <code>{pendingKey}</code>…
                </p>
              )}
              <p className="fineprint">
                Same engine as <a href="https://blacklight.intentius.io">blacklight</a> — github.com, gitlab.com and
                codeberg.org, public repos only.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AddRepoForm(props: { onAdd: (value: string) => void; disabled: boolean; big?: boolean }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    props.onAdd(value);
    setValue("");
  };
  return (
    <form className={props.big ? "addrepo big" : "addrepo"} onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="owner/name or a repo URL"
        disabled={props.disabled}
        aria-label="repository"
      />
      <button type="submit" className="primary" disabled={props.disabled || !value.trim()}>
        {props.disabled ? "…" : "Audit"}
      </button>
    </form>
  );
}

function Composer(props: { onSend: (text: string) => void; disabled: boolean; working: boolean; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (!draft.trim() || props.disabled) return;
    props.onSend(draft.trim());
    setDraft("");
  };
  return (
    <div className="composer">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      <button className="primary" onClick={submit} disabled={props.disabled || !draft.trim()}>
        {props.working ? "Working…" : "Send"}
      </button>
    </div>
  );
}

/** The agent's last words, for the audit-failed card. */
function lastProse(thread: ThreadEntry[]): string {
  for (let i = thread.length - 1; i >= 0; i--) {
    const prose = stripBlocks(thread[i]!.reply);
    if (prose) return prose;
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
