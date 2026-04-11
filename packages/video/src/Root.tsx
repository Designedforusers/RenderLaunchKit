import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import React from 'react';
import type { CalculateMetadataFunction } from 'remotion';
import { Composition } from 'remotion';
import { LaunchKitVideo } from './LaunchKitVideo.js';
import { PodcastWaveform } from './PodcastWaveform.js';
import { VerticalVideo } from './VerticalVideo.js';
import { VoiceCommercial } from './VoiceCommercial.js';
import {
  defaultLaunchKitVideoProps,
  defaultPodcastWaveformProps,
  defaultVerticalVideoProps,
  defaultVoiceCommercialProps,
  getLaunchKitVideoDurationInFrames,
  getVerticalVideoDurationInFrames,
  VERTICAL_VIDEO_HEIGHT,
  VERTICAL_VIDEO_WIDTH,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from './types.js';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VerticalVideoProps,
  VoiceCommercialProps,
} from './types.js';

// Load fonts at the composition root so every composition inherits
// them. Remotion blocks the render until fonts are ready, so text
// never flashes unstyled even on a cold VPS where system fonts are
// absent.
loadInter('normal', {
  weights: ['400', '600', '700', '800'],
  subsets: ['latin'],
});
loadJetBrainsMono('normal', {
  weights: ['400'],
  subsets: ['latin'],
});

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

const calculateVerticalVideoMetadata: CalculateMetadataFunction<
  VerticalVideoProps
> = ({ props }) =>
  Promise.resolve({
    durationInFrames: getVerticalVideoDurationInFrames(props),
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
      <Composition
        id="LaunchKitVerticalVideo"
        component={VerticalVideo}
        durationInFrames={getVerticalVideoDurationInFrames(
          defaultVerticalVideoProps
        )}
        fps={VIDEO_FPS}
        width={VERTICAL_VIDEO_WIDTH}
        height={VERTICAL_VIDEO_HEIGHT}
        defaultProps={defaultVerticalVideoProps}
        calculateMetadata={calculateVerticalVideoMetadata}
      />
    </>
  );
};
