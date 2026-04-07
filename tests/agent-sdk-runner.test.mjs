// Smoke tests for the Claude Agent SDK migration.
//
// These tests do not burn Anthropic API credits — they exercise the
// import surface and the schema validation that the research agent
// relies on, without spinning up a real `query()` call. The goal is to
// catch breakage from dependency upgrades, type changes, missing
// imports, or bad zod schemas before the worker is deployed.
//
// A real end-to-end test against the Agent SDK requires (a) the
// `@anthropic-ai/claude-code` CLI binary on the PATH and (b) a valid
// `ANTHROPIC_API_KEY` — that's the responsibility of a deploy-time
// integration check, not this test file.

import test from 'node:test';
import assert from 'node:assert/strict';

test('agent-sdk-runner module loads and exposes runAgent', async () => {
  const mod = await import('../apps/worker/dist/lib/agent-sdk-runner.js');
  assert.equal(typeof mod.runAgent, 'function', 'runAgent must be a function');
});

test('launch-research-agent module loads and exposes runResearchAgent', async () => {
  const mod = await import('../apps/worker/dist/agents/launch-research-agent.js');
  assert.equal(
    typeof mod.runResearchAgent,
    'function',
    'runResearchAgent must be a function'
  );
});

test('claude-agent-sdk exports the symbols we depend on', async () => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  assert.equal(typeof sdk.query, 'function', 'query() must exist');
  assert.equal(typeof sdk.tool, 'function', 'tool() must exist');
  assert.equal(
    typeof sdk.createSdkMcpServer,
    'function',
    'createSdkMcpServer() must exist'
  );
});

test('tool() accepts our heterogeneous Zod schemas without throwing', async () => {
  const { tool } = await import('@anthropic-ai/claude-agent-sdk');
  const { z } = await import('zod');

  // String input
  const stringTool = tool(
    'echo',
    'Echo a string',
    { input: z.string() },
    async ({ input }) => ({ content: [{ type: 'text', text: input }] })
  );
  assert.equal(stringTool.name, 'echo');
  assert.equal(stringTool.description, 'Echo a string');
  assert.equal(typeof stringTool.handler, 'function');
  assert.ok(stringTool.inputSchema, 'tool must expose inputSchema');
  assert.ok(
    stringTool.inputSchema.input,
    'inputSchema must contain the declared field'
  );

  // Object input with multiple fields
  const complexTool = tool(
    'lookup',
    'Look up something',
    {
      query: z.string(),
      limit: z.number().optional(),
    },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );
  assert.equal(complexTool.name, 'lookup');
  assert.ok(complexTool.inputSchema.query);
  assert.ok(complexTool.inputSchema.limit);

  // Array input — same shape the research_complete tool uses
  const arrayTool = tool(
    'submit_results',
    'Submit results',
    {
      items: z.array(
        z.object({
          name: z.string(),
          score: z.number(),
        })
      ),
    },
    async ({ items }) => ({
      content: [{ type: 'text', text: `received ${items.length} items` }],
    })
  );
  assert.equal(arrayTool.name, 'submit_results');
  assert.ok(arrayTool.inputSchema.items);
});

test('createSdkMcpServer accepts an array of heterogeneous tools', async () => {
  const { tool, createSdkMcpServer } = await import(
    '@anthropic-ai/claude-agent-sdk'
  );
  const { z } = await import('zod');

  const server = createSdkMcpServer({
    name: 'launchkit-test',
    version: '1.0.0',
    tools: [
      tool('a', 'A', { x: z.string() }, async () => ({
        content: [{ type: 'text', text: '' }],
      })),
      tool('b', 'B', { y: z.number() }, async () => ({
        content: [{ type: 'text', text: '' }],
      })),
    ],
  });

  assert.ok(server, 'createSdkMcpServer must return a server config');
  assert.equal(server.name, 'launchkit-test');
});
