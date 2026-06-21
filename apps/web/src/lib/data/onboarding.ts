import "server-only";

import { prisma } from "@forgespecs/db";

import { hasAnyReview, hasAnyApprovedDoc } from "./collaboration";

/**
 * Cheap state probe powering both the <NextStepsCard/> on the project landing
 * and the chat's `getOnboardingState` tool. Composes existing reads with a few
 * targeted `findFirst` existence checks so the whole probe is a handful of
 * fast queries even on big projects.
 *
 * Shape is intentionally flat so the chat tool can serialize it directly and
 * the React card can render it without an adapter.
 */

export type OnboardingStepId =
  | "workspace-created"
  | "project-created"
  | "source-or-doc"
  | "first-review"
  | "first-approval";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  done: boolean;
  /** Where the user (or bot's "Take me there" button) should go to do it. */
  ctaHref?: string;
  ctaLabel?: string;
  /** Short, one-line "why this matters" string for the bot to cite. */
  hint?: string;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  nextStepId: OnboardingStepId | null;
  completedFraction: number;
  /** Useful flags the chat tool can pass through to the model for prompt grounding. */
  signals: {
    hasIngestSource: boolean;
    docCount: number;
    aiAvailable: boolean;
    localIngestEnabled: boolean;
  };
}

export interface OnboardingScope {
  workspaceId?: string;
  workspaceSlug?: string;
  projectId?: string;
  projectSlug?: string;
}

export async function computeOnboardingState(
  scope: OnboardingScope,
): Promise<OnboardingState> {
  const aiAvailable = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const localIngestEnabled = Boolean(
    process.env.INGEST_LOCAL_ALLOWED_ROOTS?.trim(),
  );

  const hasWorkspace = !!scope.workspaceId;
  const hasProject = hasWorkspace && !!scope.projectId;

  // Project-scoped probes — only fire when we have a project context.
  let docCount = 0;
  let hasIngestSource = false;
  let reviewed = false;
  let approved = false;
  if (hasProject && scope.projectId) {
    [docCount, hasIngestSource, reviewed, approved] = await Promise.all([
      prisma.document.count({ where: { projectId: scope.projectId } }),
      prisma.repoIngestSource
        .findUnique({
          where: { projectId: scope.projectId },
          select: { id: true },
        })
        .then((r) => r !== null),
      hasAnyReview(scope.projectId),
      hasAnyApprovedDoc(scope.projectId),
    ]);
  }

  const wsSlug = scope.workspaceSlug ?? scope.workspaceId ?? "";
  const projSlug = scope.projectSlug ?? scope.projectId ?? "";
  const projectBase = `/${wsSlug}/${projSlug}`;

  // The "source or doc" milestone lights up as soon as EITHER an ingest source
  // is configured OR at least one document exists — we treat them as equivalent
  // ways to "have content".
  const hasSourceOrDoc = hasIngestSource || docCount > 0;

  const steps: OnboardingStep[] = [
    {
      id: "workspace-created",
      label: "Create your first workspace",
      done: hasWorkspace,
      ctaHref: hasWorkspace ? undefined : "/welcome",
      ctaLabel: "Open welcome",
      hint: "A workspace is the tenancy boundary — members and projects live inside one.",
    },
    {
      id: "project-created",
      label: "Add a project",
      done: hasProject,
      ctaHref: hasWorkspace && !hasProject ? `/${wsSlug}` : undefined,
      ctaLabel: "Open workspace",
      hint: "A project maps to a codebase or product line.",
    },
    {
      id: "source-or-doc",
      label: localIngestEnabled
        ? "Import a repo or create your first doc"
        : "Create your first document",
      done: hasSourceOrDoc,
      ctaHref:
        !hasProject || hasSourceOrDoc
          ? undefined
          : localIngestEnabled
            ? `${projectBase}/ingest`
            : projectBase,
      ctaLabel: localIngestEnabled ? "Import from a repo" : "Open project",
      hint: localIngestEnabled
        ? "Pointing at a repo bootstraps a clean canonical doc set in seconds."
        : "Use the + in the spec tree to create a Vision, then a PRD, then RFCs.",
    },
    {
      id: "first-review",
      label: "Send a doc to review",
      done: reviewed,
      ctaHref: !hasProject || reviewed ? undefined : projectBase,
      ctaLabel: "Open project",
      hint: "Move any DRAFT doc to REVIEW from its status menu to invite reviewers.",
    },
    {
      id: "first-approval",
      label: "Get a doc approved",
      done: approved,
      ctaHref: undefined,
      ctaLabel: undefined,
      hint: "An APPROVE review on the current version flips status to APPROVED.",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);
  return {
    steps,
    nextStepId: nextStep?.id ?? null,
    completedFraction: completed / steps.length,
    signals: { hasIngestSource, docCount, aiAvailable, localIngestEnabled },
  };
}
