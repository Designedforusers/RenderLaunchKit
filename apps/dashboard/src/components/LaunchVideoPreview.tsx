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
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-lg flex items-center justify-center">
        <div className="text-center text-surface-500">
          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-sm">Video generating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden bg-surface-800">
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
    </div>
  );
}
