# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: the owner (or a small set of power users) using Arcanus as a personal agentic assistant — research, recall, and tool-using help in a solo session. Not multi-tenant product use.

## Product Purpose

Arcanus is an agentic AI assistant embodied as an audio-reactive 3D sphere. The user asks questions in chat; Arcanus may plan, call tools (knowledge search, web search, URL fetch, time, calculate), retrieve from a local knowledge base (RAG), answer clearly, and speak the reply while the sphere reacts to the voice.

Success: clear, trustworthy answers with reliable tool/RAG behavior, plus a living sphere+voice presence that makes the assistant feel present — not a plain chat box.

## Positioning

Embodiment, agent competence, and a local/small-model path are one product — none is optional decoration. A neighboring plain LLM chat UI cannot truthfully claim the inseparable combination of: audio-reactive 3D sphere presence with TTS coupling; a tool-using agent loop with RAG; and an inference stack the user controls (local MiniCPM GGUF, optional HF Space/endpoint, env-driven fallbacks).

## Operating Context

- Single-page web app (Next.js): chat panel + Three.js sphere scene
- Inference order: `HF_CHAT_ENDPOINT` → local `node-llama-cpp` GGUF → HF Router fallback
- Model target: `MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf`
- TTS via Hugging Face (browser SpeechSynthesis fallback); sphere driven by Web Audio analyser
- Knowledge seed and product identity notes live under `hf-space/knowledge/`
- Requires HF token / env configuration for full stack (see `.env.example`)

## Capabilities and Constraints

Confirmed capabilities:
- Agentic chat with tool calling (`search_knowledge`, `web_search`, `fetch_url`, `get_current_time`, `calculate`)
- RAG over local knowledge (HF embeddings + cosine similarity)
- TTS with audio-reactive sphere
- Optional HF Space backend (`hf-space/`) for remote llama.cpp inference

Constraints:
- Platform is web (browser); not a native app
- Small-model / local-first path is identity — do not redefine the product as a generic hosted-chat wrapper
- Secrets stay in `.env.local`; never commit tokens
- Multi-user accounts, billing, and public SaaS claims: undecided / out of current scope

## Brand Commitments

- Name: **Arcanus** (product surface also called Arcanus Sphere)
- Voice: precise, curious, agent-like — plans, uses tools, then answers clearly; concise unless detail is asked
- Embodiment commitment: luminous audio-reactive 3D energy sphere as the assistant’s presence (particle sphere with voice-coupled reaction). Visual system details belong in design work, not here — the presence itself is product truth.

## Evidence on Hand

- Seed/product knowledge: `hf-space/knowledge/arcanus.md`
- Runnable app: `src/app/` (sphere + chat), agent/RAG/TTS under `src/lib/` and `src/app/api/`
- README setup and inference order: `README.md`
- No customer testimonials, case studies, press, or fabricated benchmarks on hand — future work must not invent them

## Product Principles

1. Presence is part of the product — the sphere and spoken replies are not ornamental chrome.
2. Agency before theater — tools and RAG must actually work; embodiment expresses a competent mind.
3. Own the stack — prefer local/small-model and swappable HF endpoints over opaque lock-in.
4. Concise and clear — answers stay tight; thinking/tool use stays purposeful.
5. Personal scale — design for a trusted solo assistant, not an enterprise multi-tenant console.

## Accessibility & Inclusion

Aim for WCAG 2.2 AA where applicable: keyboard use, contrast, focus, and usable controls for chat and voice (including the ability to follow spoken content without relying on the sphere alone).
