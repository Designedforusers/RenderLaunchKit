import { createDecipheriv } from 'node:crypto';
import { env } from '../env.js';

/**
 * AES-256-GCM decryption for user-supplied GitHub personal access
 * tokens. Mirrors `apps/web/src/lib/github-token-crypto.ts` — the
 * web service encrypts on write, the worker decrypts on read at the
 * start of the analyze job.
 *
 * Format
 * ------
 *
 * The `projects.github_token_encrypted` column stores:
 *
 *     <iv_base64>:<auth_tag_base64>:<ciphertext_base64>
 *
 * See the web-side mirror for the rationale and the key generation
 * command.
 *
 * Failure modes
 * -------------
 *
 * `decryptGithubToken()` returns `null` rather than throwing when:
 *
 *   - The `GITHUB_TOKEN_SECRET` env var is unset (the operator has
 *     not rotated the old deployment). The analyze worker falls back
 *     to the global `GITHUB_TOKEN` (or unauthenticated) in that case
 *     — public-repo projects still run, private-repo projects fail
 *     cleanly at the first 404 from the GitHub API with the existing
 *     error-handling path.
 *
 *   - The blob format is malformed, the key is the wrong size, or
 *     the auth tag fails to verify. Any of those means the stored
 *     blob was produced by a different (or corrupted) key. Returning
 *     null here keeps the analyze job from crashing the whole
 *     pipeline; the project degrades to the unauthenticated path.
 *
 * A thrown exception would be the wrong failure mode — the worker
 * would mark the job failed and bubble the error to the user, who
 * cannot fix a misconfigured server secret from their side. The
 * caller logs the failure so operators see it.
 */

// These three constants MUST match the encrypt side in
// `apps/web/src/lib/github-token-crypto.ts`. The two files are
// intentionally not sharing a module because `@launchkit/shared` is
// browser-buildable and `node:crypto` is not — duplicating the
// constants keeps the shared package clean while still documenting
// the lockstep requirement at both call sites.
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;

function loadKey(): Buffer | null {
  const raw = env.GITHUB_TOKEN_SECRET;
  if (!raw) return null;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTE_LENGTH) {
    console.error(
      `[GithubTokenCrypto] GITHUB_TOKEN_SECRET must decode to ${String(KEY_BYTE_LENGTH)} bytes (got ${String(key.length)}); ignoring.`
    );
    return null;
  }

  return key;
}

/**
 * Decrypt a stored GitHub personal access token blob. Returns null
 * on any failure (missing secret, malformed blob, auth-tag mismatch)
 * so the analyze pipeline degrades gracefully instead of crashing.
 */
export function decryptGithubToken(blob: string): string | null {
  const key = loadKey();
  if (!key) return null;

  const parts = blob.split(':');
  if (parts.length !== 3) {
    console.error(
      '[GithubTokenCrypto] Encrypted token blob did not have three segments; ignoring.'
    );
    return null;
  }

  const [ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) {
    console.error(
      '[GithubTokenCrypto] Encrypted token blob had an empty segment; ignoring.'
    );
    return null;
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');

  if (iv.length !== IV_BYTE_LENGTH) {
    console.error(
      `[GithubTokenCrypto] Encrypted token IV was ${String(iv.length)} bytes; expected ${String(IV_BYTE_LENGTH)}. Ignoring.`
    );
    return null;
  }

  // GCM auth tags MUST be exactly 16 bytes. Node's `setAuthTag` will
  // accept shorter tags on some versions, which weakens the
  // authentication guarantee — a corrupted or adversarially-crafted
  // stored blob with a short tag could otherwise slip past the
  // integrity check. Reject anything that isn't the canonical length.
  if (tag.length !== AUTH_TAG_BYTE_LENGTH) {
    console.error(
      `[GithubTokenCrypto] Encrypted token auth tag was ${String(tag.length)} bytes; expected ${String(AUTH_TAG_BYTE_LENGTH)}. Ignoring.`
    );
    return null;
  }

  let plaintext: Buffer | null = null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[GithubTokenCrypto] Failed to decrypt token (${message}); ignoring.`
    );
    return null;
  } finally {
    // Defense-in-depth: zero the intermediate plaintext Buffer so a
    // later heap inspection or core-dump analysis cannot recover the
    // decrypted token from a page that has not yet been reused. Node
    // strings are immutable, so the returned string copy still lives
    // on the V8 heap until GC — but the Buffer-backed allocation,
    // which is the larger and longer-lived intermediate, is wiped
    // here before the function returns either a value or null.
    if (plaintext) {
      plaintext.fill(0);
    }
  }
}
