import { makeTransform, scale as scaleTransform, translateY } from '@remotion/animation-utils';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
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
import { OUTRO_DURATION_IN_FRAMES, TRANSITION_DURATION_IN_FRAMES } from './types.js';

// Vertical transitions swipe bottom-to-top to match the scroll
// direction users expect on TikTok / Reels / Shorts.
const VERTICAL_TRANSITIONS: TransitionPresentation<Record<string, unknown>>[] = [
  slide({ direction: 'from-bottom' }),
  fade(),
];

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

  const entrance = spring({
    frame,
    fps,
    durationInFrames: 20,
    config: { damping: 180 },
  });

  const opacity = interpolate(frame, [0, 10, shot.durationInFrames - 6], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Stronger Ken Burns on vertical — larger image area to fill.
  const kenBurnsScale = interpolate(frame, [0, shot.durationInFrames], [1.12, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const textSlide = interpolate(entrance, [0, 1], [60, 0]);

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
      {/* Heavier gradient for vertical — text needs more contrast against taller images */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(2, 6, 23, 0.08) 0%, rgba(2, 6, 23, 0.42) 50%, rgba(2, 6, 23, 0.96) 100%)',
        }}
      />

      {/* Product pill — top center */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          transform: makeTransform([translateY(textSlide)]),
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
          transform: makeTransform([translateY(textSlide)]),
        }}
      >
        {/* Vertical accent bar */}
        <div
          style={{
            width: 6,
            height: 64,
            borderRadius: 999,
            backgroundColor: accentColor,
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 72,
            lineHeight: 0.95,
            fontWeight: 800,
            letterSpacing: -2,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {shot.headline}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 36,
            lineHeight: 1.3,
            color: 'rgba(226, 232, 240, 0.92)',
            fontFamily: 'Inter, sans-serif',
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
            }}
          >
            <span style={{ color: accentColor, fontWeight: 700 }}>{shot.accent}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

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
  const reveal = spring({
    frame,
    fps,
    durationInFrames: 22,
    config: { damping: 200 },
  });
  const outroScale = interpolate(reveal, [0, 1], [0.94, 1]);
  const opacity = interpolate(reveal, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at center, ${accentColor}22 0%, ${backgroundColor} 55%)`,
        color: 'white',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '85%',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          alignItems: 'center',
          textAlign: 'center',
          transform: makeTransform([scaleTransform(outroScale)]),
          opacity,
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 24,
            textTransform: 'uppercase',
            letterSpacing: 1.4,
            color: accentColor,
          }}
        >
          {productName}
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 80,
            lineHeight: 0.92,
            fontWeight: 800,
            letterSpacing: -2.5,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {tagline}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 36,
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
                timing={linearTiming({ durationInFrames: TRANSITION_DURATION_IN_FRAMES })}
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
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION_IN_FRAMES })}
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
