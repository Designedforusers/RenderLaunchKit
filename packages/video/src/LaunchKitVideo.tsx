import { makeTransform, scale as scaleTransform, translateY } from '@remotion/animation-utils';
import { fitText } from '@remotion/layout-utils';
import { springTiming, TransitionSeries } from '@remotion/transitions';
import type { TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {
  LaunchKitCaption,
  LaunchKitVideoProps,
  LaunchKitVideoShot,
} from './types.js';
import {
  OUTRO_DURATION_IN_FRAMES,
  TRANSITION_DURATION_IN_FRAMES,
  VIDEO_WIDTH,
} from './types.js';
import {
  getAccentBarState,
  getGlowRingState,
  getGrainOffset,
  getStaggeredWordStates,
  SPRING_BOUNCY,
  SPRING_SMOOTH,
  SPRING_SNAPPY,
} from './lib/motion.js';

type SceneProps = {
  shot: LaunchKitVideoShot;
  accentColor: string;
  backgroundColor: string;
  title: string;
  badge: string;
};

// Cycle through presentations for visual variety without randomness.
const TRANSITION_PRESETS: TransitionPresentation<Record<string, unknown>>[] = [
  slide({ direction: 'from-right' }),
  fade(),
  wipe({ direction: 'from-left' }),
  slide({ direction: 'from-bottom' }),
];

// ── Scene ──────────────────────────────────────────────────────────

function Scene({
  shot,
  accentColor,
  backgroundColor,
  title,
  badge,
}: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Badge bounces in — visible overshoot before settling.
  const badgeEntrance = spring({
    frame,
    fps,
    durationInFrames: 18,
    config: SPRING_BOUNCY,
  });
  const badgeScale = interpolate(badgeEntrance, [0, 1], [0, 1]);
  const badgeOpacity = interpolate(badgeEntrance, [0, 1], [0, 1]);

  // Smooth entrance for non-staggered elements (title label).
  const smoothEntrance = spring({
    frame,
    fps,
    durationInFrames: 18,
    config: SPRING_SMOOTH,
  });
  const titleSlide = interpolate(smoothEntrance, [0, 1], [40, 0]);
  const titleOpacity = interpolate(smoothEntrance, [0, 1], [0, 1]);

  // Overall opacity (fade in/out at scene boundaries).
  const opacity = interpolate(frame, [0, 8, shot.durationInFrames - 8], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // More dramatic Ken Burns zoom.
  const kenBurnsScale = interpolate(frame, [0, shot.durationInFrames], [1.10, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Staggered per-word headline reveal.
  const wordStates = getStaggeredWordStates(shot.headline, frame, fps);

  // Animated accent bar (draw-on + shimmer).
  const accentBar = getAccentBarState(frame, fps, 96);

  // Film grain offset.
  const grainOffset = getGrainOffset(frame);

  // Safe-area text sizing via fitText.
  const textContainerWidth = VIDEO_WIDTH * 0.72 - 48 * 2;
  const headlineFit = fitText({
    text: shot.headline,
    withinWidth: textContainerWidth,
    fontFamily: 'Inter',
    fontWeight: '800',
  });
  const headlineFontSize = Math.min(headlineFit.fontSize, 64);

  const captionFit = fitText({
    text: shot.caption,
    withinWidth: textContainerWidth,
    fontFamily: 'Inter',
    fontWeight: '400',
  });
  const captionFontSize = Math.min(captionFit.fontSize, 28);

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        color: 'white',
        opacity,
        overflow: 'hidden',
      }}
    >
      {/* Background image with Ken Burns */}
      <Img
        src={shot.imageUrl}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: makeTransform([scaleTransform(kenBurnsScale)]),
        }}
      />

      {/* Dark gradient overlay */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(135deg, rgba(2, 6, 23, 0.18) 0%, rgba(2, 6, 23, 0.72) 42%, rgba(2, 6, 23, 0.94) 100%)',
        }}
      />

      {/* Film grain — subtle rolling scan lines */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          opacity: 0.06,
          mixBlendMode: 'overlay',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
            transform: `translateY(${String(grainOffset)}px)`,
          }}
        />
      </AbsoluteFill>

      {/* Content */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '42px 48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Top row: badge + title */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(2, 6, 23, 0.42)',
              borderRadius: 999,
              padding: '10px 16px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 18,
              letterSpacing: 1,
              textTransform: 'uppercase',
              transform: makeTransform([scaleTransform(badgeScale)]),
              opacity: badgeOpacity,
            }}
          >
            {badge}
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 18,
              color: accentColor,
              textTransform: 'uppercase',
              letterSpacing: 1,
              transform: makeTransform([translateY(titleSlide)]),
              opacity: titleOpacity,
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom: accent bar + headline + caption */}
        <div
          style={{
            width: '72%',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* Animated accent bar with shimmer */}
          <div style={{ position: 'relative', width: 96, height: 6 }}>
            <div
              style={{
                width: interpolate(accentBar.drawProgress, [0, 1], [0, 96]),
                height: 6,
                borderRadius: 999,
                backgroundColor: accentColor,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: accentBar.shimmerX,
                  width: 40,
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
                  filter: 'blur(4px)',
                  opacity: accentBar.shimmerOpacity,
                }}
              />
            </div>
          </div>

          {/* Staggered headline */}
          <h1
            style={{
              margin: 0,
              fontSize: headlineFontSize,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: -1.8,
              fontFamily: 'Inter, sans-serif',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0 0.28em',
            }}
          >
            {wordStates.map((ws, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  transform: makeTransform([translateY(ws.translateY)]),
                  opacity: ws.opacity,
                }}
              >
                {ws.word}
              </span>
            ))}
          </h1>

          <p
            style={{
              margin: 0,
              fontSize: captionFontSize,
              lineHeight: 1.3,
              color: 'rgba(226, 232, 240, 0.92)',
              fontFamily: 'Inter, sans-serif',
              opacity: titleOpacity,
              transform: makeTransform([translateY(titleSlide)]),
            }}
          >
            {shot.caption}
          </p>
        </div>

        {shot.accent ? (
          <div
            style={{
              alignSelf: 'flex-end',
              maxWidth: '42%',
              fontSize: 24,
              lineHeight: 1.25,
              color: 'rgba(226, 232, 240, 0.88)',
              textAlign: 'right',
              fontFamily: 'Inter, sans-serif',
              opacity: titleOpacity,
              transform: makeTransform([translateY(titleSlide)]),
            }}
          >
            <span style={{ color: accentColor, fontWeight: 700 }}>{shot.accent}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

// ── Outro ──────────────────────────────────────────────────────────

function Outro({
  title,
  subtitle,
  outroCta,
  accentColor,
  backgroundColor,
}: Pick<
  LaunchKitVideoProps,
  'title' | 'subtitle' | 'outroCta' | 'accentColor' | 'backgroundColor'
>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Snappy reveal with slight overshoot.
  const reveal = spring({
    frame,
    fps,
    durationInFrames: 22,
    config: SPRING_SNAPPY,
  });
  const outroScale = interpolate(reveal, [0, 1], [0.94, 1]);
  const opacity = interpolate(reveal, [0, 1], [0, 1]);

  // Glow ring pulse.
  const glow = getGlowRingState(frame);

  // Staggered subtitle words.
  const wordStates = getStaggeredWordStates(subtitle, frame, fps);

  // Safe-area text sizing.
  const subtitleFit = fitText({
    text: subtitle,
    withinWidth: 720,
    fontFamily: 'Inter',
    fontWeight: '800',
  });
  const subtitleFontSize = Math.min(subtitleFit.fontSize, 68);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at top, ${accentColor}22 0%, ${backgroundColor} 55%)`,
        color: 'white',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Pulsing glow ring */}
      <div
        style={{
          position: 'absolute',
          width: 280,
          height: 280,
          borderRadius: '50%',
          border: `2px solid ${accentColor}`,
          transform: makeTransform([scaleTransform(glow.scale)]),
          boxShadow: `0 0 60px ${accentColor}${Math.round(glow.glowOpacity * 255).toString(16).padStart(2, '0')}, inset 0 0 60px ${accentColor}${Math.round(glow.glowOpacity * 128).toString(16).padStart(2, '0')}`,
          opacity: 0.6,
        }}
      />

      <div
        style={{
          width: 720,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          alignItems: 'center',
          textAlign: 'center',
          transform: makeTransform([scaleTransform(outroScale)]),
          opacity,
          position: 'relative',
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 22,
            textTransform: 'uppercase',
            letterSpacing: 1.4,
            color: accentColor,
          }}
        >
          {title}
        </div>

        {/* Staggered subtitle */}
        <h2
          style={{
            margin: 0,
            fontSize: subtitleFontSize,
            lineHeight: 0.96,
            fontWeight: 800,
            letterSpacing: -2,
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0 0.28em',
          }}
        >
          {wordStates.map((ws, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                transform: makeTransform([translateY(ws.translateY)]),
                opacity: ws.opacity,
              }}
            >
              {ws.word}
            </span>
          ))}
        </h2>

        <p
          style={{
            margin: 0,
            fontSize: 30,
            lineHeight: 1.3,
            color: 'rgba(226, 232, 240, 0.88)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {outroCta}
        </p>
      </div>
    </AbsoluteFill>
  );
}

// ── Caption overlay ────────────────────────────────────────────────

function CaptionOverlay({
  captions,
  accentColor,
}: {
  captions: LaunchKitCaption[];
  accentColor: string;
}) {
  const frame = useCurrentFrame();
  const activeCaption = captions.find(
    (caption) => frame >= caption.startInFrames && frame < caption.endInFrames
  );

  if (!activeCaption) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        right: 48,
        bottom: 42,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          background: 'rgba(2, 6, 23, 0.82)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 18,
          padding: '18px 22px',
          boxShadow: '0 18px 50px rgba(2, 6, 23, 0.42)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 4,
            borderRadius: 999,
            margin: '0 auto 12px auto',
            background: accentColor,
          }}
        />
        <p
          style={{
            margin: 0,
            fontSize: 24,
            lineHeight: 1.35,
            textAlign: 'center',
            color: 'white',
            fontWeight: 650,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {activeCaption.text}
        </p>
      </div>
    </div>
  );
}

// ── Main composition ───────────────────────────────────────────────

export function LaunchKitVideo(props: LaunchKitVideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      <TransitionSeries>
        {props.shots.map((shot, index) => {
          const elements: React.ReactNode[] = [];

          // Organic spring-timed transitions between shots.
          if (index > 0) {
            const preset = TRANSITION_PRESETS[index % TRANSITION_PRESETS.length] ?? fade();
            elements.push(
              <TransitionSeries.Transition
                key={`tr-${shot.id}`}
                presentation={preset}
                timing={springTiming({
                  config: SPRING_SMOOTH,
                  durationInFrames: TRANSITION_DURATION_IN_FRAMES,
                })}
              />
            );
          }

          elements.push(
            <TransitionSeries.Sequence key={shot.id} durationInFrames={shot.durationInFrames}>
              <Scene
                shot={shot}
                accentColor={props.accentColor}
                backgroundColor={props.backgroundColor}
                title={props.title}
                badge={props.badge}
              />
            </TransitionSeries.Sequence>
          );

          return elements;
        })}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({
            config: SPRING_SMOOTH,
            durationInFrames: TRANSITION_DURATION_IN_FRAMES,
          })}
        />
        <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION_IN_FRAMES}>
          <Outro
            title={props.title}
            subtitle={props.subtitle}
            outroCta={props.outroCta}
            accentColor={props.accentColor}
            backgroundColor={props.backgroundColor}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      {props.captions?.length ? (
        <CaptionOverlay
          captions={props.captions}
          accentColor={props.accentColor}
        />
      ) : null}
    </AbsoluteFill>
  );
}
