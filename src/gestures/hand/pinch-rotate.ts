/**
 * Pinch-Rotate gesture: 2-hand pinch + twist → rotate bearing.
 *
 * When both hands are pinching, the angle between pinch centers
 * determines bearing change. Twist clockwise = rotate right.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { isPinching, pinchCenter } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

let prevAngle: number | null = null;

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

export const pinchRotate: GestureHandler = {
  name: "pinch-rotate",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const { hands, handConfidences } = frame;
    if (hands.length < 2) {
      prevAngle = null;
      return null;
    }

    const now = frame.timestamp;
    if (!confirmPinch(0, hands[0], handConfidences[0] ?? 0, now) ||
        !confirmPinch(1, hands[1], handConfidences[1] ?? 0, now)) {
      prevAngle = null;
      return null;
    }

    const c1 = pinchCenter(hands[0]);
    const c2 = pinchCenter(hands[1]);
    if (!c1 || !c2) { prevAngle = null; return null; }

    const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);

    if (prevAngle === null) {
      prevAngle = angle;
      return null;
    }

    let delta = angle - prevAngle;
    prevAngle = angle;

    // Normalize to [-PI, PI]
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    if (Math.abs(delta) < cfg.rotateDeadzone) return null;

    return {
      gesture: "pinch-rotate",
      data: { angleDelta: delta },
    };
  },

  apply(detection, viewState, _config): ViewState {
    const { angleDelta } = detection.data as { angleDelta: number };
    return {
      ...viewState,
      bearing: (viewState.bearing ?? 0) + angleDelta * cfg.rotateSensitivity,
    };
  },

  reset() {
    prevAngle = null;
    pinchStartTimes[0] = null;
    pinchStartTimes[1] = null;
  },
};
