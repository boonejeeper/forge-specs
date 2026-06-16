/**
 * The Yjs collaboration websocket server.
 *
 * Lifecycle of a connection:
 *   1. HTTP upgrade arrives at `/<documentId>` carrying the session cookie.
 *   2. `authorizeHandshake` validates the Better Auth session and requires
 *      `doc.edit` on the room's document (shared RBAC chokepoint). Reject → close.
 *   3. We get-or-load the Room (Y.Doc reconstructed from yDocState + YjsUpdate
 *      log), register the socket, and run the y-websocket sync handshake.
 *   4. Applied doc updates are persisted (append-log) and broadcast to peers via
 *      a per-room doc `update` observer. Awareness is relayed per message.
 *   5. On close we clear the socket's awareness states; when the last peer
 *      leaves we run a final compaction and drop the room from memory.
 */
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { loadEnv } from "@forgespecs/config";

import { authorizeHandshake, HandshakeError } from "./auth";
import { Room } from "./room";
import {
  MESSAGE_AWARENESS,
  broadcast,
  handleMessage,
  sendInitialSync,
} from "./protocol";
import { BACKPLANE_ORIGIN, CollabBackplane } from "./backplane";

/** Live rooms keyed by documentId. Single-replica in-memory registry. */
const rooms = new Map<string, Room>();
/** In-flight room loads, so concurrent first connections share one Room. */
const loading = new Map<string, Promise<Room>>();

/**
 * Optional multi-replica Redis backplane. null = single-replica (default). When
 * enabled, local doc/awareness updates fan out to peer replicas and vice versa.
 */
let backplane: CollabBackplane | null = null;

/** Per-room teardown of the update/awareness observers we attach. */
const roomCleanups = new WeakMap<Room, () => void>();

async function getRoom(documentId: string): Promise<Room> {
  const existing = rooms.get(documentId);
  if (existing) return existing;

  const inflight = loading.get(documentId);
  if (inflight) return inflight;

  const promise = (async () => {
    const room = await Room.load(documentId);
    attachObservers(room);
    rooms.set(documentId, room);
    loading.delete(documentId);
    // Join the multi-replica fan-out (no-op when the backplane is disabled).
    if (backplane) await backplane.addRoom(room);
    return room;
  })();
  loading.set(documentId, promise);
  return promise;
}

/**
 * Wire the room's Y.Doc update observer (persist + broadcast) and awareness
 * change observer (broadcast). These fire for changes applied via the sync
 * protocol regardless of which socket originated them; the `origin` lets us avoid
 * echoing an update back to its sender.
 */
function attachObservers(room: Room): void {
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    // Persist durably (append-log; schedules compaction). Never blocks the
    // broadcast path. Updates that arrived FROM a peer replica (origin =
    // BACKPLANE_ORIGIN) were already persisted on the origin replica, so we skip
    // persisting them here to keep the append-log free of cross-replica dupes.
    if (origin !== BACKPLANE_ORIGIN) {
      void room.persistUpdate(update);
    }

    // Broadcast to every peer except the originating socket.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0 /* MESSAGE_SYNC */);
    // sync update sub-message: writeUpdate
    encoding.writeVarUint(encoder, 2 /* messageYjsUpdate */);
    encoding.writeVarUint8Array(encoder, update);
    const data = encoding.toUint8Array(encoder);
    const except = isWebSocket(origin) ? origin : undefined;
    broadcast(room, data, except);
  };

  const onAwarenessChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    // Only relay changes we did not already relay inline (those with a socket
    // origin were broadcast in handleMessage). Server-initiated removals (e.g.
    // on disconnect) have no socket origin and must be broadcast here.
    if (isWebSocket(origin)) return;
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed),
    );
    broadcast(room, encoding.toUint8Array(encoder));
  };

  room.doc.on("update", onUpdate);
  room.awareness.on("update", onAwarenessChange);
  roomCleanups.set(room, () => {
    room.doc.off("update", onUpdate);
    room.awareness.off("update", onAwarenessChange);
  });
}

function isWebSocket(x: unknown): x is WebSocket {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { send?: unknown }).send === "function"
  );
}

/** Extract the documentId (room) from the request URL: `/<documentId>`. */
function documentIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Path is the first segment; ignore query string. y-websocket appends the
  // room name as the path: ws://host/<room>.
  const path = url.split("?")[0] ?? "";
  const seg = path.replace(/^\/+/, "").split("/")[0];
  return seg ? decodeURIComponent(seg) : null;
}

/** Build a WHATWG Headers object from a Node IncomingMessage (for Better Auth). */
function toHeaders(req: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

export function createServer(): http.Server {
  const server = http.createServer((req, res) => {
    // Health check for docker-compose / load balancers.
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("Upgrade Required");
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const documentId = documentIdFromUrl(req.url);
    if (!documentId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authorize BEFORE completing the upgrade — no valid session/permission, no
    // websocket. This is the RBAC chokepoint mirror of the web Server Actions.
    void authorizeHandshake(documentId, toHeaders(req))
      .then((authd) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          void onConnection(ws, documentId, authd.user);
        });
      })
      .catch((err) => {
        const status =
          err instanceof HandshakeError ? err.code : 500;
        const reason =
          err instanceof HandshakeError ? err.message : "Internal Server Error";
        socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
        socket.destroy();
        if (status === 500) {
          // eslint-disable-next-line no-console
          console.error("[collab] handshake error:", err);
        }
      });
  });

  return server;
}

async function onConnection(
  ws: WebSocket,
  documentId: string,
  user: { id: string; name: string },
): Promise<void> {
  let room: Room;
  try {
    room = await getRoom(documentId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[collab] failed to load room ${documentId}:`, err);
    ws.close(1011, "room load failed");
    return;
  }

  room.conns.add(ws);
  // Awareness client-ids this socket controls (cleared on disconnect).
  const controlled = new Set<number>();

  ws.binaryType = "arraybuffer";

  ws.on("message", (data: ArrayBuffer | Buffer) => {
    try {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      handleMessage(room, ws, bytes, controlled);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[collab] message error in ${documentId}:`, err);
    }
  });

  ws.on("close", () => {
    void onClose(ws, room, controlled);
  });
  ws.on("error", () => {
    void onClose(ws, room, controlled);
  });

  // y-websocket handshake: send our state vector + current awareness.
  sendInitialSync(ws, room);

  void user; // user info is surfaced to peers via the client's own awareness state
}

async function onClose(
  ws: WebSocket,
  room: Room,
  controlled: Set<number>,
): Promise<void> {
  if (!room.conns.has(ws)) return;
  room.conns.delete(ws);

  // Remove this socket's awareness states so peers drop its cursor. Origin is
  // `null` (not a socket) → the awareness observer broadcasts the removal.
  if (controlled.size > 0) {
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(controlled),
      null,
    );
  }

  if (room.isEmpty) {
    rooms.delete(room.documentId);
    roomCleanups.get(room)?.();
    if (backplane) await backplane.removeRoom(room.documentId);
    await room.destroy();
  }
}

export function start(): http.Server {
  const env = loadEnv();
  const server = createServer();
  // Initialise the optional multi-replica backplane (no-op when disabled). Awaited
  // lazily so a Redis hiccup at boot doesn't prevent the server from listening.
  void CollabBackplane.createIfEnabled()
    .then((bp) => {
      backplane = bp;
    })
    .catch((err) => {
      console.error("[collab/backplane] init failed; staying single-replica:", err);
    });
  server.listen(env.COLLAB_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[collab] Yjs websocket server listening on :${env.COLLAB_PORT}`);
  });
  return server;
}
