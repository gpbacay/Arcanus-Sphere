"use client";

import { EllipsisVertical, Move3d, Orbit, Power, RotateCcw, Rotate3d, Scale3d, View } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { TOP_ACTIONS } from "@/shared/pane";
import { power, setPower } from "@/shared/power";
import { useStore } from "@/shared/store";
import type { Tool } from "./SphereScene";

const ArDialog = dynamic(() => import("./ArDialog"), { ssr: false });

const TOOLS = [
  { id: "view", label: "Orbit the camera", Icon: Orbit },
  { id: "move", label: "Move the orb", Icon: Move3d },
  { id: "rotate", label: "Rotate the orb", Icon: Rotate3d },
  { id: "scale", label: "Resize the orb", Icon: Scale3d },
] as const;

/**
 * The studio's toolbar, folded behind one ⋮ button at the right end of the top bar: switch Arcanus on or off, pick how a drag acts
 * on the orb, see it in AR, and, once the orb has been moved, rotated or resized, put it back.
 */
export function SphereTools({ tool, onTool, edited, onReset }: { tool: Tool; onTool: (tool: Tool) => void; edited: boolean; onReset: () => void }) {
  const mobile = useIsMobile();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const on = useStore(power, (s) => s.on);
  const changing = useStore(power, (s) => s.changing);

  // Shown at the right end of the top bar (shell's TopBar leaves this slot for it), not over the stage.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(TOP_ACTIONS)), []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  if (!slot) return null;
  return createPortal(
    <div className="stage-tools" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        className="icon-btn power-btn"
        data-changing={changing || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Arcanus and 3D orb tools"
        title="Arcanus and 3D orb tools"
        onClick={() => setOpen((v) => !v)}
      >
        <EllipsisVertical size={18} />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="menu tools-menu" aria-label="Arcanus and 3D orb tools">
          <button type="button" role="menuitemcheckbox" aria-checked={on} className="menu-item" onClick={pick(() => setPower(!on))}>
            <span>{on ? "Turn Arcanus off" : "Turn Arcanus on"}</span>
            <Power size={16} />
          </button>
          <div className="menu-sep" />
          {TOOLS.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={tool === id} className="menu-item" onClick={pick(() => onTool(id))}>
              <span>{label}</span>
              <Icon size={16} />
            </button>
          ))}
          {edited ? (
            <button type="button" role="menuitem" className="menu-item" onClick={pick(onReset)}>
              <span>Undo changes to the orb</span>
              <RotateCcw size={16} />
            </button>
          ) : null}
          <div className="menu-sep" />
          {mobile ? (
            <Link href="/ar" role="menuitem" className="menu-item">
              <span>View in AR</span>
              <View size={16} />
            </Link>
          ) : (
            <button type="button" role="menuitem" className="menu-item" onClick={pick(() => setQr(true))}>
              <span>View in AR</span>
              <View size={16} />
            </button>
          )}
        </div>
      ) : null}
      {qr && <ArDialog onClose={() => setQr(false)} />}
    </div>,
    slot,
  );
}
