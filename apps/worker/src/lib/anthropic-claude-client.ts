import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, Tool, ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { anthropic };

/**
 * Simple prompted call — single request/response.
 * Used by content generation agents (writer, strategist, etc.)
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }
  return textBlock.text;
}

/**
 * JSON generation — prompted call that expects a JSON response.
 */
export async function generateJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number }
): Promise<T> {
  const response = await generateContent(
    systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.',
    userPrompt,
    options
  );

  // Strip markdown code fences if present
  const cleaned = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  return JSON.parse(cleaned) as T;
}

/**
 * Agentic tool-use loop — the core of the research agent.
 * Claude decides which tools to call and when to stop.
 */
export async function runAgentLoop(config: {
  systemPrompt: string;
  initialMessage: string;
  tools: Tool[];
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  terminalTool?: string;
  maxSteps?: number;
  maxTokens?: number;
}): Promise<unknown> {
  const {
    systemPrompt,
    initialMessage,
    tools,
    toolExecutor,
    onToolCall,
    terminalTool = 'research_complete',
    maxSteps = 15,
    maxTokens = 4096,
  } = config;

  const messages: MessageParam[] = [
    { role: 'user', content: initialMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    // If Claude stopped without calling a tool, return the final text
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((c) => c.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : null;
    }

    // Process tool calls
    const toolUses = response.content.filter(
      (c): c is ToolUseBlock => c.type === 'tool_use'
    );

    if (toolUses.length === 0) {
      const textBlock = response.content.find((c) => c.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : null;
    }

    // Add assistant message with all content blocks
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool and collect results
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      onToolCall?.(toolUse.name, toolUse.input as Record<string, unknown>);

      // Check for terminal tool — return its input as the result
      if (toolUse.name === terminalTool) {
        return toolUse.input;
      }

      try {
        const result = await toolExecutor(toolUse.name, toolUse.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`Agent exceeded maximum steps (${maxSteps})`);
}
