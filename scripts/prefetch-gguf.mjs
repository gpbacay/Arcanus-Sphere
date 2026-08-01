import path from "path";
import { resolveModelFile } from "node-llama-cpp";

const repo =
  process.env.HF_GGUF_REPO ||
  "GnLOLot/MiniCPM5-1B-Claude-Opus-Fable5-Thinking-GGUF";
const file =
  process.env.HF_GGUF_FILE ||
  "MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf";

const uri = `hf:${repo}/${file}`;
const directory = path.join(process.cwd(), ".models");

console.log(`Prefetching ${uri} → ${directory}`);

const modelPath = await resolveModelFile(uri, {
  directory,
  download: "auto",
  tokens: { huggingFace: process.env.HF_TOKEN },
  cli: true,
  onProgress: ({ totalSize, downloadedSize }) => {
    if (!totalSize) return;
    const pct = ((downloadedSize / totalSize) * 100).toFixed(1);
    process.stdout.write(`\r${pct}% (${downloadedSize}/${totalSize})`);
  },
});

console.log(`\nReady: ${modelPath}`);
