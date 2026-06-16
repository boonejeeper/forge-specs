/**
 * Wire protocol — y-websocket compatible.
 *
 * The web client uses y-websocket's `WebsocketProvider` (via BlockNote's
 * collaboration option), so this server speaks the exact same framing:
 *
 *   messageSync (0)      → y-protocols/sync sub-protocol (step1/step2/update)
 *   messageAwareness (1) → y-protocols/awareness encoded states
 *
 * We implement it directly on `y-protocols` + `lib0` rather than pulling the
 * y-websocket *server* utilities, because those bundle their own pluggable
 * persistence (LevelDB by default) we don't want — our persistence is the
 * Postgres append-log/compaction adapter. Speaking the protocol ourselves keeps
 * persistence and the transport cleanly separated and fully under our control.
 */
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import type { WebSocket } from "ws";

import type { Room } from "./room";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

function send(ws: WebSocket, data: Uint8Array): void {
  // ws readyState 1 === OPEN
  if (ws.readyState !== 1) return;
  try {
    ws.send(data);
  } catch {
    // The connection close handler will clean up.
  }
}

/** Broadcast a framed message to every peer except `except`. */
export function broadcast(room: Room, data: Uint8Array, except?: WebSocket): void {
  for (const conn of room.conns) {
    if (conn === except) continue;
    send(conn, data);
  }
}

/**
 * Send the initial sync to a freshly-connected client: SyncStep1 (our state
 * vector) followed by the current awareness states. The client replies with its
 * own SyncStep1 and any missing updates, converging both sides.
 */
export function sendInitialSync(ws: WebSocket, room: Room): void {
  // Sync step 1.
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(ws, encoding.toUint8Array(encoder));
  }

  // Current awareness (so the newcomer sees existing cursors immediately).
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(states.keys()),
      ),
    );
    send(ws, encoding.toUint8Array(encoder));
  }
}

/**
 * Handle one inbound binary message from a client.
 *
 * Returns the set of awareness client-ids this connection currently controls
 * (so disconnect can remove them) by mutating `controlled`.
 */
export function handleMessage(
  room: Room,
  ws: WebSocket,
  message: Uint8Array,
  controlled: Set<number>,
): void {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case MESSAGE_SYNC: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      // readSyncMessage applies SyncStep1/Step2/Update to the doc and may write a
      // reply (e.g. SyncStep2) into `encoder`. We pass `ws` as the transaction
      // origin so the doc 'update' observer (server.ts) knows which socket sent
      // the change and does NOT echo it back to that same socket. Persistence
      // and peer-broadcast of applied updates both happen in that observer.
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);

      // Only send if there's a payload beyond the leading message-type varint
      // (e.g. a SyncStep2 reply to the client's SyncStep1).
      if (encoding.length(encoder) > 1) {
        send(ws, encoding.toUint8Array(encoder));
      }
      break;
    }

    case MESSAGE_AWARENESS: {
      const update = decoding.readVarUint8Array(decoder);
      // Track which client-ids this socket controls so we can clear them on
      // disconnect.
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      // Record controlled ids (the decoder for ids is internal; instead we read
      // the changed clients from the awareness states post-apply via the origin).
      recordControlled(room, update, controlled);

      // Relay awareness to all other peers verbatim.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder), ws);
      break;
    }

    default:
      // Unknown message type — ignore (forward-compat).
      break;
  }
}

/**
 * Parse the client-ids out of an awareness update so we know which to remove
 * when this socket disconnects. The awareness update encodes a count followed by
 * (clientId, clock, state) tuples; we only need the ids.
 */
function recordControlled(
  _room: Room,
  update: Uint8Array,
  controlled: Set<number>,
): void {
  try {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    for (let i = 0; i < len; i++) {
      const clientId = decoding.readVarUint(decoder);
      decoding.readVarUint(decoder); // clock
      decoding.readVarString(decoder); // state JSON
      controlled.add(clientId);
    }
  } catch {
    // Best-effort; on parse failure we simply don't track these ids.
  }
}
