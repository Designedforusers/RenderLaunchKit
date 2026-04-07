import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
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
import { OUTRO_DURATION_IN_FRAMES } from './types.js';

type SceneProps = {
  shot: LaunchKitVideoShot;
  accentColor: string;
  backgroundColor: string;
  title: string;
  badge: string;
};

function Scene({
  shot,
  accentColor,
  backgroundColor,
  title,
  badge,
}: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    durationInFrames: 18,
    config: { damping: 200 },
  });
  const opacity = interpolate(frame, [0, 8, shot.durationInFrames - 8], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(frame, [0, shot.durationInFrames], [1.06, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const textY = interpolate(entrance, [0, 1], [40, 0]);

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
            justifyContent: 'space-between',
            alignItems: 'center',
            transform: `translateY(${textY}px)`,
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
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            width: '72%',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            transform: `translateY(${textY}px)`,
          }}
        >
          <div
            style={{
              width: 96,
              height: 6,
              borderRadius: 999,
              backgroundColor: accentColor,
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: 64,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: -1.8,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {shot.headline}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 28,
              lineHeight: 1.3,
              color: 'rgba(226, 232, 240, 0.92)',
              fontFamily: 'Inter, sans-serif',
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
              transform: `translateY(${textY}px)`,
            }}
          >
            <span style={{ color: accentColor, fontWeight: 700 }}>{shot.accent}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

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
  const reveal = spring({
    frame,
    fps,
    durationInFrames: 22,
    config: { damping: 200 },
  });
  const scale = interpolate(reveal, [0, 1], [0.94, 1]);
  const opacity = interpolate(reveal, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at top, ${accentColor}22 0%, ${backgroundColor} 55%)`,
        color: 'white',
        justifyContent: 'center',
        alignItems: 'center',
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
          transform: `scale(${scale})`,
          opacity,
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
        <h2
          style={{
            margin: 0,
            fontSize: 68,
            lineHeight: 0.96,
            fontWeight: 800,
            letterSpacing: -2,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {subtitle}
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

export function LaunchKitVideo(props: LaunchKitVideoProps) {
  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {props.shots.map((shot) => {
        const currentFrom = from;
        from += shot.durationInFrames;

        return (
          <Sequence key={shot.id} from={currentFrom} durationInFrames={shot.durationInFrames}>
            <Scene
              shot={shot}
              accentColor={props.accentColor}
              backgroundColor={props.backgroundColor}
              title={props.title}
              badge={props.badge}
            />
          </Sequence>
        );
      })}
      <Sequence from={from} durationInFrames={OUTRO_DURATION_IN_FRAMES}>
        <Outro
          title={props.title}
          subtitle={props.subtitle}
          outroCta={props.outroCta}
          accentColor={props.accentColor}
          backgroundColor={props.backgroundColor}
        />
      </Sequence>
      {props.captions?.length ? (
        <CaptionOverlay
          captions={props.captions}
          accentColor={props.accentColor}
        />
      ) : null}
    </AbsoluteFill>
  );
}
