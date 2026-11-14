import { Info as InfoIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

/** An ⓘ button whose text opens in a popover in the middle of the window: instructions that would crowd a pane. */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button type="button" className="icon-btn" aria-label={label} title={label} popoverTarget={id}>
        <InfoIcon size={15} />
      </button>
      <div id={id} popover="auto" className="menu info-pop">
        {children}
      </div>
    </>
  );
}
