"use client";

/**
 * A bar along a region's edge, dragged (or moved with the arrow keys once focused) to resize it. `drag` gets the
 * pointer's position as it moves; `nudge` gets -1 for Left/Up and 1 for Right/Down.
 */
export function Grip({ label, x, value, min, max, drag, nudge }: { label: string; x?: boolean; value: number; min: number; max: number; drag: (x: number, y: number) => void; nudge: (step: -1 | 1) => void }) {
  return (
    <div
      className="grip"
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => e.buttons && drag(e.clientX, e.clientY)}
      onKeyDown={(e) => {
        const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as const)[e.key as "ArrowLeft"];
        if (!step) return;
        e.preventDefault();
        nudge(step);
      }}
    />
  );
}
