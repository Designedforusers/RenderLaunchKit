import { createHash } from 'node:crypto';

/**
 * Pure filename helpers for the Remotion render cache. Lives in its
 * own file so the browser-safe top-level `@launchkit/video` export
 * can re-export these without pulling the Node-only
 * `@remotion/bundler` + `@remotion/renderer` imports from
 * `remotion-renderer.ts` into the dashboard's Vite bundle.
 *
 * Anything here must be pure: no imports from `@remotion/*`, no
 * filesystem access, no environment lookups. `node:crypto` is a
 * Node built-in and is bundled into the browser safely by Vite's
 * built-in polyfill surface.
 */

/**
 * Composition id literal union, duplicated here instead of imported
 * from `remotion-renderer.ts` because that module has top-level
 * Node-only imports that would poison this file's browser safety.
 * The canonical definition lives in `remotion-renderer.ts` as
 * `RemotionCompositionId`; any addition there must also land here,
 * and a TypeScript assignability guard in the renderer ensures the
 * two never drift silently.
 */
export type CompositionId =
  | 'LaunchKitProductVideo'
  | 'LaunchKitVoiceCommercial'
  | 'LaunchKitPodcastWaveform'
  | 'LaunchKitVerticalVideo';

/**
 * Stable filename the web service sends in `Content-Disposition`
 * headers on video responses so browsers download the file with a
 * sensible name.
 */
export function getRenderedVideoFilename(
  assetId: string,
  version: number,
  variant: 'visual' | 'narrated' = 'visual'
): string {
  return `launchkit-${assetId}-v${String(version)}${
    variant === 'narrated' ? '-narrated' : ''
  }.mp4`;
}

/**
 * Deterministic basename used as the cache key on disk.
 *
 * The legacy `LaunchKitProductVideo` cache layout predates Phase 4
 * and is preserved verbatim so existing cached files on disk remain
 * valid. New compositions embed the composition id in the basename
 * so renders for the same asset id never collide across
 * compositions.
 */
export function buildRenderBasename(input: {
  assetId: string;
  version: number;
  variant: 'visual' | 'narrated';
  compositionId: CompositionId;
  cacheSeed?: string;
}): string {
  const suffix = input.cacheSeed
    ? `-${createHash('sha1').update(input.cacheSeed).digest('hex').slice(0, 12)}`
    : '';

  if (input.compositionId === 'LaunchKitProductVideo') {
    return `${input.assetId}-v${String(input.version)}-${input.variant}${suffix}`;
  }

  return `${input.assetId}-${input.compositionId}-v${String(input.version)}-${input.variant}${suffix}`;
}
