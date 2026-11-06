"use client";

import { Network, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { closePane, pane } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtResult, ChainOfThoughtResults, ChainOfThoughtStep } from "@/shared/ui/chain-of-thought";
import { clearMind, mind, type Thought } from "./mind";

/** The live Graph of Thought pane, beside the rail. Rendered only while open, so a closed pane costs nothing. */
export function GraphOfThought() {
  const open = useStore(pane, (s) => s.open === "mind");
  return open ? <GraphPane /> : null;
}

const LONG = 320;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Thoughts in trains: each root (a wake, a message) with everything that grew from it, in order. */
function trains(thoughts: Thought[]) {
  const rootOf = new Map<string, string>();
  const out = new Map<string, Thought[]>();
  for (const t of thoughts) {
    const root = (t.parents[0] && rootOf.get(t.parents[0])) || t.id;
    rootOf.set(t.id, root);
    out.set(root, [...(out.get(root) ?? []), t]);
  }
  return [...out.values()];
}

function GraphPane() {
  const thoughts = useStore(mind, (s) => s.thoughts);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // follow the newest thought unless you scrolled up to read
  const live = thoughts.some((t) => t.status === "active");

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
          {live ? "thinking" : "idle"} · {thoughts.length} thoughts
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
          trains(thoughts).map((train) => (
            <div key={train[0].id} className="got-train">
              <p className="got-when">{time(train[0].at)}</p>
              <ChainOfThought bare>
                <ChainOfThoughtContent>
                  {train.map((t, i) => (
                    <ThoughtNode key={t.id} t={t} previous={train[i - 1]?.id} />
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

function ThoughtNode({ t, previous }: { t: Thought; previous?: string }) {
  // Edges worth spelling out: a merge of several thoughts, or a branch back to an earlier one.
  const from = t.parents.length > 1 || (t.parents[0] && t.parents[0] !== previous) ? `from ${t.parents.join(" + ")}` : "";
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
    </ChainOfThoughtStep>
  );
}
