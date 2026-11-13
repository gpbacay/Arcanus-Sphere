// Downloads Arcanus's models from Hugging Face into public/models, so the app serves them itself: a first visit then
// loads them from this server (at once on localhost) and needs no outside service. Without this step Arcanus still
// works; each browser downloads the models from Hugging Face on its first visit instead. Run: npm run models
// Also what `npm run eval` reads SmolLM2 from. The folder is git-ignored (~250 MB). Safe to run again: finished files are skipped.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// [repo, revision, files]. Keep in step with llm.worker.ts, listen.worker.ts and tts.worker.ts.
const MODELS = [
  ["HuggingFaceTB/SmolLM2-135M-Instruct", "main", ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_q4.onnx"]],
  ["onnx-community/moonshine-tiny-ONNX", "main", ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "onnx/encoder_model.onnx", "onnx/decoder_model_merged_quantized.onnx"]],
  ["sahilmahendrakar/Paradee-8M-v1.2", "v1.2", ["config.json", "onnx/paradee_int8.onnx"]],
];
// The larger SmolLM2 (Settings, "Language model"): `npm run models -- --large` fetches it as well (~390 MB more).
const LARGE = ["HuggingFaceTB/SmolLM2-360M-Instruct", "main", MODELS[0][2]];
const wanted = process.argv.includes("--large") ? [...MODELS, LARGE] : MODELS;
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");

let failed = 0;
for (const [name, revision, list] of wanted) {
  for (const file of list) {
    const path = join(dest, name, file);
    if (existsSync(path)) continue;
    const url = `https://huggingface.co/${name}/resolve/${revision}/${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      mkdirSync(dirname(path), { recursive: true });
      // Written beside it and renamed when whole, so a download cut short is never taken for the file.
      await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.part`));
      renameSync(`${path}.part`, path);
      console.log(`[models] ${name}/${file} · ${(statSync(path).size / 1e6).toFixed(1)} MB`);
    } catch (err) {
      failed++;
      console.warn(`[models] ${name}/${file} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
console.log(failed ? `[models] ${failed} files failed. Run it again to retry them.` : "[models] Everything is in public/models.");
process.exit(failed ? 1 : 0);
