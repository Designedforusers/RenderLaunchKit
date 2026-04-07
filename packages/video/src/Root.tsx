import React from 'react';
import type { CalculateMetadataFunction } from 'remotion';
import { Composition } from 'remotion';
import { LaunchKitVideo } from './LaunchKitVideo.js';
import {
  defaultLaunchKitVideoProps,
  getLaunchKitVideoDurationInFrames,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from './types.js';
import type { LaunchKitVideoProps } from './types.js';

const calculateMetadata: CalculateMetadataFunction<LaunchKitVideoProps> = async ({
  props,
}) => {
  return {
    durationInFrames: getLaunchKitVideoDurationInFrames(props),
  };
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="LaunchKitProductVideo"
      component={LaunchKitVideo}
      durationInFrames={getLaunchKitVideoDurationInFrames(defaultLaunchKitVideoProps)}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={defaultLaunchKitVideoProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
