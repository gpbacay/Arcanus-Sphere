/** The globe mark. */
export function Logo({ state, size = 28 }: { state?: string; size?: number }) {
  return (
    <span className="brand-logo" data-state={state} style={{ width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="" />
    </span>
  );
}
