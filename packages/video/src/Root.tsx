import React from 'react';
import type { CalculateMetadataFunction } from 'remotion';
import { Composition } from 'remotion';
import { LaunchKitVideo } from './LaunchKitVideo.js';
import { PodcastWaveform } from './PodcastWaveform.js';
import { VoiceCommercial } from './VoiceCommercial.js';
import {
  defaultLaunchKitVideoProps,
  defaultPodcastWaveformProps,
  defaultVoiceCommercialProps,
  getLaunchKitVideoDurationInFrames,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from './types.js';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VoiceCommercialProps,
} from './types.js';

// Remotion types `CalculateMetadataFunction` as returning a Promise,
// but our implementation is purely synchronous, so we wrap with
// `Promise.resolve` to match the contract without an unnecessary
// `async` keyword.
const calculateMetadata: CalculateMetadataFunction<LaunchKitVideoProps> = ({
  props,
}) =>
  Promise.resolve({
    durationInFrames: getLaunchKitVideoDurationInFrames(props),
  });

// Voice commercial and podcast compositions store their duration as
// a prop directly — no shot/caption math needed. The metadata
// callback simply forwards `props.durationInFrames`.
const calculateVoiceCommercialMetadata: CalculateMetadataFunction<
  VoiceCommercialProps
> = ({ props }) =>
  Promise.resolve({
    durationInFrames: props.durationInFrames,
  });

const calculatePodcastWaveformMetadata: CalculateMetadataFunction<
  PodcastWaveformProps
> = ({ props }) =>
  Promise.resolve({
    durationInFrames: props.durationInFrames,
  });

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="LaunchKitProductVideo"
        component={LaunchKitVideo}
        durationInFrames={getLaunchKitVideoDurationInFrames(
          defaultLaunchKitVideoProps
        )}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultLaunchKitVideoProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="LaunchKitVoiceCommercial"
        component={VoiceCommercial}
        durationInFrames={defaultVoiceCommercialProps.durationInFrames}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultVoiceCommercialProps}
        calculateMetadata={calculateVoiceCommercialMetadata}
      />
      <Composition
        id="LaunchKitPodcastWaveform"
        component={PodcastWaveform}
        durationInFrames={defaultPodcastWaveformProps.durationInFrames}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultPodcastWaveformProps}
        calculateMetadata={calculatePodcastWaveformMetadata}
      />
      {/*
        Phase 4 plan also lists `LaunchKitPerCommitTeaser` (a 15-second
        per-commit card video). It's intentionally cut from this PR —
        the plan marks it optional and the demo path doesn't need it
        before Phase 6 wires the per-commit marketing run pipeline. The
        composition will land alongside `process-commit-marketing-run.ts`
        in that PR so the two ship as one reviewable unit.
      */}
    </>
  );
};
