import { NextRequest, NextResponse } from "next/server";
import {
  InferenceClient,
  type InferenceProviderOrPolicy,
} from "@huggingface/inference";

export const runtime = "nodejs";
export const maxDuration = 60;

type TtsTarget = {
  model: string;
  provider?: InferenceProviderOrPolicy;
};

/**
 * Prefer Kokoro via fal-ai — confirmed working on this account.
 * Skip models with no Inference Provider (e.g. facebook/mms-tts-eng).
 */
function resolveTargets(): TtsTarget[] {
  const fromEnv = process.env.HF_TTS_MODEL?.trim();
  const provider = (process.env.HF_TTS_PROVIDER?.trim() ||
    "fal-ai") as InferenceProviderOrPolicy;

  const targets: TtsTarget[] = [];

  if (fromEnv && !fromEnv.includes("mms-tts")) {
    const [model, envProvider] = fromEnv.includes(":")
      ? (fromEnv.split(":") as [string, InferenceProviderOrPolicy])
      : [fromEnv, provider];
    targets.push({ model, provider: envProvider || provider });
  }

  targets.push({ model: "hexgrad/Kokoro-82M", provider: "fal-ai" });

  // De-dupe by model+provider
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = `${t.model}:${t.provider || "auto"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    const input = String(text || "").trim().slice(0, 800);
    if (!input) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const token = process.env.HF_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "HF_TOKEN missing" }, { status: 500 });
    }

    const client = new InferenceClient(token);
    let lastError: unknown;
    const targets = resolveTargets();

    for (const target of targets) {
      try {
        const blob = await client.textToSpeech({
          model: target.model,
          provider: target.provider,
          inputs: input,
        });
        const buffer = Buffer.from(await blob.arrayBuffer());
        const contentType = blob.type || "audio/wav";
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
            "X-Arcanus-TTS-Model": target.model,
            "X-Arcanus-TTS-Provider": target.provider || "auto",
          },
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`TTS failed for ${target.model} (${target.provider}): ${msg}`);
      }
    }

    return NextResponse.json(
      {
        error:
          lastError instanceof Error
            ? lastError.message
            : "No HF TTS provider available — client will use browser speech",
      },
      { status: 503 }
    );
  } catch (err) {
    console.error("[/api/tts]", err);
    const message = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
