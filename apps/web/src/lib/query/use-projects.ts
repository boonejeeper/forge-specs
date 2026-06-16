"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { fetchProjects } from "@/lib/actions/reads";
import {
  createProject,
  renameProject,
  setProjectArchived,
} from "@/lib/actions/projects";
import type { ProjectSummary } from "@/lib/data/projects";

export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.projects.list(workspaceId),
    queryFn: () => fetchProjects(workspaceId),
  });
}

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient();
  const key = queryKeys.projects.list(workspaceId);

  return useMutation({
    mutationFn: (name: string) => createProject({ workspaceId, name }),
    onMutate: async (name: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectSummary[]>(key);
      const optimistic: ProjectSummary = {
        id: `optimistic-${Date.now()}`,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        name: name.trim(),
        description: null,
        archived: false,
        documentCount: 0,
      };
      qc.setQueryData<ProjectSummary[]>(key, (old) =>
        [...(old ?? []), optimistic].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useRenameProject(workspaceId: string) {
  const qc = useQueryClient();
  const key = queryKeys.projects.list(workspaceId);

  return useMutation({
    mutationFn: (input: { projectId: string; name: string }) =>
      renameProject({ workspaceId, ...input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectSummary[]>(key);
      qc.setQueryData<ProjectSummary[]>(key, (old) =>
        (old ?? []).map((p) =>
          p.id === input.projectId ? { ...p, name: input.name.trim() } : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useSetProjectArchived(workspaceId: string) {
  const qc = useQueryClient();
  const key = queryKeys.projects.list(workspaceId);

  return useMutation({
    mutationFn: (input: { projectId: string; archived: boolean }) =>
      setProjectArchived({ workspaceId, ...input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectSummary[]>(key);
      qc.setQueryData<ProjectSummary[]>(key, (old) =>
        (old ?? []).map((p) =>
          p.id === input.projectId ? { ...p, archived: input.archived } : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
