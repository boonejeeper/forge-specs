import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM helpers for the encrypted GitHub PAT stored on RepoIngestSource.
 *
 * Key derivation: HKDF-SHA256 over BETTER_AUTH_SECRET (already a 32+ byte
 * high-entropy server secret) with a fixed "info" label so the key is stable
 * across restarts without an extra env var. Tying it to BETTER_AUTH_SECRET also
 * means rotating the auth secret rotates this key — the existing operational
 * runbook for secret rotation extends to ingest tokens without new ceremony.
 *
 * Ciphertext, IV (12 bytes — GCM standard), and auth tag (16 bytes) are stored
 * separately on the row as bytea columns. Plaintext NEVER round-trips back
 * through any API response (see decryptToken comment).
 */

const KEY_INFO = "forgespecs.repo-ingest.pat.v1";
const KEY_LEN = 32;
const IV_LEN = 12;

function deriveKey(secret: string): Buffer {
  // hkdfSync returns ArrayBuffer; wrap in Buffer for the cipher API.
  const buf = hkdfSync("sha256", secret, "", KEY_INFO, KEY_LEN);
  return Buffer.from(buf);
}

export interface SealedToken {
  cipher: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt a PAT under the server's auth secret. Returns plain Uint8Arrays
 * (not Buffer) so the values are assignable to Prisma's Bytes columns, which
 * expect `Uint8Array<ArrayBuffer>` rather than `Buffer<ArrayBufferLike>`.
 */
export function encryptToken(plaintext: string, secret: string): SealedToken {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: toUint8Array(ct),
    iv: toUint8Array(iv),
    tag: toUint8Array(tag),
  };
}

/**
 * Copy a Buffer into a fresh Uint8Array backed by a plain ArrayBuffer (NOT
 * SharedArrayBuffer / ArrayBufferLike). Prisma's Bytes column type requires
 * exactly `Uint8Array<ArrayBuffer>`, and a Buffer's `.buffer` is typed as
 * `ArrayBufferLike`, so we cannot subarray-view it directly. The double cast
 * is the documented escape hatch for the TS lib mismatch.
 */
function toUint8Array(buf: Buffer): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(buf.byteLength);
  const out = new Uint8Array(ab);
  out.set(buf);
  return out;
}

/**
 * Decrypt a sealed PAT. Throws on auth-tag mismatch (tampering / wrong key).
 *
 * CALLERS: only invoke inside the worker process at the moment of the GitHub
 * tarball fetch. Do not return the plaintext (or any prefix of it) from any
 * API response — the form surface only ever shows a redacted last-4 indicator.
 */
export function decryptToken(sealed: SealedToken, secret: string): string {
  const key = deriveKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv));
  decipher.setAuthTag(Buffer.from(sealed.tag));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(sealed.cipher)),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/** Redact a PAT for display ("ghp_…abcd"). */
export function redactToken(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `${plaintext.slice(0, 4)}…${tail}`;
}
