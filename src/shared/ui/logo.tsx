/** The globe mark. Dark theme shows the white glyph; light theme shows the ink glyph. */
export function Logo({ state, size = 28 }: { state?: string; size?: number }) {
  return (
    <span className="brand-logo" data-state={state} style={{ width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="" className="brand-logo-dark" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-light.png" alt="" className="brand-logo-light" />
    </span>
  );
}
