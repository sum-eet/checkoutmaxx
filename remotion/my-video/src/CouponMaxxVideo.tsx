import React from "react";
import { Sequence, useCurrentFrame, interpolate } from "remotion";
import { CartFrustrationScene, CartRecoveryScene } from "./scenes/CartScene";
import { DashboardScene } from "./scenes/DashboardScene";
import { AlertsScene } from "./scenes/AlertsScene";
import {
  IntroScene,
  BlindSpotScene,
  RecoveryIntroScene,
  ResultsScene,
  CTAScene,
} from "./scenes/TextScene";
import { AudioTrack } from "./audio/AudioTrack";

// 30fps — all durations in frames
const SCENES = {
  intro: { start: 0, duration: 90 },              // 0-3s: Hook
  cartFrustration: { start: 90, duration: 300 },   // 3-13s: Customer tries codes, fails, leaves
  blindSpot: { start: 390, duration: 90 },          // 13-16s: "You never saw this happen"
  dashboard: { start: 480, duration: 240 },         // 16-24s: Admin dashboard with zoom/pan
  alerts: { start: 720, duration: 180 },            // 24-30s: Slack + Email notifications
  recoveryIntro: { start: 900, duration: 90 },      // 30-33s: "Smart Recovery" intro
  cartRecovery: { start: 990, duration: 240 },      // 33-41s: Code fails -> recovery -> success
  results: { start: 1230, duration: 120 },           // 41-45s: Revenue recovered stats
  cta: { start: 1350, duration: 120 },               // 45-49s: CouponMaxx CTA
};

// Cross-fade transition wrapper
const SceneWithTransition: React.FC<{
  children: React.ReactNode;
  sceneStart: number;
  sceneDuration: number;
  fadeIn?: number;
  fadeOut?: number;
}> = ({ children, sceneStart, sceneDuration, fadeIn = 8, fadeOut = 8 }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - sceneStart;

  let opacity = 1;
  if (fadeIn > 0 && localFrame < fadeIn) {
    opacity = interpolate(localFrame, [0, fadeIn], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (fadeOut > 0 && localFrame > sceneDuration - fadeOut) {
    opacity = interpolate(
      localFrame,
      [sceneDuration - fadeOut, sceneDuration],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
      }}
    >
      {children}
    </div>
  );
};

export const CouponMaxxVideo: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0f0f23",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        position: "relative",
      }}
    >
      <Sequence from={SCENES.intro.start} durationInFrames={SCENES.intro.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.intro.duration} fadeIn={0}>
          <IntroScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.cartFrustration.start} durationInFrames={SCENES.cartFrustration.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.cartFrustration.duration}>
          <CartFrustrationScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.blindSpot.start} durationInFrames={SCENES.blindSpot.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.blindSpot.duration}>
          <BlindSpotScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.dashboard.start} durationInFrames={SCENES.dashboard.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.dashboard.duration}>
          <DashboardScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.alerts.start} durationInFrames={SCENES.alerts.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.alerts.duration}>
          <AlertsScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.recoveryIntro.start} durationInFrames={SCENES.recoveryIntro.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.recoveryIntro.duration}>
          <RecoveryIntroScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.cartRecovery.start} durationInFrames={SCENES.cartRecovery.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.cartRecovery.duration}>
          <CartRecoveryScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.results.start} durationInFrames={SCENES.results.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.results.duration}>
          <ResultsScene />
        </SceneWithTransition>
      </Sequence>

      <Sequence from={SCENES.cta.start} durationInFrames={SCENES.cta.duration}>
        <SceneWithTransition sceneStart={0} sceneDuration={SCENES.cta.duration} fadeOut={0}>
          <CTAScene />
        </SceneWithTransition>
      </Sequence>

      {/* Audio layer */}
      <AudioTrack />
    </div>
  );
};
