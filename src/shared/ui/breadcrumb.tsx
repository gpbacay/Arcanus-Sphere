import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type Crumb = { name: string; path?: string };

/** The folder path. A crumb with `path` opens that folder; the last one, without a path, is the open place. */
export function Breadcrumb({
  label,
  root,
  segments,
  onOpen,
  action,
}: {
  label: string;
  root: string;
  segments: Crumb[];
  onOpen: (path: string) => void;
  action?: ReactNode;
}) {
  return (
    <nav className="crumbs" aria-label={label}>
      {segments.length ? (
        <button type="button" onClick={() => onOpen("")}>
          {root}
        </button>
      ) : (
        <span aria-current="page">{root}</span>
      )}
      {segments.map((segment) => (
        <span key={segment.path ?? segment.name}>
          <ChevronRight size={12} aria-hidden />
          {segment.path ? (
            <button type="button" onClick={() => onOpen(segment.path!)}>
              {segment.name}
            </button>
          ) : (
            <span aria-current="page">{segment.name}</span>
          )}
        </span>
      ))}
      {action}
    </nav>
  );
}
