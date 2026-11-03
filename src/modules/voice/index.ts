// Public API of the voice module. Other modules import from "@/modules/voice" only.
export { voice, voiceEngine } from "./client";
export { isEcho, isIntroduction, openingLine, takeSentences } from "./text";
