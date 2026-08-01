import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@huggingface/inference", "openai", "node-llama-cpp"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
