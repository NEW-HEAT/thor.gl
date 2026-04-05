/**
 * Core detection types for thor.gl.
 *
 * ThorFrame is the unified output of any MediaPipe detector.
 * All fields are present but may be empty — handlers check what they need.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Single hand: 21 normalized landmarks */
export type HandLandmarks = NormalizedLandmark[];

/** Face mesh: 478 normalized landmarks (includes 10 iris points) */
export type FaceLandmarks = NormalizedLandmark[];

/** Pose skeleton: 33 normalized landmarks */
export type PoseLandmarks = NormalizedLandmark[];

/** ARKit-compatible face blendshape coefficients */
export interface Blendshapes {
  /** 52 blendshape categories with scores 0-1 */
  categories: { categoryName: string; score: number }[];
}

/**
 * ThorFrame — the unified detection result for a single video frame.
 *
 * Produced by the detector, consumed by all gesture handlers.
 * Fields may be empty arrays/null depending on what's visible to the camera
 * and which detector mode is active.
 */
export interface ThorFrame {
  timestamp: number;

  // ── Hands (0-2) ──
  hands: HandLandmarks[];
  handedness: ("Left" | "Right")[];
  handConfidences: number[];

  // ── Face (0-1) ──
  face: FaceLandmarks | null;
  blendshapes: Blendshapes | null;

  // ── Pose (0-1) ──
  pose: PoseLandmarks | null;
}

/** Empty frame — used when no detection occurs */
export const EMPTY_FRAME: ThorFrame = {
  timestamp: 0,
  hands: [],
  handedness: [],
  handConfidences: [],
  face: null,
  blendshapes: null,
  pose: null,
};

/** Detector mode */
export type DetectorMode = "auto" | "hands" | "holistic";

/** What body parts a handler requires */
export type BodyPart = "hands" | "face" | "pose";
