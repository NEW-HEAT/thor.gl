/**
 * Lean gesture: body lean → pan the viewport.
 *
 * Uses shoulder midpoint relative to hip midpoint to detect lean direction.
 * Leaning left/right → pan longitude, leaning forward/back → pan latitude.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { POSE, midpoint } from "../../detection/landmarks";

let prevLean: { x: number; y: number } | null = null;

const DEADZONE = 0.01;
const LEAN_SENSITIVITY = 2.0;

export const lean: GestureHandler = {
  name: "lean",
  requires: ["pose"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.pose || frame.pose.length < 25) return null;

    const leftShoulder = frame.pose[POSE.LEFT_SHOULDER];
    const rightShoulder = frame.pose[POSE.RIGHT_SHOULDER];
    const leftHip = frame.pose[POSE.LEFT_HIP];
    const rightHip = frame.pose[POSE.RIGHT_HIP];

    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);

    // Lean = shoulder offset from hip center
    const leanX = shoulderMid.x - hipMid.x;
    const leanY = shoulderMid.y - hipMid.y;

    if (prevLean === null) {
      prevLean = { x: leanX, y: leanY };
      return null;
    }

    const dx = leanX - prevLean.x;
    const dy = leanY - prevLean.y;
    prevLean = { x: leanX, y: leanY };

    if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) {
      return null;
    }

    return {
      gesture: "lean",
      data: { dx, dy },
    };
  },

  apply(detection, viewState, config): ViewState {
    const { dx, dy } = detection.data as { dx: number; dy: number };
    const zoomFactor = Math.pow(2, viewState.zoom);
    const lngDelta = (dx * LEAN_SENSITIVITY * config.panSensitivity * 180) / zoomFactor;
    const latDelta = (dy * LEAN_SENSITIVITY * config.panSensitivity * 90) / zoomFactor;

    return {
      ...viewState,
      longitude: viewState.longitude + lngDelta,
      latitude: Math.max(-85, Math.min(85, viewState.latitude + latDelta)),
    };
  },

  reset() {
    prevLean = null;
  },
};
