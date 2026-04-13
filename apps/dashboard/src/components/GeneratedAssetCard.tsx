import { useMemo, useState, useCallback, useRef } from 'react';
import { ArrowsClockwise, DownloadSimple, PencilSimpleLine } from '@phosphor-icons/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AssetLightbox } from './AssetLightbox.js';
import { api } from '../lib/api.js';
import type { Asset } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchVideoPreview } from './LaunchVideoPreview.js';
import { Tooltip, CopyButton, useToast, ModelSelector } from './ui/index.js';
import {
  WrittenAssetContent,
  parseStructuredAssetContent,
} from './asset-content/index.js';
import type { LaunchKitVideoProps } from '@launchkit/video';
import {
  getMarkdownFromStructured,
  ASSET_TYPE_LABELS,
  ASSET_TYPE_ICONS,
  ASSET_TYPE_PHOSPHOR,
  ASSET_TYPE_TINTS,
  DEFAULT_TINT,
  IMAGE_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
  IMAGE_ASSET_TYPES,
  VIDEO_ASSET_TYPES,
} from './asset-card/config.js';
import { QualityScoreRing } from './asset-card/QualityScoreRing.js';
import { AudioPlayer } from './asset-card/AudioPlayer.js';
import { InProgressBody, FailedAssetBody } from './asset-card/CardStates.js';
import { WorldScenePreview, WorldSceneDownloadMenu } from './asset-card/WorldScenePreview.js';

interface GeneratedAssetCardProps {
  asset: Asset;
  onRefresh: () => void;
  projectAssets?: Asset[];
}

