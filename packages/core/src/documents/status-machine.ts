import { DocumentStatus, Role } from "@forgespecs/db";
import { ROLE_RANK } from "../rbac/permissions";

/**
 * Document status state machine.
 *
 * The lifecycle of a spec document moves along a small set of allowed
 * transitions. This is the single source of truth for "can a doc go from X to
 * Y" — both the server action (`changeDocumentStatus`) and any future UI gating
 * consult it. RBAC (the `doc.changeStatus` capability) is enforced separately at
 * the action boundary; some transitions additionally require a minimum role.
 *
 * Lifecycle:
 *   DRAFT → REVIEW → APPROVED → IMPLEMENTING → IMPLEMENTED
 * with:
 *   - REVIEW can fall back to DRAFT (changes requested).
 *   - APPROVED can fall back to REVIEW (re-open review).
 *   - DEPRECATED is reachable from any non-deprecated state and is terminal
 *     except that it may be revived back to DRAFT.
 */

/** Allowed forward/back transitions, keyed by the current status. */
export const STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  [DocumentStatus.DRAFT]: [DocumentStatus.REVIEW, DocumentStatus.DEPRECATED],
  [DocumentStatus.REVIEW]: [
    DocumentStatus.DRAFT,
    DocumentStatus.APPROVED,
    DocumentStatus.DEPRECATED,
  ],
  [DocumentStatus.APPROVED]: [
    DocumentStatus.REVIEW,
    DocumentStatus.IMPLEMENTING,
    DocumentStatus.DEPRECATED,
  ],
  [DocumentStatus.IMPLEMENTING]: [
    DocumentStatus.IMPLEMENTED,
    DocumentStatus.APPROVED,
    DocumentStatus.DEPRECATED,
  ],
  [DocumentStatus.IMPLEMENTED]: [DocumentStatus.DEPRECATED],
  // Deprecated specs can be revived to a fresh draft, nothing else.
  [DocumentStatus.DEPRECATED]: [DocumentStatus.DRAFT],
};

/**
 * Transitions that require a minimum role beyond the `doc.changeStatus`
 * capability. Per the plan, moving a doc to APPROVED is an authoritative act
 * reserved for Architects/Owners. The "≥1 approving Review" rule is a M5 hook
 * (see `requiresApprovingReview`).
 */
const TRANSITION_MIN_ROLE: Partial<Record<DocumentStatus, Role>> = {
  [DocumentStatus.APPROVED]: Role.ARCHITECT,
};

export interface TransitionContext {
  /** The effective role of the actor at the document's scope. */
  role: Role;
  /**
   * Number of APPROVE-decision reviews pinned to the document's current version.
   * Required for transitions where `requiresApprovingReview` is true (REVIEW →
   * APPROVED). Omitted/0 means "no approving review yet". The action resolves
   * this from the `Review` table (see `countApprovingReviews`) before calling.
   */
  approvingReviews?: number;
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: string };

/** Is `to` a structurally valid next status from `from`? */
export function canTransition(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  if (from === to) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Does this transition require at least one approving Review before it may be
 * taken? Review UI arrives in M5; until then `changeDocumentStatus` treats this
 * as a TODO hook (the rule is advisory, not enforced).
 */
export function requiresApprovingReview(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return from === DocumentStatus.REVIEW && to === DocumentStatus.APPROVED;
}

/**
 * Full guard: structural validity + role floor. Returns a typed result so the
 * caller can surface a precise message.
 */
export function checkTransition(
  from: DocumentStatus,
  to: DocumentStatus,
  ctx: TransitionContext,
): TransitionCheck {
  if (from === to) {
    return { ok: false, reason: `Document is already ${to}.` };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      reason: `Cannot move a document from ${from} to ${to}.`,
    };
  }
  const minRole = TRANSITION_MIN_ROLE[to];
  if (minRole && ROLE_RANK[ctx.role] < ROLE_RANK[minRole]) {
    return {
      ok: false,
      reason: `Moving a document to ${to} requires at least the ${minRole} role.`,
    };
  }
  // The ≥1-approving-review gate (M1 left this as a TODO hook; M5 enforces it).
  // REVIEW → APPROVED additionally requires at least one APPROVE review pinned to
  // the document's current version.
  if (requiresApprovingReview(from, to) && (ctx.approvingReviews ?? 0) < 1) {
    return {
      ok: false,
      reason: `Approving a document requires at least one approving review.`,
    };
  }
  return { ok: true };
}

/** Thrown when a status transition is rejected by the state machine. */
export class InvalidStatusTransitionError extends Error {
  readonly code = "INVALID_STATUS_TRANSITION" as const;
  readonly from: DocumentStatus;
  readonly to: DocumentStatus;

  constructor(from: DocumentStatus, to: DocumentStatus, reason: string) {
    super(reason);
    this.name = "InvalidStatusTransitionError";
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, InvalidStatusTransitionError.prototype);
  }
}

/**
 * Assert a transition is allowed, throwing `InvalidStatusTransitionError`
 * otherwise. Used by the server action so the failure maps to a clean error.
 */
export function assertTransition(
  from: DocumentStatus,
  to: DocumentStatus,
  ctx: TransitionContext,
): void {
  const result = checkTransition(from, to, ctx);
  if (!result.ok) {
    throw new InvalidStatusTransitionError(from, to, result.reason);
  }
}

/** The set of statuses reachable in one step from `from` (for UI menus). */
export function nextStatuses(from: DocumentStatus): readonly DocumentStatus[] {
  return STATUS_TRANSITIONS[from];
}
