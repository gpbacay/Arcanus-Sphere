import { InferenceClient } from "@huggingface/inference";
import OpenAI from "openai";
import type { ChatMessage } from "../types";
import {
  chatWithLocalGguf,
  getLocalGgufLabel,
  isLocalGgufAvailable,
} from "./localGguf";

const GGUF_REPO =
  process.env.HF_GGUF_REPO ||
  "GnLOLot/MiniCPM5-1B-Claude-Opus-Fable5-Thinking-GGUF";
const GGUF_FILE =
  process.env.HF_GGUF_FILE ||
  "MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf";

const DEFAULT_MODEL =
  process.env.HF_MODEL || "GnLOLot/MiniCPM5-1B-Claude-Opus-Fable5-Thinking";

/** Fast router SLM — keep CoT short via prompt; lower max_tokens for speed. */
const ROUTER_MODEL =
  process.env.HF_ROUTER_MODEL || "Qwen/Qwen3-0.6B:featherless-ai";

let lastUsedModel = DEFAULT_MODEL;

export function getModelLabel() {
  return lastUsedModel;
}

function requireToken() {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is missing. Add it to .env.local");
  return token;
}

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: (m.role === "tool" ? "user" : m.role) as "system" | "user" | "assistant",
    content:
      m.role === "tool"
        ? `[tool_result name=${m.name || "tool"}]\n${m.content}`
        : m.content,
  }));
}

function openAIClient(baseURL: string) {
  return new OpenAI({
    apiKey: requireToken(),
    baseURL,
    timeout: 45_000,
  });
}

async function chatViaOpenAICompatible(
  baseURL: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
) {
  const client = openAIClient(baseURL);
  const completion = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    max_tokens: maxTokens,
    temperature,
  });
  return completion.choices[0]?.message?.content?.trim() || "";
}

export type StreamHandlers = {
  onDelta?: (text: string) => void;
};

async function streamViaOpenAICompatible(
  baseURL: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  handlers?: StreamHandlers
): Promise<string> {
  const client = openAIClient(baseURL);
  const stream = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    max_tokens: maxTokens,
    temperature,
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || "";
    if (!delta) continue;
    full += delta;
    handlers?.onDelta?.(delta);
  }
  return full.trim();
}

function resolveEndpoint(): { base: string; model: string; label: string } | null {
  const endpoint = process.env.HF_CHAT_ENDPOINT?.replace(/\/$/, "");
  if (!endpoint) return null;
  return {
    base: endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`,
    model: GGUF_FILE,
    label: `GGUF-remote:${GGUF_REPO}/${GGUF_FILE}`,
  };
}

/**
 * Non-streaming completion (tool rounds / fallbacks).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 320;
  const temperature = options?.temperature ?? 0.45;
  const remote = resolveEndpoint();

  if (remote) {
    const text = await chatViaOpenAICompatible(
      remote.base,
      remote.model,
      messages,
      maxTokens,
      temperature
    );
    if (text) {
      lastUsedModel = remote.label;
      return text;
    }
  }

  if (await isLocalGgufAvailable()) {
    try {
      const text = await chatWithLocalGguf(messages, { maxTokens, temperature });
      if (text) {
        lastUsedModel = `GGUF-local:${getLocalGgufLabel()}`;
        return text;
      }
    } catch (err) {
      console.warn("Local GGUF inference failed", err);
    }
  }

  try {
    const text = await chatViaOpenAICompatible(
      "https://router.huggingface.co/v1",
      ROUTER_MODEL,
      messages,
      maxTokens,
      temperature
    );
    if (text) {
      lastUsedModel = ROUTER_MODEL;
      return text;
    }
  } catch (err) {
    console.warn("HF router chat failed", err);
  }

  const client = new InferenceClient(requireToken());
  const result = await client.chatCompletion({
    model: DEFAULT_MODEL,
    messages: toOpenAIMessages(messages),
    max_tokens: maxTokens,
    temperature,
  });
  const content = result.choices?.[0]?.message?.content?.trim();
  if (content) {
    lastUsedModel = DEFAULT_MODEL;
    return content;
  }
  throw new Error("LLM request failed");
}

/**
 * Streaming completion — preferred for final answers (faster perceived latency).
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number; onDelta?: (t: string) => void }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 360;
  const temperature = options?.temperature ?? 0.45;
  const remote = resolveEndpoint();

  if (remote) {
    try {
      const text = await streamViaOpenAICompatible(
        remote.base,
        remote.model,
        messages,
        maxTokens,
        temperature,
        { onDelta: options?.onDelta }
      );
      if (text) {
        lastUsedModel = remote.label;
        return text;
      }
    } catch (err) {
      console.warn("Remote GGUF stream failed, falling back", err);
    }
  }

  // Local GGUF has no true token stream — emit once
  if (await isLocalGgufAvailable()) {
    try {
      const text = await chatWithLocalGguf(messages, { maxTokens, temperature });
      if (text) {
        lastUsedModel = `GGUF-local:${getLocalGgufLabel()}`;
        options?.onDelta?.(text);
        return text;
      }
    } catch (err) {
      console.warn("Local GGUF failed", err);
    }
  }

  try {
    const text = await streamViaOpenAICompatible(
      "https://router.huggingface.co/v1",
      ROUTER_MODEL,
      messages,
      maxTokens,
      temperature,
      { onDelta: options?.onDelta }
    );
    if (text) {
      lastUsedModel = ROUTER_MODEL;
      return text;
    }
  } catch (err) {
    console.warn("HF router stream failed, non-stream fallback", err);
  }

  const text = await chatCompletion(messages, { maxTokens, temperature });
  options?.onDelta?.(text);
  return text;
}
