"use client";

import { Move3d, Orbit, RotateCcw, Rotate3d, Scale3d, View } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import type { Tool } from "./SphereScene";

const ArDialog = dynamic(() => import("./ArDialog"), { ssr: false });

const TOOLS = [
  { id: "view", label: "Orbit the camera", Icon: Orbit },
  { id: "move", label: "Move the orb", Icon: Move3d },
  { id: "rotate", label: "Rotate the orb", Icon: Rotate3d },
  { id: "scale", label: "Resize the orb", Icon: Scale3d },
] as const;

/** The studio's toolbar: pick how a drag acts on the orb, put it back, or see it in AR. */
export function SphereTools({ tool, onTool, onReset }: { tool: Tool; onTool: (tool: Tool) => void; onReset: () => void }) {
  const mobile = useIsMobile();
  const [qr, setQr] = useState(false);
  return (
    <div className="stage-tools" role="toolbar" aria-label="3D orb tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button key={id} type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={tool === id} onClick={() => onTool(id)}>
          <Icon size={18} />
        </button>
      ))}
      <button type="button" className="icon-btn" aria-label="Reset the orb and camera" title="Reset" onClick={onReset}>
        <RotateCcw size={18} />
      </button>
      <span className="tools-sep" />
      {mobile ? (
        <Link href="/ar" className="icon-btn" aria-label="View in AR" title="View in AR">
          <View size={18} />
        </Link>
      ) : (
        <button type="button" className="icon-btn" aria-label="View in AR" title="View in AR" onClick={() => setQr(true)}>
          <View size={18} />
        </button>
      )}
      {qr && <ArDialog onClose={() => setQr(false)} />}
    </div>
  );
}
