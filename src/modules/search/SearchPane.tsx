"use client";

import { ArrowLeft, ArrowRight, CaseSensitive, ChevronRight, ExternalLink, FileText, Globe, ListFilter, MessageSquareText, Regex, RotateCw, Save, Search, WholeWord } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { browser, go, reload, step } from "@/modules/web";
import { openFile, saveArtifact, shortPath, type FileHit, type FindOptions } from "@/modules/workspace";
import { plainText, type Page } from "@/shared/html";
import { pane, pin, usePlace, type Section } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { PaneControls } from "@/shared/ui/pane-controls";
import { engine, findFiles, runSearch, type Scope, type WebWhy } from "./engine";

/**
 * Arcanus's search engine: its file system by name and by line, like a code editor's search, and the web when it is
 * needed. Web pages arrive as text through the app's relay and show in reader view: most sites refuse to be framed,
 * and this page's cross-origin isolation (for multi-threaded WASM) blocks frames anyway.
 */
export function SearchEngine() {
  const { home, at, wide } = usePlace("search");
  return home ? <SearchPane place={at} wide={wide} /> : null;
}

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "web", label: "Web" },
];

const WHY: Record<WebWhy, string> = {
  arc1: "ARC 1 read this as a web search",
  scope: "",
  "no files": "Nothing in my files, so I searched the web",
  offline: "Offline · the web needs a connection, so only my files were searched",
  "files only": "",
  "not needed": "ARC 1 read this as a search of my files · press Web to search the internet too",
};

function SearchPane({ place, wide }: { place: Section | null; wide: boolean }) {
  const query = useStore(engine, (s) => s.query);
  const options = useStore(engine, (s) => s.options);
  const scope = useStore(engine, (s) => s.scope);
  const searching = useStore(engine, (s) => s.searching);
  const web = useStore(engine, (s) => s.web);
  const view = useStore(browser, (s) => s.view);
  const loading = useStore(browser, (s) => s.loading);
  const error = useStore(browser, (s) => s.error);
  const at = useStore(browser, (s) => s.at);
  const history = useStore(browser, (s) => s.history);
  const [filters, setFilters] = useState(Boolean(options.include || options.exclude));
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);

  // Files are searched as you type: they are on this device. The web waits for Enter.
  useEffect(() => {
    const timer = window.setTimeout(() => void findFiles(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, options, scope]);

  const set = (change: Partial<FindOptions>) => engine.set({ options: { ...options, ...change } });
  const toggle = (key: "matchCase" | "wholeWord" | "regex", label: string, icon: ReactNode) => (
    <button type="button" className="find-toggle" aria-pressed={Boolean(options[key])} aria-label={label} title={label} onClick={() => set({ [key]: !options[key] })}>
      {icon}
    </button>
  );
  const shownWeb = scope !== "files" && (view || loading || error);

  return (
    <section className="side-pane search-pane" aria-label="Arcanus search engine" data-at={place ?? undefined} data-wide={wide || undefined} hidden={!place}>
      <header className="pane-head">
        <Search size={16} aria-hidden />
        <h2>Search engine</h2>
        <span className="pane-sub truncate">{view?.kind === "page" ? view.page.title : view?.kind === "results" ? `Web · ${view.engine}` : "Files first · ARC 1"}</span>
        <PaneControls page="search" title="the search engine" />
      </header>

      <form
        className="find-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <div className="find-row">
          <div className="find-box">
            <input
              ref={box}
              className="field"
              value={query}
              placeholder="Search my files and the web, or type an address"
              aria-label="Search"
              spellCheck={false}
              onChange={(e) => engine.set({ query: e.target.value })}
            />
            {toggle("matchCase", "Match case", <CaseSensitive size={16} />)}
            {toggle("wholeWord", "Match whole word", <WholeWord size={16} />)}
            {toggle("regex", "Use regular expression", <Regex size={15} />)}
          </div>
          <button type="button" className="icon-btn" aria-pressed={filters} aria-label="Files to include or exclude" title="Files to include or exclude" onClick={() => setFilters((v) => !v)}>
            <ListFilter size={15} />
          </button>
        </div>
        {filters ? (
          <>
            <label className="find-label">
              files to include
              <input className="field" value={options.include ?? ""} placeholder="e.g. *.md, memory" spellCheck={false} onChange={(e) => set({ include: e.target.value })} />
            </label>
            <label className="find-label">
              files to exclude
              <input className="field" value={options.exclude ?? ""} placeholder="e.g. *.ts, src/**/exclude" spellCheck={false} onChange={(e) => set({ exclude: e.target.value })} />
            </label>
          </>
        ) : null}
        <div className="find-scopes" role="radiogroup" aria-label="Where to search">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} className="find-scope" onClick={() => engine.set({ scope: s.id })}>
              {s.label}
            </button>
          ))}
          <button type="submit" className="btn btn-primary find-go" disabled={!query.trim()}>
            Search
          </button>
        </div>
      </form>

      <div className="pane-body reader search-body" aria-busy={searching || Boolean(loading)}>
        {!query.trim() && !shownWeb ? (
          <p className="pane-note">
            Search my files as you type: notes, memory, books, skills and my own source code, by name and by line. Press Enter and ARC 1 reads what you
            asked: if it needs the internet, and the device is online, I search the web too. An address opens in the reader. Your chats never go there.
          </p>
        ) : null}

        {scope !== "web" && query.trim() ? <FileResultsView /> : null}

        {web && WHY[web] ? <p className="find-why">{WHY[web]}</p> : null}

        {shownWeb ? (
          <section className="find-section" aria-label="Web">
            <h3 className="find-heading">
              <Globe size={13} aria-hidden /> Web
              <span className="find-nav">
                <button type="button" className="icon-btn" aria-label="Back" disabled={at <= 0} onClick={() => step(-1)}>
                  <ArrowLeft size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label="Forward" disabled={at >= history.length - 1} onClick={() => step(1)}>
                  <ArrowRight size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label="Reload" disabled={at < 0} onClick={reload}>
                  <RotateCw size={13} />
                </button>
              </span>
            </h3>
            <WebView />
          </section>
        ) : null}
      </div>
      <PageActions />
    </section>
  );
}

