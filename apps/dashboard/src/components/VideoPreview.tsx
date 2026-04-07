interface VideoPreviewProps {
  videoUrl: string;
  thumbnailUrl?: string;
  title?: string;
}

export function VideoPreview({ videoUrl, thumbnailUrl, title }: VideoPreviewProps) {
  if (!videoUrl) {
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
      <video
        src={videoUrl}
        controls
        poster={thumbnailUrl}
        className="w-full aspect-video"
        preload="metadata"
      >
        Your browser does not support the video tag.
      </video>
      {title && (
        <div className="p-3 border-t border-surface-700">
          <p className="text-sm text-surface-300">{title}</p>
        </div>
      )}
    </div>
  );
}
