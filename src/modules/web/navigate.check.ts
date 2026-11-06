// Run: node src/modules/web/navigate.check.ts
import assert from "node:assert/strict";
import { browserUrl, commandTool, mergeCall } from "./navigate.ts";

assert.equal(browserUrl("youtube", "ASMR"), "https://www.youtube.com/results?search_query=ASMR");
assert.equal(browserUrl("YouTube"), "https://www.youtube.com/");
assert.equal(browserUrl("https://github.com/gpbacay", "arcane"), "https://github.com/search?q=arcane&type=repositories");
assert.equal(browserUrl("example.com/docs"), "https://example.com/docs");
assert.equal(browserUrl("nytimes"), "https://www.nytimes.com/");
assert.equal(browserUrl("the sky at night"), "https://www.google.com/search?q=the%20sky%20at%20night");

const go = commandTool("go to youtube and search ASMR");
assert.equal(go?.name, "open_browser");
assert.equal(go?.arguments.site, "youtube");
assert.equal(go?.arguments.query, "ASMR");
assert.equal(browserUrl(go!.arguments.site, go!.arguments.query), "https://www.youtube.com/results?search_query=ASMR");
assert.equal(commandTool("open https://github.com")?.arguments.site, "https://github.com");
assert.equal(commandTool("read https://news.ycombinator.com")?.name, "read_page");
assert.equal(commandTool("search the web for electric cars")?.arguments.query, "electric cars");
assert.equal(commandTool("what time is it"), null);

const merged = mergeCall({ name: "open_browser", arguments: { site: "ASMR", query: "ASMR" } }, go);
assert.equal(merged?.arguments.site, "youtube");
assert.equal(merged?.arguments.query, "ASMR");
const held = mergeCall(null, go);
assert.equal(held?.name, "open_browser");
assert.equal(browserUrl(held!.arguments.site, held!.arguments.query).includes("search_query=ASMR"), true);

console.log("navigate ok");
