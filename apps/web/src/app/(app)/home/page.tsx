import { redirect } from "next/navigation";

import { listWorkspacesForCurrentUser } from "@/lib/data/workspaces";

/**
 * Landing entry for signed-in users. Routes into the user's first workspace, or
 * to onboarding if they have none. Workspace-scoped routes own the real shell.
 */
export default async function HomePage() {
  const workspaces = await listWorkspacesForCurrentUser();
  if (workspaces.length === 0) {
    redirect("/welcome");
  }
  redirect(`/${workspaces[0]!.slug}`);
}
