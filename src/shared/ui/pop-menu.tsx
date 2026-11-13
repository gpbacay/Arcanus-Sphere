"use client";

import { Check, type LucideIcon } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

export type PopItem = { label: string; icon?: LucideIcon; kbd?: string; danger?: boolean; checked?: boolean; run: () => unknown };

/**
 * A small menu behind an icon button. The list is a popover: it opens in the top layer, so no pane's scrolling or
 * glass can clip it, closes on a click elsewhere or Esc, and sits under the button (above it near the foot of the window).
 */
export function PopMenu({ label, title, trigger, className = "", disabled, items }: { label: string; title?: string; trigger: ReactNode; className?: string; disabled?: boolean; items: PopItem[] }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  function place(e: React.ToggleEvent<HTMLDivElement>) {
    if (e.newState !== "open" || !button.current) return;
    const list = e.currentTarget;
    const at = button.current.getBoundingClientRect();
    const below = at.bottom + 4 + list.offsetHeight <= window.innerHeight;
    list.style.top = `${Math.max(4, below ? at.bottom + 4 : at.top - 4 - list.offsetHeight)}px`;
    list.style.left = `${Math.max(4, at.right - list.offsetWidth)}px`;
    window.addEventListener("scroll", () => list.hidePopover(), { capture: true, once: true }); // it would stay behind as the list moves
  }

  return (
    <>
      <button ref={button} type="button" className={`icon-btn ${className}`} aria-label={label} title={title ?? label} disabled={disabled} popoverTarget={id} popoverTargetAction="toggle">
        {trigger}
      </button>
      <div id={id} popover="auto" role="menu" aria-label={label} className="menu pop-menu" onToggle={place}>
        {items.map(({ label: text, icon: Icon, kbd, danger, checked, run }) => (
          <button
            key={text}
            type="button"
            role={checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={checked}
            className={danger ? "menu-item danger" : "menu-item"}
            onClick={(e) => {
              e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              void run();
            }}
          >
            {Icon ? <Icon size={14} aria-hidden /> : null}
            <span>{text}</span>
            {checked ? <Check size={14} aria-hidden /> : kbd ? <kbd>{kbd}</kbd> : null}
          </button>
        ))}
      </div>
    </>
  );
}
