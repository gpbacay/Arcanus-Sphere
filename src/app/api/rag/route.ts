import { NextRequest, NextResponse } from "next/server";
import { retrieveKnowledge } from "@/lib/rag/retrieve";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { query, topK } = await req.json();
    const q = String(query || "").trim();
    if (!q) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }
    const chunks = await retrieveKnowledge(q, Number(topK) || 4);
    return NextResponse.json({ chunks });
  } catch (err) {
    console.error("[/api/rag]", err);
    const message = err instanceof Error ? err.message : "RAG failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
