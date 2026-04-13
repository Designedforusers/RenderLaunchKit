import type { AssetType, StrategyBrief } from '@launchkit/shared';

export const STRATEGY_ASSET_TYPES = [
  'blog_post',
  'twitter_thread',
  'linkedin_post',
  'product_hunt_description',
  'hacker_news_post',
  'faq',
  'changelog_entry',
  'og_image',
  'social_card',
  'product_video',
  'voiceover_script',
  'video_storyboard',
  'tips',
  'voice_commercial',
  'podcast_script',
  'world_scene',
] as const satisfies readonly AssetType[];

const ALWAYS_AVAILABLE_ASSET_TYPES = [
  'blog_post',
  'twitter_thread',
  'linkedin_post',
  'product_hunt_description',
  'hacker_news_post',
  'faq',
  'changelog_entry',
  'voiceover_script',
  'tips',
] as const satisfies readonly AssetType[];

const FAL_ASSET_TYPES = [
  'og_image',
  'social_card',
  'product_video',
  'video_storyboard',
] as const satisfies readonly AssetType[];

const ELEVENLABS_ASSET_TYPES = [
  'voice_commercial',
  'podcast_script',
] as const satisfies readonly AssetType[];

const WORLD_LABS_ASSET_TYPES = [
  'world_scene',
] as const satisfies readonly AssetType[];

const REQUIRED_ASSETS = [
  {
    type: 'blog_post',
    generationInstructions:
      'Write a technical blog post introducing the product, its key features, and why developers should care.',
    priority: 1,
  },
  {
    type: 'og_image',
    generationInstructions:
      'Create an OG image that communicates the product value at a glance.',
    priority: 2,
  },
] as const;

export interface LaunchStrategyCapabilityInput {
  falConfigured: boolean;
  elevenLabsConfigured: boolean;
  worldLabsConfigured: boolean;
}

export interface UnavailableLaunchAsset {
  type: AssetType;
  reasoning: string;
}

export interface LaunchStrategyAssetCapabilities {
  availableAssetTypes: AssetType[];
  unavailableAssets: UnavailableLaunchAsset[];
}

function unavailableReasonForAssetType(type: AssetType): string {
  switch (type) {
    case 'og_image':
    case 'social_card':
      return 'Skipped because this deployment does not have fal.ai image generation configured.';
    case 'product_video':
    case 'video_storyboard':
      return 'Skipped because this deployment does not have fal.ai visual generation configured for video planning.';
    case 'voice_commercial':
    case 'podcast_script':
      return 'Skipped because this deployment does not have ElevenLabs audio generation configured.';
    case 'world_scene':
      return 'Skipped because this deployment does not have World Labs 3D scene generation configured.';
    default:
      return 'Skipped because this asset type is unavailable in the current deployment.';
  }
}

export function getLaunchStrategyAssetCapabilities(
  input: LaunchStrategyCapabilityInput
): LaunchStrategyAssetCapabilities {
  const available = new Set<AssetType>(ALWAYS_AVAILABLE_ASSET_TYPES);

  if (input.falConfigured) {
    for (const type of FAL_ASSET_TYPES) {
      available.add(type);
    }
  }

  if (input.elevenLabsConfigured) {
    for (const type of ELEVENLABS_ASSET_TYPES) {
      available.add(type);
    }
  }

  if (input.worldLabsConfigured) {
    for (const type of WORLD_LABS_ASSET_TYPES) {
      available.add(type);
    }
  }

  const availableAssetTypes = STRATEGY_ASSET_TYPES.filter((type) =>
    available.has(type)
  );
  const unavailableAssets = STRATEGY_ASSET_TYPES.filter(
    (type) => !available.has(type)
  ).map((type) => ({
    type,
    reasoning: unavailableReasonForAssetType(type),
  }));

  return { availableAssetTypes, unavailableAssets };
}

export function applyLaunchStrategyAssetCapabilities(
  strategy: StrategyBrief,
  capabilities: LaunchStrategyAssetCapabilities
): StrategyBrief {
  const available = new Set(capabilities.availableAssetTypes);
  const unavailableByType = new Map(
    capabilities.unavailableAssets.map((asset) => [asset.type, asset.reasoning])
  );
  const skipByType = new Map(
    strategy.skipAssets.map((asset) => [asset.type, asset])
  );
  const seen = new Set<AssetType>();
  const assetsToGenerate: StrategyBrief['assetsToGenerate'] = [];

  for (const asset of strategy.assetsToGenerate) {
    const unavailableReason = unavailableByType.get(asset.type);
    if (unavailableReason !== undefined) {
      skipByType.set(asset.type, {
        type: asset.type,
        reasoning: unavailableReason,
      });
      continue;
    }

    if (seen.has(asset.type)) {
      continue;
    }

    seen.add(asset.type);
    assetsToGenerate.push(asset);
  }

  for (const requiredAsset of REQUIRED_ASSETS) {
    if (!available.has(requiredAsset.type) || seen.has(requiredAsset.type)) {
      continue;
    }

    seen.add(requiredAsset.type);
    assetsToGenerate.push({ ...requiredAsset });
  }

  return {
    ...strategy,
    assetsToGenerate,
    skipAssets: [...skipByType.values()],
  };
}
