import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Waveform } from '@phosphor-icons/react';

import type { AssetCard } from './data.js';
import {
  CARD_WRITTEN,
  CARD_IMAGE,
  CARD_VIDEO,
  CARD_AUDIO,
  CARD_SCENE,
} from './data.js';

// ─────────────────────────────────────────────────────────────────────
// Section: Bento assets — the 5 asset types with per-kind mini previews.
// ─────────────────────────────────────────────────────────────────────

export function BentoAssets() {
  return (
    <section id="assets" className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <div className="flex items-center justify-center gap-2 text-label text-text-muted">
          <span className="h-px w-6 bg-accent-500" />
          WHAT COMES OUT
          <span className="h-px w-6 bg-accent-500" />
        </div>
        <h2 className="mt-4 font-display text-display-lg leading-[1.02] tracking-[-0.02em] text-text-primary">
          Every format you need for launch day.
        </h2>
        <p className="mt-4 text-body-lg text-text-secondary">
          Five generators, one kit. Each asset is reviewed by a creative-director
          agent before it lands on your dashboard — and you can regenerate any
          single one without re-running the whole pipeline.
        </p>
      </div>

      <div className="mt-16 grid gap-4 md:grid-cols-6 md:grid-rows-2">
        <BentoCard card={CARD_WRITTEN} className="md:col-span-3 md:row-span-1">
          <WrittenPreview />
        </BentoCard>
        <BentoCard card={CARD_IMAGE} className="md:col-span-3 md:row-span-1">
          <ImagePreview />
        </BentoCard>
        <BentoCard card={CARD_VIDEO} className="md:col-span-2 md:row-span-1">
          <VideoPreview />
        </BentoCard>
        <BentoCard card={CARD_AUDIO} className="md:col-span-2 md:row-span-1">
          <AudioPreview />
        </BentoCard>
        <BentoCard card={CARD_SCENE} className="md:col-span-2 md:row-span-1">
          <ScenePreview />
        </BentoCard>
      </div>
    </section>
  );
}

function BentoCard({
  card,
  children,
  className = '',
}: {
  card: AssetCard;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = card.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4 }}
      className={`group relative overflow-hidden rounded-2xl border border-surface-800 bg-gradient-to-b from-surface-900/90 to-surface-950/80 p-6 backdrop-blur-sm transition-all hover:border-surface-700 hover:shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] ${className}`}
    >
      {/* hover-only accent border */}
      <span
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          boxShadow:
            '0 0 0 1px rgba(255,94,74,0.25), 0 30px 70px -20px rgba(255,94,74,0.25)',
        }}
      />
      <div className="relative flex h-full flex-col">
        {/* Preview area (top) */}
        <div className="mb-5 min-h-[132px] flex-1">{children}</div>

        {/* Meta (bottom) */}
        <div className="space-y-2 border-t border-surface-800/80 pt-5">
          <div className="flex items-center gap-2">
            <Icon size={14} weight="fill" className="text-accent-500" />
            <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-accent-400">
              {card.eyebrow}
            </span>
          </div>
          <h3 className="text-heading-md text-text-primary">{card.title}</h3>
          <p className="text-body-sm text-text-secondary">{card.copy}</p>
        </div>

        <ArrowUpRight
          size={16}
          weight="bold"
          className="absolute right-0 top-0 text-text-muted transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-400"
        />
      </div>
    </motion.div>
  );
}

function WrittenPreview() {
  return (
    <div className="relative h-full rounded-lg border border-surface-800 bg-surface-950/70 p-4 font-mono text-[11px] leading-relaxed text-text-secondary">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="ml-2 text-[9px] uppercase tracking-[0.14em] text-text-muted">
          launch-post.md
        </span>
      </div>
      <p className="text-text-primary"># Orbit CLI 1.0 — ship to anywhere in one command</p>
      <p className="mt-2 text-text-tertiary">
        We built Orbit because every modern project ends up with the same
        ritual: seven configs, three CI files, two secrets&nbsp;files…
      </p>
      <p className="mt-2 text-text-muted">
        <span className="text-success-400">[cited]</span> README.md:14 ·
        package.json:22
      </p>
      <div className="absolute inset-x-4 bottom-3 h-6 bg-gradient-to-t from-surface-950 to-transparent" />
    </div>
  );
}

function ImagePreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      {/* Abstract gradient "generated hero" */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(255,94,74,0.55), transparent 50%), radial-gradient(circle at 70% 70%, rgba(255,183,77,0.45), transparent 55%), linear-gradient(135deg, #120818, #1a1028)',
        }}
      />
      {/* faux frame grid */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* corner label */}
      <div className="absolute left-3 top-3 rounded border border-white/10 bg-surface-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/70 backdrop-blur-sm">
        1200 × 630 · og.png
      </div>
      {/* variation chips */}
      <div className="absolute bottom-3 left-3 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-5 rounded-full ${
              i === 0 ? 'bg-accent-400' : 'bg-white/20'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function VideoPreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(255,94,74,0.35), transparent 60%), linear-gradient(180deg, #10081a, #08040f)',
        }}
      />
      {/* play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
          <span
            className="ml-0.5 block h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-surface-950"
            aria-hidden="true"
          />
          <span className="absolute -inset-2 rounded-full border border-white/30" />
        </div>
      </div>
      {/* scrubber */}
      <div className="absolute inset-x-3 bottom-3">
        <div className="relative h-1 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 w-[38%] bg-accent-400" />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] text-text-muted">
          <span>00:11</span>
          <span>00:30 · vertical 9:16</span>
        </div>
      </div>
    </div>
  );
}

function AudioPreview() {
  // SVG waveform — static, deterministic. Taller in the middle, tapering out.
  const bars = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const t = (i - 24) / 24;
      const h = Math.round((1 - t * t) * 34 + 4 + (i % 3) * 3);
      return { i, h };
    });
  }, []);

  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          <Waveform size={12} weight="bold" className="text-accent-400" />
          voiceover · eleven
        </div>
        <span className="font-mono text-[10px] text-text-tertiary">00:42</span>
      </div>

      <div className="mt-4 flex h-16 items-center gap-[3px]">
        {bars.map(({ i, h }) => (
          <span
            key={i}
            className={`block w-[3px] rounded-sm ${
              i < 18 ? 'bg-accent-400' : 'bg-text-muted/40'
            }`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[9px] text-text-muted">
        <span>cache hit · $0.00</span>
        <span>44.1khz · mp3</span>
      </div>
    </div>
  );
}

function ScenePreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 80%, rgba(255,94,74,0.35), transparent 60%), linear-gradient(180deg, #0e0818, #08040f)',
        }}
      />
      {/* wireframe isometric cube */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 160"
        aria-hidden="true"
      >
        <g
          fill="none"
          stroke="rgba(139,123,168,0.55)"
          strokeWidth={0.8}
          strokeLinecap="round"
        >
          {/* floor grid */}
          {[...Array<number>(8)].map((_, i) => (
            <line
              key={`fl-${i}`}
              x1={30 + i * 20}
              y1={100}
              x2={30 + i * 20 - 30}
              y2={150}
              stroke="rgba(139,123,168,0.2)"
            />
          ))}
          {[...Array<number>(5)].map((_, i) => (
            <line
              key={`fk-${i}`}
              x1={10}
              y1={100 + i * 12}
              x2={180}
              y2={100 + i * 12}
              stroke="rgba(139,123,168,0.2)"
            />
          ))}
          {/* cube — isometric */}
          <polygon points="100,40 140,60 140,100 100,80" fill="rgba(255,94,74,0.18)" />
          <polygon points="100,40 60,60 60,100 100,80" fill="rgba(255,94,74,0.1)" />
          <polygon points="60,60 100,40 140,60 100,80" fill="rgba(255,94,74,0.28)" />
          <polyline points="100,80 100,120 60,100" />
          <polyline points="100,120 140,100" />
        </g>
      </svg>
      <div className="absolute left-3 top-3 rounded border border-white/10 bg-surface-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/70 backdrop-blur-sm">
        scene.glb · world labs
      </div>
      <div className="absolute bottom-3 right-3 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
        drag to orbit
      </div>
    </div>
  );
}
