import { z } from 'zod';

/**
 * Type definitions and Zod schemas for the LaunchKit Remotion video
 * composition.
 *
 * The schemas exist alongside the inferred types so callers that
 * receive these props from an untrusted source (e.g. the Remotion
 * render route in `apps/web/src/routes/asset-api-routes.ts`, which
 * pulls the props from `assets.metadata.remotionProps`) can validate
 * the shape with `LaunchKitVideoPropsSchema.safeParse(value)` instead
 * of a hand-rolled type guard.
 *
 * `z.infer` produces TypeScript types that are structurally
 * identical to the previous hand-written `LaunchKitVideoProps` /
 * `LaunchKitVideoShot` / `LaunchKitCaption` interfaces, so every
 * existing import keeps working unchanged.
 */

export const LaunchKitVideoShotSchema = z.object({
  id: z.string(),
  headline: z.string(),
  caption: z.string(),
  imageUrl: z.string(),
  durationInFrames: z.number().positive(),
  accent: z.string().optional(),
});
export type LaunchKitVideoShot = z.infer<typeof LaunchKitVideoShotSchema>;

export const LaunchKitCaptionSchema = z.object({
  startInFrames: z.number().nonnegative(),
  endInFrames: z.number().positive(),
  text: z.string(),
});
export type LaunchKitCaption = z.infer<typeof LaunchKitCaptionSchema>;

export const LaunchKitVideoPropsSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  badge: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  shots: z.array(LaunchKitVideoShotSchema),
  outroCta: z.string(),
  audioSrc: z.string().optional(),
  captions: z.array(LaunchKitCaptionSchema).optional(),
});
export type LaunchKitVideoProps = z.infer<typeof LaunchKitVideoPropsSchema>;

export const VIDEO_FPS = 24;
export const VIDEO_WIDTH = 960;
export const VIDEO_HEIGHT = 540;
export const OUTRO_DURATION_IN_FRAMES = 36;

export function getLaunchKitVideoDurationInFrames(
  props: LaunchKitVideoProps
): number {
  const captionDuration =
    props.captions?.reduce(
      (max, caption) => Math.max(max, caption.endInFrames),
      0
    ) ?? 0;

  return (
    Math.max(
      props.shots.reduce((total, shot) => total + shot.durationInFrames, 0),
      captionDuration
    ) +
    OUTRO_DURATION_IN_FRAMES
  );
}

export const defaultLaunchKitVideoProps: LaunchKitVideoProps = {
  title: 'LaunchKit',
  subtitle: 'AI go-to-market teammate',
  badge: 'Product Video',
  accentColor: '#10b981',
  backgroundColor: '#020617',
  shots: [
    {
      id: 'shot-1',
      headline: 'Ship the launch',
      caption: 'Research, strategy, creative, and review in one flow.',
      imageUrl: 'https://placehold.co/1280x720/020617/10b981?text=LaunchKit',
      durationInFrames: 48,
      accent: 'fast',
    },
  ],
  outroCta: 'Paste a repo. Generate the launch pack.',
};
