import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Cross-origin isolation unlocks SharedArrayBuffer, so ONNX Runtime Web runs its WASM on several threads.
  // "credentialless" keeps the CORS model and runtime downloads (Hugging Face, jsDelivr) working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
