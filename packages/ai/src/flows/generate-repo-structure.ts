/**
 * generate-repo-structure — agent execution mode. Propose a repository layout
 * (flat list of file/dir nodes with purposes) for the spec'd system.
 * Materializes into a RUNBOOK / TASK_PLAN body (a code tree block).
 */
import { generateObject } from "ai";

import { languageModel } from "../models";
import { repoStructureSchema, type GeneratedRepoStructure } from "./schemas";
import { repoStructureToGenBlocks } from "./sections";
import { genBlocksToBlockNote, type BlockNoteBlock } from "./blocks";

export interface GenerateRepoStructureParams {
  source: string;
  contextBlock?: string;
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a staff engineer scaffolding a new codebase. Propose a clear repository structure as a FLAT list of nodes, each with a POSIX path, a kind (file or dir), and a one-line purpose. Cover apps, packages/libraries, config, infra, and tests. Match any stated technology preferences.`;

function userPrompt(p: GenerateRepoStructureParams): string {
  const parts: string[] = [];
  if (p.contextBlock?.trim()) parts.push(`# Context\n${p.contextBlock.trim()}`);
  parts.push(`# Propose a repo structure for:\n${p.source.trim()}`);
  return parts.join("\n\n");
}

export interface GeneratedRepoStructureDoc {
  repo: GeneratedRepoStructure;
  blocks: BlockNoteBlock[];
}

export async function generateRepoStructure(
  params: GenerateRepoStructureParams,
): Promise<GeneratedRepoStructureDoc> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: repoStructureSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
  const repo = object as GeneratedRepoStructure;
  return {
    repo,
    blocks: genBlocksToBlockNote(repoStructureToGenBlocks(repo)),
  };
}
