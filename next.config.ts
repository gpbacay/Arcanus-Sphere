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
      // The AR page needs the camera and motion sensors; the engine files never change for a given install.
      { source: "/ar", headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), xr-spatial-tracking=(self)" }] },
      { source: "/external/xr/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
