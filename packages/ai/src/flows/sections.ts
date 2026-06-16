/**
 * Pure mappers from structured generation output → generator blocks
 * (`GenBlocks`), which `genBlocksToBlockNote` then turns into a BlockNote body.
 *
 * Keeping this separate from the flows means the exact same shaping is used by
 * the streaming route and the batch job, and it is unit-testable with plain
 * objects (no provider).
 */
import type { GenBlocks } from "./blocks";
import type {
  GeneratedRfc,
  GeneratedRepoStructure,
  GeneratedTasks,
  GeneratedEpics,
  GeneratedAgentPrompts,
} from "./schemas";

function heading(text: string, level: 1 | 2 | 3 = 2): GenBlocks[number] {
  return { kind: "heading", text, level };
}
function para(text: string): GenBlocks[number] {
  return { kind: "paragraph", text };
}
function bullets(items: string[]): GenBlocks {
  return items.map((text) => ({ kind: "bullet" as const, text }));
}

/** Render a generated RFC into a canonical, sectioned BlockNote body. */
export function rfcToGenBlocks(rfc: GeneratedRfc): GenBlocks {
  const out: GenBlocks = [];
  out.push(heading(rfc.title, 1));
  if (rfc.summary) out.push(para(rfc.summary));

  out.push(heading("Problem"));
  if (rfc.problem) out.push(para(rfc.problem));

  if (rfc.requirements.length > 0) {
    out.push(heading("Requirements"));
    out.push(...bullets(rfc.requirements));
  }

  if (rfc.architecture) {
    out.push(heading("Architecture"));
    out.push(para(rfc.architecture));
  }

  if (rfc.sequenceDiagrams.length > 0) {
    out.push(heading("Sequence diagrams"));
    for (const d of rfc.sequenceDiagrams) {
      if (d.title) out.push(heading(d.title, 3));
      out.push({ kind: "mermaid", text: "", code: d.mermaid });
    }
  }

  if (rfc.apiContracts.length > 0) {
    out.push(heading("API contracts"));
    for (const c of rfc.apiContracts) {
      if (c.name) out.push(heading(c.name, 3));
      out.push({ kind: "code", text: "", code: c.sketch, language: c.language });
    }
  }

  if (rfc.risks.length > 0) {
    out.push(heading("Risks"));
    out.push(...bullets(rfc.risks));
  }

  if (rfc.alternatives.length > 0) {
    out.push(heading("Alternatives considered"));
    out.push(...bullets(rfc.alternatives));
  }

  if (rfc.acceptanceCriteria.length > 0) {
    out.push(heading("Acceptance criteria"));
    out.push(...bullets(rfc.acceptanceCriteria));
  }

  return out;
}

/** Render a generated repo structure into a BlockNote body. */
export function repoStructureToGenBlocks(repo: GeneratedRepoStructure): GenBlocks {
  const out: GenBlocks = [heading("Repository structure", 1)];
  if (repo.summary) out.push(para(repo.summary));
  const tree = repo.nodes
    .map((n) => `${n.path}${n.kind === "dir" ? "/" : ""}${n.purpose ? `  — ${n.purpose}` : ""}`)
    .join("\n");
  out.push({ kind: "code", text: "", code: tree, language: "" });
  return out;
}

/** Render generated tasks into a BlockNote body (TASK_PLAN). */
export function tasksToGenBlocks(tasks: GeneratedTasks): GenBlocks {
  const out: GenBlocks = [heading("Tasks", 1)];
  for (const t of tasks.tasks) {
    out.push(heading(`${t.title} (${t.estimate})`, 3));
    if (t.description) out.push(para(t.description));
    if (t.dependsOn.length > 0) out.push(para(`Depends on: ${t.dependsOn.join(", ")}`));
    if (t.acceptanceCriteria.length > 0) {
      out.push(...t.acceptanceCriteria.map((c) => ({ kind: "bullet" as const, text: c })));
    }
  }
  return out;
}

/** Render generated epics into a BlockNote body. */
export function epicsToGenBlocks(epics: GeneratedEpics): GenBlocks {
  const out: GenBlocks = [heading("Epics", 1)];
  for (const e of epics.epics) {
    out.push(heading(e.title, 3));
    if (e.goal) out.push(para(e.goal));
    if (e.taskTitles.length > 0) {
      out.push(...e.taskTitles.map((t) => ({ kind: "bullet" as const, text: t })));
    }
  }
  return out;
}

/** Render generated agent prompts into a BlockNote body. */
export function agentPromptsToGenBlocks(prompts: GeneratedAgentPrompts): GenBlocks {
  const out: GenBlocks = [heading("Agent execution prompts", 1)];
  for (const a of prompts.agents) {
    out.push(heading(`${a.agent} agent`, 2));
    if (a.role) out.push(para(a.role));
    out.push(heading("System prompt", 3));
    out.push({ kind: "code", text: "", code: a.systemPrompt, language: "" });
    if (a.firstTasks.length > 0) {
      out.push(heading("First tasks", 3));
      out.push(...a.firstTasks.map((t) => ({ kind: "bullet" as const, text: t })));
    }
  }
  return out;
}
