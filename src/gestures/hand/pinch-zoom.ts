/**
 * Pinch-Zoom gesture: 2-hand pinch → zoom the viewport.
 *
 * Hands moving apart = zoom in, hands moving together = zoom out.
 * Ported from thor's useGestureViewState.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { isPinching, pinchCenter } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

// ── Internal state ──

let prevDistance: number | null = null;

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

  const threshold =
    confidence > 0.8
      ? cfg.pinchThreshold * 1.5
      : confidence > 0.6
        ? cfg.pinchThreshold * 1.3
        : cfg.pinchThreshold;

  if (!isPinching(landmarks, threshold)) {
    pinchStartTimes[handIndex] = null;
    return false;
  }

  if (pinchStartTimes[handIndex] === null) {
    pinchStartTimes[handIndex] = now;
  }

  return (now - pinchStartTimes[handIndex]!) >= cfg.grabDelay;
}

export const pinchZoom: GestureHandler = {
  name: "pinch-zoom",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const { hands, handConfidences } = frame;
    if (hands.length < 2) {
      prevDistance = null;
      return null;
    }

    const now = frame.timestamp;
    const h1Confirmed = confirmPinch(0, hands[0], handConfidences[0] ?? 0, now);
    const h2Confirmed = confirmPinch(1, hands[1], handConfidences[1] ?? 0, now);

    if (!h1Confirmed || !h2Confirmed) {
      prevDistance = null;
      return null;
    }

    const center1 = pinchCenter(hands[0]);
    const center2 = pinchCenter(hands[1]);
    if (!center1 || !center2) {
      prevDistance = null;
      return null;
    }

    const dx = center2.x - center1.x;
    const dy = center2.y - center1.y;
    const currentDistance = Math.sqrt(dx * dx + dy * dy);

    if (prevDistance === null) {
      prevDistance = currentDistance;
      return null; // first frame
    }

    const distanceDelta = currentDistance - prevDistance;
    prevDistance = currentDistance;

    return {
      gesture: "pinch-zoom",
      data: { distanceDelta },
    };
  },

  apply(detection, viewState, config): ViewState {
    const { distanceDelta } = detection.data as { distanceDelta: number };

    if (Math.abs(distanceDelta) < config.zoomDeadzone) {
      return viewState;
    }

    const zoomDelta = distanceDelta * config.zoomSensitivity;
    return {
      ...viewState,
      zoom: Math.max(0, Math.min(22, viewState.zoom + zoomDelta)),
    };
  },

  reset() {
    prevDistance = null;
    pinchStartTimes[0] = null;
    pinchStartTimes[1] = null;
  },
};
