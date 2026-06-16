import { describe, it, expect } from "vitest";
import { DocumentStatus, Role } from "@forgespecs/db";
import {
  canTransition,
  checkTransition,
  assertTransition,
  nextStatuses,
  requiresApprovingReview,
  InvalidStatusTransitionError,
  STATUS_TRANSITIONS,
} from "./status-machine";

describe("canTransition", () => {
  it("allows the happy-path lifecycle", () => {
    expect(canTransition(DocumentStatus.DRAFT, DocumentStatus.REVIEW)).toBe(true);
    expect(canTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED)).toBe(true);
    expect(canTransition(DocumentStatus.APPROVED, DocumentStatus.IMPLEMENTING)).toBe(true);
    expect(canTransition(DocumentStatus.IMPLEMENTING, DocumentStatus.IMPLEMENTED)).toBe(true);
  });

  it("allows the documented back-transitions", () => {
    expect(canTransition(DocumentStatus.REVIEW, DocumentStatus.DRAFT)).toBe(true);
    expect(canTransition(DocumentStatus.APPROVED, DocumentStatus.REVIEW)).toBe(true);
    expect(canTransition(DocumentStatus.IMPLEMENTING, DocumentStatus.APPROVED)).toBe(true);
  });

  it("makes DEPRECATED reachable from any non-deprecated state", () => {
    for (const from of Object.values(DocumentStatus)) {
      if (from === DocumentStatus.DEPRECATED) continue;
      expect(canTransition(from, DocumentStatus.DEPRECATED)).toBe(true);
    }
  });

  it("allows reviving a deprecated doc to DRAFT only", () => {
    expect(canTransition(DocumentStatus.DEPRECATED, DocumentStatus.DRAFT)).toBe(true);
    expect(canTransition(DocumentStatus.DEPRECATED, DocumentStatus.APPROVED)).toBe(false);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition(DocumentStatus.DRAFT, DocumentStatus.APPROVED)).toBe(false);
    expect(canTransition(DocumentStatus.DRAFT, DocumentStatus.IMPLEMENTED)).toBe(false);
    expect(canTransition(DocumentStatus.IMPLEMENTED, DocumentStatus.DRAFT)).toBe(false);
  });

  it("rejects a no-op transition", () => {
    expect(canTransition(DocumentStatus.DRAFT, DocumentStatus.DRAFT)).toBe(false);
  });
});

describe("checkTransition role floor", () => {
  it("requires at least ARCHITECT to approve", () => {
    // With an approving review present, only the role floor is under test.
    expect(
      checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
        role: Role.ENGINEER,
        approvingReviews: 1,
      }).ok,
    ).toBe(false);
    expect(
      checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
        role: Role.ARCHITECT,
        approvingReviews: 1,
      }).ok,
    ).toBe(true);
    expect(
      checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
        role: Role.OWNER,
        approvingReviews: 1,
      }).ok,
    ).toBe(true);
  });

  it("does not gate non-approval transitions on role", () => {
    expect(
      checkTransition(DocumentStatus.DRAFT, DocumentStatus.REVIEW, {
        role: Role.VIEWER,
      }).ok,
    ).toBe(true);
  });

  it("returns a reason on rejection", () => {
    const res = checkTransition(DocumentStatus.DRAFT, DocumentStatus.APPROVED, {
      role: Role.OWNER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Cannot move/);
  });
});

describe("assertTransition", () => {
  it("throws InvalidStatusTransitionError on an illegal move", () => {
    expect(() =>
      assertTransition(DocumentStatus.DRAFT, DocumentStatus.IMPLEMENTED, {
        role: Role.OWNER,
      }),
    ).toThrow(InvalidStatusTransitionError);
  });

  it("does not throw on a legal move", () => {
    expect(() =>
      assertTransition(DocumentStatus.DRAFT, DocumentStatus.REVIEW, {
        role: Role.ENGINEER,
      }),
    ).not.toThrow();
  });
});

describe("requiresApprovingReview", () => {
  it("flags REVIEW→APPROVED as needing an approving review (M5 hook)", () => {
    expect(
      requiresApprovingReview(DocumentStatus.REVIEW, DocumentStatus.APPROVED),
    ).toBe(true);
    expect(
      requiresApprovingReview(DocumentStatus.DRAFT, DocumentStatus.REVIEW),
    ).toBe(false);
  });
});

describe("checkTransition approving-review gate (M5)", () => {
  it("blocks REVIEW→APPROVED without an approving review even for an Owner", () => {
    const res = checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
      role: Role.OWNER,
      approvingReviews: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/approving review/i);
  });

  it("treats a missing approvingReviews as zero", () => {
    expect(
      checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
        role: Role.OWNER,
      }).ok,
    ).toBe(false);
  });

  it("permits REVIEW→APPROVED with role + ≥1 approving review", () => {
    expect(
      checkTransition(DocumentStatus.REVIEW, DocumentStatus.APPROVED, {
        role: Role.ARCHITECT,
        approvingReviews: 1,
      }).ok,
    ).toBe(true);
  });

  it("does not gate other transitions on approving reviews", () => {
    expect(
      checkTransition(DocumentStatus.APPROVED, DocumentStatus.IMPLEMENTING, {
        role: Role.ARCHITECT,
        approvingReviews: 0,
      }).ok,
    ).toBe(true);
  });
});

describe("nextStatuses", () => {
  it("mirrors the transition table", () => {
    expect(nextStatuses(DocumentStatus.DRAFT)).toEqual(
      STATUS_TRANSITIONS[DocumentStatus.DRAFT],
    );
  });
});
