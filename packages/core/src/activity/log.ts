import {
  prisma,
  type ActivityType,
  type Prisma,
  type PrismaClient,
} from "@forgespecs/db";

type Db = PrismaClient | Prisma.TransactionClient;

export interface LogActivityInput {
  workspaceId: string;
  actorId?: string | null;
  type: ActivityType;
  /** Loose entity reference, e.g. "document". */
  entityType?: string | null;
  entityId?: string | null;
  /** Arbitrary structured payload (titles, old/new status, etc.). */
  data?: Prisma.InputJsonValue;
}

/**
 * Append an immutable `ActivityEvent`. Domain mutations (create / rename /
 * status change / version) call this so the activity feed stays an accurate,
 * append-only audit log. Accepts a transaction handle so the event is written
 * atomically with the mutation it records.
 */
export async function logActivity(
  input: LogActivityInput,
  db: Db = prisma,
): Promise<void> {
  await db.activityEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      data: input.data ?? undefined,
    },
  });
}
