/**
 * Redis pub/sub backplane for MULTI-REPLICA collab (M11) — SCAFFOLD, flag-gated.
 *
 * The M4 collab server is single-replica: a room's Y.Doc + Awareness live in one
 * process's memory, and updates fan out only to sockets connected to THAT
 * process. To scale horizontally (N collab replicas behind a load balancer), an
 * update applied on replica A must also reach the peers connected to replica B.
 *
 * DESIGN (Redis pub/sub, one channel per room):
 *   - Channel `collab:doc:<documentId>` carries framed messages:
 *       [originId(16)] [kind(1)] [payload…]
 *     where kind = 1 (Yjs update) or 2 (awareness update). The 16-byte originId
 *     is this process's random id, so a replica IGNORES its own echoes.
 *   - On a LOCAL doc update, we PUBLISH the Yjs update; remote replicas receive
 *     it, apply it to their in-memory Y.Doc (origin = BACKPLANE_ORIGIN so the
 *     local persist path does NOT re-append — only the origin replica persists),
 *     and their normal doc-update observer broadcasts to their sockets.
 *   - Awareness is relayed the same way and applied via applyAwarenessUpdate.
 *
 * SAFETY / GRACEFUL DEGRADATION:
 *   - Enabled ONLY when REDIS_URL is set AND COLLAB_REDIS_BACKPLANE ∈ {1,true}.
 *     Otherwise every function here is a NO-OP and the server stays single-replica
 *     exactly as before. No Redis connection is opened.
 *   - Persistence stays authoritative on the ORIGIN replica (we tag remote-applied
 *     updates with BACKPLANE_ORIGIN and room.ts skips persisting those — see
 *     wiring note below), so the append-log/compaction invariants are preserved.
 *
 * STATUS: build/typecheck-verified. End-to-end fan-out needs live Redis + ≥2
 * collab replicas to exercise — flagged for live infra testing.
 */
import { randomBytes } from "node:crypto";
import IORedis, { type Redis } from "ioredis";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { env } from "@forgespecs/config";

import type { Room } from "./room";

/** Origin tag for doc updates applied FROM the backplane (so we don't re-publish/re-persist). */
export const BACKPLANE_ORIGIN = Symbol("forgespecs.collab.backplane");

const KIND_DOC = 1;
const KIND_AWARENESS = 2;
const ORIGIN_LEN = 16;

/** Is the multi-replica backplane enabled? Requires REDIS_URL + the flag. */
export function isBackplaneEnabled(): boolean {
  const flag = env.COLLAB_REDIS_BACKPLANE;
  const flagged = flag === "1" || flag === "true";
  return flagged && typeof env.REDIS_URL === "string" && env.REDIS_URL.length > 0;
}

function channelFor(documentId: string): string {
  return `collab:doc:${documentId}`;
}

/** Per-process identity, so a replica ignores messages it published itself. */
const PROCESS_ID = randomBytes(ORIGIN_LEN);

function frame(kind: number, payload: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(ORIGIN_LEN + 1 + payload.byteLength);
  PROCESS_ID.copy(out, 0);
  out[ORIGIN_LEN] = kind;
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(
    out,
    ORIGIN_LEN + 1,
  );
  return out;
}

interface ParsedFrame {
  fromSelf: boolean;
  kind: number;
  payload: Uint8Array;
}

function parse(buf: Buffer): ParsedFrame {
  const origin = buf.subarray(0, ORIGIN_LEN);
  const kind = buf[ORIGIN_LEN]!;
  const payload = new Uint8Array(
    buf.buffer,
    buf.byteOffset + ORIGIN_LEN + 1,
    buf.byteLength - ORIGIN_LEN - 1,
  );
  return { fromSelf: origin.equals(PROCESS_ID), kind, payload };
}

/**
 * The backplane for ONE replica. Holds a publisher + subscriber connection and a
 * per-room subscription with its observers. Construct only when enabled.
 */
export class CollabBackplane {
  private pub: Redis;
  private sub: Redis;
  /** documentId → cleanup of the room's publish observers. */
  private roomCleanups = new Map<string, () => void>();
  /** documentId → the live Room, for applying inbound remote messages. */
  private rooms = new Map<string, Room>();

  private constructor(url: string) {
    // lazyConnect: open on first command (subscribe/publish), never at import.
    this.pub = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.sub = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.pub.on("error", (e) => console.error("[collab/backplane] pub error:", e.message));
    this.sub.on("error", (e) => console.error("[collab/backplane] sub error:", e.message));

    this.sub.on("messageBuffer", (channelBuf: Buffer, message: Buffer) => {
      this.onMessage(channelBuf.toString("utf8"), message);
    });
  }

  /** Construct + connect, or return null when the backplane is disabled. */
  static async createIfEnabled(): Promise<CollabBackplane | null> {
    if (!isBackplaneEnabled()) return null;
    const bp = new CollabBackplane(env.REDIS_URL as string);
    await Promise.all([bp.pub.connect(), bp.sub.connect()]);
    console.log("[collab/backplane] multi-replica Redis backplane enabled.");
    return bp;
  }

  /**
   * Register a room: subscribe to its channel and observe its Y.Doc + Awareness
   * to publish LOCAL changes (changes applied from the backplane are tagged with
   * BACKPLANE_ORIGIN and skipped, preventing publish loops).
   */
  async addRoom(room: Room): Promise<void> {
    const { documentId } = room;
    if (this.roomCleanups.has(documentId)) return;
    this.rooms.set(documentId, room);
    await this.sub.subscribe(channelFor(documentId));

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === BACKPLANE_ORIGIN) return; // came from a peer replica
      void this.pub
        .publish(channelFor(documentId), frame(KIND_DOC, update))
        .catch((e) => console.error("[collab/backplane] publish doc failed:", e));
    };

    const onAwareness = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      if (origin === BACKPLANE_ORIGIN) return;
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      const payload = awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed);
      void this.pub
        .publish(channelFor(documentId), frame(KIND_AWARENESS, payload))
        .catch((e) => console.error("[collab/backplane] publish awareness failed:", e));
    };

    room.doc.on("update", onUpdate);
    room.awareness.on("update", onAwareness);
    this.roomCleanups.set(documentId, () => {
      room.doc.off("update", onUpdate);
      room.awareness.off("update", onAwareness);
    });
  }

  /** Unsubscribe + detach when a room is torn down on this replica. */
  async removeRoom(documentId: string): Promise<void> {
    this.roomCleanups.get(documentId)?.();
    this.roomCleanups.delete(documentId);
    this.rooms.delete(documentId);
    await this.sub.unsubscribe(channelFor(documentId)).catch(() => {});
  }

  private onMessage(channel: string, message: Buffer): void {
    const documentId = channel.slice("collab:doc:".length);
    const room = this.rooms.get(documentId);
    if (!room) return;
    const { fromSelf, kind, payload } = parse(message);
    if (fromSelf) return; // ignore our own echo

    if (kind === KIND_DOC) {
      // Apply with BACKPLANE_ORIGIN so the local doc-update observer broadcasts
      // to local sockets but does NOT re-publish or re-persist (room.ts skips
      // persisting BACKPLANE_ORIGIN updates — see persistUpdate wiring).
      Y.applyUpdate(room.doc, payload, BACKPLANE_ORIGIN);
    } else if (kind === KIND_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, BACKPLANE_ORIGIN);
    }
  }

  async close(): Promise<void> {
    for (const [documentId] of this.roomCleanups) {
      await this.removeRoom(documentId);
    }
    await this.pub.quit().catch(() => {});
    await this.sub.quit().catch(() => {});
  }
}
