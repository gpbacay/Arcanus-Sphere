"use client";
import { useEffect, useState } from "react";
export default function Page() {
  const [out, setOut] = useState("waiting");
  useEffect(() => {
    const w = new Worker(new URL("../../workers/tts.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "ready") w.postMessage({ type: "speak", gen: 0, text: "Good evening, sir. All systems are online, and the weather in London is twenty one degrees." });
      else if (data.type === "audio") {
        const b = new Uint8Array((data.samples as Float32Array).buffer); let s = ""; for (const x of b) s += String.fromCharCode(x);
        setOut(`R${data.rate}B64:` + btoa(s));
      } else if (data.type === "error") setOut("ERROR " + data.message);
    };
    w.postMessage({ type: "load" });
  }, []);
  return <pre id="out">{out}</pre>;
}
