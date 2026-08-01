import fs from "fs";
import path from "path";
import type { ChatMessage } from "../types";

type LlamaModule = typeof import("node-llama-cpp");

type SessionBundle = {
  session: InstanceType<LlamaModule["LlamaChatSession"]>;
};

let bundlePromise: Promise<SessionBundle> | null = null;
let activeLabel = "";

function ggufParts() {
  const repo =
    process.env.HF_GGUF_REPO ||
    "GnLOLot/MiniCPM5-1B-Claude-Opus-Fable5-Thinking-GGUF";
  const file =
    process.env.HF_GGUF_FILE ||
    "MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf";
  activeLabel = `${repo}/${file}`;
  return { repo, file, uri: `hf:${repo}/${file}` };
}

function modelsDir() {
  return path.join(process.cwd(), ".models");
}

/** True only when the GGUF is already on disk (avoids blocking first chat on download). */
export function isLocalGgufCached(): boolean {
  if (process.env.HF_DISABLE_LOCAL_GGUF === "1") return false;
  const { file } = ggufParts();
  const candidates = [
    path.join(modelsDir(), file),
    path.join(modelsDir(), `hf_${file}`),
  ];
  try {
    const entries = fs.readdirSync(modelsDir());
    return (
      candidates.some((p) => fs.existsSync(p) && fs.statSync(p).size > 100_000_000) ||
      entries.some(
        (name) =>
          name.toLowerCase().includes("minicpm5") &&
          name.toLowerCase().endsWith(".gguf") &&
          fs.statSync(path.join(modelsDir(), name)).size > 100_000_000
      )
    );
  } catch {
    return false;
  }
}

async function getSession(): Promise<SessionBundle> {
  if (bundlePromise) return bundlePromise;

  bundlePromise = (async () => {
    const llamaCpp = await import("node-llama-cpp");
    const { uri, file } = ggufParts();

    const modelPath = await llamaCpp.resolveModelFile(uri, {
      directory: modelsDir(),
      // Only auto-download if explicitly allowed
      download: process.env.HF_GGUF_AUTO_DOWNLOAD === "1" ? "auto" : false,
      fileName: file,
      tokens: { huggingFace: process.env.HF_TOKEN },
      cli: false,
    });

    const llama = await llamaCpp.getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 4096 });
    const session = new llamaCpp.LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    return { session };
  })().catch((err) => {
    bundlePromise = null;
    throw err;
  });

  return bundlePromise;
}

export function getLocalGgufLabel() {
  return activeLabel || ggufParts().uri.replace(/^hf:/, "");
}

export async function chatWithLocalGguf(
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const { session } = await getSession();

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const transcript = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "assistant") return `Assistant: ${m.content}`;
      if (m.role === "tool") return `Tool(${m.name || "tool"}): ${m.content}`;
      return `User: ${m.content}`;
    })
    .join("\n");

  const prompt = [system ? `System:\n${system}` : "", transcript, "Assistant:"]
    .filter(Boolean)
    .join("\n\n");

  session.resetChatHistory();

  const response = await session.prompt(prompt, {
    maxTokens: options?.maxTokens ?? 700,
    temperature: options?.temperature ?? 0.7,
  });

  return String(response || "").trim();
}

export async function isLocalGgufAvailable(): Promise<boolean> {
  if (process.env.HF_DISABLE_LOCAL_GGUF === "1") return false;
  try {
    await import("node-llama-cpp");
    return isLocalGgufCached();
  } catch {
    return false;
  }
}
