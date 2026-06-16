/**
 * generate-epics — agent execution mode. Roll a spec up into epics (each with a
 * goal + the task titles under it). Materializes into a TASK_PLAN body.
 */
import { generateObject } from "ai";

import { languageModel } from "../models";
import { epicsSchema, type GeneratedEpics } from "./schemas";
import { epicsToGenBlocks } from "./sections";
import { genBlocksToBlockNote, type BlockNoteBlock } from "./blocks";

export interface GenerateEpicsParams {
  source: string;
  contextBlock?: string;
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a product engineering lead grouping work into epics. For each epic give a title, a clear goal, and the titles of the tasks that roll up under it. Keep epics coherent and outcome-oriented.`;

function userPrompt(p: GenerateEpicsParams): string {
  const parts: string[] = [];
  if (p.contextBlock?.trim()) parts.push(`# Context\n${p.contextBlock.trim()}`);
  parts.push(`# Organise this work into epics:\n${p.source.trim()}`);
  return parts.join("\n\n");
}

export interface GeneratedEpicsDoc {
  epics: GeneratedEpics;
  blocks: BlockNoteBlock[];
}

export async function generateEpics(
  params: GenerateEpicsParams,
): Promise<GeneratedEpicsDoc> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: epicsSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
  const epics = object as GeneratedEpics;
  return { epics, blocks: genBlocksToBlockNote(epicsToGenBlocks(epics)) };
}
