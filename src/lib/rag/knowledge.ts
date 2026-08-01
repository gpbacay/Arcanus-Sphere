export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

/** Seed knowledge base for Arcanus RAG. Expand this over time. */
export const KNOWLEDGE_BASE: KnowledgeChunk[] = [
  {
    id: "arcanus-identity",
    title: "Who is Arcanus",
    content:
      "Arcanus is an agentic AI assistant embodied as a living 3D energy sphere. It can reason, call tools, search its knowledge base (RAG), browse the web, speak aloud with text-to-speech, and react visually to its own voice through the sphere animation.",
    tags: ["arcanus", "identity", "assistant"],
  },
  {
    id: "arcanus-capabilities",
    title: "Arcanus capabilities",
    content:
      "Arcanus supports: (1) conversational chat, (2) tool calling for web search, URL fetch, time, and math, (3) retrieval-augmented generation over a local knowledge base, (4) text-to-speech playback, (5) audio-reactive 3D sphere visualization while speaking.",
    tags: ["capabilities", "tools", "rag", "tts"],
  },
  {
    id: "arcanus-model",
    title: "Language model",
    content:
      "Arcanus is powered by MiniCPM5-1B-Claude-Opus-Fable5-Thinking (Q4_K_M GGUF), a ~1B-parameter thinking model fine-tuned for coding, instruction following, and tool use. It is hosted via Hugging Face and served through an OpenAI-compatible chat API when a llama.cpp endpoint is configured.",
    tags: ["model", "minicpm", "huggingface", "gguf"],
  },
  {
    id: "arcanus-rag",
    title: "How RAG works in Arcanus",
    content:
      "RAG (Retrieval-Augmented Generation) embeds the user question, finds the most relevant knowledge chunks with cosine similarity, and injects them into the model context before answering. Prefer retrieved facts over guessing when the knowledge base covers the topic.",
    tags: ["rag", "retrieval", "embeddings"],
  },
  {
    id: "arcanus-tools",
    title: "Available tools",
    content:
      "Tools: search_knowledge (query local RAG), web_search (search the public internet), fetch_url (read a webpage), get_current_time (current date/time), calculate (safe arithmetic). Arcanus should call tools when facts may be outdated or missing from memory.",
    tags: ["tools", "web", "search"],
  },
  {
    id: "arcanus-ui",
    title: "Sphere visualization",
    content:
      "The Arcanus Sphere is a Three.js particle system with bloom, lightning, and audio-reactive motion. When Arcanus speaks, TTS audio is routed through the Web Audio API analyser so bass/mid/treble drive the sphere like a talking avatar.",
    tags: ["sphere", "threejs", "visualization", "audio"],
  },
  {
    id: "project-stack",
    title: "Project tech stack",
    content:
      "Arcanus Sphere is a Next.js App Router project using React, TypeScript, Three.js, Tailwind CSS, Hugging Face Inference for LLM/TTS/embeddings, and server-side agent loops for tool calling.",
    tags: ["nextjs", "stack", "tech"],
  },
];
