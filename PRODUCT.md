# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: the owner (or a small set of power users) using Arcanus as a personal agentic assistant — research, recall, and tool-using help in a solo session. Not multi-tenant product use.

## Product Purpose

Arcanus is a fully local AI assistant embodied as an audio-reactive 3D sphere. The user asks questions in chat or by voice; Hippocampus decides what the message needs, Arcanus answers time and math itself, recalls its own knowledge, writes replies with SmolLM2, and speaks them with Paradee while the sphere reacts to the voice.

Success: clear, trustworthy answers with reliable tool/RAG behavior, plus a living sphere+voice presence that makes the assistant feel present — not a plain chat box.

## Positioning

Embodiment, agent competence, and a local/small-model path are one product — none is optional decoration. A neighboring plain LLM chat UI cannot truthfully claim the inseparable combination of: audio-reactive 3D sphere presence with TTS coupling; a System 1 decision model with memory that routes before the language model runs; and an inference stack that runs entirely on the user's device.

## Operating Context

- Single-page web app (Next.js): chat panel + Three.js sphere scene; no server-side inference
- Decide: Hippocampus + Occipital (ARCANE), main thread, under 1 ms per message; ARC 1 reads skill arguments
- Write: SmolLM2-Instruct q4 on multi-threaded WASM (135M, or 360M chosen in Settings) via Transformers.js / ONNX Runtime Web, in a Web Worker
- Speak: Paradee-8M, in a Web Worker; audio drives the sphere through the Web Audio analyser
- Hear: Moonshine tiny, in a Web Worker; live voice is full duplex, with the user's words written as they speak
- Knowledge notes live in `src/modules/brain/knowledge.ts`; skills and their routing examples in `src/modules/brain/skills.ts`
- Models are served by the app itself when `npm run models` has fetched them, otherwise downloaded from Hugging Face on first visit; either way the browser caches them
- Local accounts (Argon2id, no server): each has its own conversations and `.arcanus/` files

## Capabilities and Constraints

Confirmed capabilities:
- Routing with a Hippocampus memory that learns from /teach; time and calculate answered without the language model
- Knowledge recall from a Hippocampus memory (word + Occipital letter matching)
- Streaming replies spoken sentence by sentence, with an on-screen caption
- Chain of Thought trace on every reply, a live Graph of Thought, conversations persisted in the browser
- Web search and page reading through a small relay (`/api/web`), only when the user browses or asks to look something up

Constraints:
- Platform is web (browser); not a native app
- Small-model / local-first path is identity — do not redefine the product as a generic hosted-chat wrapper
- Inference is fully local: no model runs on a server, and conversations never leave the device. The web relay is the one server part
- SmolLM2 is tiny: replies are short and can be wrong; keep facts in the knowledge notes
- Multi-user accounts, billing, and public SaaS claims: undecided / out of current scope

## Brand Commitments

- Name: **Arcanus** (product surface also called Arcanus Sphere)
- Voice: precise, curious, agent-like — plans, uses tools, then answers clearly; concise unless detail is asked
- Embodiment commitment: luminous audio-reactive 3D energy sphere as the assistant’s presence (particle sphere with voice-coupled reaction). Visual system details belong in design work, not here — the presence itself is product truth.

## Evidence on Hand

- Seed/product knowledge: `src/modules/brain/knowledge.ts`
- Runnable app: `src/app/` (composition root), feature modules under `src/modules/` (brain, llm, voice, chat, sphere, offline), shared kernel under `src/shared/`
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
