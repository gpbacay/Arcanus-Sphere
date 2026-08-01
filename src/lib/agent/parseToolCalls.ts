import type { ToolCall } from "../types";

function randomId() {
  return `call_${Math.random().toString(36).slice(2, 10)}`;
}

function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return { value: raw };
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  const xmlBlocks = [
    ...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi),
    ...text.matchAll(/<minicpmtoolcall>\s*([\s\S]*?)\s*<\/minicpmtoolcall>/gi),
  ];

  for (const match of xmlBlocks) {
    const body = match[1].trim();
    try {
      const json = JSON.parse(body);
      const name = json.name || json.function || json.tool;
      if (!name) continue;
      calls.push({
        id: randomId(),
        name: String(name),
        arguments: safeParseArgs(json.arguments || json.parameters || json.args || {}),
      });
    } catch {
      const nameMatch = body.match(/"name"\s*:\s*"([^"]+)"/);
      const argsMatch = body.match(
        /"arguments"\s*:\s*(\{[\s\S]*\}|\[[\s\S]*\]|"[^"]*")/
      );
      if (nameMatch) {
        calls.push({
          id: randomId(),
          name: nameMatch[1],
          arguments: argsMatch ? safeParseArgs(argsMatch[1]) : {},
        });
      }
    }
  }

  const seen = new Set<string>();
  return calls.filter((c) => {
    const key = `${c.name}:${JSON.stringify(c.arguments)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function stripToolArtifacts(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<minicpmtoolcall>[\s\S]*?<\/minicpmtoolcall>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

export function extractThought(text: string): string | null {
  const closed = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (closed) return closed[1].trim();
  const open = text.match(/<think>([\s\S]*)$/i);
  if (open && !text.includes("</think>")) return open[1].trim();
  return null;
}

export function finalizeReply(text: string): string {
  const cleaned = stripToolArtifacts(text);
  if (!cleaned) return cleaned;

  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length >= 2) {
    const last = blocks[blocks.length - 1];
    const looksLikeThinking =
      /^(okay[,.]?\s+the user|let me |i need to|i should |the user is asking|from the (first|second|provided)|checking the)/i.test(
        cleaned
      );
    if (
      looksLikeThinking &&
      last.length > 12 &&
      last.length < cleaned.length * 0.7 &&
      !/^(okay[,.]?\s+the user|let me )/i.test(last)
    ) {
      return last;
    }
  }

  return cleaned;
}

/** Incremental parser for streamed model text → thought vs answer vs tools. */
export class StreamThoughtParser {
  private buf = "";
  private phase: "pre" | "think" | "after" = "pre";
  private thought = "";
  private answer = "";

  push(delta: string): { thoughtDelta: string; answerDelta: string } {
    this.buf += delta;
    let thoughtDelta = "";
    let answerDelta = "";

    // Re-scan buffer for simplicity (buffers stay small with capped max_tokens)
    const thinkOpen = this.buf.search(/<think>/i);
    const thinkClose = this.buf.search(/<\/think>/i);

    if (thinkOpen === -1) {
      // No think tag yet — treat as answer (or wait for tag)
      if (/^\s*</.test(this.buf) && this.buf.length < 16) {
        return { thoughtDelta: "", answerDelta: "" };
      }
      if (!/<tool_call/i.test(this.buf)) {
        const nextAnswer = stripToolArtifacts(this.buf);
        answerDelta = nextAnswer.slice(this.answer.length);
        this.answer = nextAnswer;
      }
      return { thoughtDelta, answerDelta };
    }

    if (thinkClose === -1) {
      const raw = this.buf.slice(thinkOpen + 7);
      thoughtDelta = raw.slice(this.thought.length);
      this.thought = raw;
      this.phase = "think";
      return { thoughtDelta, answerDelta };
    }

    const fullThought = this.buf.slice(thinkOpen + 7, thinkClose).trim();
    thoughtDelta = fullThought.slice(this.thought.length);
    this.thought = fullThought;
    this.phase = "after";

    const after = this.buf.slice(thinkClose + 8);
    if (!/<tool_call/i.test(after)) {
      const nextAnswer = stripToolArtifacts(after);
      answerDelta = nextAnswer.slice(this.answer.length);
      this.answer = nextAnswer;
    }

    return { thoughtDelta, answerDelta };
  }

  getThought() {
    return this.thought.trim();
  }

  getAnswer() {
    return this.answer.trim() || finalizeReply(this.buf);
  }

  getRaw() {
    return this.buf;
  }
}
