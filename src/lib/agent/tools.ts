import type { ToolDefinition } from "../types";
import { formatRetrievedContext, retrieveKnowledge } from "../rag/retrieve";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_knowledge",
    description:
      "Search Arcanus local knowledge base (RAG). Use for questions about Arcanus, its features, model, stack, or sphere.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for the knowledge base",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the public internet for current facts, news, docs, or anything not in the knowledge base.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch a URL and return readable text content from the page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "get_current_time",
    description: "Get the current date and time in ISO and locale formats.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Optional IANA timezone, e.g. Asia/Manila",
        },
      },
    },
  },
  {
    name: "calculate",
    description: "Evaluate a safe arithmetic expression (+ - * / % ^ parentheses).",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Math expression, e.g. (12 + 3) * 2",
        },
      },
      required: ["expression"],
    },
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function webSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ArcanusSphere/1.0" },
  });
  if (!res.ok) throw new Error(`web_search failed: ${res.status}`);
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const lines: string[] = [];
  if (data.Heading) lines.push(`Heading: ${data.Heading}`);
  if (data.AbstractText) {
    lines.push(`Summary: ${data.AbstractText}`);
    if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
  }
  const related = (data.RelatedTopics || [])
    .filter((t) => t.Text)
    .slice(0, 5)
    .map((t) => `- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ""}`);
  if (related.length) {
    lines.push("Related:");
    lines.push(...related);
  }
  if (!lines.length) {
    return `No structured results for "${query}". Try fetch_url on a specific page, or rephrase.`;
  }
  return lines.join("\n");
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    return "Error: url must start with http:// or https://";
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "ArcanusSphere/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return `Error fetching URL: HTTP ${res.status}`;
  const html = await res.text();
  const text = stripHtml(html).slice(0, 6000);
  return text || "Page had no readable text.";
}

function calculate(expression: string): string {
  const cleaned = expression.replace(/\s+/g, "");
  if (!/^[\d+\-*/%^().]+$/.test(cleaned)) {
    return "Error: only digits and + - * / % ^ ( ) are allowed.";
  }
  const jsExpr = cleaned.replace(/\^/g, "**");
  try {
    const value = Function(`"use strict"; return (${jsExpr});`)();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "Error: expression did not evaluate to a finite number.";
    }
    return String(value);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "invalid expression"}`;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "search_knowledge": {
      const query = String(args.query || "");
      const chunks = await retrieveKnowledge(query, 4);
      return formatRetrievedContext(chunks);
    }
    case "web_search": {
      return webSearch(String(args.query || ""));
    }
    case "fetch_url": {
      return fetchUrl(String(args.url || ""));
    }
    case "get_current_time": {
      const timezone = args.timezone ? String(args.timezone) : undefined;
      const now = new Date();
      try {
        const locale = now.toLocaleString("en-US", timezone ? { timeZone: timezone } : undefined);
        return JSON.stringify({
          iso: now.toISOString(),
          locale,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } catch {
        return JSON.stringify({ iso: now.toISOString(), error: "Invalid timezone" });
      }
    }
    case "calculate": {
      return calculate(String(args.expression || ""));
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export function toolsPromptBlock(): string {
  return TOOL_DEFINITIONS.map(
    (t) =>
      `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters.properties)}`
  ).join("\n");
}
