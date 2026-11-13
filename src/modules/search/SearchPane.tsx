"use client";

import { ArrowLeft, ArrowRight, ExternalLink, Globe, MessageSquareText, RotateCw, Save, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { saveArtifact } from "@/modules/workspace";
import { plainText, type Page } from "@/shared/html";
import { closePane, pane, pin } from "@/shared/pane";
import { errorText, useStore } from "@/shared/store";
import { browser, go, reload, step } from "./client";

/**
 * Arcanus's browser. Pages arrive as text through the app's relay and show in reader view: most sites refuse to be
 * framed, and this page's cross-origin isolation (for multi-threaded WASM) blocks frames anyway.
 */
export function Browser() {
  const open = useStore(pane, (s) => s.open === "browser");
  return open ? <BrowserPane /> : null;
}

const shown = (target = "") => (target.startsWith("search:") ? target.slice(7) : target);

function BrowserPane() {
  const view = useStore(browser, (s) => s.view);
  const loading = useStore(browser, (s) => s.loading);
  const error = useStore(browser, (s) => s.error);
  const at = useStore(browser, (s) => s.at);
  const history = useStore(browser, (s) => s.history);
  const pinned = useStore(pane, (s) => s.pinned);
  const [address, setAddress] = useState(shown(history[at]));
  const [note, setNote] = useState("");
  useEffect(() => setAddress(shown(history[at])), [history, at]);
  useEffect(() => setNote(""), [view]);

  const page = view?.kind === "page" ? view.page : null;
  const reading = Boolean(page && pinned?.href === page.url);

  async function save(p: Page) {
    try {
      setNote(`Saved ${await saveArtifact(p.title, `# ${p.title}\n\n${p.url}\n\n${plainText(p.text)}\n`)}`);
    } catch (err) {
      setNote(errorText(err));
    }
  }

  return (
    <section className="side-pane" aria-label="Arcanus browser">
      <header className="pane-head">
        <Globe size={16} aria-hidden />
        <h2>Browser</h2>
        <span className="pane-sub truncate">{page?.title ?? (view?.kind === "results" ? `Search · ${view.engine}` : "")}</span>
        <button type="button" className="icon-btn" aria-label="Close browser" onClick={closePane}>
          <X size={16} />
        </button>
      </header>
      <form
        className="pane-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (address.trim()) go(address).catch(() => undefined);
        }}
      >
        <button type="button" className="icon-btn" aria-label="Back" disabled={at <= 0} onClick={() => step(-1)}>
          <ArrowLeft size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Forward" disabled={at >= history.length - 1} onClick={() => step(1)}>
          <ArrowRight size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Reload" disabled={at < 0} onClick={reload}>
          <RotateCw size={14} />
        </button>
        <input
          className="field"
          value={address}
          placeholder="Search, or type an address"
          aria-label="Address or search"
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </form>

      <div className="pane-body reader" aria-busy={Boolean(loading)}>
        {loading ? <p className="pane-note">Loading {shown(loading)}…</p> : null}
        {error && !loading ? (
          <p className="pane-note" role="alert">
            {error}
          </p>
        ) : null}
        {!view && !loading && !error ? (
          <p className="pane-note">
            Search the web or open an address. Arcanus reads pages as text through this app&apos;s relay, and only when you browse or ask it to look
            something up. Your chats never go there.
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
            {!view.results.length ? <p className="pane-note">Nothing found for “{view.query}”.</p> : null}
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
      </div>

      {page ? (
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
      ) : null}
    </section>
  );
}

const LINK = /\[([^\]]*)\]\((https?:[^)\s]*)\)/;

/** One block of reader text, its [text](url) links clickable inside Arcanus's browser. */
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
