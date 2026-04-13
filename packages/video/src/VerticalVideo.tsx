import { makeTransform, scale as scaleTransform, translateY } from '@remotion/animation-utils';
import { fitText } from '@remotion/layout-utils';
import { springTiming, TransitionSeries } from '@remotion/transitions';
import type { TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
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
  LaunchKitVideoShot,
  VerticalVideoProps,
} from './types.js';
import {
  OUTRO_DURATION_IN_FRAMES,
  TRANSITION_DURATION_IN_FRAMES,
  VERTICAL_VIDEO_WIDTH,
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

// Vertical transitions swipe bottom-to-top to match the scroll
// direction users expect on TikTok / Reels / Shorts.
const VERTICAL_TRANSITIONS: TransitionPresentation<Record<string, unknown>>[] = [
  slide({ direction: 'from-bottom' }),
  fade(),
];

// ── Scene ──────────────────────────────────────────────────────────

function VerticalScene({
  shot,
  accentColor,
  backgroundColor,
  productName,
}: {
  shot: LaunchKitVideoShot;
  accentColor: string;
  backgroundColor: string;
  productName: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Badge bounces in with visible overshoot.
  const badgeEntrance = spring({
    frame,
    fps,
    durationInFrames: 20,
    config: SPRING_BOUNCY,
  });
  const badgeScale = interpolate(badgeEntrance, [0, 1], [0, 1]);
  const badgeOpacity = interpolate(badgeEntrance, [0, 1], [0, 1]);

  const opacity = interpolate(frame, [0, 10, shot.durationInFrames - 6], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Stronger Ken Burns on vertical — larger image area to fill.
  const kenBurnsScale = interpolate(frame, [0, shot.durationInFrames], [1.12, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Staggered per-word headline reveal.
  const wordStates = getStaggeredWordStates(shot.headline, frame, fps);

  // Smooth entrance for non-staggered elements.
  const smoothEntrance = spring({
    frame,
    fps,
    durationInFrames: 20,
    config: SPRING_SMOOTH,
  });
  const textSlide = interpolate(smoothEntrance, [0, 1], [60, 0]);
  const textOpacity = interpolate(smoothEntrance, [0, 1], [0, 1]);

  // Animated accent bar (draws downward for vertical).
  const accentBar = getAccentBarState(frame, fps, 64);

  // Film grain offset.
  const grainOffset = getGrainOffset(frame);

  // Safe-area text sizing.
  const textContainerWidth = VERTICAL_VIDEO_WIDTH - 48 * 2;
  const headlineFit = fitText({
    text: shot.headline,
    withinWidth: textContainerWidth,
    fontFamily: 'Inter',
    fontWeight: '800',
  });
  const headlineFontSize = Math.min(headlineFit.fontSize, 72);

  const captionFit = fitText({
    text: shot.caption,
    withinWidth: textContainerWidth,
    fontFamily: 'Inter',
    fontWeight: '400',
  });
  const captionFontSize = Math.min(captionFit.fontSize, 36);

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        color: 'white',
        opacity,
        overflow: 'hidden',
      }}
    >
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

      {/* Heavier gradient for vertical — text needs more contrast */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(2, 6, 23, 0.08) 0%, rgba(2, 6, 23, 0.42) 50%, rgba(2, 6, 23, 0.96) 100%)',
        }}
      />

      {/* Film grain */}
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

      {/* Product pill — top center with bounce */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(2, 6, 23, 0.52)',
            borderRadius: 999,
            padding: '12px 24px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 20,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: accentColor,
            transform: makeTransform([scaleTransform(badgeScale)]),
            opacity: badgeOpacity,
          }}
        >
          {productName}
        </div>
      </div>

      {/* Text block — bottom third (vertical safe zone) */}
      <div
        style={{
          position: 'absolute',
          left: 48,
          right: 48,
          bottom: 120,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Animated vertical accent bar (draws downward) */}
        <div style={{ position: 'relative', width: 6, height: 64 }}>
          <div
            style={{
              width: 6,
              height: interpolate(accentBar.drawProgress, [0, 1], [0, 64]),
              borderRadius: 999,
              backgroundColor: accentColor,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: accentBar.shimmerX * (64 / 96),
                width: '100%',
                height: 30,
                background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.6), transparent)',
                filter: 'blur(3px)',
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
            lineHeight: 0.95,
            fontWeight: 800,
            letterSpacing: -2,
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
            opacity: textOpacity,
            transform: makeTransform([translateY(textSlide)]),
          }}
        >
          {shot.caption}
        </p>

        {shot.accent ? (
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.25,
              fontFamily: 'Inter, sans-serif',
              opacity: textOpacity,
              transform: makeTransform([translateY(textSlide)]),
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

function VerticalOutro({
  productName,
  tagline,
  outroCta,
  accentColor,
  backgroundColor,
}: Pick<
  VerticalVideoProps,
  'productName' | 'tagline' | 'outroCta' | 'accentColor' | 'backgroundColor'
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

  // Staggered tagline words.
  const wordStates = getStaggeredWordStates(tagline, frame, fps);

  // Safe-area text sizing.
  const containerWidth = VERTICAL_VIDEO_WIDTH * 0.85;
  const taglineFit = fitText({
    text: tagline,
    withinWidth: containerWidth,
    fontFamily: 'Inter',
    fontWeight: '800',
  });
  const taglineFontSize = Math.min(taglineFit.fontSize, 110);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at center, ${accentColor}22 0%, ${backgroundColor} 55%)`,
        color: 'white',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Pulsing glow ring */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          border: `2px solid ${accentColor}`,
          transform: makeTransform([scaleTransform(glow.scale)]),
          boxShadow: `0 0 80px ${accentColor}${Math.round(glow.glowOpacity * 255).toString(16).padStart(2, '0')}, inset 0 0 80px ${accentColor}${Math.round(glow.glowOpacity * 128).toString(16).padStart(2, '0')}`,
          opacity: 0.6,
        }}
      />

      <div
        style={{
          width: '85%',
          display: 'flex',
          flexDirection: 'column',
          gap: 40,
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
            fontSize: 36,
            textTransform: 'uppercase',
            letterSpacing: 1.4,
            color: accentColor,
          }}
        >
          {productName}
        </div>

        {/* Staggered tagline */}
        <h2
          style={{
            margin: 0,
            fontSize: taglineFontSize,
            lineHeight: 0.92,
            fontWeight: 800,
            letterSpacing: -2.5,
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
            fontSize: 48,
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

function VerticalCaptionOverlay({
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
        left: 36,
        right: 36,
        bottom: 64,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: '90%',
          background: 'rgba(2, 6, 23, 0.85)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 22,
          padding: '22px 28px',
          boxShadow: '0 18px 50px rgba(2, 6, 23, 0.42)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 4,
            borderRadius: 999,
            margin: '0 auto 14px auto',
            background: accentColor,
          }}
        />
        <p
          style={{
            margin: 0,
            fontSize: 32,
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

export function VerticalVideo(props: VerticalVideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      <TransitionSeries>
        {props.shots.map((shot, index) => {
          const elements: React.ReactNode[] = [];

          if (index > 0) {
            const preset = VERTICAL_TRANSITIONS[index % VERTICAL_TRANSITIONS.length] ?? fade();
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
              <VerticalScene
                shot={shot}
                accentColor={props.accentColor}
                backgroundColor={props.backgroundColor}
                productName={props.productName}
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
          <VerticalOutro
            productName={props.productName}
            tagline={props.tagline}
            outroCta={props.outroCta}
            accentColor={props.accentColor}
            backgroundColor={props.backgroundColor}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      {props.captions?.length ? (
        <VerticalCaptionOverlay
          captions={props.captions}
          accentColor={props.accentColor}
        />
      ) : null}
    </AbsoluteFill>
  );
}
