"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { DocumentStatus, DocumentType } from "@forgespecs/db";
import type { Scope } from "@forgespecs/core";

import { queryKeys } from "@/lib/query/keys";
import { fetchDocumentTree } from "@/lib/actions/reads";
import {
  changeDocumentStatus,
  createDocument,
  deleteDocument,
  renameDocument,
  reorderDocuments,
} from "@/lib/actions/documents";
import type { DocumentTreeItem } from "@/lib/data/documents";

type TreeKeyArgs = { workspaceId: string; projectId: string };

function projectScope({ workspaceId, projectId }: TreeKeyArgs): Scope {
  return { kind: "project", workspaceId, projectId };
}

export function useDocumentTree(projectId: string) {
  return useQuery({
    queryKey: queryKeys.documents.tree(projectId),
    queryFn: () => fetchDocumentTree(projectId),
  });
}

export function useCreateDocument({ workspaceId, projectId }: TreeKeyArgs) {
  const qc = useQueryClient();
  const key = queryKeys.documents.tree(projectId);

  return useMutation({
    mutationFn: (input: { type: DocumentType; title: string }) =>
      createDocument({ workspaceId, projectId, ...input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentTreeItem[]>(key);
      const optimistic: DocumentTreeItem = {
        id: `optimistic-${Date.now()}`,
        slug: input.title.toLowerCase().replace(/\s+/g, "-"),
        title: input.title.trim(),
        type: input.type,
        status: "DRAFT" as DocumentStatus,
        order: Number.MAX_SAFE_INTEGER,
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<DocumentTreeItem[]>(key, (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useRenameDocument({ workspaceId, projectId }: TreeKeyArgs) {
  const qc = useQueryClient();
  const key = queryKeys.documents.tree(projectId);
  const scope = projectScope({ workspaceId, projectId });

  return useMutation({
    mutationFn: (input: { documentId: string; title: string }) =>
      renameDocument({ ...input, scope }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentTreeItem[]>(key);
      qc.setQueryData<DocumentTreeItem[]>(key, (old) =>
        (old ?? []).map((d) =>
          d.id === input.documentId ? { ...d, title: input.title.trim() } : d,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteDocument({ workspaceId, projectId }: TreeKeyArgs) {
  const qc = useQueryClient();
  const key = queryKeys.documents.tree(projectId);
  const scope = projectScope({ workspaceId, projectId });

  return useMutation({
    mutationFn: (documentId: string) => deleteDocument({ documentId, scope }),
    onMutate: async (documentId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentTreeItem[]>(key);
      qc.setQueryData<DocumentTreeItem[]>(key, (old) =>
        (old ?? []).filter((d) => d.id !== documentId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useChangeDocumentStatus({
  workspaceId,
  projectId,
}: TreeKeyArgs) {
  const qc = useQueryClient();
  const key = queryKeys.documents.tree(projectId);
  const scope = projectScope({ workspaceId, projectId });

  return useMutation({
    mutationFn: (input: { documentId: string; status: DocumentStatus }) =>
      changeDocumentStatus({ ...input, scope }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentTreeItem[]>(key);
      qc.setQueryData<DocumentTreeItem[]>(key, (old) =>
        (old ?? []).map((d) =>
          d.id === input.documentId ? { ...d, status: input.status } : d,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({
        queryKey: queryKeys.documents.detail(vars.documentId),
      });
    },
  });
}

export function useReorderDocuments({ workspaceId, projectId }: TreeKeyArgs) {
  const qc = useQueryClient();
  const key = queryKeys.documents.tree(projectId);

  return useMutation({
    // The full ordered list of ids within a single type group.
    mutationFn: (orderedIds: string[]) =>
      reorderDocuments({ workspaceId, projectId, orderedIds }),
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DocumentTreeItem[]>(key);
      const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
      qc.setQueryData<DocumentTreeItem[]>(key, (old) =>
        (old ?? []).map((d) =>
          orderIndex.has(d.id) ? { ...d, order: orderIndex.get(d.id)! } : d,
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
