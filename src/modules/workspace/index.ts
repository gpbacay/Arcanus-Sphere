// Public API of the workspace module: Arcanus's own files (.arcanus/), its source code and git, and the Arcanus OS pane.
export { Files } from "./Files";
export { FILE_COMMANDS, fileCommand, sourceAction } from "./terminal";
export { searchFiles, shortPath, type FileResults } from "./search";
export type { FileHit, FindOptions, LineHit } from "./find";
export { openFile } from "./ide";
export { sourceCommand } from "./command";
export {
  GUARDRAILS,
  HOME,
  addBooks,
  books,
  createSkill,
  guardrails,
  instructions,
  lore,
  memories,
  read as readFile,
  ready as workspaceReady,
  remember,
  saveArtifact,
  workspace,
  write as writeFile,
  type Skill,
} from "./fs";
