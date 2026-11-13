// Public API of the brain module. Other modules import from "@/modules/brain" only.
export { brainEngine, recallNotes, routeNames, teach, think, type Plan } from "./brain";
export { recallPassages } from "./library";
export { asksForFact, lookupQuery } from "./shelf";
export { grounding } from "./ground";
export { searchIntent } from "./arc1";
export type { Outcome } from "./skills";
