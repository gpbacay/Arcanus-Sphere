// Run: node src/modules/device/command.check.ts
import assert from "node:assert/strict";
import { appLines, deviceCommand, focusTarget, keyName, matchApp, parseTree, pickElement, scrollTarget, specLines, typedKeys, type Specs } from "./command.ts";

assert.deepEqual(deviceCommand("launch spotify"), { kind: "open", app: "spotify", explicit: true });
assert.deepEqual(deviceCommand("please open the calculator app"), { kind: "open", app: "calculator", explicit: true });
assert.deepEqual(deviceCommand("open notepad"), { kind: "open", app: "notepad", explicit: false });
assert.equal(deviceCommand("go to youtube and search ASMR"), null);
assert.equal(deviceCommand("open youtube and search ASMR"), null);
assert.equal(deviceCommand("start a story about dragons"), null);
assert.equal(deviceCommand("run the echo tool"), null);
assert.deepEqual(deviceCommand("click the Save button in Notepad"), { kind: "click", target: "Save", app: "Notepad" });
assert.deepEqual(deviceCommand("click sign in"), { kind: "click", target: "sign in", app: undefined });
assert.deepEqual(deviceCommand("click sign in in chrome"), { kind: "click", target: "sign in", app: "chrome" });
assert.deepEqual(deviceCommand("press enter in notepad"), { kind: "key", key: "Return", app: "notepad" });
assert.deepEqual(deviceCommand("press ctrl+s"), { kind: "key", key: "ctrl+s", app: undefined });
assert.equal(deviceCommand("hit me with a joke"), null);
assert.deepEqual(deviceCommand('type "meet in the park" into notepad'), { kind: "type", text: "meet in the park", app: "notepad" });
assert.deepEqual(deviceCommand("type hello world into notepad"), { kind: "type", text: "hello world", app: "notepad" });
assert.equal(deviceCommand("type of cars that are fast"), null);
assert.deepEqual(deviceCommand("scroll down in chrome"), { kind: "scroll", direction: "down", app: "chrome" });
assert.deepEqual(deviceCommand("what apps are running?"), { kind: "apps" });
assert.deepEqual(deviceCommand("list open windows"), { kind: "apps" });
assert.deepEqual(deviceCommand("how much RAM do I have"), { kind: "specs" });
assert.deepEqual(deviceCommand("what are my computer specs"), { kind: "specs" });
assert.equal(deviceCommand("what is a cpu"), null);
assert.equal(deviceCommand("how much memory do you use"), null);
assert.deepEqual(deviceCommand("read the notepad window"), { kind: "read", app: "notepad" });
assert.deepEqual(deviceCommand("what's on my screen"), { kind: "read" });
assert.equal(deviceCommand("tell me a joke"), null);

assert.equal(keyName("page down"), "Page_Down");
assert.equal(keyName("Control+Shift+Esc"), "ctrl+shift+Escape");
assert.equal(keyName("f5"), "F5");
assert.deepEqual(typedKeys("Hi 2"), ["shift+h", "i", "space", "2"]);
assert.equal(typedKeys("hello, world"), null);

const apps = [
  { name: "Notepad", id: "notepad" },
  { name: "YouTube Music", id: "yt" },
  { name: "File Explorer", id: "fe" },
  { name: "Google Chrome", id: "chrome" },
];
assert.equal(matchApp(apps, "notepad")?.id, "notepad");
assert.equal(matchApp(apps, "youtube", true), null); // "open youtube" is the site
assert.equal(matchApp(apps, "youtube")?.id, "yt");
assert.equal(matchApp(apps, "explorer")?.id, "fe");
assert.equal(matchApp(apps, "chrome")?.id, "chrome");
assert.equal(matchApp(apps, "photoshop"), null);

const tree = parseTree(
  [
    "App=notepad (pid 1)",
    'Window: "Untitled - Notepad", App: Notepad.',
    "\t0 window Untitled - Notepad Frame: {x: 0, y: 0, width: 800, height: 600}",
    "\t\t1 menu item File Secondary Actions: Expand Frame: {x: 0, y: 30, width: 40, height: 20}",
    "\t\t2 document Text editor Frame: {x: 0, y: 60, width: 800, height: 500}",
    "\t\t3 button Save as Frame: {x: 0, y: 0, width: 10, height: 10}",
    "\t\t4 button Save Secondary Actions: Invoke Frame: {x: 0, y: 0, width: 10, height: 10}",
  ].join("\n"),
);
assert.equal(tree.length, 5);
assert.deepEqual(tree[1], { index: "1", depth: 2, role: "menu item", title: "File", actions: ["Expand"], area: 800 });
assert.equal(pickElement(tree, "save")?.index, "4");
assert.equal(pickElement(tree, "file")?.index, "1");
assert.equal(pickElement(tree, "print"), null);
assert.equal(scrollTarget(tree), "2");
assert.equal(focusTarget(tree), "2");
assert.equal(focusTarget(parseTree("\t0 window Calc\n\t\t4 button Minimize Calculator\n\t\t46 button Seven")), "46");
assert.deepEqual(appLines("notepad -- notepad [running, pid=1234, window=Untitled - Notepad]\n"), ["notepad: Untitled - Notepad"]);

const specs: Specs = {
  host: "DESK",
  user: "gianne",
  os: { name: "Windows 11 Home", release: "10.0.26200", arch: "x64" },
  cpu: { model: "Intel i5", cores: 8 },
  memory: { total: 16 * 1024 ** 3, free: 4 * 1024 ** 3 },
  disks: [{ path: "C:", total: 512 * 1024 ** 3, free: 100 * 1024 ** 3 }],
  uptime: 3 * 3600 + 120,
};
assert.deepEqual(specLines(specs, "how much ram do I have"), ["**Memory:** 16.0 GB, 4.0 GB free"]);
assert.equal(specLines(specs, "what are my specs").length, 6); // no gpu, battery or screen known
assert.ok(specLines(specs, "how long has my pc been up")[0].includes("3 h 2 min"));

console.log("device ok");
