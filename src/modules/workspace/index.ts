// Public API of the workspace module: Arcanus's own files (.arcanus/), its source code and git, and the Operating System pane.
export { OperatingSystem } from "./OperatingSystem";
export { EDITOR_PAGE } from "./Center";
export { centerAway } from "./ide";
export { FILE_COMMANDS, fileCommand, sourceAction } from "./terminal";
export { fileCatalog, fileNames, searchFiles, shortPath, type FileResults } from "./search";
export type { FileHit, FindOptions, LineHit } from "./find";
export { ide, openFile } from "./ide";
export { linkedNotes, openNote } from "./notes";
export { plainLinks } from "./links";
export { sourceCommand } from "./command";
export {
  BUILT_IN_ARTIFACTS,
  GUARDRAILS,
  HOME,
  addBooks,
  artifacts,
  books,
  createSkill,
  guardrails,
  instructions,
  lore,
  memories,
  read as readFile,
  ready as workspaceReady,
  remember,
  restoreArtifact,
  saveArtifact,
  workspace,
  write as writeFile,
  type Artifact,
  type Skill,
} from "./fs";
