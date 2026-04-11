// Browser-safe entry point. Compositions + types + schemas only.
//
// The Node-only Remotion renderer (`createRemotionRenderer`) lives
// at the `@launchkit/video/renderer` subpath export so the dashboard
// can keep importing `LaunchKitVideoProps` and friends from
// `@launchkit/video` without Vite pulling `@remotion/bundler` and
// `@remotion/renderer` into the browser bundle — those packages
// import `createRequire` from `node:module`, which breaks the
// Rollup build. Backend consumers (`apps/web`, `apps/workflows`)
// import from `@launchkit/video/renderer` explicitly.
//
// `getRenderedVideoFilename` and `buildRenderBasename` live in
// `./lib/filename-helpers.ts` and are re-exported by the `/renderer`
// subpath only. They import `node:crypto` for sha1 hashing, which
// Vite cannot cleanly polyfill for the browser, so the top-level
// export here intentionally does NOT surface them. Tests import
// them directly from `./lib/filename-helpers.js` in the compiled
// output.
export * from './LaunchKitVideo.js';
export * from './PodcastWaveform.js';
export * from './VerticalVideo.js';
export * from './VoiceCommercial.js';
export * from './types.js';
