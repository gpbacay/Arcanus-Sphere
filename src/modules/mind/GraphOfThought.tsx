"use client";

import { Network, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { closePane, pane } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { graphs, type Graph } from "./layout";
import { clearMind, mind, type Thought } from "./mind";

/** The live Graph of Thought pane, beside the rail. Rendered only while open, so a closed pane costs nothing. */
export function GraphOfThought() {
  const open = useStore(pane, (s) => s.open === "mind");
  return open ? <GraphPane /> : null;
}

const ROW = 54; // px from one layer to the next
const NODE = 30; // px: a node's height
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function GraphPane() {
  const thoughts = useStore(mind, (s) => s.thoughts);
  const [picked, setPicked] = useState<string | null>(null);
  const pick = useCallback((id: string) => setPicked((was) => (was === id ? null : id)), []);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // follow the newest thought unless you scrolled up to read
  const running = thoughts.filter((t) => t.status === "active").length; // threads running at once
  // The thought read out below the graph: the one you picked, else whatever is running, else the newest.
  const shown = thoughts.find((t) => t.id === picked) ?? thoughts.findLast((t) => t.status === "active") ?? thoughts.at(-1);

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
          graphs(thoughts).map((graph) => (
            <div key={graph.nodes[0].t.id} className="got-train">
              <p className="got-when">{time(graph.nodes[0].t.at)}</p>
              <GraphView graph={graph} shown={graph.nodes.some((n) => n.t.id === shown?.id) ? shown?.id : undefined} onPick={pick} />
            </div>
          ))
        ) : (
          <p className="pane-note">
            Arcanus&apos;s mind, live: what it hears, recalls, decides, writes, checks and says, as it happens. Each thought is a node of
            ARCANE&apos;s Graph of Thought, and the thoughts it came from are its edges.
          </p>
        )}
      </div>
      {shown ? <Detail t={shown} followed={!picked} /> : null}
    </section>
  );
}

/** One graph: its thoughts as nodes, layer by layer, and a curve from each thought down to every thought that came from it.
 *  Drawn again only when one of its own thoughts changed, or the thought being read out moved into or out of it. */
const GraphView = memo(
  GraphDrawing,
  (was, now) => was.shown === now.shown && was.graph.nodes.length === now.graph.nodes.length && was.graph.nodes.every((n, i) => n.t === now.graph.nodes[i].t),
);

function GraphDrawing({ graph, shown, onPick }: { graph: Graph; shown?: string; onPick: (id: string) => void }) {
  const at = new Map(graph.nodes.map((n) => [n.t.id, n]));
  const height = (graph.layers - 1) * ROW + NODE;
  return (
    <div className="got-graph" style={{ height }}>
      {/* x runs 0 to 100 across whatever width the pane has; y is in pixels. */}
      <svg className="got-edges" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
        {graph.edges.map(({ from, to }) => {
          const a = at.get(from)!;
          const b = at.get(to)!;
          const y1 = a.layer * ROW + NODE;
          const y2 = b.layer * ROW;
          const mid = (y1 + y2) / 2;
          return (
            <path
              key={`${from}-${to}`}
              d={`M${a.x * 100} ${y1} C${a.x * 100} ${mid} ${b.x * 100} ${mid} ${b.x * 100} ${y2}`}
              data-live={b.t.status === "active" || undefined}
              data-lit={from === shown || to === shown || undefined}
            />
          );
        })}
      </svg>
      {graph.nodes.map(({ t, layer, x, span }) => (
        <button
          key={t.id}
          type="button"
          className="got-node"
          data-status={t.status}
          data-tight={span < 0.3 || undefined}
          aria-pressed={t.id === shown}
          aria-label={`${t.operation}: ${t.content || "running"}`}
          title={[t.content, t.detail].filter(Boolean).join(" · ")}
          style={{ left: `${x * 100}%`, top: layer * ROW, width: `calc(${span * 100}% - 6px)` }}
          onClick={() => onPick(t.id)}
        >
          <span className="got-op" data-op={t.operation}>
            {t.operation}
          </span>
          <span className="got-text">{t.content || "…"}</span>
        </button>
      ))}
    </div>
  );
}

const LONG = 600;

/** The thought in full, under the graph: a node only has room for its first words. */
function Detail({ t, followed }: { t: Thought; followed: boolean }) {
  // A long reply: its newest words while it is being written, its opening once done.
  const long = t.content.length > LONG;
  const content = !long ? t.content : t.status === "active" ? `…${t.content.slice(-LONG)}` : `${t.content.slice(0, LONG)}…`;
  const facts = [
    t.detail,
    t.parents.length ? `from ${t.parents.join(" + ")}` : "a root",
    t.ms !== undefined ? took(t.ms) : t.status === "active" ? "running" : "",
    t.status === "failed" ? "failed" : "",
  ].filter(Boolean);
  return (
    <footer className="got-detail" aria-live={followed ? "off" : "polite"}>
      <p className="got-detail-head">
        <span className="got-op" data-op={t.operation}>
          {t.id} · {t.operation}
        </span>
        <span>{followed ? "following the newest thought" : "picked · tap it again to follow"}</span>
      </p>
      <p className="got-detail-text">{content || "…"}</p>
      <p className="got-detail-facts">{facts.join(" · ")}</p>
      {t.results?.length ? (
        <ul className="got-detail-results">
          {t.results.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
    </footer>
  );
}
