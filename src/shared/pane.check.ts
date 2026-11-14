// Run: node src/shared/pane.check.ts
import assert from "node:assert/strict";
import { closed, editorInArtifacts, onlyChat, osDrawsEditor, picked, placed, shifted, type View } from "./sections.ts";

const blank = (): View => ({ left: "artifacts", center: "chat", right: "os", expanded: null, artifact: "", artifactBack: "", front: "chat" });

// The chat closes and moves like the other pages.
let s = closed(blank(), "chat");
assert.equal(s.center, null);
assert.equal(s.front, "artifacts");

s = shifted(blank(), "chat", "left");
assert.equal(s.left, "chat");
assert.equal(s.center, "artifacts");
assert.equal(s.right, "os");

// Opening a page into the chat's section replaces the chat, the same as any other page.
s = placed({ ...blank(), left: "chat", center: null }, "artifacts");
assert.equal(s.left, "artifacts");
assert.equal(s.center, null);
assert.equal(s.right, "os");

// Opening a file switches to the editor and remembers the artifact. Closing the Operating System keeps the editor tab.
s = { ...blank(), ...picked(blank(), "search-engine.html") };
s = { ...s, ...picked(s, "editor") };
assert.equal(s.artifact, "editor");
assert.equal(s.artifactBack, "search-engine.html");
s = closed(s, "os");
assert.equal(s.artifact, "editor");
assert.equal(s.right, null);
assert.equal(editorInArtifacts(s), true);

const open = blank();
assert.equal(osDrawsEditor(open), false);
assert.equal(editorInArtifacts(open), true);
assert.equal(editorInArtifacts({ ...open, right: null, artifact: "search-engine.html" }), false);
assert.equal(osDrawsEditor({ ...open, expanded: "right" }), true);
assert.equal(editorInArtifacts({ ...open, left: "artifacts", center: "os", right: "chat" }), false);
assert.equal(onlyChat(open).center, "chat");
assert.equal(onlyChat(open).left, null);

console.log("pane ok");
