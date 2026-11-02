/** What Arcanus knows about itself. Recalled by a Hippocampus memory (word + Occipital letter search). */
export const KNOWLEDGE: { id: string; title: string; content: string }[] = [
  {
    id: "identity",
    title: "Who Arcanus is",
    content:
      "Arcanus is an AI assistant embodied as a living 3D energy sphere. It reads your message, decides what it needs, answers, and speaks the reply aloud while the sphere reacts to its voice.",
  },
  {
    id: "local",
    title: "Fully local and private",
    content:
      "Arcanus runs entirely in your web browser. Every model runs on your device with ONNX Runtime Web. No server sees your messages. The models download once and are cached, so later visits load from your device.",
  },
  {
    id: "smolvlm",
    title: "Language model: SmolVLM",
    content:
      "Arcanus writes its replies with SmolVLM-256M-Instruct, a 256 million parameter vision-language model quantized to 4 bits (Q4). It runs on WebGPU when your browser has it, otherwise on WebAssembly. Because it is a vision model, you can attach an image and ask about it.",
  },
  {
    id: "arc1",
    title: "Decision model: ARC 1",
    content:
      "ARC 1 from ARCANE is a 1.3 million parameter System 1 decision model. It does not write text. In about 10 milliseconds it decides what each message needs: a chat reply, a fact about Arcanus, the time, or a calculation. Time and math are answered instantly without the language model, which makes Arcanus faster.",
  },
  {
    id: "memory",
    title: "Memory: Hippocampus and Occipital",
    content:
      "Hippocampus is ARCANE's memory of decided examples. Similar remembered examples vote alongside ARC 1, so routing improves without retraining. Occipital reads memories by their letters, so typos and other word forms still find the right memory. Arcanus also recalls these knowledge notes through a Hippocampus memory.",
  },
  {
    id: "voice",
    title: "Voice: Paradee TTS",
    content:
      "Arcanus speaks with Paradee-8M, an open text-to-speech model by Sahil Mahendrakar distilled from Kokoro-82M, in a British male voice. It is only 8.5 MB and runs in your browser many times faster than real time. It starts speaking each sentence as soon as it is written, and the audio drives the sphere through the Web Audio analyser.",
  },
  {
    id: "sphere",
    title: "The sphere",
    content:
      "The Arcanus Sphere is a holographic orb of gold circuit traces on three nested shells, with loose broken rings and a glowing core eye. The shape is a GLB model, drawn with Three.js shaders and bloom. Every shell and ring moves on its own axes at its own speed. While Arcanus thinks they turn faster, and while it speaks the rings whirl and each shell and ring swells and shrinks at its own random rhythm, as if the orb were talking.",
  },
  {
    id: "thoughts",
    title: "Chain of thought",
    content:
      "Every reply shows how Arcanus decided: the route ARC 1 chose and how sure it was, the memories that voted, what was recalled, and which model wrote and spoke the answer.",
  },
  {
    id: "stack",
    title: "Tech stack",
    content:
      "Arcanus Sphere is a Next.js and React app with Three.js, Transformers.js, ONNX Runtime Web, Paradee and ARCANE (ARC 1, Hippocampus, Occipital). The language and voice models run in Web Workers so the sphere stays smooth.",
  },
];
