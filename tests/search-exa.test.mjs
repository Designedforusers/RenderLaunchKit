// Unit tests for the Exa REST search helper.
//
// Stubs `globalThis.fetch` with a captured handler so each test
// drives the helper through a specific upstream response shape
// without burning Exa credits or flaking on network. The helper
// guards missing API keys and empty queries before reaching fetch,
// so those branches short-circuit without touching the stub.
//
// The `env.EXA_API_KEY` read is memoized via the lazy env proxy
// on first access, so `process.env.EXA_API_KEY` is set once at
// module load here. Covering the "missing key" branch would require
// clearing the module cache and re-importing — not worth the
// complexity for a 3-line guard. Manual verification confirms
// that path returns `[]` and logs a warning as documented.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.EXA_API_KEY ??= 'exa-test-key-placeholder';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Test infrastructure ──────────────────────────────────────────

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ────────────────────────────────────────────────────────

test('searchExa: happy path maps upstream results to typed shape', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  let capturedUrl = '';
  let capturedAuth = '';
  let capturedBody = '';
  const restore = stubFetch(async (url, init) => {
    capturedUrl = String(url);
    const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
    capturedAuth = String(headers['x-api-key'] ?? '');
    capturedBody = typeof init?.body === 'string' ? init.body : '';
    return jsonResponse(200, {
      results: [
        {
          title: 'Launching a CLI the hard way',
          url: 'https://example.com/cli-launch',
          text: 'A postmortem on a rough launch day.',
          publishedDate: '2026-01-12',
          score: 0.87,
        },
        {
          title: 'Second result',
          url: 'https://example.com/two',
          text: 'Another article',
          publishedDate: null,
          score: 0.5,
        },
      ],
    });
  });

  try {
    const results = await searchExa('cli launch postmortem');
    assert.equal(results.length, 2);
    assert.equal(capturedUrl, 'https://api.exa.ai/search');
    assert.equal(capturedAuth, 'exa-test-key-placeholder');
    // Body should contain the query verbatim.
    assert.match(capturedBody, /cli launch postmortem/);
    assert.equal(results[0].title, 'Launching a CLI the hard way');
    assert.equal(results[0].url, 'https://example.com/cli-launch');
    assert.equal(results[0].snippet, 'A postmortem on a rough launch day.');
    assert.equal(results[0].publishedDate, '2026-01-12');
    assert.equal(results[0].score, 0.87);
    assert.equal(results[1].publishedDate, null);
    assert.equal(results[1].score, 0.5);
  } finally {
    restore();
  }
});

test('searchExa: empty query returns empty array without calling fetch', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  let fetchCalled = false;
  const restore = stubFetch(async () => {
    fetchCalled = true;
    return jsonResponse(200, { results: [] });
  });

  try {
    const results = await searchExa('   ');
    assert.deepEqual(results, []);
    assert.equal(fetchCalled, false);
  } finally {
    restore();
  }
});

test('searchExa: non-2xx response logs and returns empty', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  const restore = stubFetch(async () => {
    return new Response('{"error":"rate limited"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const results = await searchExa('rate limit test');
    assert.deepEqual(results, []);
  } finally {
    restore();
  }
});

test('searchExa: malformed upstream response returns empty', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  const restore = stubFetch(async () => {
    // Missing `results` array → schema mismatch.
    return jsonResponse(200, { foo: 'bar' });
  });

  try {
    const results = await searchExa('schema mismatch test');
    assert.deepEqual(results, []);
  } finally {
    restore();
  }
});

test('searchExa: result with null title is filtered out', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  const restore = stubFetch(async () => {
    return jsonResponse(200, {
      results: [
        {
          title: 'Kept result',
          url: 'https://example.com/a',
          text: 'text a',
          publishedDate: null,
          score: 0.9,
        },
        {
          title: null,
          url: 'https://example.com/b',
          text: 'text b',
          publishedDate: null,
          score: 0.8,
        },
      ],
    });
  });

  try {
    const results = await searchExa('title filter test');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Kept result');
  } finally {
    restore();
  }
});

test('searchExa: abort (e.g. upstream timeout) returns empty array', async () => {
  const { searchExa } = await import(
    '../apps/web/dist/lib/search-exa.js'
  );

  const restore = stubFetch(async () => {
    throw new DOMException('aborted', 'AbortError');
  });

  try {
    const results = await searchExa('abort test');
    assert.deepEqual(results, []);
  } finally {
    restore();
  }
});
