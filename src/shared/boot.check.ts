// Run: node src/shared/boot.check.ts
import assert from "node:assert/strict";
import { afterGpu, bootInTurn, engineSettled, type BootEngine } from "./boot.ts";

function phase(status: BootEngine["state"]["state"]["status"] = "idle") {
  return { state: { status, off: undefined as boolean | undefined } };
}

function engine(start: (engine: BootEngine) => void, later?: boolean): BootEngine {
  const state = phase();
  const engine: BootEngine = { state, later, start() { start(engine); } };
  return engine;
}

assert.equal(engineSettled(engine(() => undefined, true)), true);
assert.equal(engineSettled(engine(() => undefined)), false);

const order: string[] = [];
const voice = engine((e) => { order.push("voice"); e.state.state = { status: "loading" }; });
const speech = engine(() => { order.push("speech"); }, true);
const llm = engine((e) => { order.push("llm"); e.state.state = { status: "loading" }; });

bootInTurn([voice, speech, llm]);
assert.deepEqual(order, ["voice", "llm"]);

const blocked = engine(() => { order.push("nope"); });
await bootInTurn([blocked], () => false);
assert.equal(order.includes("nope"), false);

const gpu: string[] = [];
let release: () => void = () => undefined;
const gate = new Promise<void>((done) => { release = done; });
const first = afterGpu(() => { gpu.push("start-a"); return gate.then(() => gpu.push("end-a")); });
const second = afterGpu(() => { gpu.push("start-b"); return Promise.resolve(); });
await Promise.resolve();
assert.deepEqual(gpu, ["start-a"]);
release();
await first;
await second;
assert.deepEqual(gpu, ["start-a", "end-a", "start-b"]);

console.log("boot ok");
