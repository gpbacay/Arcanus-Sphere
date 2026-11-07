// Run: node src/modules/llm/kv.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { Tensor } from "@huggingface/transformers";
import { crop, ReplyPenalty, shared } from "./kv.ts";

const ids = (...n: number[]) => BigInt64Array.from(n.map(BigInt));

// The shared start, and always one token of the new prompt left to read.
assert.equal(shared(ids(1, 2, 3, 9), ids(1, 2, 3, 4, 5)), 3);
assert.equal(shared(ids(1, 2, 3), ids(1, 2, 3)), 2);
assert.equal(shared(ids(7), ids(1, 2)), 0);
assert.equal(shared(ids(), ids(1)), 0);

// Cropping keeps the first n tokens of every layer.
const t = new Tensor("float32", Float32Array.from({ length: 2 * 4 * 3 }, (_, i) => i), [1, 2, 4, 3]);
const cut = crop({ "past_key_values.0.key": t }, 2)["past_key_values.0.key"];
assert.deepEqual(cut.dims, [1, 2, 2, 3]);
assert.deepEqual([...(cut.data as Float32Array)], [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17]);

// Only the reply's tokens are penalized; a token that is only in the prompt is not.
const logits = [{ data: Float32Array.from([2, 2, -2, 2]) }] as unknown as Tensor;
new ReplyPenalty(2, 2)([[0n, 1n, 2n, 1n]], logits);
assert.deepEqual([...(logits as unknown as { data: Float32Array }[])[0].data], [2, 1, -4, 2]);

// An earlier reply's own words are held against it; words the user or system gave are not.
const encode = (text: string) => text.split(" ").map((w) => w.length);
const before = earlier([{ role: "system", content: "a bb" }, { role: "assistant", content: "bb cccc ddd" }, { role: "user", content: "ddd" }], encode);
assert.deepEqual([...before], [4n]);
const again = [{ data: Float32Array.from([1, 1, 1, 1, 1]) }] as unknown as Tensor;
new ReplyPenalty(2, 1, before)([[0n]], again);
assert.deepEqual([...(again as unknown as { data: Float32Array }[])[0].data], [1, 1, 1, 1, 0.5]);

console.log("kv ok");
