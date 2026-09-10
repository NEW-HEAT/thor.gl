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
let filteredDistance: number | null = null;
let sampleDistance: number | null = null;
let previousTime: number | null = null;

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
      this.reset?.();
      return null;
    }

    const now = frame.timestamp;
    if (previousTime !== null && (now - previousTime > 200 || now < previousTime)) this.reset?.();
    const dt = previousTime === null ? 33 : Math.max(1, now - previousTime);
    previousTime = now;
    const h1Confirmed = confirmPinch(0, hands[0], handConfidences[0] ?? 0, now);
    const h2Confirmed = confirmPinch(1, hands[1], handConfidences[1] ?? 0, now);

    if (!h1Confirmed || !h2Confirmed) {
      prevDistance = null;
      filteredDistance = null;
      sampleDistance = null;
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
    const currentDistance = Math.hypot(dx, dy);
    if (currentDistance < 0.08) { prevDistance = null; filteredDistance = null; sampleDistance = null; return null; }

    if (prevDistance === null || filteredDistance === null || sampleDistance === null ||
      Math.abs(Math.log2(currentDistance / sampleDistance)) > 0.5) {
      prevDistance = currentDistance;
      filteredDistance = currentDistance;
      sampleDistance = currentDistance;
      return null; // first frame
    }
    sampleDistance = currentDistance;
    filteredDistance += (currentDistance - filteredDistance) * (1 - Math.exp(-dt / 30));
    const delta = Math.log2(filteredDistance / prevDistance);
    if (Math.abs(delta) <= cfg.zoomDeadzone) return null;
    const zoomDelta = delta - Math.sign(delta) * cfg.zoomDeadzone;
    prevDistance *= Math.pow(2, zoomDelta);

    return {
      gesture: "pinch-zoom",
      data: { zoomDelta },
    };
  },

  apply(detection, viewState, config): ViewState {
    const zoomDelta = (detection.data.zoomDelta as number) * config.zoomSensitivity;
    return {
      ...viewState,
      zoom: Math.max(config.minZoom ?? 0, Math.min(22, viewState.zoom + zoomDelta)),
    };
  },

  reset() {
    prevDistance = null;
    filteredDistance = null;
    sampleDistance = null;
    previousTime = null;
    pinchStartTimes[0] = null;
    pinchStartTimes[1] = null;
  },
};
