import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLaunchStrategyAssetCapabilities,
  getLaunchStrategyAssetCapabilities,
} from '../apps/worker/dist/lib/launch-strategy-asset-capabilities.js';

test('getLaunchStrategyAssetCapabilities returns text-only assets when optional providers are absent', () => {
  const capabilities = getLaunchStrategyAssetCapabilities({
    falConfigured: false,
    elevenLabsConfigured: false,
    worldLabsConfigured: false,
  });

  assert.deepEqual(capabilities.availableAssetTypes, [
    'blog_post',
    'twitter_thread',
    'linkedin_post',
    'product_hunt_description',
    'hacker_news_post',
    'faq',
    'changelog_entry',
    'voiceover_script',
    'tips',
  ]);
  assert.equal(
    capabilities.unavailableAssets.find((asset) => asset.type === 'og_image')
      ?.reasoning,
    'Skipped because this deployment does not have fal.ai image generation configured.'
  );
  assert.equal(
    capabilities.unavailableAssets.find(
      (asset) => asset.type === 'voice_commercial'
    )?.reasoning,
    'Skipped because this deployment does not have ElevenLabs audio generation configured.'
  );
});

test('applyLaunchStrategyAssetCapabilities strips unsupported assets and preserves supported ones', () => {
  const capabilities = getLaunchStrategyAssetCapabilities({
    falConfigured: true,
    elevenLabsConfigured: false,
    worldLabsConfigured: false,
  });

  const strategy = applyLaunchStrategyAssetCapabilities(
    {
      positioning: 'Turn repo analysis into launch assets.',
      tone: 'technical',
      keyMessages: ['Fast setup', 'Render-native', 'Multi-service'],
      selectedChannels: [
        {
          channel: 'twitter',
          priority: 1,
          reasoning: 'Developer audience is already there.',
        },
      ],
      assetsToGenerate: [
        {
          type: 'product_video',
          generationInstructions: 'Show the end-to-end flow.',
          priority: 1,
        },
        {
          type: 'voice_commercial',
          generationInstructions: 'Produce a narrated audio spot.',
          priority: 2,
        },
      ],
      skipAssets: [],
    },
    capabilities
  );

  assert.deepEqual(
    strategy.assetsToGenerate.map((asset) => asset.type),
    ['product_video', 'blog_post', 'og_image']
  );
  assert.deepEqual(strategy.skipAssets, [
    {
      type: 'voice_commercial',
      reasoning:
        'Skipped because this deployment does not have ElevenLabs audio generation configured.',
    },
  ]);
});
