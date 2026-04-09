import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import type { GenerateAssetJobData } from '@launchkit/shared';
import { assetGenerators } from '../lib/asset-generators-instance.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { database as db } from '../lib/database.js';

const {
  generateWrittenAsset,
  generateMarketingImageAsset,
  generateProductVideoAsset,
  generateVideoStoryboardAsset,
  generateVoiceCommercialAsset,
  generatePodcastScriptAsset,
  generateWorldSceneAsset,
} = assetGenerators;

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
    data.generationInstructions ??
    (data as GenerateAssetJobData & { brief?: string }).brief ??
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
    } else if (assetType === 'voice_commercial') {
      // 30-second ad-style script + ElevenLabs single-voice render.
      // The audio MP3 is cached on disk by the worker; the dashboard
      // streams it from the new /api/assets/:id/audio.mp3 route, which
      // resolves the cache file via `metadata.audioCacheKey`.
      const result = await generateVoiceCommercialAsset({
        assetId,
        repoName,
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        generationInstructions,
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
      });
      content = result.script;
      mediaUrl = `/api/assets/${assetId}/audio.mp3`;
      metadata = result.metadata;
    } else if (assetType === 'podcast_script') {
      // Multi-speaker dialogue + ElevenLabs multi-voice render. Same
      // serving model as `voice_commercial` above — the cached MP3 is
      // surfaced through the audio streaming route.
      const result = await generatePodcastScriptAsset({
        assetId,
        repoName,
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        generationInstructions,
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
      });
      content = result.script;
      mediaUrl = `/api/assets/${assetId}/audio.mp3`;
      metadata = result.metadata;
    } else if (assetType === 'world_scene') {
      // World Labs (Marble) 3D scene of the product in a real-world
      // setting. Claude drafts the world prompt; the World Labs client
      // kicks off the generation, polls until done, and returns the
      // public viewer URL plus every supporting asset URL we might
      // want to surface (thumbnail, panorama, splat, collider mesh).
      // The dashboard renders the thumbnail and links the user out to
      // `marbleUrl` for the interactive walk-through. The user-facing
      // text content is the world prompt itself so it round-trips on
      // regenerate without re-querying Claude for the same shape.
      const result = await generateWorldSceneAsset({
        repoName,
        repoAnalysis,
        research,
        strategy,
        generationInstructions,
      });
      content = result.prompt;
      mediaUrl = result.marbleUrl;
      metadata = result.metadata;
    } else {
      // Writer agent handles all remaining text content (blog post,
      // twitter thread, FAQ, voiceover script, tips, …). The new
      // `tips` branch lives in this catch-all because it produces a
      // pure text asset with no audio or video render attached.
      const result = await generateWrittenAsset({
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        assetType,
        generationInstructions,
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
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
