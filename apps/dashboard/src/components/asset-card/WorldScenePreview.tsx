import { useState, useRef, useEffect } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '../ui/index.js';

// World scene download dropdown -- offers Marble's three export
// formats (panorama, Gaussian splat, collider mesh) so the user
// can pick the one they need instead of a single opaque download.
export function WorldSceneDownloadMenu({
  assetId,
  worldLabsMetadata,
}: {
  assetId: string;
  worldLabsMetadata: Record<string, unknown> | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasPano =
    typeof worldLabsMetadata?.['panoUrl'] === 'string' ||
    typeof worldLabsMetadata?.['thumbnailUrl'] === 'string';
  const hasSplat = typeof worldLabsMetadata?.['splatUrl'] === 'string';
  const hasMesh = typeof worldLabsMetadata?.['colliderMeshUrl'] === 'string';

  const options: { format: string; label: string; badge: string }[] = [];
  if (hasPano) options.push({ format: 'pano', label: '360\u00b0 Panorama', badge: 'PNG' });
  if (hasSplat) options.push({ format: 'splat', label: 'Gaussian Splat', badge: 'SPZ' });
  if (hasMesh) options.push({ format: 'mesh', label: 'Collider Mesh', badge: 'GLB' });

  if (options.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <Tooltip label="Download">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="rounded-md p-1 text-white/70 transition-colors hover:text-white hover:bg-white/10"
        >
          <DownloadSimple size={14} weight="bold" />
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-1.5 min-w-[180px] rounded-lg border border-surface-700 bg-surface-900 shadow-xl overflow-hidden z-50"
          >
            {options.map((opt) => (
              <a
                key={opt.format}
                href={`/api/assets/${assetId}/download?format=${opt.format}`}
                onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
              >
                <span>{opt.label}</span>
                <span className="font-mono text-[10px] text-surface-500">{opt.badge}</span>
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// World Labs (Marble) 3D walk-through preview.
// Two-stage: thumbnail poster, then iframe/pano on "Launch walk-through".
// Prefers `panoUrl` (public CDN, works regardless of Marble permission)
// over the Marble viewer iframe (needs public world). Sandbox on the
// iframe: allow-scripts + allow-same-origin for WebGL, nothing else.
export function WorldScenePreview({
  viewerUrl,
  thumbnailUrl,
  panoUrl,
  title,
  description,
}: {
  viewerUrl: string;
  thumbnailUrl: string | undefined;
  panoUrl?: string;
  title: string;
  description: string | null;
}) {
  const [launched, setLaunched] = useState(false);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg bg-surface-800 aspect-video">
        {launched && panoUrl !== undefined ? (
          <motion.img
            key={panoUrl}
            src={panoUrl}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          />
        ) : launched ? (
          <iframe
            key={viewerUrl}
            src={viewerUrl}
            title={title}
            className="absolute inset-0 h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            allow="xr-spatial-tracking"
          />
        ) : thumbnailUrl !== undefined ? (
          <>
            <motion.img
              src={thumbnailUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-900/90 via-surface-900/20 to-transparent" />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-lime-300/60 text-xs font-mono">
              3D scene ready · tap to walk through
            </div>
          </div>
        )}

        {!launched && (
          <div className="absolute inset-0 flex items-end justify-center p-4">
            <motion.button
              type="button"
              onClick={() => setLaunched(true)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-full bg-lime-500/90 px-4 py-2 text-sm font-medium text-surface-950 shadow-lg shadow-lime-500/30 backdrop-blur"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Launch walk-through
            </motion.button>
          </div>
        )}

        <a
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-surface-950/70 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-lime-300 backdrop-blur hover:bg-surface-950/90 transition-colors"
          title="Open in a new tab"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Marble
        </a>
      </div>

      {description !== null && description.length > 0 && (
        <p className="mt-3 text-xs text-surface-400 leading-relaxed">
          <span className="font-mono uppercase tracking-wide text-lime-400/70">
            Scene prompt —{' '}
          </span>
          {description}
        </p>
      )}
    </div>
  );
}
