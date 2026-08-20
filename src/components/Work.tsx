/**
 * The work log: what the mender said and did, turn by turn — prose bubbles
 * with the protocol blocks stripped out, and a chip per tool call as it
 * clones, greps, patches and re-audits. Watching it work is half the demo.
 */
import { useEffect, useRef } from "react";
import type { Turn } from "../api/types";
import type { Block } from "../lib/acp";
import { stripBlocks } from "../lib/protocol";
import { AUDIT_PROMPT, MEND_PROMPT } from "../lib/spec";

export interface ThreadEntry {
  turn: Turn;
  blocks: Block[];
  reply: string;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  [AUDIT_PROMPT]: "running the audit",
  [MEND_PROMPT]: "mending",
};

export function Work(props: { thread: ThreadEntry[]; working: boolean }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const count = props.thread.reduce((n, e) => n + e.blocks.length, 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count, props.working]);

  if (props.thread.length === 0) return null;

  return (
    <section className="work">
      <h3>Work log</h3>
      {props.thread.map(({ turn, blocks }) => {
        const note = SYSTEM_PROMPTS[turn.prompt];
        return (
          <div key={turn.id} className="entry">
            {note ? <div className="work-note">{note}</div> : <div className="bubble you">{turn.prompt}</div>}
            {blocks.map((b, i) => {
              if (b.kind === "tool") {
                return (
                  <span key={i} className={`toolchip tool-${b.status}`} title={b.output ? b.output.slice(0, 400) : undefined}>
                    <i />
                    {b.name}
                    {b.summary && <code>{b.summary}</code>}
                  </span>
                );
              }
              if (b.kind !== "text") return null;
              const prose = stripBlocks(b.body);
              if (!prose) return null;
              return (
                <div key={i} className="bubble them">
                  {prose}
                </div>
              );
            })}
            {turn.ended_at === null && turn.status !== "failed" && <div className="state-note">working…</div>}
          </div>
        );
      })}
      <div ref={endRef} />
    </section>
  );
}
