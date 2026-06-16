/**
 * In-memory room state for a single collaborative document (one per documentId).
 *
 * Holds the live Y.Doc, the Awareness instance (presence/cursors), the set of
 * connected websockets, and the debounced compaction scheduler. Single-replica
 * only — no Redis backplane (that is M11). The Y.Doc is the convergent source of
 * truth while the room is live; durability comes from the append-log +
 * compaction in persistence.ts.
 */
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { WebSocket } from "ws";
import {
  COLLAB_COMPACTION_IDLE_MS,
  COLLAB_COMPACTION_UPDATE_COUNT,
} from "@forgespecs/config";

import { appendUpdate, compact, loadDoc } from "./persistence";

export class Room {
  readonly documentId: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly conns = new Set<WebSocket>();

  /** Highest YjsUpdate id known to be folded-or-persisted (compaction boundary). */
  private watermark: bigint | null = null;
  /** Updates appended since the last compaction. */
  private dirtyCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private compacting = false;
  private closed = false;

  private constructor(documentId: string, doc: Y.Doc, watermark: bigint | null) {
    this.documentId = documentId;
    this.doc = doc;
    this.watermark = watermark;
    this.awareness = new Awareness(doc);
    // The server is not an editor — clear its own awareness slot.
    this.awareness.setLocalState(null);
  }

  /** Load durable state and construct the room. */
  static async load(documentId: string): Promise<Room> {
    const { doc, watermark } = await loadDoc(documentId);
    return new Room(documentId, doc, watermark);
  }

  /**
   * Durably persist an update that has ALREADY been applied to `this.doc`.
   *
   * The update is applied by `readSyncMessage` (origin = the sending socket),
   * which fires the doc's `update` event; the server wires that event here. So
   * this method only appends to the crash-safe log and schedules compaction — it
   * must NOT re-apply the update (that would be a no-op churn at best).
   */
  async persistUpdate(update: Uint8Array): Promise<void> {
    if (this.closed) return;
    // Durable, crash-safe append. The new row's id advances the watermark only
    // once compaction folds it; until then it lives in the log.
    const id = await appendUpdate(this.documentId, update);
    if (this.watermark === null || id > this.watermark) {
      this.watermark = id;
    }
    this.dirtyCount += 1;
    this.scheduleCompaction();
  }

  private scheduleCompaction(): void {
    if (this.closed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);

    if (this.dirtyCount >= COLLAB_COMPACTION_UPDATE_COUNT) {
      void this.runCompaction();
      return;
    }
    this.idleTimer = setTimeout(() => {
      void this.runCompaction();
    }, COLLAB_COMPACTION_IDLE_MS);
  }

  /** Fold the log into yDocState + regenerate the projection. Idempotent. */
  async runCompaction(): Promise<void> {
    if (this.compacting || this.dirtyCount === 0) return;
    this.compacting = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Snapshot the boundary now; updates after this keep higher ids and survive.
    const boundary = this.watermark;
    const pending = this.dirtyCount;
    this.dirtyCount = 0;
    try {
      await compact(this.documentId, this.doc, boundary);
    } catch (err) {
      // On failure, restore the dirty count so a retry is scheduled — the
      // append-log is intact so no data is lost regardless.
      this.dirtyCount += pending;
      // eslint-disable-next-line no-console
      console.error(`[collab] compaction failed for ${this.documentId}:`, err);
      this.scheduleCompaction();
    } finally {
      this.compacting = false;
    }
  }

  /**
   * Tear down the room. Runs a final compaction so the latest edits are folded
   * before we drop the in-memory doc (the log already has them durably, but this
   * keeps yDocState fresh and the log small).
   */
  async destroy(): Promise<void> {
    this.closed = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.dirtyCount > 0) {
      // Force a final fold regardless of the compacting guard race.
      try {
        await compact(this.documentId, this.doc, this.watermark);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[collab] final compaction failed for ${this.documentId}:`, err);
      }
    }
    this.awareness.destroy();
    this.doc.destroy();
  }

  get isEmpty(): boolean {
    return this.conns.size === 0;
  }
}
