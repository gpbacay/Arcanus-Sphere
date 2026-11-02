declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// onnxruntime-web ships these types in types.d.ts but leaves them out of package.json "exports".
declare module "onnxruntime-web/wasm" {
  export * from "onnxruntime-common";
}
