# Arcanus

Arcanus is an agentic AI assistant visualized as a luminous 3D energy sphere.

## Capabilities
- Conversational chat with a small language model (MiniCPM5-1B Fable5 Thinking GGUF)
- Tool calling: web search, URL fetch, knowledge-base retrieval, document ingest
- Retrieval-Augmented Generation (RAG) over uploaded notes and seed docs
- Text-to-speech: Arcanus speaks replies aloud; the sphere reacts to the voice waveform

## Product identity
- Name: Arcanus
- Visual: audio-reactive particle sphere with bloom and lightning arcs
- Personality: precise, curious, agent-like — plans, uses tools, then answers clearly

## Architecture
- Frontend: Next.js + Three.js (Arcanus Sphere)
- Backend: Hugging Face Space (Docker) running FastAPI + llama.cpp
- Model file: MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf

## How to use
1. Ask a question in the chat panel
2. Arcanus may call tools (search, fetch, RAG) before answering
3. When the reply is ready, Arcanus speaks it; the sphere pulses with the voice
