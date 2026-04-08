import { createCipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';

/**
 * AES-256-GCM encryption for user-supplied GitHub personal access
 * tokens. Pairs with `apps/worker/src/lib/github-token-crypto.ts`
 * which reverses the process at the start of an analyze job.
 *
 * Format
 * ------
 *
 * The encrypted value is stored as a single colon-separated string:
 *
 *     <iv_base64>:<auth_tag_base64>:<ciphertext_base64>
 *
 * The IV is 12 bytes (the GCM standard) and is freshly random per
 * encryption, so the same token re-submitted for two projects
 * produces two different blobs — the DB never leaks "these two
 * projects belong to the same user" by pattern-matching ciphertexts.
 * The auth tag is 16 bytes.
 *
 * Key source
 * ----------
 *
 * The key is a 32-byte (256-bit) random secret, base64-encoded in
 * the `GITHUB_TOKEN_SECRET` env var. Generate one with:
 *
 *     node -e "console.log(crypto.randomBytes(32).toString('base64'))"
 *
 * When the secret is missing, `encryptGithubToken()` throws a
 * `GithubTokenEncryptionDisabledError` which the `POST /api/projects`
 * route catches and maps to a 503. The public-repo path never reaches
 * this helper, so a missing secret does not break the default surface.
 */

export class GithubTokenEncryptionDisabledError extends Error {
  override readonly name = 'GithubTokenEncryptionDisabledError';
  constructor() {
    super(
      'Private-repo support is not configured on this server: set GITHUB_TOKEN_SECRET to accept githubToken submissions.'
    );
  }
}

const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;

function loadKey(): Buffer {
  const raw = env.GITHUB_TOKEN_SECRET;
  if (!raw) {
    throw new GithubTokenEncryptionDisabledError();
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new Error(
      `GITHUB_TOKEN_SECRET must decode to exactly ${String(KEY_BYTE_LENGTH)} bytes (got ${String(key.length)}). Generate a fresh key with \`node -e "console.log(crypto.randomBytes(32).toString('base64'))"\`.`
    );
  }

  return key;
}

/**
 * Encrypt a GitHub personal access token. Returns the colon-separated
 * `iv:tag:ciphertext` blob the `projects.github_token_encrypted`
 * column expects.
 */
export function encryptGithubToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}
