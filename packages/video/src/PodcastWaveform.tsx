import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type {
  PodcastDialogueSegment,
  PodcastWaveformProps,
} from './types.js';

const WAVEFORM_BAR_COUNT = 32;
const INTRO_CARD_DURATION_IN_FRAMES = 24;

function findActiveSegment(
  segments: PodcastDialogueSegment[],
  frame: number
): PodcastDialogueSegment | undefined {
  return segments.find(
    (segment) =>
      frame >= segment.startInFrames && frame < segment.endInFrames
  );
}

function WaveformBars({
  accentColor,
  activeSpeaker,
}: {
  accentColor: string;
  activeSpeaker: PodcastDialogueSegment['speaker'] | null;
}) {
  const frame = useCurrentFrame();
  const bars = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, i) => i);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '38%',
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 64px',
      }}
    >
      {bars.map((i) => {
        const sineValue = Math.sin(frame / 4 + i);
        const baseHeight = interpolate(sineValue, [-1, 1], [18, 96]);

        const isLeftHalf = i < WAVEFORM_BAR_COUNT / 2;
        const isActiveHalf =
          (activeSpeaker === 'alex' && isLeftHalf) ||
          (activeSpeaker === 'sam' && !isLeftHalf);

        const height = isActiveHalf ? baseHeight * 1.4 : baseHeight * 0.7;
        const opacity = isActiveHalf ? 1 : 0.45;

        return (
          <div
            key={i}
            style={{
              width: 8,
              height,
              borderRadius: 4,
              backgroundColor: accentColor,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}

function SpeakerLabel({
  name,
  active,
  align,
  accentColor,
}: {
  name: string;
  active: boolean;
  align: 'left' | 'right';
  accentColor: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : 'flex-end',
        gap: 8,
        opacity: active ? 1 : 0.35,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 36,
          fontWeight: 800,
          letterSpacing: -0.8,
          color: '#ffffff',
        }}
      >
        {name}
      </div>
      <div
        style={{
          width: active ? 64 : 24,
          height: 4,
          borderRadius: 999,
          backgroundColor: active ? accentColor : 'rgba(226, 232, 240, 0.4)',
        }}
      />
    </div>
  );
}

function DialogueCaption({
  text,
  accentColor,
}: {
  text: string;
  accentColor: string;
}) {
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
            color: '#ffffff',
            fontWeight: 650,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

export function PodcastWaveform(props: PodcastWaveformProps) {
  const frame = useCurrentFrame();
  const activeSegment = findActiveSegment(props.segments, frame);
  const activeSpeaker = activeSegment?.speaker ?? null;
  const isIntro = frame < INTRO_CARD_DURATION_IN_FRAMES;
  const introOpacity = interpolate(
    frame,
    [0, INTRO_CARD_DURATION_IN_FRAMES],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      <Audio src={props.audioSrc} />

      <div
        style={{
          position: 'absolute',
          top: 36,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(2, 6, 23, 0.42)',
            borderRadius: 999,
            padding: '10px 18px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 16,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: '#ffffff',
          }}
        >
          {props.productName}
        </div>
      </div>

      <WaveformBars
        accentColor={props.accentColor}
        activeSpeaker={activeSpeaker}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '62%',
          padding: '0 96px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <SpeakerLabel
          name="Alex"
          active={activeSpeaker === 'alex'}
          align="left"
          accentColor={props.accentColor}
        />
        <SpeakerLabel
          name="Sam"
          active={activeSpeaker === 'sam'}
          align="right"
          accentColor={props.accentColor}
        />
      </div>

      {activeSegment ? (
        <DialogueCaption
          text={activeSegment.text}
          accentColor={props.accentColor}
        />
      ) : null}

      {isIntro ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at center, ${props.accentColor}22 0%, ${props.backgroundColor} 60%)`,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: introOpacity,
          }}
        >
          <div
            style={{
              width: 720,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 20,
                textTransform: 'uppercase',
                letterSpacing: 1.4,
                color: props.accentColor,
              }}
            >
              {props.productName}
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: 56,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: -1.6,
                fontFamily: 'Inter, sans-serif',
                color: '#ffffff',
              }}
            >
              {props.episodeTitle}
            </h2>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}
