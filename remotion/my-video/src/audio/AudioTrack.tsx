import React, { useMemo } from "react";
import { Audio, Sequence, useVideoConfig } from "remotion";
import {
  generateBackgroundPad,
  generateErrorBuzz,
  generateSuccessChime,
  generateWhoosh,
  generateImpact,
} from "./generateAudio";

export const AudioTrack: React.FC = () => {
  const { durationInFrames, fps } = useVideoConfig();
  const totalSeconds = durationInFrames / fps;

  // Generate audio data URLs (memoized)
  const bgPad = useMemo(() => generateBackgroundPad(totalSeconds), [totalSeconds]);
  const errorBuzz = useMemo(() => generateErrorBuzz(), []);
  const successChime = useMemo(() => generateSuccessChime(), []);
  const whoosh = useMemo(() => generateWhoosh(), []);
  const impact = useMemo(() => generateImpact(), []);

  // Scene timing (matching CouponMaxxVideo.tsx)
  // intro: 0-90, cartFrustration: 90-390, blindSpot: 390-480,
  // dashboard: 480-720, alerts: 720-900, recoveryIntro: 900-990,
  // cartRecovery: 990-1230, results: 1230-1350, cta: 1350-1470

  // Cart frustration: first error at 90+70=160, second at 90+160=250
  const firstError = 160;
  const secondError = 250;
  const abandonImpact = 290;

  // Blind spot transition
  const blindSpotWhoosh = 390;

  // Dashboard reveal
  const dashboardWhoosh = 480;

  // Alerts scene reveal
  const alertsWhoosh = 720;
  // Slack notification "ding" impact
  const slackDing1 = 735;
  const slackDing2 = 770;

  // Recovery intro
  const recoveryWhoosh = 900;

  // Cart recovery: error at 990+40=1030, success at 990+175=1165
  const recoveryError = 1030;
  const recoverySuccess = 1165;

  // Results
  const resultsImpact = 1230;

  return (
    <>
      {/* Background ambient pad */}
      <Sequence from={0} durationInFrames={durationInFrames}>
        <Audio src={bgPad} volume={0.3} />
      </Sequence>

      {/* Cart frustration errors */}
      <Sequence from={firstError} durationInFrames={Math.floor(0.35 * fps)}>
        <Audio src={errorBuzz} volume={0.6} />
      </Sequence>
      <Sequence from={secondError} durationInFrames={Math.floor(0.35 * fps)}>
        <Audio src={errorBuzz} volume={0.75} />
      </Sequence>

      {/* Abandon impact */}
      <Sequence from={abandonImpact} durationInFrames={Math.floor(0.6 * fps)}>
        <Audio src={impact} volume={0.7} />
      </Sequence>

      {/* Scene transition whooshes */}
      <Sequence from={blindSpotWhoosh} durationInFrames={Math.floor(0.5 * fps)}>
        <Audio src={whoosh} volume={0.5} />
      </Sequence>
      <Sequence from={dashboardWhoosh} durationInFrames={Math.floor(0.5 * fps)}>
        <Audio src={whoosh} volume={0.4} />
      </Sequence>
      <Sequence from={alertsWhoosh} durationInFrames={Math.floor(0.5 * fps)}>
        <Audio src={whoosh} volume={0.45} />
      </Sequence>
      <Sequence from={recoveryWhoosh} durationInFrames={Math.floor(0.5 * fps)}>
        <Audio src={whoosh} volume={0.5} />
      </Sequence>

      {/* Slack notification impacts */}
      <Sequence from={slackDing1} durationInFrames={Math.floor(0.8 * fps)}>
        <Audio src={successChime} volume={0.35} />
      </Sequence>
      <Sequence from={slackDing2} durationInFrames={Math.floor(0.8 * fps)}>
        <Audio src={successChime} volume={0.3} />
      </Sequence>

      {/* Recovery scene error */}
      <Sequence from={recoveryError} durationInFrames={Math.floor(0.35 * fps)}>
        <Audio src={errorBuzz} volume={0.5} />
      </Sequence>

      {/* Success chime */}
      <Sequence from={recoverySuccess} durationInFrames={Math.floor(0.8 * fps)}>
        <Audio src={successChime} volume={0.7} />
      </Sequence>

      {/* Results reveal */}
      <Sequence from={resultsImpact} durationInFrames={Math.floor(0.6 * fps)}>
        <Audio src={impact} volume={0.5} />
      </Sequence>
    </>
  );
};
