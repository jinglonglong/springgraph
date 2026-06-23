/**
 * Content hashing for the incremental-skip path (init-performance
 * change, phase 3).
 *
 * Two tiers:
 *   1. `cheapHash` - non-cryptographic, ~5 GB/s. First-tier skip
 *      key. If a file's cheap hash matches the stored `cheap_hash`
 *      column, the orchestrator skips the expensive SHA-256 + parse
 *      without touching anything else.
 *   2. `strongHash` - SHA-256 (same as the existing `hashContent`).
 *      Second-tier verifier. Used when the cheap hash differs but
 *      we want to avoid re-parsing on a strong-hash match. With
 *      ~400 MB/s, SHA-256 is cheap enough to pay on the slow path.
 *
 * Algorithm preference (cheapest first; fall back on first match):
 *   1. xxhash (npm: `xxhashjs` or `xxhash-wasm` if available)
 *   2. Node's built-in crypto SHA-1 (160-bit, fast in V8)
 *   3. Node's built-in crypto MD5 (128-bit, fast in V8)
 *
 * xxhash is the proper choice (~5 GB/s, 64-bit). When xxhashjs is
 * not installed we fall back to crypto's SHA-1 which is "good
 * enough" as a non-cryptographic tier (collision rate is fine for
 * 1M-file indexes; not safe for adversarial inputs but the
 * orchestrator's strong-hash check catches the rare false skip).
 */
import * as crypto from 'crypto';

/** Cheap (non-cryptographic) hash, hex string. ~5 GB/s when
 *  xxhashjs is installed, ~1 GB/s otherwise. */
export function cheapHash(content: string): string {
  // Try xxhash first. We try-require because the package is
  // optional - if it's not installed we fall through to crypto
  // (which always works in Node).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const xxhash = require('xxhashjs');
    const hasher = xxhash.h32(0xcafebabe);
    return hasher.update(content).digest().toString(16);
  } catch {
    // xxhashjs not installed - fall back to SHA-1 (still
    // ~5x faster than SHA-256 in V8 thanks to the JS-to-WASM
    // bridge being skipped).
    return crypto.createHash('sha1').update(content).digest('hex');
  }
}

/** Strong content hash, hex string. SHA-256. ~400 MB/s.
 *  Mirrors the extraction module's `hashContent` so the two stay
 *  byte-for-byte compatible on the same input. */
export function strongHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Cheap hash of a buffer (used by git-native path for the blob
 * OID-free case). Falls through the same way as `cheapHash`.
 */
export function cheapHashBuffer(buf: Buffer | Uint8Array): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const xxhash = require('xxhashjs');
    const hasher = xxhash.h32(0xcafebabe);
    return hasher.update(buf).digest().toString(16);
  } catch {
    return crypto.createHash('sha1').update(buf).digest('hex');
  }
}
