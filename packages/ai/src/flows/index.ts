export { runChat, buildChatTools, type ChatFlowParams } from "./chat";
export { runRefine, type RefineParams, type RefineMode } from "./refine";
export {
  searchSpecsInput,
  getDocumentInput,
  getDependenciesInput,
  proposeEditInput,
  type SearchSpecsInput,
  type GetDocumentInput,
  type GetDependenciesInput,
  type ProposeEditInput,
} from "./tool-schemas";

// ── M7 generation suite ──────────────────────────────────────────────────────
export {
  genBlockSchema,
  genBlocksSchema,
  genBlockToBlockNote,
  genBlocksToBlockNote,
  type GenBlock,
  type GenBlocks,
  type BlockNoteBlock,
} from "./blocks";
export {
  docTypeEnum,
  dependencyKindEnum,
  rfcSchema,
  archNodeSchema,
  archEdgeSchema,
  architectureSchema,
  taskSchema,
  tasksSchema,
  epicSchema,
  epicsSchema,
  repoNodeSchema,
  repoStructureSchema,
  agentPromptSchema,
  agentPromptsSchema,
  changelogSchema,
  type GenDocType,
  type GenDependencyKind,
  type GeneratedRfc,
  type ArchNode,
  type ArchEdge,
  type GeneratedArchitecture,
  type GeneratedTask,
  type GeneratedTasks,
  type GeneratedEpic,
  type GeneratedEpics,
  type GeneratedRepoNode,
  type GeneratedRepoStructure,
  type GeneratedAgentPrompt,
  type GeneratedAgentPrompts,
  type GeneratedChangelog,
} from "./schemas";
export {
  rfcToGenBlocks,
  repoStructureToGenBlocks,
  tasksToGenBlocks,
  epicsToGenBlocks,
  agentPromptsToGenBlocks,
} from "./sections";
export {
  streamRfc,
  generateRfcDoc,
  type GenerateRfcParams,
  type GeneratedRfcDoc,
} from "./generate-rfc";
export {
  streamArchitecture,
  generateArchitecture,
  type ArchitectureInput,
  type GenerateArchitectureParams,
} from "./generate-architecture";
export {
  generateTasks,
  type GenerateTasksParams,
  type GeneratedTasksDoc,
} from "./generate-tasks";
export {
  generateEpics,
  type GenerateEpicsParams,
  type GeneratedEpicsDoc,
} from "./generate-epics";
export {
  generateRepoStructure,
  type GenerateRepoStructureParams,
  type GeneratedRepoStructureDoc,
} from "./generate-repo-structure";
export {
  generateAgentPrompts,
  type GenerateAgentPromptsParams,
  type GeneratedAgentPromptsDoc,
} from "./generate-agent-prompts";
export { generateChangelog, type ChangelogParams } from "./changelog";

// ── M12 repo ingest ──────────────────────────────────────────────────────────
export * from "./ingest/index";
