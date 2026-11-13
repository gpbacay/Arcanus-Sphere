"use client";

import { ChevronDown, Network, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { closePane, pane } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { processes, type Process, type Step } from "./layout";
import { clearMind, mind, type Thought } from "./mind";

/** The live Graph of Thought pane, beside the rail. Rendered only while open, so a closed pane costs nothing. */
export function GraphOfThought() {
  const open = useStore(pane, (s) => s.open === "mind");
  return open ? <GraphPane /> : null;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

function GraphPane() {
  const thoughts = useStore(mind, (s) => s.thoughts);
  // The thought you picked: the thoughts it came from light up, which is how an edge that isn't a rail is read.
  const [picked, setPicked] = useState<string | null>(null);
  const pick = useCallback((id: string) => setPicked((was) => (was === id ? null : id)), []);
  // A process is open while it runs, and the newest one stays open; opening or closing one yourself overrides that.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // follow the newest thought unless you scrolled up to read
  const all = processes(thoughts);
  const running = thoughts.filter((t) => t.status === "active").length; // threads running at once
  const sources = thoughts.find((t) => t.id === picked)?.parents ?? [];
  const newest = all.at(-1)?.root.id;

  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [thoughts]);

  const group = (title: string, list: Process[]) =>
    list.length ? (
      <section className="got-group" aria-label={title}>
        <h3>{title}</h3>
        {list.map((p) => {
          const open = chosen[p.root.id] ?? (p.active > 0 || p.root.id === newest);
          return <ProcessView key={p.root.id} p={p} open={open} picked={picked} sources={sources} onPick={pick} onToggle={() => setChosen((c) => ({ ...c, [p.root.id]: !open }))} />;
        })}
      </section>
    ) : null;

  return (
    <section className="side-pane mind-pane" aria-label="Graph of Thought">
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
          <>
            {group("Initialization", all.filter((p) => p.init))}
            {group("Conversation", all.filter((p) => !p.init))}
          </>
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

type Picking = { picked: string | null; sources: string[]; onPick: (id: string) => void };

/** One process as an accordion: its root thought is the heading, and opening it shows every thought that grew from it, in full. */
function ProcessView({ p, open, onToggle, ...picking }: { p: Process; open: boolean; onToggle: () => void } & Picking) {
  const { root } = p;
  const state = p.active ? "active" : p.failed ? "failed" : "complete";
  const meta = [
    time(root.at),
    `${p.count} ${p.count === 1 ? "thought" : "thoughts"}`,
    p.active ? `${p.active} running` : root.ms !== undefined ? took(root.ms) : "",
    p.failed ? `${p.failed} failed` : "",
    root.detail,
  ].filter(Boolean);
  return (
    <article className="got-proc" data-status={state}>
      <button type="button" className="got-proc-head" aria-expanded={open} aria-controls={`got-${root.id}`} data-thought={`${root.operation}: ${root.content}`} data-status={root.status} data-source={picking.sources.includes(root.id) || undefined} onClick={onToggle}>
        <span className="got-op" data-op={root.operation}>
          {root.operation}
        </span>
        <span className="got-proc-title">{root.content || "…"}</span>
        <ChevronDown size={15} aria-hidden className="got-chevron" />
        <span className="got-facts">{meta.join(" · ")}</span>
      </button>
      {open && p.steps.length ? (
        <div id={`got-${root.id}`} className="got-proc-body">
          <Rail steps={p.steps} {...picking} />
        </div>
      ) : null}
    </article>
  );
}

function Rail({ steps, ...picking }: { steps: Step[] } & Picking) {
  return (
    <ol className="got-rail">
      {steps.map((s) => (
        <li key={s.t.id} className="got-step" data-status={s.t.status}>
          <Row t={s.t} joins={s.joins.join(" + ")} picked={picking.picked === s.t.id} source={picking.sources.includes(s.t.id)} onPick={picking.onPick} />
          {s.branches.length ? <Rail steps={s.branches} {...picking} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** One thought, whole: what it did, every word of it, how long it took, and what it found. Drawn again only when it changed. */
const Row = memo(function Row({ t, joins, picked, source, onPick }: { t: Thought; joins: string; picked: boolean; source: boolean; onPick: (id: string) => void }) {
  const facts = [t.detail, joins ? `joins ${joins}` : "", t.status === "failed" ? "failed" : ""].filter(Boolean);
  return (
    <button
      type="button"
      className="got-row"
      data-thought={`${t.operation}: ${t.content}`}
      data-status={t.status}
      data-source={source || undefined}
      aria-pressed={picked}
      title={t.parents.length ? `Came from ${t.parents.join(" + ")}. Select to light them up.` : undefined}
      onClick={() => onPick(t.id)}
    >
      <span className="got-row-head">
        <span className="got-op" data-op={t.operation}>
          {t.operation}
        </span>
        <span className="got-id">{t.id}</span>
        <span className="got-ms">{t.ms !== undefined ? took(t.ms) : t.status === "active" ? "running" : ""}</span>
      </span>
      <span className="got-text">{t.content || "…"}</span>
      {facts.length ? <span className="got-facts">{facts.join(" · ")}</span> : null}
      {t.results?.length ? (
        <span className="got-results">
          {t.results.map((r, i) => (
            <span key={i}>{r}</span>
          ))}
        </span>
      ) : null}
    </button>
  );
});
