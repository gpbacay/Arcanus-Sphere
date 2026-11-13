"use client";

import { ChevronDown, ChevronUp, EllipsisVertical, Network, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { usePlace, type Section } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { PaneControls } from "@/shared/ui/pane-controls";
import { processes, type Process, type Step } from "./layout";
import { clearMind, mind, type Thought } from "./mind";

/** The live Graph of Thought pane, beside the rail. Rendered only while open, so a closed pane costs nothing. */
export function GraphOfThought() {
  const { home, at, wide } = usePlace("mind");
  return home ? <GraphPane at={at} wide={wide} /> : null;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

function GraphPane({ at, wide }: { at: Section | null; wide: boolean }) {
  const thoughts = useStore(mind, (s) => s.thoughts);
  // The thought you picked: the thoughts it came from light up, which is how an edge that isn't a rail is read.
  const [picked, setPicked] = useState<string | null>(null);
  const pick = useCallback((id: string) => setPicked((was) => (was === id ? null : id)), []);
  // A process is open while it runs, and the newest one stays open; opening or closing one yourself overrides that.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [min, setMin] = useState(false);
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

  const latest = thoughts.at(-1);
  return (
    <section className="side-pane mind-pane" aria-label="Graph of Thought" data-min={min || undefined} data-at={at ?? undefined} data-wide={wide || undefined} hidden={!at}>
      <header className="pane-head">
        <Network size={16} aria-hidden />
        <h2>Graph of Thought</h2>
        <span className="pane-sub" aria-live="polite">
          {running ? `${running} running` : "idle"} · {thoughts.length} thoughts
        </span>
        <GraphMenu />
        <button type="button" className="icon-btn" aria-label={min ? "Expand Graph of Thought" : "Minimize Graph of Thought"} title={min ? "Expand" : "Minimize"} aria-expanded={!min} onClick={() => setMin((v) => !v)}>
          {min ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <PaneControls page="mind" title="Graph of Thought" />
      </header>
      <div
        ref={body}
        className="pane-body"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {/* Minimized: the newest thought alone, on its node, under the header. */}
        {min && latest ? (
          <ol className="got-rail got-latest">
            <li className="got-step" data-status={latest.status}>
              <Row t={latest} joins="" picked={picked === latest.id} source={sources.includes(latest.id)} onPick={pick} />
            </li>
          </ol>
        ) : thoughts.length ? (
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

/** The pane's ⋮ menu: what changes the graph itself, kept out of the header so it isn't pressed by mistake. */
function GraphMenu() {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="got-tools" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label="Graph of Thought options" title="Options" onClick={() => setOpen((v) => !v)}>
        <EllipsisVertical size={16} />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="menu got-menu" aria-label="Graph of Thought options">
          <button
            type="button"
            role="menuitem"
            className="menu-item danger"
            onClick={() => {
              clearMind();
              setOpen(false);
            }}
          >
            <span>Clear the graph</span>
            <Trash2 size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Picking ={ picked: string | null; sources: string[]; onPick: (id: string) => void };

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
