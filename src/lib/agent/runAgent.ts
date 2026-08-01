import type {
  AgentStep,
  AgentStreamEvent,
  ChatApiResponse,
  ChatMessage,
} from "../types";
import { chatCompletion, chatCompletionStream, getModelLabel } from "../llm/client";
import { buildFastAnswerPrompt, buildSystemPrompt } from "./prompts";
import {
  extractThought,
  finalizeReply,
  parseToolCalls,
  StreamThoughtParser,
} from "./parseToolCalls";
import { executeTool } from "./tools";
import {
  formatRetrievedContext,
  retrieveKnowledgeSync,
} from "../rag/retrieve";

const MAX_TOOL_ROUNDS = 2;

type Emit = (event: AgentStreamEvent) => void;

function planThought(userMessage: string, ragHits: number): string {
  const lines = [
    `- Query: ${userMessage.slice(0, 80)}${userMessage.length > 80 ? "…" : ""}`,
    `- RAG hits: ${ragHits}`,
  ];
  const lower = userMessage.toLowerCase();
  if (/\b(time|date|timezone|clock)\b/.test(lower)) {
    lines.push("- Route: get_current_time (fast path)");
  } else if (/[\d\s+\-*/%^().]+/.test(userMessage) && /\d/.test(userMessage) && /[+\-*/^%]/.test(userMessage)) {
    lines.push("- Route: calculate (fast path)");
  } else if (
    /\b(arcanus|sphere|rag|tool|tts|visualizer|this (app|project))\b/.test(lower) &&
    ragHits > 0
  ) {
    lines.push("- Route: answer from RAG (1 LLM call)");
  } else if (/\b(search|latest|news|who is|what is|http|www\.)\b/.test(lower)) {
    lines.push("- Route: may need web_search / fetch_url");
  } else {
    lines.push("- Route: direct answer if possible");
  }
  return lines.join("\n");
}

function needsWeb(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  return /\b(search|latest|news|today|current|weather|who is|http|www\.|look up|browse)\b/.test(
    lower
  );
}

async function streamAnswer(
  messages: ChatMessage[],
  emit: Emit,
  steps: AgentStep[],
  maxTokens = 360
): Promise<string> {
  const parser = new StreamThoughtParser();
  let streamedThought = false;

  const raw = await chatCompletionStream(messages, {
    maxTokens,
    temperature: 0.4,
    onDelta: (delta) => {
      const { thoughtDelta, answerDelta } = parser.push(delta);
      if (thoughtDelta) {
        streamedThought = true;
        emit({ type: "thought", content: thoughtDelta, append: true });
      }
      if (answerDelta) {
        emit({ type: "answer", content: answerDelta, append: true });
      }
    },
  });

  const thought = parser.getThought() || extractThought(raw);
  if (thought && !streamedThought) {
    steps.push({ type: "thought", content: thought.slice(0, 600) });
    emit({ type: "thought", content: thought.slice(0, 600) });
  } else if (thought) {
    steps.push({ type: "thought", content: thought.slice(0, 600) });
  }

  const toolCalls = parseToolCalls(raw);
  if (toolCalls.length) {
    return raw; // caller handles tools
  }

  const reply =
    parser.getAnswer() ||
    finalizeReply(raw) ||
    "Empty response — try again.";
  steps.push({ type: "answer", content: reply });
  return reply;
}

