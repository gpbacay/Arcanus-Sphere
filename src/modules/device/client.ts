"use client";

// Arcanus on this computer: what it is (specs), opening apps, and working them through open computer use (the
// /api/device route). Each user command is one action; Arcanus never chains actions on its own, so text it reads
// from a page or a window can't steer it.
import { recallNotes, type Outcome } from "@/modules/brain";
import { errorText } from "@/shared/store";
import { appLines, focusTarget, parseTree, pickElement, scrollTarget, specLines, typedKeys, type Command, type Element, type Specs } from "./command";

async function device<T>(body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/device", {
      method: body ? "POST" : "GET",
      headers: { "x-arcanus": "device", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Arcanus's device service isn't running.");
  }
  const data = await res.json().catch(() => ({ error: `The device service answered ${res.status}.` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The device service answered ${res.status}.`), { status: res.status });
  return data as T;
}

/** This computer's specs, with what only the browser can see: graphics, battery, display. */
export async function deviceSpecs(): Promise<Specs> {
  const specs = await device<Specs>();
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && info) specs.gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \((.*)\)$/, "$1");
  } catch {}
  try {
    const battery = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.();
    if (battery) specs.battery = { level: battery.level, charging: battery.charging };
  } catch {}
  specs.screen = { width: Math.round(screen.width * devicePixelRatio), height: Math.round(screen.height * devicePixelRatio), scale: devicePixelRatio };
  return specs;
}

/** Open an installed app by name; `exact` for an "open X" that may be a website. Null when no app has that name. */
export async function openApp(name: string, exact = false): Promise<string | null> {
  try {
    const { opened } = await device<{ opened: string }>({ open: name, exact });
    lastApp = opened;
    return opened;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** One open computer use tool call. */
async function act(tool: string, args: Record<string, unknown>) {
  const { text, error } = await device<{ text: string; error?: string }>({ tool, args });
  if (error) throw new Error(error);
  return text;
}

/**
 * A real keystroke (global input) reaches every app, but only the window in front. Behind, the app is brought forward
 * by focusing one of its elements; posted messages are the last resort (and all there is with global input off).
 */
async function pressKey(app: string, key: string, elements: Element[]) {
  const real = () => act("press_key", { app, key, key_method: "global" });
  try {
    return await real();
  } catch (err) {
    const target = /foreground/i.test(errorText(err)) ? focusTarget(elements) : null;
    if (target) {
      try {
        await act("perform_secondary_action", { app, element_index: target, action: "SetFocus" });
        await act("get_app_state", { app, ...STATE });
        return await real();
      } catch {}
    }
  }
  return act("press_key", { app, key });
}

// The app the last command worked in, so "click Save" after "open Notepad" needs no "in Notepad".
let lastApp: string | undefined;

const STATE = { include_screenshot: false, max_tree_nodes: 600 };

/** Typos ("clik sav") miss the plain title match; Hippocampus with Occipital matches by letters too. */
function recallElement(elements: ReturnType<typeof parseTree>, target: string) {
  const [hit] = recallNotes(target, elements.filter((e) => e.title).map((e) => ({ id: e.index, text: e.title })), 1);
  return hit ? elements.find((e) => e.index === hit.id) ?? null : null;
}

/** Carry out a device command. Null hands the message on to the language model (an app that isn't there). */
export async function operate(command: Command, question: string): Promise<Outcome | null> {
  if (command.kind === "specs") {
    const lines = specLines(await deviceSpecs(), question);
    return { step: { label: "Read this device", description: "From the operating system and the browser", results: lines.map((l) => l.replace(/\*\*/g, "")) }, reply: lines.map((l) => `- ${l}`).join("\n") };
  }
  if (command.kind === "open") {
    const opened = await openApp(command.app);
    if (!opened) return null;
    return { step: { label: "Opened an app", description: `Asked for "${command.app}"`, results: [opened] }, reply: `Opened ${opened}.` };
  }
  if (command.kind === "apps") {
    const lines = appLines(await act("list_apps", {}));
    return { step: { label: "Open apps", description: "open computer use · list_apps", results: lines }, reply: lines.length ? lines.map((l) => `- ${l}`).join("\n") : "No app windows are open." };
  }

  const app = command.app ?? lastApp;
  if (!app) {
    if (command.kind === "type") return null; // "type something" with nothing open is likely chat
    return { step: { label: "Which app?", description: "No app named and none used yet" }, reply: `Which app? For example: "${command.kind === "read" ? "read the Notepad window" : "click Save in Notepad"}".` };
  }
  lastApp = app;
  const via = (tool: string) => `open computer use · ${tool} · ${app}`;

  // Every action needs a fresh look first: element indexes, and the app itself, come from get_app_state.
  const state = await act("get_app_state", { app, ...STATE, ...(command.kind === "read" ? { text_limit: 1000 } : {}) });
  const elements = parseTree(state);

  if (command.kind === "type") {
    const after = await act("type_text", { app, text: command.text });
    // type_text posts window messages, which apps like Calculator and the new Notepad ignore while reporting success.
    // When the text doesn't show up, type it as real keystrokes instead.
    const seen = (tree: string) => parseTree(tree).map((e) => e.title).join("\n").split(command.text).length; // names, not frame numbers
    const keys = seen(after) > seen(state) ? null : typedKeys(command.text);
    if (keys) for (const key of keys) await pressKey(app, key, elements);
    return { step: { label: "Typed", description: via(keys ? "press_key" : "type_text"), results: [command.text] }, reply: `Typed it into ${app}.` };
  }
  if (command.kind === "key") {
    await pressKey(app, command.key, elements);
    return { step: { label: "Pressed a key", description: via("press_key"), results: [command.key] }, reply: `Pressed ${command.key} in ${app}.` };
  }

  if (command.kind === "read") {
    return {
      step: { label: "Looked at a window", description: via("get_app_state"), results: [`${elements.length} elements`] },
      facts: [state.slice(0, 4000)],
      source: `The accessibility tree of the ${app} window on this computer (numbered elements: role, then name)`,
    };
  }
  if (command.kind === "scroll") {
    await act("scroll", { app, direction: command.direction, element_index: scrollTarget(elements) });
    return { step: { label: "Scrolled", description: via("scroll"), results: [command.direction] }, reply: `Scrolled ${command.direction} in ${app}.` };
  }
  const element = pickElement(elements, command.target) ?? recallElement(elements, command.target);
  if (!element) {
    return { step: { label: "Looked for it", description: via("get_app_state"), results: [`${elements.length} elements, none named "${command.target}"`] }, reply: `I don't see "${command.target}" in ${app}.` };
  }
  await act("click", { app, element_index: element.index });
  const name = element.title || element.role;
  return { step: { label: "Clicked", description: via("click"), results: [`${element.index} ${element.role} ${name}`] }, reply: `Clicked "${name}" in ${app}.` };
}
