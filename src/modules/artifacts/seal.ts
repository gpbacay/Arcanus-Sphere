// What every file artifact starts from. An artifact is code out of a file, so it runs sealed: a sandboxed frame with
// no origin (it can't reach Arcanus's files, storage or device service) under a policy with no network (what it is
// shown never leaves the device). Sealed, it can't load Arcanus's stylesheet or fonts either, so they are handed in:
// the design tokens as CSS variables, and the fonts inside the page as data: URLs.

/** The tokens of app/globals.css an artifact may use, by name. */
const TOKENS = [
  "bg-root", "line", "line-strong", "tick", "surface", "surface-2", "surface-3", "text", "text-muted", "text-faint",
  "accent", "accent-hot", "accent-ink", "accent-soft", "accent-glow", "ok", "think", "speak", "danger", "danger-soft",
  "font-ui", "font-mono", "ease", "r", "r-sm", "gap", "glass", "glass-sheen", "glass-blur", "glass-shadow",
];

/**
 * In every artifact, before its own code: `arcanus.call(name, ...args)` and `arcanus.on(topic, fn)`, the bridge's two
 * ends (bridge.ts). A web link pressed opens in a tab of your browser, unless the page handled the press itself.
 */
const BRIDGE = `(()=>{let n=0;const waiting=new Map(),subs={};
addEventListener("message",(e)=>{if(e.source!==parent)return;const d=e.data||{};
if(d.arcanus==="reply"){const p=waiting.get(d.id);waiting.delete(d.id);if(p)"error"in d?p[1](new Error(d.error)):p[0](d.result);}
else(subs[d.arcanus]||[]).forEach((fn)=>fn(d));});
window.arcanus={call:(name,...args)=>new Promise((ok,fail)=>{const id=++n;waiting.set(id,[ok,fail]);parent.postMessage({arcanus:"call",id,name,args},"*");}),
on:(topic,fn)=>{(subs[topic]||=[]).push(fn);}};
addEventListener("click",(e)=>{const a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||!/^https?:/i.test(a.href))return;e.preventDefault();arcanus.call("open",a.href).catch(()=>{});});
})();`;

const dataUrl = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });

/** Arcanus's fonts as @font-face rules that carry the font itself. Only the Latin faces: the rest are never drawn. */
async function fonts() {
  const rules = [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules];
    } catch {
      return []; // another origin's sheet
    }
  });
  const faces = rules.filter((rule): rule is CSSFontFaceRule => {
    if (!(rule instanceof CSSFontFaceRule)) return false;
    const range = rule.style.getPropertyValue("unicode-range");
    return !range || /U\+0+-0*FF\b/i.test(range);
  });
  const carried = await Promise.all(
    faces.map(async (face) => {
      const url = face.cssText.match(/url\("?([^")]+)"?\)/)?.[1];
      if (!url) return face.cssText; // a local fallback face: nothing to fetch
      const file = await fetch(new URL(url, face.parentStyleSheet?.href ?? location.href)).then((res) => (res.ok ? res.blob() : null), () => null);
      return file ? face.cssText.replace(url, await dataUrl(file)) : ""; // without it the page falls back to a system font
    }),
  );
  return carried.join("");
}

let made: Promise<string> | null = null;

/** The head of every artifact's page: the seal, the fonts, the tokens and a plain base. Made once. */
export const seal = () =>
  (made ??= fonts().then((faces) => {
    const root = getComputedStyle(document.documentElement);
    const tokens = TOKENS.map((name) => `--${name}:${root.getPropertyValue(`--${name}`)}`).join(";");
    return (
      `<!doctype html><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' data: blob:">` +
      `<style>${faces}:root{color-scheme:dark;${tokens}}` +
      `html,body{height:100%;margin:0}` +
      // Transparent: the pane's plate shows through unless the artifact paints its own.
      `body{background:transparent;color:var(--text);font:13px/1.45 var(--font-ui);-webkit-font-smoothing:antialiased}` +
      `*{scrollbar-width:thin;scrollbar-color:var(--surface-3) transparent}` +
      `::selection{background:rgba(111,224,255,.28)}` +
      `:focus-visible{outline:1px solid var(--accent);outline-offset:2px}` +
      `@keyframes pulse{50%{opacity:.3}}</style>` +
      `<script>${BRIDGE}</script>`
    );
  }));
