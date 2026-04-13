import { motion } from 'framer-motion';
import { Player } from '@remotion/player';
import {
  LaunchKitVideo,
  getLaunchKitVideoDurationInFrames,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '@launchkit/video';
import type { LaunchKitVideoProps } from '@launchkit/video';

interface RemotionPreviewCardProps {
  assetId: string;
  remotionProps: LaunchKitVideoProps;
  version: number;
}

/**
 * Standalone card for the Remotion-composed product video.
 *
 * Renders the full multi-shot composition (titles, transitions,
 * shots, outro) inline via `@remotion/player`. Sits alongside the
 * `GeneratedAssetCard` for the same asset in the Videos gallery —
 * one card for the raw AI clip, one for the finished composition.
 */
export function RemotionPreviewCard({
  assetId,
  remotionProps,
  version,
}: RemotionPreviewCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="card overflow-hidden"
    >
      {/* Remotion Player */}
      <div className="aspect-video bg-[#020617] rounded-lg overflow-hidden mb-3">
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

      {/* Footer — matches GeneratedAssetCard media footer pattern */}
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
                d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-8.625 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m17.25 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125M3.375 4.5h17.25m-17.25 0c-.621 0-1.125.504-1.125 1.125M20.625 4.5c.621 0 1.125.504 1.125 1.125m-21.75 0v1.5c0 .621.504 1.125 1.125 1.125M21.75 5.625v1.5c0 .621-.504 1.125-1.125 1.125M12 8.25v7.5m-3.75-3.75h7.5"
              />
            </svg>
          </div>
          <div>
            <h4 className="font-mono font-semibold text-sm text-surface-100">
              Remotion Video
            </h4>
            <span className="text-xs text-surface-500">v{version}</span>
          </div>
        </div>

        <a
          href={`/api/assets/${assetId}/video.mp4?download=1`}
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
