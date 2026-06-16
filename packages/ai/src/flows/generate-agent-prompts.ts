/**
 * generate-agent-prompts — agent execution mode. Produce execution-ready system
 * prompts for Backend / Frontend / DevOps / Platform agents, primed for the
 * project, each with concrete first tasks. Materializes into a RUNBOOK body.
 */
import { generateObject } from "ai";

import { languageModel } from "../models";
import { agentPromptsSchema, type GeneratedAgentPrompts } from "./schemas";
import { agentPromptsToGenBlocks } from "./sections";
import { genBlocksToBlockNote, type BlockNoteBlock } from "./blocks";

export interface GenerateAgentPromptsParams {
  source: string;
  contextBlock?: string;
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are configuring a team of coding agents to build a system. Produce one agent per discipline: Backend, Frontend, DevOps, Platform. For each, write a tight system prompt that primes the agent with the project's goals, stack, and conventions, plus a short list of concrete first tasks it should pick up. The prompts must be directly usable to drive an autonomous coding agent.`;

function userPrompt(p: GenerateAgentPromptsParams): string {
  const parts: string[] = [];
  if (p.contextBlock?.trim()) parts.push(`# Context\n${p.contextBlock.trim()}`);
  parts.push(`# Generate agent prompts for building:\n${p.source.trim()}`);
  return parts.join("\n\n");
}

export interface GeneratedAgentPromptsDoc {
  prompts: GeneratedAgentPrompts;
  blocks: BlockNoteBlock[];
}

export async function generateAgentPrompts(
  params: GenerateAgentPromptsParams,
): Promise<GeneratedAgentPromptsDoc> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: agentPromptsSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
  const prompts = object as GeneratedAgentPrompts;
  return {
    prompts,
    blocks: genBlocksToBlockNote(agentPromptsToGenBlocks(prompts)),
  };
}
