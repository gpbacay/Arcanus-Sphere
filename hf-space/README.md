---
title: Arcanus MiniCPM GGUF
emoji: 🔮
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Arcanus GGUF backend (llama.cpp)

Serves `MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf` with an OpenAI-compatible API.

After this Space is running, set in your Next.js `.env.local`:

```env
HF_CHAT_ENDPOINT=https://YOUR_USERNAME-YOUR_SPACE.hf.space/v1
HF_TOKEN=hf_...
```

Then Arcanus will use the exact GGUF for chat + tool loops.
