import { generateJSON } from '../lib/anthropic-claude-client.js';
import { generateWorldScene } from '../lib/world-labs-client.js';
import { WorldScenePromptResultSchema } from '@launchkit/shared';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
} from '@launchkit/shared';

interface WorldSceneAgentInput {
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  generationInstructions: string;
}

interface WorldSceneAgentResult {
  marbleUrl: string;
  thumbnailUrl: string | null;
  prompt: string;
  metadata: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a 3D environment art director who specialises in product placement scenes. Your job is to write a prompt for the World Labs Marble API that produces a photoreal 3D world a user can walk through, showing the developer product or service being used in a real-world setting.

Output JSON:
{
  "displayName": "short human-readable name for the scene (under 40 chars)",
  "worldPrompt": "detailed text prompt for World Labs Marble describing the scene",
  "model": "marble-1.1" or "marble-1.1-plus",
  "reasoning": "one sentence on why this setting fits the product"
}

Guidelines for the worldPrompt:
- Describe a single coherent space, not a montage. Marble generates one continuous world, not a sequence of cuts.
- Anchor the scene in a real-world location the target user would recognise (a developer's home office, a startup co-working floor, a hardware lab, a conference hallway, a coffee-shop window seat, etc.).
- Show the product in *use*, not as a logo on a wall. Laptops open with code on screen, dashboards reflected in monitors, tablets on a desk mid-task, devices wired to test rigs.
- Specify lighting ("warm afternoon window light", "cold blue monitor glow", "overhead fluorescent"), materials ("brushed aluminium", "dark walnut desk", "matte black plastic"), and at least one focal prop that ties back to the product's category.
- Avoid copyrighted brand logos, recognisable faces, or text the model will struggle to render legibly.
- Keep the prompt under 800 characters.

Choosing the model:
- "marble-1.1" — default. Use for indoor scenes that fit one room: a single home office, a meeting pod, a single coffee-shop table, a small lab bench.
- "marble-1.1-plus" — use only when the scene calls for an outdoor environment, an open-plan office floor, a warehouse, a conference hall, or any space substantially larger than a single room. The plus model consumes more credits.

Choosing the displayName:
- Title case, no quotes, no trailing punctuation.
- Should describe the setting, not the product (e.g. "Late-Night Home Studio", not "LaunchKit Demo").`;

export async function generateWorldSceneAsset(
  input: WorldSceneAgentInput
): Promise<WorldSceneAgentResult> {
  const userPrompt = `Design a 3D world that shows the following product being used in a real-life setting:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Repo Name:** ${input.repoName}
**Language:** ${input.repoAnalysis.language}
**Category:** ${input.repoAnalysis.category}
**Target Audience:** ${input.research.targetAudience}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Asset Generation Instructions:** ${input.generationInstructions}

Pick a setting where someone in the target audience would actually use this product day-to-day. The world should sell the feeling of using the product, not explain it.`;

  // Get Claude to draft the world prompt. Validated through
  // WorldScenePromptResultSchema so a missing `worldPrompt`, an
  // unknown `model`, or an empty `displayName` throws here instead of
  // crashing the World Labs client downstream with a 4xx that hides
  // the underlying mistake in the agent output.
  const promptResult = await generateJSON(
    WorldScenePromptResultSchema,
    SYSTEM_PROMPT,
    userPrompt
  );

  // Generate the world via the World Labs Marble API. The client
  // blocks for ~5 minutes while the operation is polled and returns
  // a normalised result with the public viewer URL plus every asset
  // URL the dashboard might want to surface.
  const world = await generateWorldScene({
    displayName: promptResult.displayName,
    worldPrompt: promptResult.worldPrompt,
    model: promptResult.model,
  });

  return {
    marbleUrl: world.marbleUrl,
    thumbnailUrl: world.thumbnailUrl,
    prompt: world.prompt,
    metadata: {
      worldLabs: {
        worldId: world.worldId,
        operationId: world.operationId,
        marbleUrl: world.marbleUrl,
        thumbnailUrl: world.thumbnailUrl,
        panoUrl: world.panoUrl,
        splatUrl: world.splatUrl,
        colliderMeshUrl: world.colliderMeshUrl,
        caption: world.caption,
        model: world.model,
      },
      displayName: promptResult.displayName,
      prompt: world.prompt,
      reasoning: promptResult.reasoning,
      model: promptResult.model,
    },
  };
}
