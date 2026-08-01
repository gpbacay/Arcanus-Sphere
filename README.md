# Arcanus Sphere

Agentic AI chatbot embodied as an audio-reactive 3D sphere.

## Features

- **Agent loop** with tool calling (`search_knowledge`, `web_search`, `fetch_url`, `get_current_time`, `calculate`)
- **RAG** over a local knowledge base (HF embeddings + cosine similarity)
- **TTS** via Hugging Face (browser SpeechSynthesis fallback)
- **Sphere reacts to voice** through the Web Audio API analyser
- Model target: `MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf`

## Setup

1. Copy env file and add your token:

```bash
cp .env.example .env.local
```

2. Install & run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Using the exact GGUF

Inference order:

1. **`HF_CHAT_ENDPOINT`** — your llama.cpp Space / Endpoint (`hf-space/`)
2. **Local `node-llama-cpp`** — downloads `MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf` into `.models/` (~700MB, first run only)
3. **HF Router fallback** — `Qwen/Qwen3-0.6B:featherless-ai` (also &lt;1B) if local GGUF fails

To force router-only while developing:

```env
HF_DISABLE_LOCAL_GGUF=1
```

## Security

Never commit `.env.local`. If a token was pasted into chat or committed, revoke it on Hugging Face and create a new one.
