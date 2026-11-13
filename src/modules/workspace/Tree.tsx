"use client";

// The Operating System's explorer, as an editor's: the folder as a tree, folders opening in place with a chevron, a
// guide line for each level, an icon for each kind of file, and git's marks on what changed in Arcanus's source (the
// letter on a file, a dot on each folder above it).
import { ChevronRight, EllipsisVertical, File, FileCode, FileImage, FileJson, FileText, Folder, FolderOpen, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { errorText, useStore } from "@/shared/store";
import { PopMenu } from "@/shared/ui/pop-menu";
import { SOURCE, list, workspace, type Entry } from "./fs";
import { ide } from "./ide";
import { source, sourceGit } from "./source";

const iconOf = (name: string): LucideIcon =>
  /\.(?:[cm]?[jt]sx?|css|s[ac]ss|html?|py|sh|rs|go|java|c|cpp|h)$/i.test(name)
    ? FileCode
    : /\.json5?$/i.test(name)
      ? FileJson
      : /\.(?:md|markdown|txt)$/i.test(name)
        ? FileText
        : /\.(?:png|jpe?g|gif|svg|webp|ico|avif)$/i.test(name)
          ? FileImage
          : File;
/** The letter an editor shows: an untracked file is U, a conflict ! (git's own U). */
const LETTER: Record<string, string> = { "?": "U", U: "!" };
const WHAT: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "untracked", U: "in conflict" };

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

type Props = {
  /** The folder the tree starts from: the one the breadcrumb shows. */
  root: string;
  /** Bumped by Refresh: every open folder is read again. */
  fresh: number;
  /** Why a path can't be renamed or deleted, or "". */
  kept: (path: string) => string;
  onOpen: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onError: (text: string) => void;
};

export function Tree({ root, fresh, kept, onOpen, onRename, onDelete, onError }: Props) {
  const version = useStore(workspace, (s) => s.version);
  const name = useStore(workspace, (s) => s.name);
  const hasSource = useStore(source, (s) => s.available);
  const expanded = useStore(ide, (s) => s.expanded);
  const selected = useStore(ide, (s) => s.selected);
  const active = useStore(ide, (s) => s.active);
  // Each folder's entries, by its path: a folder's own entries never stand in for another's while it loads.
  const [kids, setKids] = useState<Record<string, Entry[]>>({});
  const [changes, setChanges] = useState<Record<string, string>>({});
  const open = new Set(expanded);
  const wanted = [root, ...expanded.filter((p) => !root || p.startsWith(`${root}/`))];
  const key = wanted.join("\n");

  useEffect(() => {
    let current = true;
    void Promise.all(
      wanted.map((path) =>
        list(path).then(
          (found) => (path === root && current && onError(""), [path, found] as const),
          (err) => (path === root && current && onError(errorText(err)), [path, [] as Entry[]] as const),
        ),
      ),
    ).then((pairs) => current && setKids(Object.fromEntries(pairs)));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the root and the open folders
  }, [key, version, name, fresh]);

  // git's marks, on the source only: a path that changed, and every folder above it.
  useEffect(() => {
    if (!hasSource) return;
    let current = true;
    sourceGit(["status", "--porcelain=v1", "-uall"]).then(
      ({ out, code }) => {
        if (!current || code) return;
        const found: Record<string, string> = {};
        for (const line of out.split("\n").filter(Boolean)) {
          const path = `${SOURCE}/${(line.slice(3).split(" -> ").pop() ?? "").replace(/^"|"$/g, "")}`;
          found[path] = line.slice(0, 2).trim()[0] ?? "M";
          for (let up = parentOf(path); up; up = parentOf(up)) found[up] ??= "folder";
        }
        setChanges(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [hasSource, version, fresh]);
  const marks = hasSource ? changes : {};

  const toggle = (path: string) => ide.set({ expanded: open.has(path) ? expanded.filter((p) => p !== path) : [...expanded, path], selected: path, into: path });

  function rows(dir: string, depth: number): ReactNode[] {
    return (kids[dir] ?? []).flatMap((entry) => {
      const path = join(dir, entry.name);
      const folder = entry.kind === "directory";
      const isOpen = folder && open.has(path);
      const mark = marks[path];
      const Icon = folder ? (isOpen ? FolderOpen : Folder) : iconOf(entry.name);
      const why = kept(path);
      return [
        <li key={path} data-path={path} data-folder={folder || undefined} data-git={mark}>
          <button
            type="button"
            className="tree-row"
            title={mark && mark !== "folder" ? `${path} · ${WHAT[mark] ?? mark}` : path}
            aria-expanded={folder ? isOpen : undefined}
            aria-current={path === active || undefined}
            data-selected={path === selected || undefined}
            onClick={() => (folder ? toggle(path) : (ide.set({ selected: path, into: dir }), onOpen(path)))}
          >
            {Array.from({ length: depth }, (_, i) => (
              <span key={i} className="tree-guide" aria-hidden />
            ))}
            <ChevronRight size={12} className="tree-chev" aria-hidden data-open={isOpen || undefined} style={folder ? undefined : { visibility: "hidden" }} />
            <Icon size={14} className="tree-icon" aria-hidden />
            <span className="truncate">{entry.name}</span>
            {mark === "folder" ? <span className="tree-dot" role="img" aria-label="has changes" /> : mark ? <span className="tree-git">{LETTER[mark] ?? mark}</span> : null}
          </button>
          <PopMenu
            label={`Actions for ${entry.name}`}
            title={why || "Actions"}
            disabled={!!why}
            className="tree-more"
            trigger={<EllipsisVertical size={14} />}
            items={[
              { label: "Rename", icon: Pencil, kbd: "F2", run: () => onRename(path) },
              { label: "Delete", icon: Trash2, kbd: "Del", danger: true, run: () => onDelete(path) },
            ]}
          />
        </li>,
        ...(isOpen ? rows(path, depth + 1) : []),
      ];
    });
  }

  /** The keys an editor's tree has: Up and Down move between rows, Right opens a folder, Left closes it, F2 renames, Del deletes. */
  function keys(e: KeyboardEvent<HTMLUListElement>) {
    const row = (e.target as HTMLElement).closest("li");
    const path = row?.dataset.path;
    if (!row || !path) return;
    const folder = !!row.dataset.folder;
    const step = (dir: 1 | -1) => {
      const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".tree-row")];
      all[all.indexOf(row.querySelector(".tree-row")!) + dir]?.focus();
    };
    const act: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      ArrowRight: () => folder && !open.has(path) && toggle(path),
      ArrowLeft: () => (folder && open.has(path) ? toggle(path) : (e.currentTarget.querySelector<HTMLButtonElement>(`li[data-path="${CSS.escape(parentOf(path))}"] .tree-row`)?.focus())),
      F2: () => !kept(path) && onRename(path),
      Delete: () => !kept(path) && onDelete(path),
    };
    if (!act[e.key]) return;
    e.preventDefault();
    act[e.key]();
  }

  const top = kids[root];
  return (
    <>
      <ul className="tree" aria-label="Files" onKeyDown={keys}>
        {rows(root, 0)}
      </ul>
      {top && !top.length ? <p className="pane-note">This folder is empty.</p> : null}
    </>
  );
}
