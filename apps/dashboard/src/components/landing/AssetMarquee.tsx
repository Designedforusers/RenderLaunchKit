import { Plus } from '@phosphor-icons/react';

// ─────────────────────────────────────────────────────────────────────
// Section: Asset marquee — infinite scroll of asset-type chips.
// The "what comes out" answer, before you scroll to the proof.
// ─────────────────────────────────────────────────────────────────────

export function AssetMarquee() {
  const marqueeItems = [
    'Launch blog post',
    'Twitter/X thread',
    'Cold email sequence',
    'Hero image',
    'Open Graph cards',
    '30s vertical reel',
    'Voiceover narration',
    'Landing page copy',
    'Product Hunt launch',
    'Changelog post',
    '3D walkthrough',
    'Podcast intro',
    'HN Show HN post',
    'LinkedIn carousel',
    'Press release',
    'Feature announcement',
  ];

  // Two copies back-to-back so the CSS animation scrolls seamlessly.
  return (
    <section className="relative z-10 border-y border-surface-800/70 bg-surface-950/60 py-8 backdrop-blur-sm">
      <div
        className="relative flex overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        }}
      >
        <div className="flex shrink-0 animate-[marquee_48s_linear_infinite] gap-6 pr-6">
          {marqueeItems.map((item, i) => (
            <MarqueeChip key={`a-${i}`} label={item} />
          ))}
        </div>
        <div className="flex shrink-0 animate-[marquee_48s_linear_infinite] gap-6 pr-6" aria-hidden="true">
          {marqueeItems.map((item, i) => (
            <MarqueeChip key={`b-${i}`} label={item} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[marquee_48s_linear_infinite\\] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}

function MarqueeChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-surface-800 bg-surface-900/60 px-4 py-2">
      <Plus size={12} weight="bold" className="text-accent-500" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
    </div>
  );
}
