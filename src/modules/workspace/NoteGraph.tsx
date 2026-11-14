"use client";

// The graph view, as Obsidian has it: every note a dot, every [[link]] a line, linked notes pulled together. The note
// open in the editor is lit; pointing at a dot lights it and the notes beside it. Click a dot to open its note (a dot
// for a note not written yet makes it). Drag to move around, the wheel to zoom.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, useStore } from "@/shared/store";
import { workspace } from "./fs";
import { openFile } from "./ide";
import { layout, neighbors, type Graph } from "./links";
import { noteGraph, openNote } from "./notes";

type Box = { x: number; y: number; w: number; h: number };

export function NoteGraph({ current }: { current: string }) {
  const version = useStore(workspace, (s) => s.version);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<Box | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    noteGraph().then((g) => live && setGraph(g), (err) => live && setError(errorText(err)));
    return () => void (live = false);
  }, [version]);

  const at = useMemo(() => (graph ? layout(graph) : new Map<string, { x: number; y: number }>()), [graph]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const [a, b] of graph?.edges ?? []) for (const id of [a, b]) d.set(id, (d.get(id) ?? 0) + 1);
    return d;
  }, [graph]);
  const fit = useMemo((): Box => {
    const xs = [...at.values()].map((p) => p.x);
    const ys = [...at.values()].map((p) => p.y);
    if (!xs.length) return { x: -100, y: -100, w: 200, h: 200 };
    const [x0, x1, y0, y1] = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...ys) - 40, Math.max(...ys) + 40];
    return { x: x0, y: y0, w: Math.max(x1 - x0, 200), h: Math.max(y1 - y0, 200) };
  }, [at]);
  const box = view ?? fit;
  useEffect(() => setView(null), [fit]); // new notes: fit them all in again

  // The wheel zooms about the pointer. Not React's onWheel: that listener is passive, so the page would scroll too.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const b = v ?? fit;
        const k = Math.exp(e.deltaY * 0.0015);
        const px = b.x + ((e.clientX - r.left) / r.width) * b.w;
        const py = b.y + ((e.clientY - r.top) / r.height) * b.h;
        return { x: px - (px - b.x) * k, y: py - (py - b.y) * k, w: b.w * k, h: b.h * k };
      });
    };
    el.addEventListener("wheel", zoom, { passive: false });
    return () => el.removeEventListener("wheel", zoom);
  }, [fit, graph]);

  if (error) return <p className="pane-note" role="alert">{error}</p>;
  if (!graph) return <p className="pane-note">Reading your notes…</p>;
  if (!graph.nodes.length)
    return (
      <p className="pane-note">
        No notes yet. Write <code>[[a note&apos;s name]]</code> in a markdown file to link it to another; each note shows here as a dot, each link as a line.
      </p>
    );

  const lit = hover ?? current;
  const near = new Set(lit ? [lit, ...neighbors(lit, graph), ...graph.edges.filter(([a]) => a === lit).map(([, b]) => b)] : []);
  const open = (id: string) => {
    if (!id.startsWith("?")) return void openFile(id).catch((err) => setError(errorText(err)));
    const from = graph.edges.find(([, b]) => b === id)?.[0] ?? "";
    void openNote(graph.nodes.find((n) => n.id === id)!.name, from).catch((err) => setError(errorText(err)));
  };

  return (
    <div className="note-graph">
      <p className="note-graph-sum">
        {graph.nodes.filter((n) => !n.missing).length} notes · {graph.edges.length} links
      </p>
      <svg
        ref={svg}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="group"
        aria-label="Graph of your notes and the links between them"
        data-lit={lit || undefined}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = e.currentTarget.getBoundingClientRect();
          const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (!d.moved) return;
          setView({ ...box, x: box.x - (dx / r.width) * box.w, y: box.y - (dy / r.height) * box.h });
          drag.current = { x: e.clientX, y: e.clientY, moved: true };
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A press that didn't move is a click on what is under it: the capture took the click from the dot.
          const id = !d?.moved && (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-note]") as SVGElement | null)?.dataset.note;
          if (id) open(id);
        }}
        onDoubleClick={() => setView(null)}
      >
        {graph.edges.map(([a, b]) => {
          const [p, q] = [at.get(a)!, at.get(b)!];
          return <line key={`${a}>${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} data-near={(a === lit || b === lit) || undefined} />;
        })}
        {graph.nodes.map((n) => {
          const p = at.get(n.id)!;
          return (
            <g
              key={n.id}
              data-note={n.id}
              data-missing={n.missing || undefined}
              data-near={near.has(n.id) || undefined}
              data-current={n.id === current || undefined}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={n.missing ? `${n.name}, not written yet: make it` : `Open ${n.name}`}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n.id))}
            >
              <title>{n.missing ? `${n.name} (not written yet)` : n.id}</title>
              <circle r={5 + Math.sqrt(degree.get(n.id) ?? 0) * 2.5} />
              <text y={20}>{n.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
