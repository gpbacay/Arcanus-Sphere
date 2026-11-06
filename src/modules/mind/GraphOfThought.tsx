"use client";

import { Network, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { closePane, pane } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtResult, ChainOfThoughtResults, ChainOfThoughtStep, ChainOfThoughtSubsteps } from "@/shared/ui/chain-of-thought";
import { clearMind, mind } from "./mind";
import { threads, type Row } from "./threads";

/** The live Graph of Thought pane, beside the rail. Rendered only while open, so a closed pane costs nothing. */
export function GraphOfThought() {
  const open = useStore(pane, (s) => s.open === "mind");
  return open ? <GraphPane /> : null;
}

const LONG = 320;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function GraphPane() {
  const thoughts = useStore(mind, (s) => s.thoughts);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // follow the newest thought unless you scrolled up to read
  const running = thoughts.filter((t) => t.status === "active").length; // threads running at once

  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [thoughts]);

  return (
    <section className="side-pane" aria-label="Graph of Thought">
      <header className="pane-head">
        <Network size={16} aria-hidden />
        <h2>Graph of Thought</h2>
        <span className="pane-sub" aria-live="polite">
          {running ? `${running} running` : "idle"} · {thoughts.length} thoughts
        </span>
        <button type="button" className="icon-btn" aria-label="Clear the graph" title="Clear" onClick={clearMind} style={{ marginLeft: "auto" }}>
          <Trash2 size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close Graph of Thought" onClick={closePane} style={{ marginLeft: 0 }}>
          <X size={16} />
        </button>
      </header>
      <div
        ref={body}
        className="pane-body"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {thoughts.length ? (
          threads(thoughts).map((thread) => (
            <div key={thread[0].t.id} className="got-train">
              <p className="got-when">{time(thread[0].t.at)}</p>
              <ChainOfThought bare>
                <ChainOfThoughtContent>
                  {thread.map((row) => (
                    <ThoughtNode key={row.t.id} rows={[row]} />
                  ))}
                </ChainOfThoughtContent>
              </ChainOfThought>
            </div>
          ))
        ) : (
          <p className="pane-note">
            Arcanus&apos;s mind, live: what it hears, recalls, decides, writes, checks and says, as it happens. Each thought is a node of
            ARCANE&apos;s Graph of Thought, and the thoughts it came from are its edges.
          </p>
        )}
      </div>
    </section>
  );
}

/** A thought, then what it set running in parallel as branches. A branch that goes on (`then`) nests one level in. */
function ThoughtNode({ rows: [{ t, branches }, ...then] }: { rows: Row[] }) {
  const sub = then.length ? [...branches, then] : branches;
  // The layout shows where a thought came from; only a join of several is spelled out.
  const from = t.parents.length > 1 ? `joins ${t.parents.join(" + ")}` : "";
  const took = t.ms !== undefined ? (t.ms < 1000 ? `${t.ms} ms` : `${(t.ms / 1000).toFixed(1)} s`) : "";
  const description = [t.detail, from, took, t.status === "failed" ? "failed" : ""].filter(Boolean).join(" · ");
  // A long reply: its newest words while it is being written, its opening once done.
  const long = t.content.length > LONG;
  const content = !long ? t.content : t.status === "active" ? `…${t.content.slice(-LONG)}` : `${t.content.slice(0, LONG)}…`;
  return (
    <ChainOfThoughtStep
      status={t.status === "active" ? "active" : "complete"}
      label={
        <>
          <span className="got-op" data-op={t.operation}>
            {t.id} · {t.operation}
          </span>{" "}
          {content || "…"}
        </>
      }
      description={description || undefined}
    >
      {t.results?.length ? (
        <ChainOfThoughtResults>
          {t.results.map((r, i) => (
            <ChainOfThoughtResult key={i}>{r}</ChainOfThoughtResult>
          ))}
        </ChainOfThoughtResults>
      ) : null}
      {sub.length ? (
        <ChainOfThoughtSubsteps>
          {sub.map((branch) => (
            <ThoughtNode key={branch[0].t.id} rows={branch} />
          ))}
        </ChainOfThoughtSubsteps>
      ) : null}
    </ChainOfThoughtStep>
  );
}
