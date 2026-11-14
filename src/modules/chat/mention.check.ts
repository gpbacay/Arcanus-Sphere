import assert from "node:assert/strict";
import { mentionQuery, rankFiles, withoutMention } from "./mention.ts";

assert.equal(mentionQuery("look at @sea"), "sea");
assert.equal(mentionQuery("look at @sea", 12), "sea");
assert.equal(mentionQuery("look at @sea and", 12), "sea");
assert.equal(mentionQuery("look at @sea and", 16), null);
assert.equal(mentionQuery("me@home"), null);
assert.equal(mentionQuery("@"), "");
assert.equal(mentionQuery("see @a @b"), "b");

assert.deepEqual(withoutMention("see @sea"), { text: "see", cursor: 3 });
assert.deepEqual(withoutMention("@sea"), { text: "", cursor: 0 });
assert.deepEqual(withoutMention("look at @sea and", 12), { text: "look at and", cursor: 8 });
assert.deepEqual(withoutMention("@sea please", 4), { text: "please", cursor: 0 });

const paths = [".arcanus/artifacts/search-engine.html", ".arcanus/memory/search.md", ".arcanus/artifacts/graph.html"];
assert.deepEqual(rankFiles(paths, "search"), [".arcanus/memory/search.md", ".arcanus/artifacts/search-engine.html"]);
assert.deepEqual(rankFiles(paths, "engine"), [".arcanus/artifacts/search-engine.html"]);
assert.equal(rankFiles([".arcanus/a.md", ".arcanus/memory/notes.md"], "", [".arcanus/memory/notes.md"])[0], ".arcanus/memory/notes.md");
assert.equal(rankFiles(paths, "nope").length, 0);
