import { motion } from 'framer-motion';
import { Player } from '@remotion/player';
import {
  VerticalVideo,
  getVerticalVideoDurationInFrames,
  VIDEO_FPS,
  VERTICAL_VIDEO_WIDTH,
  VERTICAL_VIDEO_HEIGHT,
  landscapeToVerticalProps,
} from '@launchkit/video';
import type { LaunchKitVideoProps } from '@launchkit/video';

interface VerticalPreviewCardProps {
  assetId: string;
  remotionProps: LaunchKitVideoProps;
  version: number;
}

/**
 * Standalone card for the vertical (9:16) Remotion composition.
 *
 * Derives `VerticalVideoProps` from the landscape `LaunchKitVideoProps`
 * via `landscapeToVerticalProps` and renders the composition inline
 * via `@remotion/player`. Sits alongside the landscape Remotion card
 * and the raw AI video card in the Videos gallery.
 */
export function VerticalPreviewCard({
  assetId,
  remotionProps,
  version,
}: VerticalPreviewCardProps) {
  const verticalProps = landscapeToVerticalProps(remotionProps);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="card overflow-hidden"
    >
      {/* 9:16 Player — constrained to max height so it doesn't dominate */}
      <div className="mx-auto aspect-[9/16] max-h-[480px] bg-[#020617] rounded-lg overflow-hidden mb-3">
        <Player
          component={VerticalVideo}
          inputProps={verticalProps}
          durationInFrames={getVerticalVideoDurationInFrames(verticalProps)}
          fps={VIDEO_FPS}
          compositionWidth={VERTICAL_VIDEO_WIDTH}
          compositionHeight={VERTICAL_VIDEO_HEIGHT}
          controls
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-900/80 border border-surface-800 flex items-center justify-center text-accent-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
              />
            </svg>
          </div>
          <div>
            <h4 className="font-mono font-semibold text-sm text-surface-100">
              Vertical Video
            </h4>
            <span className="text-xs text-surface-500">v{version}</span>
          </div>
        </div>

        <a
          href={`/api/assets/${assetId}/video.mp4?composition=vertical&download=1`}
          className="flex items-center gap-1.5 text-surface-400 hover:text-white transition-colors text-xs"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download MP4
        </a>
      </div>
    </motion.div>
  );
}
