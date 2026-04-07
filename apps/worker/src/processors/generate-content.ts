import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import type { GenerateAssetJobData } from '@launchkit/shared';
import { runWriter } from '../agents/writer.js';
import { runArtDirector } from '../agents/art-director.js';
import { runVideoDirector } from '../agents/video-director.js';
import { events } from '../lib/publisher.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Unified content generation processor.
 * Routes to the appropriate agent based on asset type.
 */
export async function processGenerateContent(data: GenerateAssetJobData): Promise<void> {
  const { projectId, assetId, assetType, brief, repoAnalysis, research, strategy, pastInsights, revisionInstructions } = data;

  // Mark asset as generating
  await db
    .update(schema.assets)
    .set({ status: 'generating', updatedAt: new Date() })
    .where(eq(schema.assets.id, assetId));

  await events.statusUpdate(projectId, 'generating', `Generating ${assetType}`);

  try {
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let metadata: Record<string, unknown> = {};

    // Route to the appropriate agent
    if (assetType === 'og_image' || assetType === 'social_card') {
      // Art Director → fal.ai FLUX
      const result = await runArtDirector({
        repoAnalysis,
        research,
        strategy,
        assetType,
        brief,
      });
      mediaUrl = result.url;
      metadata = { ...result.metadata, prompt: result.prompt, style: result.style };
    } else if (assetType === 'product_video') {
      // Video Director → fal.ai Kling
      const result = await runVideoDirector({
        repoAnalysis,
        research,
        strategy,
        brief,
      });
      mediaUrl = result.videoUrl;
      metadata = {
        ...result.metadata,
        thumbnailUrl: result.thumbnailUrl,
        storyboard: result.storyboard,
      };
    } else if (assetType === 'video_storyboard') {
      // Storyboard is text content from the video director's output
      const result = await runVideoDirector({
        repoAnalysis,
        research,
        strategy,
        brief,
      });
      content = JSON.stringify(result.storyboard, null, 2);
      metadata = result.metadata;
    } else {
      // Writer agent handles all text content
      const result = await runWriter({
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        assetType,
        brief,
        revisionInstructions,
      });
      content = result.content;
      metadata = result.metadata;
    }

    // Update asset with generated content
    await db
      .update(schema.assets)
      .set({
        content,
        mediaUrl,
        metadata,
        status: 'reviewing',
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId));

    await events.assetReady(projectId, assetId, assetType);

    console.log(`[Generate] ${assetType} complete for project ${projectId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(schema.assets)
      .set({
        status: 'failed',
        metadata: { error: errorMessage },
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId));

    await events.error(projectId, 'generation', `Failed to generate ${assetType}: ${errorMessage}`);

    throw err;
  }
}
