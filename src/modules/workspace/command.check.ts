// Run: node src/modules/workspace/command.check.ts   (Node 22.18+ strips the types)
// The guard on Arcanus's source (paths, git arguments) and the messages that ask for the source.
import assert from "node:assert/strict";
import { gitArgs, hidden, redirect, resolve, sourceCommand, sourceParts, words } from "./command.ts";

// Paths stay inside the project and out of what is hidden.
assert.deepEqual(sourceParts("src//app/page.tsx"), ["src", "app", "page.tsx"]);
assert.deepEqual(sourceParts("src\\app\\page.tsx"), ["src", "app", "page.tsx"]);
assert.deepEqual(sourceParts(""), []);
assert.deepEqual(sourceParts(".env.example"), [".env.example"]);
for (const bad of ["../secrets", "src/../../x", ".git/config", ".GIT/config", ".git./config", ".git /config", "GIT~1/config", "node_modules/x", ".next/x", ".env", ".env.local", "C:/Windows", "a.txt:stream", "src/..."]) {
  assert.throws(() => sourceParts(bad), bad);
}
assert.ok(hidden(".env.production") && hidden("node_modules") && !hidden(".gitignore") && !hidden("src"));

// Git: a known subcommand first, nothing that runs a program or writes outside.
assert.deepEqual(gitArgs(["commit", "-m", "fix the orb"]), ["commit", "-m", "fix the orb"]);
for (const bad of [[], ["-c", "core.pager=x", "status"], ["config", "user.name"], ["clone", "x"], ["diff", "--output=/tmp/x"], ["fetch", "ext::sh -c x"], ["log", "--exec=x"], "status", [1]]) {
  assert.throws(() => gitArgs(bad), JSON.stringify(bad));
}
assert.deepEqual(words(`commit -m "fix the orb" 'a b' c`), ["commit", "-m", "fix the orb", "a b", "c"]);

// Messages that ask for the source.
assert.deepEqual(sourceCommand("Open your source code."), { kind: "open" });
assert.deepEqual(sourceCommand("show me your own code"), { kind: "open" });
assert.deepEqual(sourceCommand("open page.tsx"), { kind: "open", path: "page.tsx" });
assert.deepEqual(sourceCommand("please read your file src/modules/voice/client.ts"), { kind: "open", path: "src/modules/voice/client.ts" });
assert.deepEqual(sourceCommand("git status"), { kind: "status" });
assert.deepEqual(sourceCommand("what branch are you on?"), { kind: "status" });
assert.deepEqual(sourceCommand("what changed in your code"), { kind: "status" });
assert.deepEqual(sourceCommand("what was your last commit"), { kind: "log" });
assert.deepEqual(sourceCommand("find takeSentences in your source code"), { kind: "find", query: "takeSentences" });
assert.deepEqual(sourceCommand("where is the greeting in your code"), { kind: "find", query: "the greeting" });
assert.deepEqual(sourceCommand("commit your changes saying fix the orb"), { kind: "commit", message: "fix the orb" });
assert.deepEqual(sourceCommand("commit your changes"), { kind: "commit", message: "" });
// Questions about Arcanus, the web and plain chat are left alone.
for (const text of ["where is your source code", "who wrote your code", "can you edit your own files", "open notepad", "open github", "open https://example.com/readme.md", "how do I center a div in css", "commit to your goals", "what did you say", "read the Notepad window"]) {
  assert.equal(sourceCommand(text), null, text);
}
console.log("source command ok");

// The terminal's paths and redirection, as cmd reads them.
assert.equal(resolve(".arcanus/source", "src\\app"), ".arcanus/source/src/app");
assert.equal(resolve(".arcanus/source", ".."), ".arcanus");
assert.equal(resolve("a", "..\\..\\.."), ""); // never climbs out
assert.equal(resolve("a/b", "\\x"), "x");
assert.equal(resolve("a/b", "arcanus:\\.arcanus"), ".arcanus");
assert.equal(resolve("a", "arcanus:"), "");
assert.equal(resolve("a", ""), "a");
assert.deepEqual(redirect("echo hi > a.txt"), { command: "echo hi", to: "a.txt", append: false });
assert.deepEqual(redirect('echo "a > b" >> "my file.txt"'), { command: 'echo "a > b"', to: "my file.txt", append: true });
assert.deepEqual(redirect('echo "a > b"'), { command: 'echo "a > b"' });
