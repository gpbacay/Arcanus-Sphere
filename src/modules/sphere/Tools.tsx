"use client";

import { Move3d, Orbit, PencilRuler, Power, RotateCcw, Rotate3d, Scale3d, View } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { TOP_ACTIONS } from "@/shared/pane";
import { power, setPower } from "@/shared/power";
import { useStore } from "@/shared/store";
import { PopMenu, type PopItem } from "@/shared/ui/pop-menu";
import type { Tool } from "./SphereScene";

const ArDialog = dynamic(() => import("./ArDialog"), { ssr: false });

const EDITS = [
  { id: "move", label: "Move the orb", icon: Move3d },
  { id: "rotate", label: "Rotate the orb", icon: Rotate3d },
  { id: "scale", label: "Resize the orb", icon: Scale3d },
] as const;

/**
 * The studio's toolbar, at the right end of the top bar: switch Arcanus on or off, orbit the camera, edit the orb (move, rotate,
 * resize, or put it back, behind one button), and see it in AR.
 */
export function SphereTools({ canDraw, tool, onTool, edited, onReset }: { canDraw: boolean; tool: Tool; onTool: (tool: Tool) => void; edited: boolean; onReset: () => void }) {
  const mobile = useIsMobile();
  const [qr, setQr] = useState(false);
  const on = useStore(power, (s) => s.on);
  const changing = useStore(power, (s) => s.changing);

  // Shown at the right end of the top bar (shell's TopBar leaves this slot for it), not over the stage.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Looked for after every render, not once: the top bar's slot may mount after this, or be replaced by a new one.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- it sets only when the slot changed, so it cannot loop
  useEffect(() => {
    const found = document.getElementById(TOP_ACTIONS);
    if (found !== slot) setSlot(found);
  });

  const editing = tool !== "view";
  const edits: PopItem[] = [
    ...EDITS.map(({ id, label, icon }) => ({ label, icon, checked: tool === id, run: () => onTool(id) })),
    ...(edited ? [{ label: "Undo changes to the orb", icon: RotateCcw, run: onReset }] : []),
  ];

  if (!slot) return null;
  return createPortal(
    <div className="stage-tools">
      <button
        type="button"
        className="icon-btn power-btn"
        data-changing={changing || undefined}
        aria-pressed={on}
        aria-label={on ? "Turn Arcanus off" : "Turn Arcanus on"}
        title={on ? "Turn Arcanus off" : "Turn Arcanus on"}
        onClick={() => setPower(!on)}
      >
        <Power size={17} />
      </button>
      {canDraw ? (
        <>
          <button type="button" className="icon-btn" aria-pressed={!editing} aria-label="Orbit the camera" title="Orbit the camera" onClick={() => onTool("view")}>
            <Orbit size={17} />
          </button>
          <PopMenu label="Edit the orb" title="Edit the orb: move, rotate or resize it" className={editing ? "tool-on" : ""} trigger={<PencilRuler size={17} />} items={edits} />
          {mobile ? (
            <Link href="/ar" className="icon-btn" aria-label="View in AR" title="View in AR">
              <View size={17} />
            </Link>
          ) : (
            <button type="button" className="icon-btn" aria-label="View in AR" title="View in AR" onClick={() => setQr(true)}>
              <View size={17} />
            </button>
          )}
        </>
      ) : null}
      {qr && <ArDialog onClose={() => setQr(false)} />}
    </div>,
    slot,
  );
}
