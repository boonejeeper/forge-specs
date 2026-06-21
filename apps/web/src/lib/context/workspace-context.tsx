"use client";

import * as React from "react";

/**
 * Client-side context carrying the resolved workspace (and optionally project)
 * for the current route. Seeded by the RSC layouts so deeply nested client
 * components (tree, switchers, mutation hooks) have the ids/slugs without
 * re-fetching or prop-drilling.
 */
export interface WorkspaceContextValue {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(
  null,
);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider.");
  }
  return ctx;
}

/** Workspace context, or null when not inside a workspace route. */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return React.useContext(WorkspaceContext);
}

export interface ProjectContextValue {
  projectId: string;
  projectSlug: string;
  projectName: string;
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: ProjectContextValue;
  children: React.ReactNode;
}) {
  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = React.useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider.");
  }
  return ctx;
}

/** Project context, or null when not inside a project route. */
export function useOptionalProject(): ProjectContextValue | null {
  return React.useContext(ProjectContext);
}
