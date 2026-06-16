import { describe, it, expect } from "vitest";
import { Role } from "@forgespecs/db";
import {
  roleHasPermission,
  capabilitiesForRole,
  ROLE_CAPABILITIES,
} from "./permissions";
import { resolveEffectiveRole, type MembershipLike } from "./scope";
import {
  requirePermission,
  withPermission,
} from "./require-permission";
import { ForbiddenError, UnauthorizedError } from "./errors";
import type { RbacContextProvider } from "./context";

describe("capability map", () => {
  it("grants OWNER every permission", () => {
    const all = capabilitiesForRole(Role.OWNER);
    expect(all).toContain("workspace.manage");
    expect(all).toContain("doc.delete");
    expect(all).toContain("template.manage");
  });

  it("makes VIEWER read-only", () => {
    expect(roleHasPermission(Role.VIEWER, "doc.read")).toBe(true);
    expect(roleHasPermission(Role.VIEWER, "doc.edit")).toBe(false);
    expect(roleHasPermission(Role.VIEWER, "comment.create")).toBe(false);
  });

  it("lets ENGINEER edit but not change status or manage members", () => {
    expect(roleHasPermission(Role.ENGINEER, "doc.edit")).toBe(true);
    expect(roleHasPermission(Role.ENGINEER, "doc.changeStatus")).toBe(false);
    expect(roleHasPermission(Role.ENGINEER, "workspace.members.manage")).toBe(
      false,
    );
  });

  it("lets REVIEWER submit reviews but not edit the body", () => {
    expect(roleHasPermission(Role.REVIEWER, "review.submit")).toBe(true);
    expect(roleHasPermission(Role.REVIEWER, "doc.edit")).toBe(false);
    expect(roleHasPermission(Role.REVIEWER, "suggestion.create")).toBe(true);
  });

  it("lets ARCHITECT change status and manage projects", () => {
    expect(roleHasPermission(Role.ARCHITECT, "doc.changeStatus")).toBe(true);
    expect(roleHasPermission(Role.ARCHITECT, "project.manage")).toBe(true);
    // but not workspace-level admin
    expect(roleHasPermission(Role.ARCHITECT, "workspace.manage")).toBe(false);
  });

  it("defines a capability set for every role", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_CAPABILITIES[role]).toBeInstanceOf(Set);
    }
  });
});

describe("resolveEffectiveRole", () => {
  const memberships: MembershipLike[] = [
    { workspaceId: "w1", projectId: null, role: Role.ENGINEER },
    { workspaceId: "w1", projectId: "p1", role: Role.ARCHITECT },
    { workspaceId: "w2", projectId: null, role: Role.VIEWER },
  ];

  it("returns the workspace role at workspace scope", () => {
    expect(
      resolveEffectiveRole(memberships, { kind: "workspace", workspaceId: "w1" }),
    ).toBe(Role.ENGINEER);
  });

  it("project membership overrides workspace role", () => {
    expect(
      resolveEffectiveRole(memberships, {
        kind: "project",
        workspaceId: "w1",
        projectId: "p1",
      }),
    ).toBe(Role.ARCHITECT);
  });

  it("falls back to workspace role for projects without an override", () => {
    expect(
      resolveEffectiveRole(memberships, {
        kind: "project",
        workspaceId: "w1",
        projectId: "p-other",
      }),
    ).toBe(Role.ENGINEER);
  });

  it("honors an explicit project downgrade", () => {
    const m: MembershipLike[] = [
      { workspaceId: "w1", projectId: null, role: Role.ARCHITECT },
      { workspaceId: "w1", projectId: "p1", role: Role.VIEWER },
    ];
    expect(
      resolveEffectiveRole(m, {
        kind: "project",
        workspaceId: "w1",
        projectId: "p1",
      }),
    ).toBe(Role.VIEWER);
  });

  it("returns null when the user is not a member of the workspace", () => {
    expect(
      resolveEffectiveRole(memberships, { kind: "workspace", workspaceId: "wX" }),
    ).toBeNull();
  });
});

function fakeProvider(
  userId: string | null,
  memberships: MembershipLike[],
): RbacContextProvider {
  return {
    getUserId: async () => userId,
    getMembershipsForUser: async () => memberships,
  };
}

describe("requirePermission", () => {
  it("throws UnauthorizedError without a session", async () => {
    await expect(
      requirePermission(
        { kind: "workspace", workspaceId: "w1" },
        "doc.read",
        { provider: fakeProvider(null, []) },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when not a member", async () => {
    await expect(
      requirePermission(
        { kind: "workspace", workspaceId: "w1" },
        "doc.read",
        { provider: fakeProvider("u1", []) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when role lacks the capability", async () => {
    await expect(
      requirePermission(
        { kind: "workspace", workspaceId: "w1" },
        "doc.edit",
        {
          provider: fakeProvider("u1", [
            { workspaceId: "w1", projectId: null, role: Role.VIEWER },
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the actor when authorized", async () => {
    const actor = await requirePermission(
      { kind: "workspace", workspaceId: "w1" },
      "doc.edit",
      {
        provider: fakeProvider("u1", [
          { workspaceId: "w1", projectId: null, role: Role.ENGINEER },
        ]),
      },
    );
    expect(actor.userId).toBe("u1");
    expect(actor.role).toBe(Role.ENGINEER);
  });
});

describe("withPermission", () => {
  it("runs the wrapped fn when authorized and passes the actor", async () => {
    const provider = fakeProvider("u1", [
      { workspaceId: "w1", projectId: null, role: Role.OWNER },
    ]);
    const fn = withPermission(
      (workspaceId: string) => ({ kind: "workspace", workspaceId }),
      "workspace.manage",
      async (actor, workspaceId: string) =>
        `${actor.userId}:${actor.role}:${workspaceId}`,
      { provider },
    );
    await expect(fn("w1")).resolves.toBe("u1:OWNER:w1");
  });

  it("blocks the wrapped fn when unauthorized", async () => {
    const provider = fakeProvider("u1", [
      { workspaceId: "w1", projectId: null, role: Role.VIEWER },
    ]);
    let ran = false;
    const fn = withPermission(
      (workspaceId: string) => ({ kind: "workspace", workspaceId }),
      "workspace.manage",
      async () => {
        ran = true;
        return "ok";
      },
      { provider },
    );
    await expect(fn("w1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(ran).toBe(false);
  });
});
