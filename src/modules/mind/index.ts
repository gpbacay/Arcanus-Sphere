// Public API of the mind module: Arcanus's live Graph of Thought (the store every module records into, and its layout).
// It is drawn by an artifact, .arcanus/artifacts/graph-of-thought.html, which modules/artifacts feeds.
export { processes, type Process, type Step } from "./layout";
export { clearMind, interrupted, mind, revise, settle, thought, type Operation, type Thought } from "./mind";
