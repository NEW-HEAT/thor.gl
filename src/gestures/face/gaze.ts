/**
 * Gaze gesture: iris + head pose → screen gaze point.
 *
 * Uses the gaze model to estimate where on-screen the user is looking.
 * Supports both uncalibrated (geometric) and calibrated (polynomial) modes.
 *
 * Does NOT modify viewState — emits gaze position for picking/hover.
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

/** Last estimated gaze point (accessible for external consumers) */
let lastGazePoint: GazePoint | null = null;

/** Smoothing buffer for temporal filtering */
const SMOOTH_BUFFER: GazePoint[] = [];
const SMOOTH_WINDOW = 5;

function smooth(point: GazePoint): GazePoint {
  SMOOTH_BUFFER.push(point);
  if (SMOOTH_BUFFER.length > SMOOTH_WINDOW) SMOOTH_BUFFER.shift();

  let sx = 0, sy = 0, sc = 0;
  for (const p of SMOOTH_BUFFER) {
    sx += p.x;
    sy += p.y;
    sc += p.confidence;
  }
  const n = SMOOTH_BUFFER.length;
  return { x: sx / n, y: sy / n, confidence: sc / n };
}

export const gaze: GestureHandler = {
  name: "gaze",
  requires: ["face"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.face || frame.face.length < 474) return null;

    const raw = estimateGaze(frame.face, calibration);
    if (!raw) return null;

    const point = smooth(raw);
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
    // Gaze NEVER modifies viewState — it's a picking/hover signal only
    return viewState;
  },

  reset() {
    SMOOTH_BUFFER.length = 0;
    lastGazePoint = null;
  },
};

/** Set calibration data for the gaze estimator */
export function setGazeCalibration(data: CalibrationData | null): void {
  calibration = data;
  SMOOTH_BUFFER.length = 0;
}

/** Get the current calibration data */
export function getGazeCalibration(): CalibrationData | null {
  return calibration;
}

/** Get the last estimated gaze point */
export function getLastGazePoint(): GazePoint | null {
  return lastGazePoint;
}
