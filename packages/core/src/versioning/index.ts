export {
  createVersion,
  hasChangesSinceLastVersion,
  type CreateVersionInput,
  type CreatedVersion,
} from "./snapshot";

export {
  restoreVersion,
  type RestoreVersionInput,
  type RestoreResult,
} from "./restore";

export {
  diffDocuments,
  inlineWordDiff,
  diffIsEmpty,
  summarizeDiff,
  type DiffOp,
  type InlineSegment,
  type BlockDiffHunk,
  type DocumentDiff,
  type DiffStats,
} from "./diff";
