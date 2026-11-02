# Arcanus Sphere

A fully local AI assistant embodied as an audio-reactive 3D sphere. Every model runs in your browser on ONNX Runtime Web. There is no server, no API key, and nothing you type leaves the device.

## How it thinks

| Part | Model | Runs on | Job |
|---|---|---|---|
| Decide | [ARC 1](https://gpbacay-arcane.vercel.app/docs/arc-1) (1.3M params, 5.5 MB) | main thread, ~10 ms | Routes each message: chat, about Arcanus, time, or math |
| Remember | [Hippocampus](https://gpbacay-arcane.vercel.app/docs/hippocampus) + [Occipital](https://gpbacay-arcane.vercel.app/docs/occipital) | main thread | Remembered examples vote with ARC 1; also recalls Arcanus's knowledge notes, typo-tolerant |
| Write | [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct), Q4 (~170 MB) | Web Worker, WebGPU or WASM | Writes replies; can look at an attached image |
| Speak | [Kokoro-82M](https://github.com/hexgrad/kokoro), q8 (~90 MB) | Web Worker, WASM | Speaks each sentence as soon as it is written |

Time and math are answered by ARC 1's route alone, without the language model. Every reply carries a [Chain of Thought](https://gpbacay-arcane.vercel.app/docs/chain-of-thought) trace of what Arcanus did.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first visit downloads about 270 MB of models from Hugging Face, which the browser caches for later visits. SmolVLM runs on multi-threaded WebAssembly: the app sends cross-origin isolation headers (`next.config.ts`) so ONNX Runtime can use every core.

## Offline

Arcanus is an offline-first PWA, so you can install it from the browser's address bar. After one online visit it works with no network at all.

- `public/sw.js` serves the page from cache, and refreshes it in the background when online. It also caches the app's code, the ARC 1 weights and the ONNX Runtime files.
- Transformers.js and kokoro-js keep SmolVLM and Kokoro in their own Cache Storage, which they read before the network. The service worker leaves them alone, so nothing is stored twice.
- The engines start only after the service worker controls the page, so everything they download is kept. Kokoro speaks one silent sentence at load so its voice file is cached too.
- The app asks the browser for persistent storage, so the models aren't evicted.

The service worker only registers in production builds (`npm run build && npm start`). `npm run dev` unregisters it, so stale caches never hide code changes.

## Where things live

- `src/lib/brain.ts` — ARC 1 routing, Hippocampus seeds, knowledge recall, the time and math tools
- `src/lib/knowledge.ts` — what Arcanus knows about itself
- `src/lib/engines.ts` — load state for the three engines, the SmolVLM client, Kokoro playback through the analyser
- `src/workers/` — SmolVLM and Kokoro, each in its own Web Worker
- `src/lib/arcane/` — ARCANE 5.0, vendored until it is on npm (see its README)
- `src/app/components/` — the chat panel, the Chain of Thought component, the sphere

Teach the router a new phrasing by adding a line to `SEEDS` in `src/lib/brain.ts`. Check the tools with `node src/lib/tools.check.ts`.
