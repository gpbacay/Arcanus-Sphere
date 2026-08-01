import { NextRequest } from "next/server";
import { runAgentStream } from "@/lib/agent/runAgent";
import type { AgentStreamEvent, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = String(body.message || "").trim();
    const history = (Array.isArray(body.history) ? body.history : []) as ChatMessage[];
    const stream = body.stream !== false;

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }
    if (!process.env.HF_TOKEN) {
      return Response.json(
        { error: "HF_TOKEN is not configured on the server" },
        { status: 500 }
      );
    }

    if (!stream) {
      const { runAgent } = await import("@/lib/agent/runAgent");
      const result = await runAgent(history, message);
      return Response.json(result);
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (event: AgentStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          await runAgentStream(history, message, send);
        } catch (err) {
          console.error("[/api/chat]", err);
          send({
            type: "error",
            content: err instanceof Error ? err.message : "Chat failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[/api/chat]", err);
    const msg = err instanceof Error ? err.message : "Chat failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
