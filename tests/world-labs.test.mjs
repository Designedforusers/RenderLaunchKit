// Smoke tests for the World Labs (Marble) integration.
//
// These tests do not hit the upstream API or burn credits — they
// validate the boundary schemas in
// `apps/worker/src/lib/schemas/world-labs.ts` against the documented
// API response shapes from https://docs.worldlabs.ai. The goal is to
// catch breakage from a Zod regression or a doc-vs-code drift before
// the worker is deployed.
//
// A real end-to-end test against the World Labs API requires a paid
// API key and ~5 minutes per generation — that's the responsibility
// of a deploy-time integration check, not this file.

// The worker validates `process.env` through a Zod schema in
// `apps/worker/src/env.ts`. Provide placeholders so importing the
// compiled client modules below does not crash on the lazy parser if
// any field is read at module-load time.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('OperationSchema parses an in-flight world generation operation', async () => {
  const { OperationSchema } = await import(
    '../packages/asset-generators/dist/clients/schemas/world-labs.js'
  );

  const inFlight = {
    operation_id: '20bffbb1-4ba7-453f-a116-93eaw1a6843e',
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2025-01-15T10:30:00Z',
    expires_at: '2025-01-15T11:30:00Z',
    done: false,
    error: null,
    metadata: {
      progress: { status: 'IN_PROGRESS', description: 'World generation in progress' },
      world_id: 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
    },
    response: null,
  };

  const result = OperationSchema.safeParse(inFlight);
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
  assert.equal(result.data.done, false);
  assert.equal(result.data.metadata.world_id, 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a');
});

test('OperationSchema parses a completed world generation operation with full snapshot', async () => {
  const { OperationSchema } = await import(
    '../packages/asset-generators/dist/clients/schemas/world-labs.js'
  );

  const completed = {
    operation_id: '20bffbb1-4ba7-453f-a116-93eab1a6843e',
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2025-01-15T10:35:00Z',
    expires_at: '2025-01-15T11:30:00Z',
    done: true,
    error: null,
    metadata: {
      progress: {
        status: 'SUCCEEDED',
        description: 'World generation completed successfully',
      },
      world_id: 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
    },
    response: {
      // The Marble API returns the identifier as `world_id`, not `id`.
      // Verified against https://docs.worldlabs.ai/api/reference/operations/get.md
      // and against a real 7-minute Marble render that surfaced the
      // schema drift when an earlier version of this test used `id`.
      world_id: 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
      display_name: '',
      tags: null,
      world_marble_url: 'https://marble.worldlabs.ai/world/dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
      assets: {
        caption: 'The scene is a fantastical forest...',
        thumbnail_url: 'https://example.com/thumb.png',
        splats: {
          spz_urls: {
            '500k': 'https://example.com/500k.spz',
            '100k': 'https://example.com/100k.spz',
            full_res: 'https://example.com/full.spz',
          },
        },
        mesh: { collider_mesh_url: 'https://example.com/collider.glb' },
        imagery: { pano_url: 'https://example.com/pano.jpg' },
      },
      created_at: null,
      updated_at: null,
      permission: null,
      world_prompt: null,
      model: null,
    },
  };

  const result = OperationSchema.safeParse(completed);
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
  assert.equal(result.data.done, true);
  assert.ok(result.data.response, 'response must be present on completed operations');
  assert.equal(result.data.response.world_id, 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a');
  assert.equal(
    result.data.response.world_marble_url,
    'https://marble.worldlabs.ai/world/dc2c65e4-68d3-4210-a01e-7a54cc9ded2a'
  );
  assert.equal(
    result.data.response.assets.thumbnail_url,
    'https://example.com/thumb.png'
  );
});

test('WorldSchema parses the canonical GET /worlds/{world_id} response', async () => {
  // The Marble GET /worlds/{world_id} endpoint returns the World
  // object DIRECTLY, not wrapped in a `{ world: ... }` envelope.
  // Verified against https://docs.worldlabs.ai/api/reference/worlds/get.md
  // after an earlier envelope-assuming version was proved wrong.
  const { WorldSchema } = await import(
    '../packages/asset-generators/dist/clients/schemas/world-labs.js'
  );

  const directResponse = {
    world_id: 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
    display_name: 'Mystical Forest',
    tags: null,
    world_marble_url: 'https://marble.worldlabs.ai/world/dc2c65e4-68d3-4210-a01e-7a54cc9ded2a',
    assets: {
      caption: 'The scene is a fantastical forest...',
      thumbnail_url: 'https://example.com/thumb.png',
    },
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2025-01-15T10:35:00Z',
    world_prompt: { type: 'text', text_prompt: 'A mystical forest...' },
    model: 'marble-1.1',
  };

  const result = WorldSchema.safeParse(directResponse);
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
  assert.equal(result.data.display_name, 'Mystical Forest');
  assert.equal(result.data.world_id, 'dc2c65e4-68d3-4210-a01e-7a54cc9ded2a');
});

test('OperationSchema rejects an envelope missing the operation_id field', async () => {
  const { OperationSchema } = await import(
    '../packages/asset-generators/dist/clients/schemas/world-labs.js'
  );

  const malformed = {
    // operation_id intentionally absent
    done: false,
  };

  const result = OperationSchema.safeParse(malformed);
  assert.equal(result.success, false, 'parse must fail when operation_id is missing');
});

test('WorldScenePromptResultSchema validates the agent output shape', async () => {
  const { WorldScenePromptResultSchema } = await import(
    '../packages/shared/dist/schemas/agent-outputs.js'
  );

  const valid = {
    displayName: 'Late-Night Home Studio',
    worldPrompt:
      'A small home office at night, walnut desk, dual monitors with code on screen, warm desk lamp glow, mechanical keyboard, an open laptop running a build.',
    model: 'marble-1.1',
    reasoning: 'Solo developer at home matches the target audience for a CLI dev tool.',
  };
  assert.equal(WorldScenePromptResultSchema.safeParse(valid).success, true);

  const badModel = { ...valid, model: 'marble-2-not-real' };
  assert.equal(
    WorldScenePromptResultSchema.safeParse(badModel).success,
    false,
    'unknown model values must be rejected'
  );

  const emptyPrompt = { ...valid, worldPrompt: '' };
  assert.equal(
    WorldScenePromptResultSchema.safeParse(emptyPrompt).success,
    false,
    'empty world prompts must be rejected'
  );
});

test('AssetType union from @launchkit/shared includes world_scene', async () => {
  const { AssetTypeSchema } = await import(
    '../packages/shared/dist/enums.js'
  );

  assert.equal(AssetTypeSchema.safeParse('world_scene').success, true);
});
