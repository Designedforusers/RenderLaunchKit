import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type { LaunchKitCaption, VoiceCommercialProps } from './types.js';

const OUTRO_CARD_DURATION_IN_FRAMES = 24;

function ActiveCaption({
  captions,
  fallback,
}: {
  captions: LaunchKitCaption[];
  fallback: string;
}) {
  const frame = useCurrentFrame();
  const activeCaption = captions.find(
    (caption) => frame >= caption.startInFrames && frame < caption.endInFrames
  );
  return <>{activeCaption ? activeCaption.text : fallback}</>;
}

export function VoiceCommercial(props: VoiceCommercialProps) {
  const frame = useCurrentFrame();
  const totalDuration = props.durationInFrames;
  const outroStart = Math.max(0, totalDuration - OUTRO_CARD_DURATION_IN_FRAMES);
  const isOutro = frame >= outroStart;

  // Subtle Ken Burns zoom across the full duration.
  const scale = interpolate(frame, [0, totalDuration], [1.04, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Outro fade in for the closing card.
  const outroOpacity = interpolate(
    frame,
    [outroStart, Math.min(totalDuration, outroStart + 12)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      <Audio src={props.audioSrc} />
      <AbsoluteFill
        style={{
          backgroundColor: props.backgroundColor,
          color: 'white',
          overflow: 'hidden',
        }}
      >
        <Img
          src={props.heroImageUrl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale})`,
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(135deg, rgba(2, 6, 23, 0.18) 0%, rgba(2, 6, 23, 0.72) 42%, rgba(2, 6, 23, 0.94) 100%)',
          }}
        />
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
          <div
            style={{
              display: 'flex',
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
                color: '#ffffff',
              }}
            >
              {props.productName}
            </div>
          </div>

          <div
            style={{
              width: '88%',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div
              style={{
                width: 96,
                height: 6,
                borderRadius: 999,
                backgroundColor: props.accentColor,
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: 56,
                lineHeight: 1.05,
                fontWeight: 800,
                letterSpacing: -1.6,
                fontFamily: 'Inter, sans-serif',
                color: '#ffffff',
              }}
            >
              <ActiveCaption
                captions={props.captions}
                fallback={props.outroCta}
              />
            </h1>
          </div>
        </div>
      </AbsoluteFill>

      {isOutro ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at top, ${props.accentColor}22 0%, ${props.backgroundColor} 55%)`,
            color: 'white',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: outroOpacity,
          }}
        >
          <div
            style={{
              width: 720,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 22,
                textTransform: 'uppercase',
                letterSpacing: 1.4,
                color: props.accentColor,
              }}
            >
              {props.productName}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 44,
                lineHeight: 1.15,
                fontWeight: 800,
                letterSpacing: -1.2,
                fontFamily: 'Inter, sans-serif',
                color: '#ffffff',
              }}
            >
              {props.outroCta}
            </p>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}
