/**
 * Shared motion design primitives for LaunchKit Remotion compositions.
 *
 * Every animation is driven by `useCurrentFrame()` + `interpolate`/`spring`
 * — no CSS animations, no Tailwind classes. Components accept `frame`
 * and `fps` as props rather than calling hooks directly so they can be
 * composed inside parent components that already own the frame.
 */

import { evolvePath } from '@remotion/paths';
import { interpolate, spring } from 'remotion';

// ── Spring presets ────────────────────────────────────────────────

export const SPRING_SMOOTH = { damping: 200 } as const;
export const SPRING_SNAPPY = { damping: 20, stiffness: 200 } as const;
export const SPRING_BOUNCY = { damping: 12 } as const;

// ── Staggered word animation helpers ─────────────────────────────

/** Per-word animation state for staggered headline reveals. */
export interface WordAnimationState {
  word: string;
  translateY: number;
  opacity: number;
}

/**
 * Compute per-word spring entrance state. Each word begins its
 * spring 3 frames after the previous, creating a cascading reveal.
 *
 * Usage: call once per render frame, map the result to styled spans.
 */
export function getStaggeredWordStates(
  text: string,
  frame: number,
  fps: number
): WordAnimationState[] {
  const words = text.split(' ').filter(Boolean);
  return words.map((word, i) => {
    const wordProgress = spring({
      frame,
      fps,
      delay: i * 3,
      durationInFrames: 12,
      config: SPRING_SNAPPY,
    });
    return {
      word,
      translateY: interpolate(wordProgress, [0, 1], [30, 0]),
      opacity: interpolate(wordProgress, [0, 1], [0, 1]),
    };
  });
}

// ── Accent bar draw-on ───────────────────────────────────────────

/** SVG path draw-on progress for the accent bar. */
export interface AccentBarState {
  /** 0-1 progress for `evolvePath`. */
  drawProgress: number;
  /** Shimmer highlight x-offset in pixels. */
  shimmerX: number;
  /** Shimmer opacity (fades in after the bar draws). */
  shimmerOpacity: number;
}

/**
 * Compute the accent bar draw-on animation state.
 *
 * The bar "draws" over 16 frames via spring, then a white shimmer
 * highlight sweeps left-to-right from frame 10 to frame 26.
 */
export function getAccentBarState(
  frame: number,
  fps: number,
  barWidth: number
): AccentBarState {
  const drawProgress = spring({
    frame,
    fps,
    durationInFrames: 16,
    config: SPRING_SMOOTH,
  });

  const shimmerX = interpolate(frame, [10, 26], [-20, barWidth + 20], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const shimmerOpacity = interpolate(frame, [10, 14, 24, 26], [0, 0.6, 0.6, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return { drawProgress, shimmerX, shimmerOpacity };
}

/**
 * Build the `strokeDasharray` and `strokeDashoffset` for an
 * SVG rounded-rect accent bar that draws on from left to right.
 */
export function getAccentBarPathAnimation(
  progress: number,
  barWidth: number,
  barHeight: number
): { strokeDasharray: string; strokeDashoffset: number } {
  const r = barHeight / 2;
  const d = `M ${r},0 L ${barWidth - r},0 A ${r},${r} 0 0 1 ${barWidth - r},${barHeight} L ${r},${barHeight} A ${r},${r} 0 0 1 ${r},0 Z`;
  return evolvePath(progress, d);
}

// ── Film grain overlay state ─────────────────────────────────────

/**
 * Compute the vertical offset for the rolling scan-line effect.
 * Shifts 1px per frame, wrapping at 4px.
 */
export function getGrainOffset(frame: number): number {
  return (frame % 4) * 1;
}

// ── Glow ring (outro) ────────────────────────────────────────────

export interface GlowRingState {
  scale: number;
  glowOpacity: number;
}

/**
 * Continuous sine-wave pulse for the outro glow ring.
 * One full cycle = 24 frames = 1 second at 24fps.
 */
export function getGlowRingState(frame: number): GlowRingState {
  const pulse = Math.sin((frame / 24) * Math.PI * 2) * 0.5 + 0.5;
  return {
    scale: interpolate(pulse, [0, 1], [0.92, 1.08]),
    glowOpacity: interpolate(pulse, [0, 1], [0.3, 0.7]),
  };
}
