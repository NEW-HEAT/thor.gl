/**
 * Gaze gesture: iris + head pose → screen gaze point.
 *
 * Uses the gaze model to estimate where on-screen the user is looking.
 * Supports both uncalibrated (geometric) and calibrated (polynomial) modes.
 *
 * Does NOT modify viewState — emits gaze position for picking/hover only.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import {
  estimateGaze,
  type CalibrationData,
  type GazePoint,
} from "./gaze-model";

/** Current calibration data — set via setGazeCalibration() */
let calibration: CalibrationData | null = null;

/** Last estimated gaze point */
let lastGazePoint: GazePoint | null = null;

/** Exponential moving average state */
let smoothX = 0.5;
let smoothY = 0.5;

/**
 * Adaptive EMA — responsive to large movements, stable when still.
 * alpha = base smoothing factor (0 = no smoothing, 1 = freeze)
 * When velocity is high, alpha drops for responsiveness.
 */
function adaptiveSmooth(raw: GazePoint): GazePoint {
  const dx = raw.x - smoothX;
  const dy = raw.y - smoothY;
  const velocity = Math.sqrt(dx * dx + dy * dy);

  // High velocity → alpha ~0.15 (responsive). Low velocity → alpha ~0.6 (stable).
  const alpha = clamp(0.6 - velocity * 4, 0.12, 0.65);

  smoothX = smoothX * alpha + raw.x * (1 - alpha);
  smoothY = smoothY * alpha + raw.y * (1 - alpha);

  return { x: smoothX, y: smoothY, confidence: raw.confidence };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const gaze: GestureHandler = {
  name: "gaze",
  requires: ["face"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.face || frame.face.length < 474) return null;

    const raw = estimateGaze(frame.face, calibration);
    if (!raw) return null;

    const point = adaptiveSmooth(raw);
    lastGazePoint = point;

    return {
      gesture: "gaze",
      data: {
        x: point.x,
        y: point.y,
        confidence: point.confidence,
        calibrated: calibration !== null,
      },
    };
  },

  apply(_detection, viewState, _config): ViewState {
    return viewState;
  },

  reset() {
    smoothX = 0.5;
    smoothY = 0.5;
    lastGazePoint = null;
  },
};

export function setGazeCalibration(data: CalibrationData | null): void {
  calibration = data;
  smoothX = 0.5;
  smoothY = 0.5;
}

export function getGazeCalibration(): CalibrationData | null {
  return calibration;
}

export function getLastGazePoint(): GazePoint | null {
  return lastGazePoint;
}