export function GeneratedAssetCard({
  asset,
  onRefresh,
  projectAssets,
}: GeneratedAssetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [videoVariant, setVideoVariant] = useState<'visual' | 'narrated'>('visual');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [exportingNarrated, setExportingNarrated] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('auto');
  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();
  const openLightbox = useCallback(() => setLightboxOpen(true), []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  // Structured content dispatch — null for legacy pre-migration
  // assets and for non-written asset types. Drives both the
  // typed body renderer and the copy-as-markdown button.
  const structuredContent = useMemo(
    () => parseStructuredAssetContent(asset),
    [asset]
  );
  const markdownForCopy = useMemo(
    () =>
      structuredContent !== null
        ? getMarkdownFromStructured(structuredContent)
        : null,
    [structuredContent]
  );

  const isMedia = ['og_image', 'social_card', 'product_video', 'world_scene'].includes(asset.type);
  const isInProgress = ['queued', 'generating', 'regenerating'].includes(asset.status);
  const assetMetadata = asset.metadata ?? null;
  const remotionProps =
    asset.type === 'product_video'
      ? ((assetMetadata?.['remotionProps'] as LaunchKitVideoProps | undefined) ?? null)
      : null;
  // `thumbnailUrl` lives at the top of `metadata` for product_video,
  // og_image, etc. For `world_scene` the Marble-specific URLs are
  // nested under `metadata.worldLabs.{thumbnailUrl,panoUrl,splatUrl,...}`
  // because the world-scene agent emits a sub-object to keep the
  // Marble payload grouped. Fall back to the nested shape so the
  // card renders the actual thumbnail instead of the placeholder
  // text.
  const worldLabsMetadata =
    asset.type === 'world_scene' &&
    typeof assetMetadata?.['worldLabs'] === 'object' &&
    assetMetadata['worldLabs'] !== null
      ? (assetMetadata['worldLabs'] as Record<string, unknown>)
      : null;
  const worldLabsThumbnail = worldLabsMetadata?.['thumbnailUrl'];
  const thumbnailUrl =
    typeof assetMetadata?.['thumbnailUrl'] === 'string'
      ? assetMetadata['thumbnailUrl']
      : typeof worldLabsThumbnail === 'string'
        ? worldLabsThumbnail
        : undefined;
  // `panoUrl` is the public 360-degree equirectangular render URL
  // on Marble's CDN. Unlike the Marble viewer URL, the CDN bucket
  // is publicly readable regardless of the world's `permission`
  // flag, so we can surface the scene inline without bumping into
  // the viewer's "no permission to view this world" page for
  // worlds that were not generated with `permission: { public:
  // true, allow_id_access: true }`.
  const worldLabsPano = worldLabsMetadata?.['panoUrl'];
  const worldPanoUrl =
    typeof worldLabsPano === 'string' ? worldLabsPano : undefined;
  const hasPreview =
    Boolean(asset.content) ||
    Boolean(asset.mediaUrl) ||
    (asset.type === 'product_video' && Boolean(remotionProps));
  const voiceoverAsset = projectAssets?.find((candidate) => {
    if (candidate.type !== 'voiceover_script' || candidate.status === 'failed') {
      return false;
    }
    const segments = candidate.metadata?.['segments'];
    if (Array.isArray(segments)) {
      return segments.length > 0;
    }
    return Boolean(candidate.content?.includes('[SCREEN:'));
  });
  const hasNarratedVariant = asset.type === 'product_video' && Boolean(voiceoverAsset);
  const narratedPreviewUrl =
    asset.type === 'product_video'
      ? `/api/assets/${asset.id}/video.mp4?variant=narrated`
      : null;
  const label = ASSET_TYPE_LABELS[asset.type] ?? asset.type;
  const PhosphorIcon = ASSET_TYPE_PHOSPHOR[asset.type];
  const iconPath = PhosphorIcon ? null : (ASSET_TYPE_ICONS[asset.type] ?? ASSET_TYPE_ICONS['blog_post']);
  const tint = ASSET_TYPE_TINTS[asset.type] ?? DEFAULT_TINT;
  // Structured content is rendered via the per-type body components,
  // which produce richer layouts than the character count of
  // `asset.content` can predict — a short tips list with 5 items,
  // for example, can exceed the 360px clamp even though its plain-
  // text form is under the 400-char threshold. Force the clamp on
  // for any asset with structured content so the "Show more"
  // affordance is always available when the body renderer might
  // overflow its container.
  const contentNeedsClamp =
    structuredContent !== null || (asset.content?.length ?? 0) > 400;

  // `exactOptionalPropertyTypes` rejects explicit `undefined` on
  // optional properties, so error descriptions are spread in only
  // when we actually have a message.
  const errorDescription = (err: unknown): { description?: string } =>
    err instanceof Error ? { description: err.message } : {};

  const handleApprove = async () => {
    try {
      await api.approveAsset(asset.id);
      toast({ message: 'Asset approved', variant: 'success', description: label });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Approval failed',
        variant: 'error',
        ...errorDescription(err),
      });
    }
  };

  const handleReject = async () => {
    try {
      await api.rejectAsset(asset.id);
      toast({ message: 'Asset rejected', variant: 'info', description: label });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Rejection failed',
        variant: 'error',
        ...errorDescription(err),
      });
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      // Build model preferences from the selector — only include the
      // relevant key for this asset's media type so we don't override
      // preferences for unrelated types.
      const modelPreferences =
        selectedModel !== 'auto'
          ? IMAGE_ASSET_TYPES.has(asset.type)
            ? { imageModel: selectedModel as 'flux-pro-ultra' | 'nano-banana-pro' }
            : VIDEO_ASSET_TYPES.has(asset.type)
              ? { videoModel: selectedModel as 'kling-v3' | 'seedance-2' }
              : undefined
          : undefined;

      await api.regenerateAsset(asset.id, {
        ...(modelPreferences !== undefined ? { modelPreferences } : {}),
      });
      setVideoVariant('visual');
      setVideoError(null);
      toast({
        message: 'Regeneration queued',
        variant: 'info',
        description: `${label} will refresh shortly`,
      });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Regeneration failed',
        variant: 'error',
        ...errorDescription(err),
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleEditRegenerate = async () => {
    const instructions = editInputRef.current?.value.trim();
    if (!instructions) return;
    setRegenerating(true);
    setEditPromptOpen(false);
    try {
      await api.regenerateAsset(asset.id, { instructions });
      toast({
        message: 'Regeneration queued with custom instructions',
        variant: 'info',
        description: `${label} will refresh shortly`,
      });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Regeneration failed',
        variant: 'error',
        ...errorDescription(err),
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleExportNarrated = async () => {
    if (!narratedPreviewUrl) {
      return;
    }

    setExportingNarrated(true);
    setVideoError(null);

    try {
      const response = await fetch(`${narratedPreviewUrl}&download=1`);
      if (!response.ok) {
        const errorBody = (await response
          .json()
          .catch(() => ({ error: 'Narrated export failed' }))) as {
          error?: string;
        };
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition');
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ??
        `launchkit-${asset.id}-narrated.mp4`;

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast({ message: 'Narrated MP4 downloaded', variant: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Narrated export failed';
      setVideoError(message);
      toast({ message: 'Export failed', description: message, variant: 'error' });
    } finally {
      setExportingNarrated(false);
    }
  };

  const handleDownload = () => {
    const slug = label.toLowerCase().replace(/\s+/g, '-');

    // Written-only assets (no media file) — download as markdown
    const hasMedia = Boolean(asset.mediaUrl) || asset.type === 'product_video' || asset.type === 'world_scene';
    if (!hasMedia) {
      const text = markdownForCopy
        ?? (asset.userEdited && asset.userEditedContent ? asset.userEditedContent : asset.content);
      if (text) {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `launchkit-${slug}-v${asset.version}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }
      return;
    }

    // All media assets — same-origin download proxy that streams from
    // CDN with Content-Disposition: attachment (avoids cross-origin
    // download attribute being silently ignored by the browser).
    const a = document.createElement('a');
    a.href = `/api/assets/${asset.id}/download`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 240, damping: 24 }}
      whileHover={{ y: -2 }}
      // `data-asset-card` + `data-asset-type` are stable selector
      // hooks for Playwright E2E tests. The `card` Tailwind class
      // is reused across many surfaces (project cards, Pika card,
      // stats cards) so matching on it alone is too broad.
      data-asset-card
      data-asset-type={asset.type}
      data-asset-status={asset.status}
      className={`card group relative overflow-hidden bg-gradient-to-br ${tint.from} ${tint.to} hover:border-surface-700 transition-colors`}
    >
      {/* Lightbox (portalled to body) */}
      <AnimatePresence>
        {lightboxOpen && isMedia && (
          <AssetLightbox
            asset={asset}
            onClose={closeLightbox}
            actions={{
              onApprove: () => void handleApprove(),
              onReject: () => void handleReject(),
              onRegenerate: () => void handleRegenerate(),
              regenerating,
            }}
          />
        )}
      </AnimatePresence>

      {/* Header — full version for non-media cards only.
          Media cards are content-dominant: the header is replaced by
          a thin overlay label at the bottom of the media preview,
          and all metadata + actions live in the lightbox. */}
      {!isMedia && (<>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <motion.div
              className={`w-10 h-10 rounded-lg bg-surface-900/80 border border-surface-800 flex items-center justify-center ${tint.text}`}
              whileHover={{ rotate: -6, scale: 1.06 }}
              transition={{ type: 'spring', stiffness: 360, damping: 18 }}
            >
              {PhosphorIcon ? (
                <PhosphorIcon size={20} weight="bold" />
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d={iconPath ?? ''}
                  />
                </svg>
              )}
            </motion.div>
            <div>
              <h4 className="font-mono font-semibold text-sm text-surface-100">
                {label}
              </h4>
              <div className="flex items-center gap-2 text-xs text-surface-500">
                <span>v{asset.version}</span>
                {asset.costCents > 0 && (
                  <Tooltip label="Provider cost for this asset generation">
                    <span className="font-mono text-surface-400">
                      ${(asset.costCents / 100).toFixed(2)}
                    </span>
                  </Tooltip>
                )}
                {asset.userEdited && (
                  <Tooltip label="This asset was edited by a reviewer">
                    <span className="flex items-center gap-0.5 text-amber-400">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      edited
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isInProgress && asset.status !== 'failed' && (
              <>
                <Tooltip label="Regenerate">
                  <button
                    onClick={() => void handleRegenerate()}
                    disabled={regenerating}
                    className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-accent-400 disabled:opacity-50"
                  >
                    <ArrowsClockwise size={14} weight="bold" className={regenerating ? 'animate-spin' : ''} />
                  </button>
                </Tooltip>
                <Tooltip label="Edit & regenerate">
                  <button
                    onClick={() => setEditPromptOpen(!editPromptOpen)}
                    className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-accent-400"
                  >
                    <PencilSimpleLine size={14} weight="bold" />
                  </button>
                </Tooltip>
              </>
            )}
            {asset.qualityScore !== null && (
              <QualityScoreRing score={asset.qualityScore} />
            )}
            <LaunchStatusBadge status={asset.status} />
          </div>
        </div>

        {/* Edit prompt inline */}
        <AnimatePresence>
          {editPromptOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-4 overflow-hidden"
            >
              <div className="rounded-lg border border-surface-700 bg-surface-900/50 p-3">
                <textarea
                  ref={editInputRef}
                  placeholder="What should be different? e.g. 'Make it more conversational' or 'Focus on the API, not the UI'"
                  className="w-full resize-none rounded-md bg-transparent text-body-sm text-text-secondary placeholder:text-surface-600 focus:outline-none"
                  rows={2}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setEditPromptOpen(false)}
                    className="rounded-md px-3 py-1 text-body-xs text-surface-400 hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleEditRegenerate()}
                    disabled={regenerating}
                    className="rounded-md bg-accent-500/15 px-3 py-1 text-body-xs font-medium text-accent-400 hover:bg-accent-500/25 disabled:opacity-50"
                  >
                    {regenerating ? 'Regenerating...' : 'Regenerate'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>)}

      {/* Audio player for voice/podcast assets */}
      {(asset.type === 'podcast_script' || asset.type === 'voice_commercial') &&
        asset.mediaUrl &&
        !isInProgress &&
        asset.status !== 'failed' && (
          <AudioPlayer src={asset.mediaUrl} />
        )}

      {/* Content Preview */}
      {isInProgress ? (
        <InProgressBody tintText={tint.text} />
      ) : isMedia && asset.mediaUrl ? (
        <div
          className="mb-4 relative group/media cursor-pointer"
          onClick={openLightbox}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openLightbox(); }}
        >
          {/* Hover overlay — expand icon */}
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/0 group-hover/media:bg-black/30 transition-colors duration-200 pointer-events-none">
            <div className="opacity-0 group-hover/media:opacity-100 transition-opacity duration-200 bg-surface-900/80 rounded-full p-3 backdrop-blur-sm border border-surface-700">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </div>
          </div>
          {asset.type === 'product_video' ? (
            <LaunchVideoPreview
              videoUrl={videoVariant === 'narrated' ? narratedPreviewUrl : asset.mediaUrl}
              {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
              title={label}
              remotionProps={videoVariant === 'visual' ? remotionProps : null}
              {...(videoVariant === 'narrated'
                ? {
                    onError: () =>
                      setVideoError(
                        'Narrated preview is unavailable. Check the voiceover asset and ElevenLabs configuration.'
                      ),
                    onLoadedData: () => setVideoError(null),
                  }
                : {})}
            />
          ) : asset.type === 'world_scene' ? (
            <WorldScenePreview
              viewerUrl={asset.mediaUrl}
              thumbnailUrl={thumbnailUrl}
              {...(worldPanoUrl !== undefined ? { panoUrl: worldPanoUrl } : {})}
              title={label}
              description={asset.content}
            />
          ) : (
            <motion.img
              src={asset.mediaUrl}
              alt={label}
              className="w-full rounded-lg bg-surface-800 object-cover min-h-[200px]"
              loading="lazy"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}
          {/* Thin overlay label bar — replaces the full header for media cards */}
          <div className="absolute bottom-0 inset-x-0 z-[5] flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent rounded-b-lg pointer-events-none">
            <span className="font-mono text-xs font-semibold text-white/90 truncate">{label}</span>
            <div className="pointer-events-auto flex items-center gap-2">
              {asset.type === 'world_scene' ? (
                <WorldSceneDownloadMenu assetId={asset.id} worldLabsMetadata={worldLabsMetadata} />
              ) : (
                <Tooltip label="Download">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    className="rounded-md p-1 text-white/70 transition-colors hover:text-white hover:bg-white/10"
                  >
                    <DownloadSimple size={14} weight="bold" />
                  </button>
                </Tooltip>
              )}
              <LaunchStatusBadge status={asset.status} />
            </div>
          </div>
        </div>
      ) : asset.type === 'product_video' && remotionProps ? (
        <div className="mb-4">
          <LaunchVideoPreview
            videoUrl={videoVariant === 'narrated' ? narratedPreviewUrl : null}
            title={label}
            {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
            remotionProps={videoVariant === 'visual' ? remotionProps : null}
            {...(videoVariant === 'narrated'
              ? {
                  onError: () =>
                    setVideoError(
                      'Narrated preview is unavailable. Check the voiceover asset and ElevenLabs configuration.'
                    ),
                  onLoadedData: () => setVideoError(null),
                }
              : {})}
          />
        </div>
      ) : (asset.userEdited && asset.userEditedContent) || asset.content ? (
        <div className="mb-4 relative">
          {/* Copy affordances in the top-right corner of the
              content area. Shows a "Copy as markdown" button for
              structured assets alongside the plain-text copy, both
              visible on hover so they don't clutter the resting
              state. */}
          <div className="absolute right-0 top-0 z-10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
            {markdownForCopy !== null && (
              <CopyButton value={markdownForCopy} label="Copy markdown" />
            )}
            <CopyButton value={(asset.userEdited ? asset.userEditedContent : asset.content) ?? ''} />
          </div>
          <motion.div
            layout
            className={`relative text-sm text-surface-300 leading-relaxed ${
              expanded ? '' : 'max-h-[360px] overflow-hidden'
            }`}
          >
            <WrittenAssetContent asset={asset} />
          </motion.div>
          {/* Gradient fade when clamped so the cutoff reads as
              intentional, not arbitrary. */}
          {!expanded && contentNeedsClamp && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-900 to-transparent" />
          )}
          {contentNeedsClamp && (
            <motion.button
              type="button"
              onClick={() => setExpanded(!expanded)}
              whileTap={{ scale: 0.97 }}
              className="btn-ghost text-xs mt-2 flex items-center gap-1"
            >
              {expanded ? 'Show less' : 'Show more'}
              <motion.svg
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </motion.svg>
            </motion.button>
          )}
        </div>
      ) : asset.status === 'failed' ? (
        <FailedAssetBody onRegenerate={handleRegenerate} regenerating={regenerating} />
      ) : null}

      {asset.type === 'product_video' && videoError ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2.5"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 text-red-400/70 mt-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <p className="text-body-xs text-red-300/80 leading-relaxed">
            {videoError}
          </p>
        </motion.div>
      ) : null}

      {/* Review Notes */}
      {asset.reviewNotes && !isMedia && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-4 p-3 bg-surface-800/50 rounded-lg border border-surface-700/50"
        >
          <p className="text-xs font-mono text-surface-500 mb-1 flex items-center gap-1">
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            Creative Director Notes
          </p>
          <p className="text-sm text-surface-300">{asset.reviewNotes}</p>
        </motion.div>
      )}

      {/* Actions — for media cards these now live in the lightbox.
          Non-media cards (written, audio) keep the inline footer. */}
      {!isInProgress && hasPreview && !isMedia && (
        <div className="flex items-center gap-2 pt-3 border-t border-surface-800">
          <AnimatePresence mode="wait" initial={false}>
            {asset.userApproved === null ? (
              <motion.div
                key="review-buttons"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Tooltip label="Approve this asset">
                  <motion.button
                    type="button"
                    onClick={() => void handleApprove()}
                    whileTap={{ scale: 0.94 }}
                    className="btn-ghost text-accent-400 text-sm flex items-center gap-1.5"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Approve
                  </motion.button>
                </Tooltip>
                <Tooltip label="Reject this asset">
                  <motion.button
                    type="button"
                    onClick={() => void handleReject()}
                    whileTap={{ scale: 0.94 }}
                    className="btn-ghost text-red-400 text-sm flex items-center gap-1.5"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    Reject
                  </motion.button>
                </Tooltip>
              </motion.div>
            ) : (
              <motion.span
                key="review-result"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                className={`text-xs flex items-center gap-1.5 ${
                  asset.userApproved ? 'text-success-400' : 'text-red-400'
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={
                      asset.userApproved
                        ? 'M5 13l4 4L19 7'
                        : 'M6 18L18 6M6 6l12 12'
                    }
                  />
                </svg>
                {asset.userApproved ? 'Approved' : 'Rejected'}
              </motion.span>
            )}
          </AnimatePresence>
          <Tooltip label="Download">
            <motion.button
              type="button"
              onClick={handleDownload}
              whileTap={{ scale: 0.94 }}
              className="btn-ghost text-surface-400 text-sm flex items-center gap-1.5"
            >
              <DownloadSimple size={14} weight="bold" />
            </motion.button>
          </Tooltip>
          {hasNarratedVariant ? (
            <Tooltip label="Toggle between visual and narrated cut">
              <motion.button
                type="button"
                onClick={() => {
                  setVideoVariant(videoVariant === 'visual' ? 'narrated' : 'visual');
                  setVideoError(null);
                }}
                whileTap={{ scale: 0.94 }}
                className="btn-ghost text-surface-400 text-sm"
              >
                {videoVariant === 'visual' ? 'Narrated cut' : 'Visual cut'}
              </motion.button>
            </Tooltip>
          ) : null}
          {hasNarratedVariant ? (
            <Tooltip label="Download the narrated MP4">
              <motion.button
                type="button"
                onClick={() => void handleExportNarrated()}
                disabled={exportingNarrated}
                whileTap={{ scale: 0.94 }}
                className="btn-ghost text-surface-400 text-sm"
              >
                {exportingNarrated ? 'Exporting...' : 'Export narrated'}
              </motion.button>
            </Tooltip>
          ) : null}
          <div className="flex-1" />
          {IMAGE_ASSET_TYPES.has(asset.type) ? (
            <ModelSelector
              label="Image"
              value={selectedModel}
              options={IMAGE_MODEL_OPTIONS}
              onChange={setSelectedModel}
            />
          ) : VIDEO_ASSET_TYPES.has(asset.type) ? (
            <ModelSelector
              label="Video"
              value={selectedModel}
              options={VIDEO_MODEL_OPTIONS}
              onChange={setSelectedModel}
            />
          ) : null}
          <Tooltip label="Discard this version and regenerate">
            <motion.button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              whileTap={{ scale: 0.94 }}
              className="btn-ghost text-surface-400 text-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              <motion.svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                animate={
                  regenerating && !shouldReduceMotion
                    ? { rotate: 360 }
                    : { rotate: 0 }
                }
                transition={
                  regenerating && !shouldReduceMotion
                    ? { duration: 1, repeat: Infinity, ease: 'linear' }
                    : { duration: 0.3 }
                }
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </motion.svg>
              {regenerating ? 'Regenerating' : 'Regenerate'}
            </motion.button>
          </Tooltip>
        </div>
      )}
    </motion.div>
  );
}
