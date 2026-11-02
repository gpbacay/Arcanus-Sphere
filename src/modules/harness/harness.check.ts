// Run: node src/modules/harness/harness.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { argsFor, callTool, matchTool, parseMcpBody, personalityReply, usePlugin } from "./index.ts";

assert.match(personalityReply(), /Arcanus/);
assert.deepEqual(argsFor({ properties: { city: {}, units: {} } }, "Manila"), { city: "Manila" });
assert.deepEqual(argsFor(undefined, "2+2"), { input: "2+2" });

const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"weather"}]}}\n';
assert.equal((parseMcpBody(sse) as { result: { tools: { name: string }[] } }).result.tools[0].name, "weather");
assert.equal((parseMcpBody('{"ok":true}') as { ok: boolean }).ok, true);

usePlugin({ name: "demo", tools: [{ name: "echo", description: "Repeats", run: (input) => input.toUpperCase() }] });
assert.equal(matchTool("please echo this")?.name, "echo");
assert.equal(matchTool("what time is it"), undefined);
assert.equal(await callTool("echo", "hello"), "HELLO");
assert.match(await callTool("missing", "x"), /No tool/);
console.log("harness ok");
