"use client";

// The Artifacts pane: one page of the window, a tab for each artifact. An artifact is either a file, any .html page in
// .arcanus/artifacts/, or a page built into Arcanus (AR: app/page.tsx hands it in; the camera can't work sealed).
// The Graph of Thought, the search engine and the world map are files, so their code is Arcanus's own to read and
// rewrite, and a page dropped beside them becomes a tab the same way. A file runs sealed in a frame (seal.ts) and
// reaches Arcanus only through the bridge (bridge.ts).
import { AppWindow, CodeXml, EllipsisVertical, MapPin, Network, RotateCcw, Search, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { artifacts, BUILT_IN_ARTIFACTS, openFile, restoreArtifact, workspace, type Artifact } from "@/modules/workspace";
import { pane, usePlace, type Section } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { PaneControls } from "@/shared/ui/pane-controls";
import { PopMenu, type PopItem } from "@/shared/ui/pop-menu";
import { connect } from "./bridge";
import { seal } from "./seal";

/** A page built into Arcanus, shown as an artifact. `view` is the page itself: its header, then its body. */
export type ArtifactPage = { id: string; label: string; icon: LucideIcon; view: ReactNode };
type Tab = Omit<ArtifactPage, "view"> & { hint?: string; view?: ReactNode; file?: Artifact };

const ICONS: Record<string, LucideIcon> = { "graph-of-thought.html": Network, "search-engine.html": Search, "world-map.html": MapPin };
const shipped = (file: Artifact) => BUILT_IN_ARTIFACTS.includes(file.name);

/** A file's tab: named by its <title>, explained by its <meta name="description">. */
const fileTab = (file: Artifact): Tab => ({
  id: file.name,
  label: file.text.match(/<title>([^<]*)<\/title>/i)?.[1].trim() || file.name.replace(/\.html?$/i, ""),
  hint: file.text.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1],
  icon: ICONS[file.name] ?? AppWindow,
  file,
});

/** The Artifacts, in whichever section they were put. Rendered only while open, so a closed pane costs nothing. */
export function Artifacts({ pages }: { pages: ArtifactPage[] }) {
  const { home, at, wide } = usePlace("artifacts");
  return home ? <ArtifactsPane pages={pages} at={at} wide={wide} /> : null;
}

function ArtifactsPane({ pages, at, wide }: { pages: ArtifactPage[]; at: Section | null; wide: boolean }) {
  const chosen = useStore(pane, (s) => s.artifact);
  const version = useStore(workspace, (s) => s.version); // a file saved, added or deleted: the tabs are read again
  const [files, setFiles] = useState<Artifact[] | null>(null);
  useEffect(() => {
    let live = true;
    void artifacts().then((found) => live && setFiles(found));
    return () => void (live = false);
  }, [version]);

  // What Arcanus ships comes first, then its built-in pages, then the artifacts you or Arcanus added.
  const mine = (files ?? []).map(fileTab);
  const tabs: Tab[] = [...mine.filter((t) => shipped(t.file!)), ...pages, ...mine.filter((t) => !shipped(t.file!))];
  // Until the files are read the first tab isn't known, so nothing is shown in its place.
  const active = tabs.find((t) => t.id === chosen) ?? (files ? tabs[0] : undefined);
  const file = active?.file;

  function arrows(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step || !active) return;
    const next = tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length];
    pane.set({ artifact: next.id });
    // After the artifact has mounted: one that takes the focus as it opens (the search box) would end the arrowing there.
    requestAnimationFrame(() => document.getElementById(`artifact-tab-${next.id}`)?.focus());
  }

  const menu: PopItem[] = file
    ? [
        ...(file.path ? [{ label: "Edit its code", icon: CodeXml, run: () => openFile(file.path).catch(() => undefined) }] : []),
        ...(shipped(file)
          ? [
              {
                label: "Restore the original",
                icon: RotateCcw,
                run: () => window.confirm(`Replace ${file.name} with the one Arcanus ships? Your edits to it are lost.`) && restoreArtifact(file.name).catch(() => undefined),
              },
            ]
          : []),
      ]
    : [];

  return (
    <section className="side-pane artifacts-pane" aria-label="Artifacts" data-kind={file ? "file" : undefined} data-at={at ?? undefined} data-wide={wide || undefined} hidden={!at}>
      <header className="art-head">
        <div className="art-tabs" role="tablist" aria-label="Artifacts" onKeyDown={arrows}>
          {tabs.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`artifact-tab-${id}`}
              className="art-tab"
              aria-selected={id === active?.id}
              aria-controls="artifact-panel"
              aria-label={label}
              title={hint ? `${label}: ${hint}` : label}
              tabIndex={id === active?.id ? 0 : -1}
              onClick={() => pane.set({ artifact: id })}
            >
              <Icon size={15} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="art-controls">
          {menu.length ? <PopMenu label={`${active!.label} options`} title="Options" trigger={<EllipsisVertical size={15} />} items={menu} /> : null}
          <PaneControls page="artifacts" title="Artifacts" />
        </div>
      </header>
      <div className="art-panel" role="tabpanel" id="artifact-panel" aria-labelledby={active ? `artifact-tab-${active.id}` : undefined}>
        {file ? <Frame key={file.name} file={file} label={active.label} /> : active?.view}
      </div>
    </section>
  );
}

/** A file artifact, running sealed, connected to Arcanus by the bridge: what it may see, and what it may ask for. */
function Frame({ file, label }: { file: Artifact; label: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [head, setHead] = useState("");
  const [height, setHeight] = useState<number | null>(null); // the page's own, once it sends it: the pane fits it
  useEffect(() => void seal().then(setHead), []);

  const link = useRef<ReturnType<typeof connect> | null>(null);

  useEffect(() => {
    link.current = connect(() => frame.current?.contentWindow);
    const heard = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.arcanus === "height" && Number.isFinite(e.data.height)) setHeight(Math.ceil(e.data.height));
    };
    window.addEventListener("message", heard);
    return () => {
      link.current?.off();
      window.removeEventListener("message", heard);
    };
  }, []);

  return head ? (
    <iframe
      ref={frame}
      className="art-frame"
      title={label}
      sandbox="allow-scripts"
      srcDoc={head + file.text}
      onLoad={() => link.current?.sendAll()}
      data-fit={height !== null || undefined}
      style={height !== null ? { height } : undefined}
    />
  ) : null;
}
