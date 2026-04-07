import { useState } from 'react';
import { api } from '../lib/api.js';
import type { Asset } from '../lib/api.js';
import { StatusBadge } from './StatusBadge.js';

const ASSET_TYPE_LABELS: Record<string, string> = {
  blog_post: 'Blog Post',
  twitter_thread: 'Twitter Thread',
  linkedin_post: 'LinkedIn Post',
  product_hunt_description: 'Product Hunt',
  hacker_news_post: 'Hacker News',
  faq: 'FAQ',
  changelog_entry: 'Changelog',
  og_image: 'OG Image',
  social_card: 'Social Card',
  product_video: 'Product Video',
  voiceover_script: 'Voiceover',
  video_storyboard: 'Storyboard',
};

const ASSET_TYPE_ICONS: Record<string, string> = {
  blog_post: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  twitter_thread: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  og_image: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  product_video: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  faq: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

interface AssetCardProps {
  asset: Asset;
  onRefresh: () => void;
}

export function AssetCard({ asset, onRefresh }: AssetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const isMedia = ['og_image', 'social_card', 'product_video'].includes(asset.type);
  const isInProgress = ['queued', 'generating', 'regenerating'].includes(asset.status);
  const label = ASSET_TYPE_LABELS[asset.type] || asset.type;
  const iconPath = ASSET_TYPE_ICONS[asset.type] || ASSET_TYPE_ICONS.blog_post;

  const handleApprove = async () => {
    await api.approveAsset(asset.id);
    onRefresh();
  };

  const handleReject = async () => {
    await api.rejectAsset(asset.id);
    onRefresh();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await api.regenerateAsset(asset.id);
      onRefresh();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="card animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-800 flex items-center justify-center">
            <svg className="w-5 h-5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={iconPath} />
            </svg>
          </div>
          <div>
            <h4 className="font-mono font-semibold text-sm">{label}</h4>
            <span className="text-xs text-surface-500">v{asset.version}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {asset.qualityScore !== null && (
            <span
              className={`text-sm font-mono font-semibold ${
                asset.qualityScore >= 7
                  ? 'text-accent-400'
                  : asset.qualityScore >= 5
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              {asset.qualityScore.toFixed(1)}
            </span>
          )}
          <StatusBadge status={asset.status} />
        </div>
      </div>

      {/* Content Preview */}
      {isInProgress ? (
        <div className="py-8 flex flex-col items-center justify-center text-surface-500">
          <svg className="animate-spin h-8 w-8 mb-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm">Generating...</p>
        </div>
      ) : isMedia && asset.mediaUrl ? (
        <div className="mb-4">
          {asset.type === 'product_video' ? (
            <video
              src={asset.mediaUrl}
              controls
              className="w-full rounded-lg bg-surface-800"
              poster={(asset.metadata as any)?.thumbnailUrl}
            />
          ) : (
            <img
              src={asset.mediaUrl}
              alt={label}
              className="w-full rounded-lg bg-surface-800 object-cover"
              loading="lazy"
            />
          )}
        </div>
      ) : asset.content ? (
        <div className="mb-4">
          <div
            className={`text-sm text-surface-300 leading-relaxed ${
              expanded ? '' : 'line-clamp-6'
            }`}
          >
            <pre className="whitespace-pre-wrap font-sans">{asset.content}</pre>
          </div>
          {asset.content.length > 400 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="btn-ghost text-xs mt-2"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      ) : asset.status === 'failed' ? (
        <div className="py-6 text-center text-red-400 text-sm">
          Generation failed
        </div>
      ) : null}

      {/* Review Notes */}
      {asset.reviewNotes && (
        <div className="mb-4 p-3 bg-surface-800/50 rounded-lg border border-surface-700/50">
          <p className="text-xs font-mono text-surface-500 mb-1">Creative Director Notes</p>
          <p className="text-sm text-surface-300">{asset.reviewNotes}</p>
        </div>
      )}

      {/* Actions */}
      {!isInProgress && asset.content && (
        <div className="flex items-center gap-2 pt-3 border-t border-surface-800">
          {asset.userApproved === null ? (
            <>
              <button onClick={handleApprove} className="btn-ghost text-accent-400 text-sm">
                Approve
              </button>
              <button onClick={handleReject} className="btn-ghost text-red-400 text-sm">
                Reject
              </button>
            </>
          ) : (
            <span className={`text-xs ${asset.userApproved ? 'text-accent-400' : 'text-red-400'}`}>
              {asset.userApproved ? 'Approved' : 'Rejected'}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="btn-ghost text-surface-400 text-sm"
          >
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
      )}
    </div>
  );
}
