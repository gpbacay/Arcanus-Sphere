# ARCANE 5.0 (vendored)

`web.mjs`, `tools.mjs`, `hippocampus.mjs` and `occipital.mjs` are copied from
[gpbacay/gpbacay_arcane](https://github.com/gpbacay/gpbacay_arcane/tree/main/node) (MIT).
ARCANE 5.0, which adds Hippocampus and Occipital, is not on npm yet: npm has 4.1.0, which ships ARC 1 only.

The one local change: `web.mjs` loads its weights from `/arcane/arc1.onnx` and `/arcane/arc1.json`
(in `public/arcane/`) rather than from `new URL("./web/…", import.meta.url)`.

When `gpbacay-arcane@5` is published, delete this folder, `npm i gpbacay-arcane@5`, and import from
`gpbacay-arcane/web` and `gpbacay-arcane/occipital`.
