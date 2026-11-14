"use client";

import { Columns3, Maximize2, Minimize2, X } from "lucide-react";
import { closePane, movePane, toggleExpand, usePlace, type Page } from "@/shared/pane";
import { PopMenu } from "./pop-menu";

const NAMES = { left: "Left section", center: "Center section", right: "Right section" } as const;

/**
 * The buttons at the end of every page's header: move it to another section, expand it over the center (in a side
 * section only), and close it. A phone has no columns, so it shows only the close.
 */
export function PaneControls({ page, title, close = true }: { page: Page; title: string; close?: boolean }) {
  const { home, at, wide } = usePlace(page);
  // Only a page in its own side section expands: the center's page moved aside by an expansion doesn't.
  const side = (home === "left" || home === "right") && at === home ? home : null;
  return (
    <>
      <PopMenu
        label={`Move ${title}`}
        title="Move to another section"
        className="pane-move"
        trigger={<Columns3 size={15} />}
        items={(["left", "center", "right"] as const).map((k) => ({ label: NAMES[k], checked: home === k, run: () => movePane(page, k) }))}
      />
      {side ? (
        <button
          type="button"
          className="icon-btn pane-expand"
          aria-pressed={wide}
          aria-label={wide ? `Collapse ${title}` : `Expand ${title}`}
          title={wide ? "Collapse" : `Expand over the center (the center moves to the ${side === "left" ? "right" : "left"})`}
          onClick={() => toggleExpand(side)}
        >
          {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      ) : null}
      {close ? (
        <button type="button" className="icon-btn" aria-label={`Close ${title}`} title="Close" onClick={() => closePane(page)}>
          <X size={16} />
        </button>
      ) : null}
    </>
  );
}
