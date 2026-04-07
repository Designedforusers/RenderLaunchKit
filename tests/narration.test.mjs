import test from 'node:test';
import assert from 'node:assert/strict';

test('parseVoiceoverScript extracts segments and plain text', async () => {
  const { parseVoiceoverScript } = await import(
    '../packages/shared/dist/voiceover.js'
  );

  const parsed = parseVoiceoverScript(`
[SCREEN: Developer pain]
"Launching a devtool usually means writing everything from scratch."

[SCREEN: Product reveal]
"LaunchKit turns a GitHub repo into a full launch pack."
`);

  assert.equal(parsed.segmentCount, 2);
  assert.equal(
    parsed.plainText,
    'Launching a devtool usually means writing everything from scratch. LaunchKit turns a GitHub repo into a full launch pack.'
  );
  assert.deepEqual(parsed.segments[0], {
    screenCue: 'Developer pain',
    text: 'Launching a devtool usually means writing everything from scratch.',
    charStart: 0,
    charEnd: 66,
  });
});

test('parseVoiceoverScript rejects malformed blocks', async () => {
  const { parseVoiceoverScript } = await import(
    '../packages/shared/dist/voiceover.js'
  );

  assert.throws(
    () =>
      parseVoiceoverScript(`
[SCREEN: Missing quotes]
This line is invalid
`),
    /Voiceover script must use repeated/
  );
});

test('alignmentToCaptions maps segment timing to frame ranges', async () => {
  const { parseVoiceoverScript } = await import(
    '../packages/shared/dist/voiceover.js'
  );
  const { alignmentToCaptions } = await import(
    '../apps/web/dist/lib/narration.js'
  );

  const parsed = parseVoiceoverScript(`
[SCREEN: One]
"Hello world."

[SCREEN: Two]
"Ship it."
`);

  const characters = Array.from(parsed.plainText);
  const character_start_times_seconds = characters.map((_, index) => index * 0.1);
  const character_end_times_seconds = characters.map((_, index) => index * 0.1 + 0.08);

  const captions = alignmentToCaptions(parsed, {
    characters,
    character_start_times_seconds,
    character_end_times_seconds,
  });

  assert.equal(captions.length, 2);
  assert.deepEqual(captions[0], {
    startInFrames: 0,
    endInFrames: 29,
    text: 'Hello world.',
  });
  assert.deepEqual(captions[1], {
    startInFrames: 31,
    endInFrames: 50,
    text: 'Ship it.',
  });
});

test('buildNarratedCacheSeed changes when asset versions change', async () => {
  const { buildNarratedCacheSeed } = await import(
    '../apps/web/dist/lib/narration.js'
  );
  const { defaultLaunchKitVideoProps } = await import(
    '../packages/video/dist/index.js'
  );

  const first = buildNarratedCacheSeed({
    assetId: 'video-1',
    assetVersion: 1,
    voiceoverAssetId: 'voice-1',
    voiceoverVersion: 1,
    voiceId: 'voice',
    modelId: 'model',
    plainText: 'Hello world.',
    remotionProps: defaultLaunchKitVideoProps,
  });
  const second = buildNarratedCacheSeed({
    assetId: 'video-1',
    assetVersion: 2,
    voiceoverAssetId: 'voice-1',
    voiceoverVersion: 1,
    voiceId: 'voice',
    modelId: 'model',
    plainText: 'Hello world.',
    remotionProps: defaultLaunchKitVideoProps,
  });

  assert.notEqual(first, second);
});
