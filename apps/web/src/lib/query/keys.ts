/**
 * Query key factory — the single source of truth for TanStack Query cache keys.
 *
 * Centralizing keys here makes invalidation precise and refactors safe: callers
 * never hand-write string arrays. Each entity exposes hierarchical keys so a
 * broad invalidation (e.g. `queryKeys.documents.all`) cascades to its details.
 *
 * Convention: keys are `as const` tuples. `all` is the broadest scope for an
 * entity; `lists()`/`list(filters)` and `details()`/`detail(id)` narrow down.
 */
export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    lists: () => [...queryKeys.workspaces.all, "list"] as const,
    detail: (workspaceId: string) =>
      [...queryKeys.workspaces.all, "detail", workspaceId] as const,
    bySlug: (slug: string) =>
      [...queryKeys.workspaces.all, "slug", slug] as const,
  },

  projects: {
    all: ["projects"] as const,
    list: (workspaceId: string) =>
      [...queryKeys.projects.all, "list", workspaceId] as const,
    detail: (projectId: string) =>
      [...queryKeys.projects.all, "detail", projectId] as const,
  },

  memberships: {
    all: ["memberships"] as const,
    forWorkspace: (workspaceId: string) =>
      [...queryKeys.memberships.all, "workspace", workspaceId] as const,
    forUser: (userId: string) =>
      [...queryKeys.memberships.all, "user", userId] as const,
  },

  documents: {
    all: ["documents"] as const,
    list: (projectId: string) =>
      [...queryKeys.documents.all, "list", projectId] as const,
    tree: (projectId: string) =>
      [...queryKeys.documents.all, "tree", projectId] as const,
    detail: (documentId: string) =>
      [...queryKeys.documents.all, "detail", documentId] as const,
    versions: (documentId: string) =>
      [...queryKeys.documents.all, documentId, "versions"] as const,
    versionDiff: (documentId: string, aNum: number, bNum: number) =>
      [...queryKeys.documents.all, documentId, "diff", aNum, bNum] as const,
    activity: (documentId: string) =>
      [...queryKeys.documents.all, documentId, "activity"] as const,
    dependencies: (documentId: string) =>
      [...queryKeys.documents.all, documentId, "dependencies"] as const,
  },

  comments: {
    all: ["comments"] as const,
    thread: (commentThreadId: string) =>
      [...queryKeys.comments.all, "thread", commentThreadId] as const,
    forDocument: (documentId: string) =>
      [...queryKeys.comments.all, "document", documentId] as const,
  },

  suggestions: {
    all: ["suggestions"] as const,
    forDocument: (documentId: string) =>
      [...queryKeys.suggestions.all, "document", documentId] as const,
  },

  reviews: {
    all: ["reviews"] as const,
    forDocument: (documentId: string) =>
      [...queryKeys.reviews.all, "document", documentId] as const,
  },

  notifications: {
    all: ["notifications"] as const,
    inbox: (userId: string) =>
      [...queryKeys.notifications.all, "inbox", userId] as const,
    unreadCount: (userId: string) =>
      [...queryKeys.notifications.all, "unread", userId] as const,
  },

  search: {
    all: ["search"] as const,
    query: (params: {
      q: string;
      workspaceId?: string;
      projectId?: string;
      mode?: string;
    }) =>
      [
        ...queryKeys.search.all,
        params.workspaceId ?? "*",
        params.projectId ?? "*",
        params.mode ?? "all",
        params.q,
      ] as const,
    crossref: (documentId: string) =>
      [...queryKeys.search.all, "crossref", documentId] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;
