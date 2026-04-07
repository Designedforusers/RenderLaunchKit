import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import type { GenerateAssetJobData } from '@launchkit/shared';
import { generateWrittenAsset } from '../agents/written-asset-agent.js';
import { generateMarketingImageAsset } from '../agents/marketing-visual-agent.js';
import {
  generateProductVideoAsset,
  generateVideoStoryboardAsset,
} from '../agents/product-video-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Unified content generation processor.
 * Routes to the appropriate agent based on asset type.
 */
export async function generateProjectAsset(data: GenerateAssetJobData): Promise<void> {
  const {
    projectId,
    assetId,
    assetType,
    repoName,
    repoAnalysis,
    research,
    strategy,
    pastInsights,
    revisionInstructions,
  } = data;
  const generationInstructions =
    data.generationInstructions ||
    ((data as GenerateAssetJobData & { brief?: string }).brief) ||
    `Generate a ${assetType} for this product.`;

  // Mark asset as generating
  await db
    .update(schema.assets)
    .set({ status: 'generating', updatedAt: new Date() })
    .where(eq(schema.assets.id, assetId));

  await projectProgressPublisher.statusUpdate(
    projectId,
    'generating',
    `Generating ${assetType}`
  );

  try {
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let metadata: Record<string, unknown> = {};

    // Route to the appropriate agent
    if (assetType === 'og_image' || assetType === 'social_card') {
      // Art Director → fal.ai FLUX
      const result = await generateMarketingImageAsset({
        repoAnalysis,
        research,
        strategy,
        assetType,
        generationInstructions,
      });
      mediaUrl = result.url;
      metadata = { ...result.metadata, prompt: result.prompt, style: result.style };
    } else if (assetType === 'product_video') {
      // Video Director → fal.ai Kling
      const result = await generateProductVideoAsset({
        repoName,
        repoAnalysis,
        research,
        strategy,
        generationInstructions,
      });
      mediaUrl = result.videoUrl;
      metadata = {
        ...result.metadata,
        thumbnailUrl: result.thumbnailUrl,
        storyboard: result.storyboard,
      };
    } else if (assetType === 'video_storyboard') {
      // Storyboard is a text-first output with the shared Remotion plan attached.
      const result = await generateVideoStoryboardAsset({
        repoName,
        repoAnalysis,
        research,
        strategy,
        generationInstructions,
      });
      content = JSON.stringify(result.storyboard, null, 2);
      metadata = {
        ...result.metadata,
        thumbnailUrl: result.thumbnailUrl,
        storyboard: result.storyboard,
      };
    } else {
      // Writer agent handles all text content
      const result = await generateWrittenAsset({
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        assetType,
        generationInstructions,
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
        metadata: {
          ...metadata,
          generationInstructions,
        },
        status: 'reviewing',
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId));

    await projectProgressPublisher.assetReady(projectId, assetId, assetType);

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

    await projectProgressPublisher.error(
      projectId,
      'generation',
      `Failed to generate ${assetType}: ${errorMessage}`
    );

    throw err;
  }
}
