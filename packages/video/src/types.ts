export type LaunchKitVideoShot = {
  id: string;
  headline: string;
  caption: string;
  imageUrl: string;
  durationInFrames: number;
  accent?: string;
};

export type LaunchKitCaption = {
  startInFrames: number;
  endInFrames: number;
  text: string;
};

export type LaunchKitVideoProps = {
  title: string;
  subtitle: string;
  badge: string;
  accentColor: string;
  backgroundColor: string;
  shots: LaunchKitVideoShot[];
  outroCta: string;
  audioSrc?: string;
  captions?: LaunchKitCaption[];
};

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
    ) || 0;

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
