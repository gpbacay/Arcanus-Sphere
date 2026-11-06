// Run: node src/shared/html.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";
import { decode, plainText, readDuckDuckGo, readHtml, readWikipedia } from "./html.ts";

assert.equal(decode("a &amp; b &#39;c&#x27; &bogus; &#0;"), "a & b 'c' &bogus; &#0;");

const page = readHtml(
  `<html><head><title>Sea &amp; Sky</title><script>alert(1)</script></head><body>
   <nav><a href="/menu">Menu</a></nav>
   <main><h1>Tides</h1><p>The <b>moon</b> pulls the sea. See <a href="/wiki/Moon">the Moon</a>.</p>
   <ul><li>High tide</li><li>Low tide</li></ul><a href="javascript:alert(1)">bad</a></main></body></html>`,
  "https://example.com/tides"
);
assert.equal(page.title, "Sea & Sky");
assert.equal(page.text, "# Tides\nThe moon pulls the sea. See [the Moon](https://example.com/wiki/Moon) .\n- High tide\n- Low tide\nbad");
assert.ok(!page.text.includes("Menu") && !page.text.includes("alert"));
assert.equal(plainText(page.text).split("\n")[1], "The moon pulls the sea. See the Moon .");

const ddg = readDuckDuckGo(
  `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMount_Everest&amp;rut=x">Mount <b>Everest</b></a>
   <a class="result__snippet" href="#">8,849 m tall.</a>
   <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Ad</a>`
);
assert.deepEqual(ddg, [{ title: "Mount Everest", url: "https://en.wikipedia.org/wiki/Mount_Everest", snippet: "8,849 m tall." }]);

const wiki = readWikipedia({ query: { search: [{ title: "Mount Everest", snippet: 'Earth&#039;s <span class="searchmatch">highest</span>' }] } });
assert.deepEqual(wiki, [{ title: "Mount Everest", url: "https://en.wikipedia.org/wiki/Mount_Everest", snippet: "Earth's highest" }]);
console.log("html ok");
