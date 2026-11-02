# Arcanus Sphere

A fully local AI assistant embodied as an audio-reactive 3D sphere. Every model runs in your browser on ONNX Runtime Web. There is no server, no API key, and nothing you type leaves the device.

## How it thinks

| Part | Model | Runs on | Job |
|---|---|---|---|
| Decide | [ARC 1](https://gpbacay-arcane.vercel.app/docs/arc-1) (1.3M params, 5.5 MB) | main thread, ~10 ms | Routes each message: chat, about Arcanus, time, or math |
| Remember | [Hippocampus](https://gpbacay-arcane.vercel.app/docs/hippocampus) + [Occipital](https://gpbacay-arcane.vercel.app/docs/occipital) | main thread | Remembered examples vote with ARC 1; also recalls Arcanus's knowledge notes, typo-tolerant |
| Write | [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct), Q4 (~170 MB) | Web Worker, WebGPU or WASM | Writes replies; can look at an attached image |
| Speak | [Paradee-8M](https://github.com/sahilmahendrakar/paradee) v1.2, int8 (8.5 MB), British male voice `bm_fable` | Web Worker, WASM, one thread | Speaks each sentence (or long clause) as soon as it is written |

Time and math are answered by ARC 1's route alone, without the language model. Every reply carries a [Chain of Thought](https://gpbacay-arcane.vercel.app/docs/chain-of-thought) trace of what Arcanus did.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first visit downloads about 180 MB of models from Hugging Face, which the browser caches for later visits. SmolVLM runs on multi-threaded WebAssembly: the app sends cross-origin isolation headers (`next.config.ts`) so ONNX Runtime can use every core.

## Speech to text

Tap the mic in the composer and talk. Arcanus stops listening when you pause (about a second of silence) and writes what you said into the message box, so you can check it before sending. Tap the mic again to finish early.

The words come from the browser's own speech recognition (the same technology as Gianne's portfolio chat), so unlike the rest of Arcanus **it is not on-device**: Chrome and Safari send the audio to their speech service, and it needs a connection. Silero VAD (`public/silero_vad.onnx`, 2.3 MB, MIT) still runs on-device: it scores every 32 ms of microphone audio for speech, which is how Arcanus knows you've stopped. If VAD can't load, recording still works and stops when you tap. In a browser with no speech recognition (Firefox), or when it hears nothing, Whisper (tiny.en, ~41 MB, English) writes down the clip on the device instead; it is only downloaded then. The microphone needs HTTPS (or localhost).

## 3D studio and AR

The orb stands in a 3D space grid. The toolbar picks what a drag does: orbit the camera, or move, rotate or resize the orb with a gizmo. Reset puts everything back.

The eye icon opens the AR view (`/ar`). On a desktop it shows a QR code for the phone; on a phone it goes straight there. AR uses the 8th Wall XR engine (`@8thwall/engine-binary`, copied to `public/external/xr` by `npm install`) for world tracking: tap a surface to place the orb, drag it to move, pinch to resize, twist to turn.

The phone's camera needs HTTPS. To try it on a phone, run `npm run dev:https` and open the computer's network address, or use a tunnel, then edit the link in the QR dialog (or set `NEXT_PUBLIC_APP_URL`).

## Offline

Arcanus is an offline-first PWA, so you can install it from the browser's address bar. After one online visit it works with no network at all.

- `public/sw.js` serves the page from cache, and refreshes it in the background when online. It also caches the app's code, the ARC 1 weights and the ONNX Runtime files.
- Transformers.js and the voice worker keep SmolVLM and Paradee in their own Cache Storage, which they read before the network. The service worker leaves them alone, so nothing is stored twice.
- The engines start only after the service worker controls the page, so everything they download is kept. Paradee speaks one silent sentence at load to warm up.
- The app asks the browser for persistent storage, so the models aren't evicted.

The service worker only registers in production builds (`npm run build && npm start`). `npm run dev` unregisters it, so stale caches never hide code changes.

## Architecture

Arcanus is a modular monolith: one Next.js app, split into feature modules that each own their state, workers and UI, and talk to each other only through a public API.

```
src/
  app/            composition root: page.tsx wires the modules together and boots the engines
  modules/
    brain/        ARC 1 routing and skills (time, math, about): skills.ts, knowledge.ts, ARCANE in arcane/
    llm/          SmolVLM: worker + client, with a cache of finished replies
    voice/        Paradee: worker + playback through the analyser, with a cache of spoken sentences
    listen/       speech to text: browser speech recognition, microphone frames, Silero VAD (vad.worker.ts), Whisper tiny.en fallback (listen.worker.ts)
    chat/         conversations (store.ts), answering (conversation.ts), the chat panel UI
    sphere/       the three.js scene, loaded as its own chunk, with a CSS orb fallback
    offline/      service worker registration, online status
  shared/         kernel every module may use: Store, Engine, Boundary, Lru, UI components
```

- **Boundaries.** A module is imported only as `@/modules/<name>` (its `index.ts`). `npm run lint` fails on deep imports, on relative imports between modules, and on `shared/` depending on a module.
- **Adding a skill.** Add one entry to `SKILLS` in `src/modules/brain/skills.ts`: a route, a description for ARC 1, seed phrasings, and a `run` that answers. Routing, memory and the chat pick it up.
- **Adding an engine.** Export an `Engine` from its module and append it to `ENGINES` in `src/app/page.tsx`: it boots on its own and gets a status pill.
- **Graceful degradation.** Engines load independently. Without ARC 1, messages go straight to SmolVLM; without SmolVLM, Arcanus still answers time, math and questions about itself (from recalled notes); without Paradee or Web Audio, replies are text only; without WebGL, or if the scene crashes, a CSS orb stands in for the sphere; if the chat crashes, an error boundary keeps the sphere alive. When storage is full, chats are saved without their images.
- **Loading.** The page is prerendered with skeletons: the conversation skeleton until saved chats are read, the orb until the three.js chunk arrives. Each part of the chat reads only its own slice of state, so a streamed token re-renders the reply being written and nothing else.
- **Caching.** The service worker caches the app, ARC 1 and the ONNX runtime; Transformers.js and the voice worker cache the model weights. In memory, a text prompt seen before is answered from the reply cache (decoding is greedy, so the model would write the same words), and a sentence spoken before replays without running Paradee. Chats are saved to `localStorage` in the background, batched, and flushed when the tab closes.
- **Optimistic updates.** Your message and a "thinking" reply appear the moment you send, even while models still load. Deletes apply at once and can be undone for six seconds instead of asking first.

Check the pure logic with `npm run check`.
