import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arcanus",
    short_name: "Arcanus",
    description: "A fully local AI that runs in your browser, online or offline.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#04060a",
    theme_color: "#04060a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
