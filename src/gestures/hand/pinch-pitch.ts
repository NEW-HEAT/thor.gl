/**
 * Pinch-Pitch gesture: 2-hand pinch + vertical shift → tilt pitch.
 *
 * When both hands are pinching, moving them both up or down together
 * changes the pitch. Moving up = increase pitch (tilt down), moving
 * down = decrease pitch (tilt up).
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { isPinching, pinchCenter } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

let prevAvgY: number | null = null;

const pinchStartTimes: (number | null)[] = [null, null];

function confirmPinch(
  handIndex: number,
  landmarks: import("../../detection/types").HandLandmarks | undefined,
  confidence: number,
  now: number
): boolean {
  if (!landmarks || confidence < cfg.minConfidence) {
    pinchStartTimes[handIndex] = null;
    return false;
  }
  const threshold = confidence > 0.8 ? cfg.pinchThreshold * 1.5
    : confidence > 0.6 ? cfg.pinchThreshold * 1.3
    : cfg.pinchThreshold;
  if (!isPinching(landmarks, threshold)) {
    pinchStartTimes[handIndex] = null;
    return false;
  }
  if (pinchStartTimes[handIndex] === null) pinchStartTimes[handIndex] = now;
  return (now - pinchStartTimes[handIndex]!) >= cfg.grabDelay;
}

export const pinchPitch: GestureHandler = {
  name: "pinch-pitch",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const { hands, handConfidences } = frame;
    if (hands.length < 2) {
      prevAvgY = null;
      return null;
    }

    const now = frame.timestamp;
    if (!confirmPinch(0, hands[0], handConfidences[0] ?? 0, now) ||
        !confirmPinch(1, hands[1], handConfidences[1] ?? 0, now)) {
      prevAvgY = null;
      return null;
    }

    const c1 = pinchCenter(hands[0]);
    const c2 = pinchCenter(hands[1]);
    if (!c1 || !c2) { prevAvgY = null; return null; }

    // Average Y of both pinch centers — both hands moving up/down together
    const avgY = (c1.y + c2.y) / 2;

    if (prevAvgY === null) {
      prevAvgY = avgY;
      return null;
    }

    const delta = avgY - prevAvgY;
    prevAvgY = avgY;

    if (Math.abs(delta) < cfg.pitchDeadzone) return null;

    return {
      gesture: "pinch-pitch",
      data: { yDelta: delta },
    };
  },

  apply(detection, viewState, _config): ViewState {
    const { yDelta } = detection.data as { yDelta: number };
    // Moving hands down (positive y in screen space) = increase pitch
    const newPitch = Math.max(0, Math.min(85, (viewState.pitch ?? 0) + yDelta * cfg.pitchSensitivity));
    return {
      ...viewState,
      pitch: newPitch,
    };
  },

  reset() {
    prevAvgY = null;
    pinchStartTimes[0] = null;
    pinchStartTimes[1] = null;
  },
};
