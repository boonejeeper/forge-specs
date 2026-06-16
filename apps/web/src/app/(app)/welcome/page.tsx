import { Sparkles } from "lucide-react";

import { WelcomeCreate } from "@/components/workspace/welcome-create";

/**
 * Onboarding for users with no workspace yet. Standalone (outside the workspace
 * shell), so it carries its own centered layout.
 */
export default function WelcomePage() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="size-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to ForgeSpecs
          </h1>
          <p className="text-sm text-muted-foreground">
            Create your first workspace to start authoring Visions, PRDs, RFCs,
            and ADRs.
          </p>
        </div>
        <WelcomeCreate />
      </div>
    </main>
  );
}
