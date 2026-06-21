import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";

import type { OnboardingState } from "@/lib/data/onboarding";

import { NextStepsDismiss } from "./next-steps-dismiss";

/**
 * A live checklist powered by `computeOnboardingState`. Renders on the project
 * landing page and collapses to a single "all set up" line when everything is
 * done. Each step shows a check / arrow icon and (when not done) a CTA button.
 *
 * Dismissable per-project: the inner client component reads a localStorage
 * flag (`forge:nextsteps:${projectId}=hidden`) and short-circuits to null.
 */
export function NextStepsCard({
  state,
  projectId,
  scopeLabel,
}: {
  state: OnboardingState;
  projectId: string;
  scopeLabel?: string;
}) {
  const done = state.steps.every((s) => s.done);
  return (
    <NextStepsDismiss projectId={projectId}>
      <section className="rounded-lg border bg-card p-4">
        <header className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {done ? "You're all set up" : "Get started"}
          </h2>
          {scopeLabel ? (
            <span className="text-xs text-muted-foreground">· {scopeLabel}</span>
          ) : null}
          <ProgressBar fraction={state.completedFraction} />
        </header>

        {done ? (
          <p className="text-sm text-muted-foreground">
            Nice. Everything's wired up — you can dismiss this card.
          </p>
        ) : (
          <ol className="space-y-2 text-sm">
            {state.steps.map((step) => (
              <li
                key={step.id}
                className="flex items-start gap-2 rounded-md px-2 py-1.5"
              >
                <span className="mt-0.5">
                  {step.done ? (
                    <Check className="size-4 text-emerald-600" aria-hidden />
                  ) : (
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={
                        step.done ? "text-muted-foreground line-through" : "font-medium"
                      }
                    >
                      {step.label}
                    </span>
                    {!step.done && step.ctaHref ? (
                      <Link
                        href={step.ctaHref}
                        className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {step.ctaLabel ?? "Open"}
                      </Link>
                    ) : null}
                  </div>
                  {!step.done && step.hint ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </NextStepsDismiss>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
      {pct}%
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}