function FileResultsView() {
  const files = useStore(engine, (s) => s.files);
  const searching = useStore(engine, (s) => s.searching);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!files) return searching ? <p className="find-why">Searching my files…</p> : null;
  if (files.error) return <p className="pane-note" role="alert">{files.error}</p>;
  const count = `${files.matches} ${files.matches === 1 ? "result" : "results"} in ${files.files.length} ${files.files.length === 1 ? "file" : "files"}${files.more ? ", and more" : ""}`;
  return (
    <section className="find-section" aria-label="Files">
      <h3 className="find-heading">
        <FileText size={13} aria-hidden /> Files <span className="find-count">{files.files.length ? count : "no results"}</span>
      </h3>
      <ul className="find-files">
        {files.files.map((f) => (
          <FileGroup key={f.path} f={f} open={!closed[f.path]} onToggle={() => setClosed((c) => ({ ...c, [f.path]: !c[f.path] }))} />
        ))}
      </ul>
    </section>
  );
}

function FileGroup({ f, open, onToggle }: { f: FileHit; open: boolean; onToggle: () => void }) {
  const short = shortPath(f.path);
  const name = short.split("/").pop();
  const dir = short.split("/").slice(0, -1).join("/");
  const show = () => void openFile(f.path).catch(() => undefined);
  return (
    <li>
      <button type="button" className="find-file" aria-expanded={f.lines.length ? open : undefined} onClick={f.lines.length ? onToggle : show} title={f.path}>
        <ChevronRight size={13} className="find-chevron" aria-hidden data-open={(open && f.lines.length > 0) || undefined} style={{ visibility: f.lines.length ? "visible" : "hidden" }} />
        <span className="find-name" data-named={f.named || undefined}>
          {name}
        </span>
        <span className="find-dir truncate">{dir}</span>
        <span className="find-badge">{f.lines.length || "name"}</span>
      </button>
      {open && f.lines.length ? (
        <ul className="find-lines">
          {f.lines.map((l) => (
            <li key={l.line}>
              <button type="button" className="find-line" onClick={show} title={`Open ${short} in my editor`}>
                <span className="find-ln">{l.line}</span>
                <span className="find-text">
                  {l.text.slice(0, l.from)}
                  <mark>{l.text.slice(l.from, l.to)}</mark>
                  {l.text.slice(l.to)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const shown = (target = "") => (target.startsWith("search:") ? target.slice(7) : target);

function WebView() {
  const view = useStore(browser, (s) => s.view);
  const loading = useStore(browser, (s) => s.loading);
  const error = useStore(browser, (s) => s.error);
  const page = view?.kind === "page" ? view.page : null;
  return (
    <>
      {loading ? <p className="find-why">Loading {shown(loading)}…</p> : null}
      {error && !loading ? (
        <p className="pane-note" role="alert">
          {error}
        </p>
      ) : null}
      {view?.kind === "results" && !loading ? (
        <ol className="results">
          {view.results.map((r) => (
            <li key={r.url}>
              <a href={r.url} onClick={(e) => (e.preventDefault(), go(r.url).catch(() => undefined))}>
                {r.title}
              </a>
              <span className="result-url truncate">{r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
              {r.snippet ? <p>{r.snippet}</p> : null}
            </li>
          ))}
          {!view.results.length ? <p className="pane-note">Nothing found on the web for “{view.query}”.</p> : null}
        </ol>
      ) : null}
      {page && !loading ? (
        <article>
          <h1>{page.title}</h1>
          {page.text.split("\n").map((line, i) => (
            <Line key={i} line={line} />
          ))}
          {!page.text ? <p className="pane-note">This page has no readable text. It may build itself with scripts: open it in a tab.</p> : null}
        </article>
      ) : null}
    </>
  );
}

/** For a web page in the reader: hand it to Arcanus, save it, or open it in a tab. */
function PageActions() {
  const view = useStore(browser, (s) => s.view);
  const scope = useStore(engine, (s) => s.scope);
  const pinned = useStore(pane, (s) => s.pinned);
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [view]);
  const page = view?.kind === "page" ? view.page : null;
  if (!page || scope === "files") return null;
  const reading = pinned?.href === page.url;
  async function save(p: Page) {
    try {
      setNote(`Saved ${await saveArtifact(p.title, `# ${p.title}\n\n${p.url}\n\n${plainText(p.text)}\n`)}`);
    } catch (err) {
      setNote(errorText(err));
    }
  }
  return (
    <div className="pane-actions">
      <button
        type="button"
        className="btn"
        aria-pressed={reading}
        title="Arcanus reads this page with every message until you remove it"
        onClick={() => pin(reading ? null : { label: page.title, text: plainText(page.text), href: page.url })}
      >
        <MessageSquareText size={14} aria-hidden /> {reading ? "Arcanus is reading this" : "Ask Arcanus"}
      </button>
      <button type="button" className="btn" onClick={() => void save(page)}>
        <Save size={14} aria-hidden /> Save
      </button>
      <a className="icon-btn" href={page.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab">
        <ExternalLink size={15} />
      </a>
      {note ? <span className="pane-sub truncate" role="status">{note}</span> : null}
    </div>
  );
}

const LINK = /\[([^\]]*)\]\((https?:[^)\s]*)\)/;

/** One block of reader text, its [text](url) links clickable inside the search engine's reader. */
function Line({ line }: { line: string }) {
  const heading = line.startsWith("# ");
  const item = line.startsWith("- ");
  const parts: ReactNode[] = [];
  let rest = heading || item ? line.slice(2) : line;
  for (let m = rest.match(LINK); m; m = rest.match(LINK)) {
    const href = m[2];
    parts.push(rest.slice(0, m.index));
    parts.push(
      <a key={parts.length} href={href} onClick={(e) => (e.preventDefault(), go(href).catch(() => undefined))}>
        {m[1]}
      </a>
    );
    rest = rest.slice(m.index! + m[0].length);
  }
  parts.push(rest);
  if (heading) return <h3>{parts}</h3>;
  return <p className={item ? "reader-item" : undefined}>{parts}</p>;
}
