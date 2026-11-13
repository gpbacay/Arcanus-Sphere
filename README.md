# Arcanus Sphere

A fully local AI assistant embodied as an audio-reactive 3D sphere. Every model runs in your browser on ONNX Runtime Web. There is no API key, and nothing you type leaves the device. The one server part is a small relay for Arcanus's own browser, used only when you browse or ask it to look something up.

## How it thinks

| Part | Model | Runs on | Job |
|---|---|---|---|
| Decide | [Hippocampus](https://gpbacay-arcane.vercel.app/docs/hippocampus) + [Occipital](https://gpbacay-arcane.vercel.app/docs/occipital) | main thread, <1 ms | Routes each message (chat, about Arcanus, personality, time, math, web, tool) by remembered phrasings, typo-tolerant; learns from `/teach` and keeps it in `.arcanus/routing.json`. Also recalls Arcanus's knowledge notes |
| Read arguments | [ARC 1](https://gpbacay-arcane.vercel.app/docs/arc-1) (1.3M params, 5.5 MB) | main thread, ~10 ms | Reads a skill's arguments from the message's own words: the city in "what time is it in New York" |
| Write | [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), q4 (~180 MB), or [360M](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct), q4 (~390 MB), chosen in Settings | Web Worker, multi-threaded WASM | Writes replies (text only) |
| Speak | [Paradee-8M](https://github.com/sahilmahendrakar/paradee) v1.2, int8 (8.5 MB), British male voice `bm_fable` | Web Worker, WASM, one thread | Speaks each sentence (or long clause) as soon as it is written |

Time and math are answered without the language model. A question about Arcanus that routing misses is still answered from its knowledge notes, so the model doesn't invent a self. `npm run check` measures routing on held-out messages (`src/modules/brain/routing.check.ts`): ARC 1 was taken out of the routing vote because it routed 43% right alone and made Hippocampus worse when mixed in. Every reply carries a [Chain of Thought](https://gpbacay-arcane.vercel.app/docs/chain-of-thought) trace of what Arcanus did. That reasoning is kept apart from the response: in the chat it is its own quiet block above the reply (one line while the reply is written, closed until you open it), the Graph of Thought says what was done and never holds the reply's words, and only the response is spoken or read by a screen reader.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A browser's first visit loads about 190 MB of models (SmolLM2 180 MB, Paradee 9 MB), and Moonshine's 51 MB the first time you talk; the browser caches them for later visits. The models run on multi-threaded WebAssembly: the app sends cross-origin isolation headers (`next.config.ts`) so ONNX Runtime can use several cores.

```bash
npm run models              # optional, once: fetch the models into public/models (~250 MB, git-ignored)
npm run models -- --large   # the larger SmolLM2 too (~390 MB more)
```

With that folder in place Arcanus serves the models itself, so a first visit loads them from your own server (at once on localhost) and needs no outside service. Without it each browser downloads them from Hugging Face. The ONNX runtime is always served by Arcanus: `npm install` copies it into `public/ort/`.

## Accounts

Arcanus opens on a sign-in form. Accounts are local to the browser, in the style of OpenTill's offline accounts: there is no server, signing in and signing up work with no connection, and a password is kept only as an Argon2id hash (19 MiB, 2 passes, `hash-wasm`). Each account has its own conversations and its own `.arcanus/` files, so its instructions, memory, skills, books and what Hippocampus learned shape its own Arcanus. The models are shared and start loading behind the form. The account icon on the rail changes the name Arcanus greets you by and the password, and signs out.

Accounts keep people on a shared device apart. They do not encrypt anything: someone with the browser's developer tools can read every account's data.

## Files: `.arcanus/`

Like `.claude/` or `.cursor/` in a project, Arcanus keeps its own files in a `.arcanus/` folder (the folder icon on the rail, or `/files`):

```
.arcanus/
  ARCANUS.md            standing instructions, read before every reply (like CLAUDE.md); <!-- comments --> are never sent
  skills/<name>/SKILL.md  a skill: frontmatter `name` and `description`, then instructions. Run it with /<name> <message>
  memory/*.md           notes; the ones a message is about are recalled into the reply's context
  artifacts/            what Arcanus saved: replies (/save) and web pages
```

By default the folder lives privately in the browser (the Origin Private File System). **Open a folder** in the Files pane (Chrome and Edge) and Arcanus works in that folder on your device instead, creating `<folder>/.arcanus/`; it asks for access again after a reload. You can open and edit any file there, and **Ask Arcanus** hands a file to the model to read with your messages.

From the chat: `/skill <name> <instructions>` makes a skill, `/remember <note>` keeps a note, `/save` saves the last reply, `/context` shows what the last reply read, `/teach <route>` corrects where your last message was routed (kept in `.arcanus/routing.json`).

## Browser

The globe on the rail opens Arcanus's browser: type an address or a search. Paste a link in the chat or say "search for …" and Arcanus browses the same way, then answers from the page or the results. **Ask Arcanus** on a page keeps it in the model's context until you remove it.

Pages arrive as text through `src/app/api/web/route.ts` (a browser page can't read other sites itself) and show in reader view: most sites refuse to be framed, and the app's cross-origin isolation blocks frames anyway. Search uses DuckDuckGo, and Wikipedia when DuckDuckGo answers with a bot check. The relay refuses private and local network addresses and other sites' pages; add a rate limit before deploying it publicly. Offline, everything else still works.

## Context

Before each reply, the harness (`assemble` in `src/modules/harness`) fits what the model reads into a 3,200-character budget, most important first: the skill being run and the facts a skill found, then `ARCANUS.md`, then the page or file you handed Arcanus, then recalled notes. What doesn't fit is cut at a line break or left out, and the reply's chain of thought shows which. Older turns are cut to 600 characters. The budget sits far below SmolLM2's 8k tokens because on WebAssembly every token read delays the first word.

## Speech to text

Tap the mic once and just talk: it's a hands-free, full-duplex conversation. The microphone stays open; each time you pause (about half a second) Arcanus sends what you said, answers aloud, and keeps listening. Talk over it and it stops mid-sentence to hear you. Tap the mic again to end the conversation.

Everything runs on the device. Every 32 ms of microphone audio is scored for speech by Silero VAD (2 MB), or by its loudness over the room's noise when Silero is busy; `src/modules/listen/segment.ts` cuts each utterance out of the stream; Moonshine tiny (English, about 51 MB, on the CPU) writes it down in a worker while the mic keeps listening. Moonshine encodes only the audio it is given, where Whisper always encodes 30 seconds: measured in Chrome on one thread, Whisper tiny took 2.6 s for 1.5 s of speech and Moonshine tiny 0.28 s. Its encoder stays full precision, because an 8-bit encoder mishears.

That speed is what makes it live:

- **Your words appear as you say them.** Every half second while you talk, what you have said so far is written again and shown.
- **Talking over Arcanus stops it mid-sentence.** Two words of yours that are not its own echo are enough; it does not wait for you to finish. Only clear, sustained speech counts while it speaks, and anything that is mostly Arcanus's own words is dropped, so it doesn't answer itself through your speakers.
- **A sentence said in two breaths is one message.** Speak again within about a second of pausing and both halves are answered together, in place of the reply to the first half ("what time is it … in Tokyo").
- **The words are ready when you stop.** Writing starts as soon as you begin to pause, and replies start speaking at their first comma rather than their first full stop.

Headphones make barge-in the most reliable. The microphone needs HTTPS (or localhost).

### Staying real time

- **The sphere gives way to the models.** Drawing the sphere and running the models share one machine. Measured in Chrome on a 12-core laptop with integrated graphics, SmolLM2 wrote 2 tokens a second while the sphere drew 30 frames a second, and 10 to 12 at 5 frames. So while a model is working, a sphere that can't reach 50 frames a second on its own draws 12 (20 while it speaks), and goes back to full speed after (`src/modules/sphere/pace.ts`). A machine that draws it with room to spare is left alone.
- **A spoken reply reads only what is new.** Its prompt is one fixed system line, then the conversation exactly as the model read it last turn, then the new message with the notes Hippocampus and Occipital recall for it (`liveTurns` in `src/modules/harness`). SmolLM2's cache from the last reply covers everything but the new turn.
- **Each reply's trace says what it cost:** the route and how long Hippocampus took, SmolLM2's first word and tokens a second. That is where to look if it feels slow.

## 3D studio and AR

The orb stands in a 3D space grid. The toolbar picks what a drag does: orbit the camera, or move, rotate or resize the orb with a gizmo. Reset puts everything back.

The eye icon opens the AR view (`/ar`). On a desktop it shows a QR code for the phone; on a phone it goes straight there. AR uses the 8th Wall XR engine (`@8thwall/engine-binary`, copied to `public/external/xr` by `npm install`) for world tracking: tap a surface to place the orb, drag it to move, pinch to resize, twist to turn.

The phone's camera needs HTTPS. To try it on a phone, run `npm run dev:https` and open the computer's network address, or use a tunnel, then edit the link in the QR dialog (or set `NEXT_PUBLIC_APP_URL`).

## Offline

Arcanus is an offline-first PWA, so you can install it from the browser's address bar. After one visit it works with no network at all, and with `npm run models` even that first visit needs nothing but this server.

- `public/sw.js` serves the page from cache, and refreshes it in the background when online. It also caches the app's code, the ARC 1 weights and the ONNX Runtime files (served from `/ort/`, not a CDN).
- Transformers.js and the voice worker keep SmolLM2 and Paradee in their own Cache Storage, which they read before the network. The service worker leaves them alone, so nothing is stored twice.
- The engines start only after the service worker controls the page, so everything they download is kept. Paradee speaks one silent sentence at load to warm up.
- The app asks the browser for persistent storage, so the models aren't evicted.

The service worker only registers in production builds (`npm run build && npm start`). `npm run dev` unregisters it, so stale caches never hide code changes.

## Architecture

Arcanus is a modular monolith: one Next.js app, split into feature modules that each own their state, workers and UI, and talk to each other only through a public API.

```
src/
  app/            composition root: page.tsx wires the modules together and boots the engines
  modules/
    brain/        routing (routes.ts, measured by routing.check.ts), skills (skills.ts), ARC 1 arguments (arc1.ts), knowledge.ts, ARCANE in arcane/
    harness/      personality, tools, MCP, and context engineering (skill files, the context budget)
    workspace/    Arcanus's own files: .arcanus/ in the browser's private storage or a folder you open, the Files pane
    web/          Arcanus's browser: history, reader view, the Browser pane (pages come through src/app/api/web)
    llm/          SmolLM2: worker + client, with a cache of finished replies
    voice/        Paradee: worker + playback through the analyser, with a cache of spoken sentences
    listen/       speech to text, full duplex: microphone frames, Silero voice detection (vad.worker.ts), the utterance segmenter (segment.ts), Moonshine tiny (listen.worker.ts)
    mind/         the live Graph of Thought: every thought a node, its parents its edges, drawn as a graph (layout.ts)
    chat/         conversations (store.ts), answering (conversation.ts), the chat panel UI
    sphere/       the three.js scene, loaded as its own chunk, with a CSS orb fallback; pace.ts is its frame budget
    offline/      service worker registration, online status
  shared/         kernel every module may use: Store, Engine, Boundary, Lru, the HTML reader, the side-pane state, UI components
```

- **Boundaries.** A module is imported only as `@/modules/<name>` (its `index.ts`). `npm run lint` fails on deep imports, on relative imports between modules, and on `shared/` depending on a module.
- **Adding a skill.** Add a route with seed phrasings to `ROUTES` in `src/modules/brain/routes.ts`, and its `run` to `SKILLS` in `skills.ts`. Routing, memory and the chat pick it up; run `npm run check` to see routing hold up.
- **Adding an engine.** Export an `Engine` from its module and append it to `ENGINES` in `src/app/page.tsx`: it boots on its own and gets a status pill.
- **Graceful degradation.** Engines load independently. Routing needs no model; without ARC 1, a time question answers with this device's time; without SmolLM2, Arcanus still answers time, math and questions about itself (from recalled notes); without Paradee or Web Audio, replies are text only; without WebGL, or if the scene crashes, a CSS orb stands in for the sphere; if the chat crashes, an error boundary keeps the sphere alive.
- **Loading.** The page is prerendered with skeletons: the conversation skeleton until saved chats are read, the orb until the three.js chunk arrives. Each part of the chat reads only its own slice of state, so a streamed token re-renders the reply being written and nothing else.
- **Caching.** The service worker caches the app, ARC 1 and the ONNX runtime; Transformers.js and the voice worker cache the model weights. In memory, a text prompt seen before is answered from the reply cache (decoding is greedy, so the model would write the same words), and a sentence spoken before replays without running Paradee. Chats are saved to IndexedDB in the background, batched, and flushed when the tab is hidden or closed.
- **Optimistic updates.** Your message and a "thinking" reply appear the moment you send, even while models still load. Deletes apply at once and can be undone for six seconds instead of asking first.

Three checks, from fast to whole:

- `npm run check` runs the pure logic in Node: routing on held-out messages, retrieval, text handling, accounts.
- `npm run eval` scores what SmolLM2 writes for a fixed set of messages, built into the same prompts the app sends (needs `npm run models`). A prompt or model change has to beat its count; `npm run eval -- HuggingFaceTB/SmolLM2-360M-Instruct` scores the larger model.
- `npm run build && npm run e2e` boots the built app in Chrome and checks signing up, the greeting, the models loading, a sum, a written reply and a reload. Add `-- --offline` to prove a boot with every outside host blocked.
