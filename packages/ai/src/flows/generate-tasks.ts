/**
 * generate-tasks — agent execution mode. Turn a spec (or prompt + context) into
 * a concrete task breakdown with acceptance criteria, estimates, dependencies.
 * Output materializes into a TASK_PLAN document body.
 *
 * Lazy provider: gate on hasApiKey() upstream.
 */
import { generateObject } from "ai";

import { languageModel } from "../models";
import { tasksSchema, type GeneratedTasks } from "./schemas";
import { tasksToGenBlocks } from "./sections";
import { genBlocksToBlockNote, type BlockNoteBlock } from "./blocks";

export interface GenerateTasksParams {
  /** The spec text / prompt to break down. */
  source: string;
  contextBlock?: string;
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a tech lead breaking a specification into concrete, independently-shippable engineering tasks. For each task give a title, a short description, testable acceptance criteria, a rough size (XS/S/M/L/XL), and any dependencies (by task title). Be specific and ordered so the work can start immediately.`;

function userPrompt(p: GenerateTasksParams): string {
  const parts: string[] = [];
  if (p.contextBlock?.trim()) parts.push(`# Context\n${p.contextBlock.trim()}`);
  parts.push(`# Break this down into tasks:\n${p.source.trim()}`);
  return parts.join("\n\n");
}

export interface GeneratedTasksDoc {
  tasks: GeneratedTasks;
  blocks: BlockNoteBlock[];
}

export async function generateTasks(
  params: GenerateTasksParams,
): Promise<GeneratedTasksDoc> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: tasksSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
  const tasks = object as GeneratedTasks;
  return { tasks, blocks: genBlocksToBlockNote(tasksToGenBlocks(tasks)) };
}
