import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Smoke test: the web service's encrypt helper and the worker's
// decrypt helper must produce and consume the same on-disk format.
// A regression here would silently break every private-repo project
// in production — the analyze worker would fall through to the
// unauthenticated path and fetches against the user's repo would
// 404. We round-trip a sample token with a freshly-generated key
// to prove the format contract holds.

process.env.DATABASE_URL ??= 'postgres://test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.GITHUB_TOKEN_SECRET = randomBytes(32).toString('base64');

test('encryptGithubToken / decryptGithubToken round-trip', async () => {
  const { encryptGithubToken } = await import(
    '../apps/web/dist/lib/github-token-crypto.js'
  );
  const { decryptGithubToken } = await import(
    '../apps/worker/dist/lib/github-token-crypto.js'
  );

  const plaintext = 'github_pat_11AABBCCDDEEFFGGHH_exampleExampleExample';
  const blob = encryptGithubToken(plaintext);

  // Three base64 segments separated by colons.
  const parts = blob.split(':');
  assert.equal(parts.length, 3, 'blob has three segments');
  for (const part of parts) {
    assert.ok(part.length > 0, 'blob segment is non-empty');
  }

  // Each call produces a fresh IV, so two encryptions of the same
  // plaintext must differ.
  const blob2 = encryptGithubToken(plaintext);
  assert.notEqual(blob, blob2, 'IV randomisation makes ciphertexts differ');

  // Both blobs decrypt back to the original plaintext.
  assert.equal(decryptGithubToken(blob), plaintext);
  assert.equal(decryptGithubToken(blob2), plaintext);
});

test('decryptGithubToken returns null on tampered ciphertext', async () => {
  const { encryptGithubToken } = await import(
    '../apps/web/dist/lib/github-token-crypto.js'
  );
  const { decryptGithubToken } = await import(
    '../apps/worker/dist/lib/github-token-crypto.js'
  );

  const blob = encryptGithubToken('github_pat_original_value');
  const [iv, tag, ct] = blob.split(':');
  const tamperedCt = Buffer.from(ct, 'base64');
  tamperedCt[0] ^= 0x01;
  const tampered = `${iv}:${tag}:${tamperedCt.toString('base64')}`;

  assert.equal(decryptGithubToken(tampered), null);
});

test('decryptGithubToken returns null on malformed blob', async () => {
  const { decryptGithubToken } = await import(
    '../apps/worker/dist/lib/github-token-crypto.js'
  );

  assert.equal(decryptGithubToken('not-a-valid-blob'), null);
  assert.equal(decryptGithubToken('only:two'), null);
  assert.equal(decryptGithubToken('::'), null);
});
