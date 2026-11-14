"use client";

import { View } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/shared/hooks/use-mobile";

/** View in AR, as an artifact: a QR code that opens the AR page on a phone. The link can be edited: localhost means nothing to a phone. */
export default function ArLink() {
  const mobile = useIsMobile();
  const [url, setUrl] = useState(() => `${process.env.NEXT_PUBLIC_APP_URL ?? location.origin}/ar`);
  const [qr, setQr] = useState("");

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { width: 240, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b1018", light: "#ffffff" } })
      .then((data) => live && setQr(data))
      .catch(() => live && setQr(""));
    return () => {
      live = false;
    };
  }, [url]);

  let local = false;
  try {
    local = /^(localhost|127\.|\[::1\])/.test(new URL(url).hostname);
  } catch {
    // still typing
  }

  return (
    <>
      <header className="pane-head">
        <View size={16} aria-hidden />
        <h2>View in AR</h2>
      </header>
      <div className="pane-body ar-link">
        <p>Scan with your phone&apos;s camera to put Arcanus in your room.</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code that opens Arcanus in AR" width={240} height={240} className="ar-qr" />
        ) : (
          <div className="ar-qr" style={{ width: 240, height: 240 }} />
        )}
        <input className="field" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="AR link" spellCheck={false} />
        {local && <p className="ar-warn">A phone can&apos;t open localhost. Use this computer&apos;s network address or a tunnel, over HTTPS.</p>}
        <div className="row">
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            Open here
          </a>
          {/* On a phone there is nothing to scan: this is the phone. */}
          {mobile ? (
            <Link href="/ar" className="btn btn-primary">
              Start AR
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
