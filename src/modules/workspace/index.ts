// Public API of the workspace module: Arcanus's own files (.arcanus/), its source code and git, and the Files pane.
export { Files } from "./Files";
export { FILE_COMMANDS, fileCommand, sourceAction } from "./terminal";
export { sourceCommand } from "./command";
export {
  HOME,
  addBooks,
  books,
  createSkill,
  instructions,
  memories,
  read as readFile,
  ready as workspaceReady,
  remember,
  saveArtifact,
  workspace,
  write as writeFile,
  type Skill,
} from "./fs";