export async function runAgentStream(
  history: ChatMessage[],
  userMessage: string,
  emit: Emit
): Promise<ChatApiResponse> {
  const steps: AgentStep[] = [];

  emit({ type: "status", content: "planning" });
  const prefetch = retrieveKnowledgeSync(userMessage, 3).filter((c) => c.score > 0.12);
  const ragContext = formatRetrievedContext(prefetch);

  const planner = planThought(userMessage, prefetch.length);
  steps.push({ type: "thought", content: planner });
  emit({ type: "thought", content: planner });

  if (prefetch.length) {
    const toolContent = `RAG ${prefetch.length} chunks · top=${prefetch[0].score.toFixed(2)}`;
    steps.push({
      type: "tool",
      toolName: "search_knowledge",
      content: toolContent,
    });
    emit({
      type: "tool",
      toolName: "search_knowledge",
      content: toolContent,
    });
  }

  const prior = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6);

  const lower = userMessage.toLowerCase();

  // —— Fast path: time ——
  if (/\b(time|date|timezone|what day)\b/.test(lower) && !needsWeb(userMessage)) {
    emit({ type: "status", content: "tool:get_current_time" });
    const tzMatch = userMessage.match(/\b([A-Za-z]+\/[A-Za-z_]+)\b/);
    const result = await executeTool("get_current_time", {
      timezone: tzMatch?.[1],
    });
    steps.push({
      type: "tool",
      toolName: "get_current_time",
      content: result.slice(0, 300),
    });
    emit({ type: "tool", toolName: "get_current_time", content: result.slice(0, 300) });

    emit({ type: "status", content: "generating" });
    const messages: ChatMessage[] = [
      { role: "system", content: buildFastAnswerPrompt(ragContext) },
      ...prior,
      {
        role: "user",
        content: `${userMessage}\n\n[tool_result name=get_current_time]\n${result}`,
      },
    ];
    const replyRaw = await streamAnswer(messages, emit, steps, 220);
    if (!parseToolCalls(replyRaw).length) {
      const clean =
        steps.find((s) => s.type === "answer")?.content ||
        finalizeReply(replyRaw);
      emit({ type: "done", reply: clean, steps, model: getModelLabel() });
      return { reply: clean, steps, model: getModelLabel() };
    }
  }

  // —— Fast path: calculate ——
  const mathMatch = userMessage.match(
    /(?:calculate|compute|what is|whats|=)?\s*([\d().+\-*/%\s^]+)\??$/i
  );
  if (
    mathMatch &&
    /[+\-*/^%]/.test(mathMatch[1]) &&
    mathMatch[1].replace(/\s/g, "").length >= 3
  ) {
    emit({ type: "status", content: "tool:calculate" });
    const expression = mathMatch[1].trim();
    const result = await executeTool("calculate", { expression });
    steps.push({
      type: "tool",
      toolName: "calculate",
      content: `${expression} → ${result}`,
    });
    emit({
      type: "tool",
      toolName: "calculate",
      content: `${expression} → ${result}`,
    });

    const thought = `- Evaluate \`${expression}\`\n- Result: ${result}`;
    steps.push({ type: "thought", content: thought });
    emit({ type: "thought", content: thought, append: true });

    const reply = `Result: **${result}**`;
    steps.push({ type: "answer", content: reply });
    emit({ type: "answer", content: reply });
    emit({ type: "done", reply, steps, model: getModelLabel() });
    return { reply, steps, model: "heuristic:calculate" };
  }

  // —— Fast path: strong RAG, no web needed ——
  const arcanusLocal =
    prefetch.length > 0 &&
    prefetch[0].score > 0.18 &&
    !needsWeb(userMessage) &&
    /\b(arcanus|sphere|rag|tool|tts|model|visualizer|capability|who are you|what can you)\b/i.test(
      userMessage
    );

  if (arcanusLocal) {
    emit({ type: "status", content: "generating" });
    const messages: ChatMessage[] = [
      { role: "system", content: buildFastAnswerPrompt(ragContext) },
      ...prior,
      { role: "user", content: userMessage },
    ];
    const replyRaw = await streamAnswer(messages, emit, steps, 280);
    if (!parseToolCalls(replyRaw).length) {
      const clean =
        steps.find((s) => s.type === "answer")?.content ||
        finalizeReply(replyRaw);
      emit({ type: "done", reply: clean, steps, model: getModelLabel() });
      return { reply: clean, steps, model: getModelLabel() };
    }
  }

  // —— General agent loop (max 2 rounds) ——
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(ragContext) },
    ...prior,
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emit({
      type: "status",
      content: round === 0 ? "generating" : "refining",
    });

    const parser = new StreamThoughtParser();
    let sawThought = false;
    const raw = await chatCompletionStream(messages, {
      maxTokens: round === 0 ? 320 : 280,
      temperature: 0.4,
      onDelta: (delta) => {
        const { thoughtDelta, answerDelta } = parser.push(delta);
        if (thoughtDelta) {
          sawThought = true;
          emit({ type: "thought", content: thoughtDelta, append: true });
        }
        // Only stream answer when no tool calls likely
        if (answerDelta && !/<tool_call/i.test(parser.getRaw())) {
          emit({ type: "answer", content: answerDelta, append: true });
        }
      },
    });

    const thought = parser.getThought() || extractThought(raw);
    if (thought) {
      steps.push({ type: "thought", content: thought.slice(0, 600) });
      if (!sawThought) emit({ type: "thought", content: thought.slice(0, 600) });
    }

    const toolCalls = parseToolCalls(raw);
    if (!toolCalls.length) {
      const reply =
        parser.getAnswer() ||
        finalizeReply(raw) ||
        "I am here, but my reply came back empty.";
      steps.push({ type: "answer", content: reply });
      emit({ type: "done", reply, steps, model: getModelLabel() });
      return { reply, steps, model: getModelLabel() };
    }

    messages.push({ role: "assistant", content: raw });

    // Parallel tool execution
    emit({ type: "status", content: `tools×${toolCalls.length}` });
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const result = await executeTool(call.name, call.arguments);
        return { call, result };
      })
    );

    for (const { call, result } of results) {
      const content = `${call.name}(${JSON.stringify(call.arguments)}) → ${result.slice(0, 400)}`;
      steps.push({ type: "tool", toolName: call.name, content });
      emit({ type: "tool", toolName: call.name, content });
      messages.push({
        role: "tool",
        name: call.name,
        tool_call_id: call.id,
        content: result.slice(0, 2500),
      });
    }

    messages.push({
      role: "user",
      content:
        "Tool results above. Output brief <think> then the FINAL answer only. No more tools.",
    });
  }

  emit({ type: "status", content: "finalizing" });
  const fallback = await chatCompletion(messages, {
    maxTokens: 260,
    temperature: 0.35,
  });
  const thought = extractThought(fallback);
  if (thought) {
    steps.push({ type: "thought", content: thought.slice(0, 400) });
    emit({ type: "thought", content: thought.slice(0, 400) });
  }
  const reply =
    finalizeReply(fallback) ||
    "Tool limit reached — ask a narrower question.";
  steps.push({ type: "answer", content: reply });
  emit({ type: "answer", content: reply });
  emit({ type: "done", reply, steps, model: getModelLabel() });
  return { reply, steps, model: getModelLabel() };
}

/** Non-stream wrapper for compatibility. */
export async function runAgent(
  history: ChatMessage[],
  userMessage: string
): Promise<ChatApiResponse> {
  let result: ChatApiResponse | null = null;
  await runAgentStream(history, userMessage, (event) => {
    if (event.type === "done") {
      result = {
        reply: event.reply,
        steps: event.steps,
        model: event.model,
      };
    }
  });
  if (!result) throw new Error("Agent produced no result");
  return result;
}
