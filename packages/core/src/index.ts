export * from "./rbac/index";
export * from "./documents/index";
export * from "./versioning/index";
export * from "./activity/index";
export * from "./notifications/index";
export * from "./generation/index";
export * from "./ratelimit/index";
export * from "./github/index";
export * from "./util/index";

// NOTE: the search domain (./search) is intentionally NOT re-exported from the
// root barrel. It pulls node:crypto (chunk hashing) and pgvector raw SQL, which
// must never be bundled into client components that import the root for
// docTypeLabel / RBAC types. Import server-only search helpers from the
// "@forgespecs/core/search" subpath instead.
