/** Types for GradientWaves.jsx, the React Bits component (reactbits.dev/backgrounds/gradient-waves). */
import type { CSSProperties } from "react";

export interface GradientWavesProps {
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  /** "transparent" (the default) lets the page show through. */
  backgroundColor?: string;
  /** Tints a light page instead of glowing on a dark one. */
  lightMode?: boolean;
  speed?: number;
  amplitude?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  tilt?: number;
  zoom?: number;
  height?: number;
  fogDepth?: number;
  relief?: number;
  lightAngle?: number;
  sheen?: number;
  brightness?: number;
  opacity?: number;
  grain?: number | boolean;
  quality?: "low" | "medium" | "high";
  intro?: boolean;
  mouseInteraction?: boolean;
  parallaxStrength?: number;
  mouseStrength?: number;
  swellOnClick?: boolean;
  paused?: boolean;
  /** Most device pixels per CSS pixel the canvas renders at. */
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

export default function GradientWaves(props: GradientWavesProps): React.JSX.Element;
