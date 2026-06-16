import type { Permission } from "./permissions";
import type { Scope } from "./scope";

/**
 * Thrown by requirePermission/withPermission when authorization fails.
 * Carries enough context to render a useful message and to map to an HTTP 403.
 */
export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  readonly permission?: Permission;
  readonly scope?: Scope;

  constructor(
    message = "You do not have permission to perform this action.",
    opts?: { permission?: Permission; scope?: Scope },
  ) {
    super(message);
    this.name = "ForbiddenError";
    this.permission = opts?.permission;
    this.scope = opts?.scope;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/** Thrown when there is no authenticated session. */
export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export function isForbiddenError(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}
