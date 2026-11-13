"use client";

// Arcanus's own source code, reached through /api/source: the project on the computer Arcanus runs from. It is
// there only when Arcanus is opened at localhost on that computer; anywhere else `available` stays false. fs.ts
// mounts it into the file system at .arcanus/source, so nothing else needs to know it is not a browser folder.
import { Store } from "@/shared/store";
import type { Entry } from "./fs";

export type Hit = { path: string; line: number; text: string };

export const source = new Store({ available: false, name: "", branch: "" });

async function call<T>(body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/source", {
      method: body ? "POST" : "GET",
      headers: { "x-arcanus": "source", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("My source isn't reachable: the server I run from isn't answering.");
  }
  const data = await res.json().catch(() => ({ error: `My source answered ${res.status}.` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `My source answered ${res.status}.`), { status: res.status });
  return data as T;
}

/** Look for the source. Asked only at localhost: anywhere else the route refuses, and the request would be wasted. */
export async function connectSource() {
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  const found = await call<{ name: string; branch: string }>().catch(() => null);
  if (found) source.set({ available: true, ...found });
}

/** The same six operations fs.ts has for a browser folder, on the source. Paths are relative to the project. */
export const sourceFs = {
  list: async (path: string) => (await call<{ entries: Entry[] }>({ op: "list", path })).entries,
  read: (path: string) =>
    call<{ text: string }>({ op: "read", path }).then(
      (r) => r.text,
      (err: { status?: number }) => {
        if (err.status === 404) return null;
        throw err;
      },
    ),
  write: (path: string, text: string) => call({ op: "write", path, text }),
  makeFolder: (path: string) => call({ op: "mkdir", path }),
  remove: (path: string) => call({ op: "remove", path }),
  rename: (path: string, to: string) => call({ op: "rename", path, to }),
};

/** Every file of the source that git tracks or would track. */
export const sourceFiles = async () => (await call<{ files: string[] }>({ op: "files" })).files;

/** Where `query` appears in the source: as written and whatever its case, unless the options say otherwise. */
export const searchSource = (query: string, options: { matchCase?: boolean; wholeWord?: boolean; regex?: boolean; limit?: number } = {}) =>
  call<{ hits: Hit[]; more: boolean }>({ op: "search", query, ...options });

/** One git command on the source. `code` is git's exit code: 0 when it worked. */
export async function sourceGit(args: string[]) {
  const result = await call<{ out: string; code: number }>({ op: "git", args });
  if (/^(?:switch|checkout|pull|merge|reset|stash)$/.test(args[0])) await connectSource(); // the branch may have changed
  return result;
}
