import { motion, useReducedMotion } from 'framer-motion';
import { Player } from '@remotion/player';
import {
  LaunchKitVideo,
  getLaunchKitVideoDurationInFrames,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '@launchkit/video';
import type { LaunchKitVideoProps } from '@launchkit/video';

interface LaunchVideoPreviewProps {
  videoUrl?: string | null;
  thumbnailUrl?: string;
  title?: string;
  remotionProps?: LaunchKitVideoProps | null;
  onError?: () => void;
  onLoadedData?: () => void;
}

export function LaunchVideoPreview({
  videoUrl,
  thumbnailUrl,
  title,
  remotionProps,
  onError,
  onLoadedData,
}: LaunchVideoPreviewProps) {
  if (!videoUrl && !remotionProps) {
    return <VideoGeneratingPlaceholder />;
  }

  return (
    <motion.div
      className="rounded-lg overflow-hidden bg-surface-800 border border-surface-800/80 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          poster={thumbnailUrl}
          className="w-full aspect-video"
          preload="metadata"
          onError={onError}
          onLoadedData={onLoadedData}
        >
          Your browser does not support the video tag.
        </video>
      ) : remotionProps ? (
        <div className="aspect-video bg-[#020617]">
          <Player
            component={LaunchKitVideo}
            inputProps={remotionProps}
            durationInFrames={getLaunchKitVideoDurationInFrames(remotionProps)}
            fps={VIDEO_FPS}
            compositionWidth={VIDEO_WIDTH}
            compositionHeight={VIDEO_HEIGHT}
            controls
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      ) : null}
      {title && (
        <div className="p-3 border-t border-surface-700">
          <p className="text-sm text-surface-300">{title}</p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Animated placeholder shown while a video asset is still rendering.
 * Three concentric halo rings pulse outward from a centered film-
 * reel icon; the copy shimmers between two opacities so the state
 * reads as "still working" without any CSS keyframe class that
 * would disappear under reduced-motion.
 */
function VideoGeneratingPlaceholder() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="w-full aspect-video bg-surface-800 rounded-lg flex items-center justify-center relative overflow-hidden">
      {/* Soft grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.5) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative text-center text-surface-500">
        <div className="relative mx-auto mb-3 h-14 w-14">
          {/* Three pulsing halos staggered so they read as one wave —
              suppressed under reduced-motion so the halo does not
              loop forever. */}
          {!shouldReduceMotion &&
            [0, 0.4, 0.8].map((delay) => (
              <motion.span
                key={delay}
                className="absolute inset-0 rounded-full border border-accent-500/50"
                initial={{ scale: 0.6, opacity: 0.6 }}
                animate={{ scale: [0.6, 1.4, 1.4], opacity: [0.6, 0, 0] }}
                transition={{
                  duration: 2,
                  delay,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            ))}
          <motion.svg
            className="relative h-14 w-14 text-accent-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={shouldReduceMotion ? { y: 0 } : { y: [0, -2, 0] }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
            }
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </motion.svg>
        </div>
        <motion.p
          className="text-sm"
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.55, 1, 0.55] }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
          }
        >
          Rendering video...
        </motion.p>
      </div>
    </div>
  );
}
