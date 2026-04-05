/**
 * Pinch-Pan gesture: 1-hand pinch + drag → pan the viewport.
 *
 * Ported from thor's useGestureViewState — same math, new interface.
 * Includes inertia: releasing a pan gesture carries momentum forward.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { isPinching, pinchCenter, HAND, FINGERTIPS } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

// ── Internal state (lives in the handler, reset on deactivate) ──

let prevCenter: { x: number; y: number } | null = null;
let velocity = { vx: 0, vy: 0 };
let inertiaActive = false;
let wasPanning = false;

// Confirmation state per hand
const pinchStartTimes: (number | null)[] = [null, null];

const INERTIA_FRICTION = 0.92;
const INERTIA_THRESHOLD = 0.00005;

function confirmPinch(
  handIndex: number,
  landmarks: import("../../detection/types").HandLandmarks | undefined,
  confidence: number,
  now: number
): { confirmed: boolean; dwelling: boolean } {
  if (!landmarks || confidence < cfg.minConfidence) {
    pinchStartTimes[handIndex] = null;
    return { confirmed: false, dwelling: false };
  }

  // Adaptive threshold
  const threshold =
    confidence > 0.8
      ? cfg.pinchThreshold * 1.5
      : confidence > 0.6
        ? cfg.pinchThreshold * 1.3
        : cfg.pinchThreshold;

  if (!isPinching(landmarks, threshold)) {
    pinchStartTimes[handIndex] = null;
    return { confirmed: false, dwelling: false };
  }

  if (pinchStartTimes[handIndex] === null) {
    pinchStartTimes[handIndex] = now;
  }

  const elapsed = now - pinchStartTimes[handIndex]!;
  const confirmed = elapsed >= cfg.grabDelay;
  return { confirmed, dwelling: !confirmed };
}

export const pinchPan: GestureHandler = {
  name: "pinch-pan",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const { hands, handConfidences } = frame;
    if (hands.length === 0) {
      // No hands — check if we should trigger inertia
      if (wasPanning) {
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        if (speed > INERTIA_THRESHOLD) {
          inertiaActive = true;
        }
        wasPanning = false;
        prevCenter = null;
      }

      if (inertiaActive) {
        // Tick inertia
        velocity.vx *= INERTIA_FRICTION;
        velocity.vy *= INERTIA_FRICTION;
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        if (speed < INERTIA_THRESHOLD) {
          inertiaActive = false;
          velocity = { vx: 0, vy: 0 };
          return null;
        }
        return {
          gesture: "pinch-pan",
          data: { inertia: true, vx: velocity.vx, vy: velocity.vy },
        };
      }
      return null;
    }

    const now = frame.timestamp;
    const hand1 = confirmPinch(0, hands[0], handConfidences[0] ?? 0, now);
    const hand2 = confirmPinch(1, hands[1], handConfidences[1] ?? 0, now);

    // Two hands confirmed = zoom territory, not pan
    if (hand1.confirmed && hand2.confirmed) {
      prevCenter = null;
      wasPanning = false;
      return null;
    }

    // One hand confirmed = pan
    const panningHandIndex = hand1.confirmed ? 0 : hand2.confirmed ? 1 : -1;
    if (panningHandIndex === -1) {
      // No confirmed pinch — trigger inertia if we were panning
      if (wasPanning) {
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        if (speed > INERTIA_THRESHOLD) {
          inertiaActive = true;
        }
        wasPanning = false;
        prevCenter = null;
      }

      if (inertiaActive) {
        velocity.vx *= INERTIA_FRICTION;
        velocity.vy *= INERTIA_FRICTION;
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        if (speed < INERTIA_THRESHOLD) {
          inertiaActive = false;
          velocity = { vx: 0, vy: 0 };
          return null;
        }
        return {
          gesture: "pinch-pan",
          data: { inertia: true, vx: velocity.vx, vy: velocity.vy },
        };
      }

      return null;
    }

    const center = pinchCenter(hands[panningHandIndex]);
    if (!center) return null;

    inertiaActive = false;
    wasPanning = true;

    if (!prevCenter) {
      prevCenter = center;
      return null; // first frame, no delta yet
    }

    const dx = (center.x - prevCenter.x);
    const dy = (center.y - prevCenter.y);
    prevCenter = center;

    // Deadzone — ignore sub-pixel jitter from model noise
    if (Math.abs(dx) < cfg.panMoveDeadzone && Math.abs(dy) < cfg.panMoveDeadzone) {
      return null;
    }

    // Update smoothed velocity for inertia
    velocity.vx = velocity.vx * (1 - cfg.panSmoothing) + dx * cfg.panSmoothing;
    velocity.vy = velocity.vy * (1 - cfg.panSmoothing) + dy * cfg.panSmoothing;

    return {
      gesture: "pinch-pan",
      data: { dx, dy, inertia: false },
    };
  },

  apply(detection, viewState, config): ViewState {
    const { dx, dy, inertia, vx, vy } = detection.data as {
      dx?: number;
      dy?: number;
      inertia: boolean;
      vx?: number;
      vy?: number;
    };

    const zoomFactor = Math.pow(2, viewState.zoom);

    if (inertia && vx !== undefined && vy !== undefined) {
      const lngDelta = (vx * 180) / zoomFactor;
      const latDelta = (vy * 90) / zoomFactor;
      return {
        ...viewState,
        longitude: viewState.longitude + lngDelta,
        latitude: Math.max(-85, Math.min(85, viewState.latitude + latDelta)),
      };
    }

    if (dx !== undefined && dy !== undefined) {
      const scaledDx = dx * config.panSensitivity;
      const scaledDy = dy * config.panSensitivity;
      const lngDelta = (scaledDx * 180) / zoomFactor;
      const latDelta = (scaledDy * 90) / zoomFactor;

      return {
        ...viewState,
        longitude: viewState.longitude + lngDelta,
        latitude: Math.max(-85, Math.min(85, viewState.latitude + latDelta)),
      };
    }

    return viewState;
  },

  reset() {
    prevCenter = null;
    velocity = { vx: 0, vy: 0 };
    inertiaActive = false;
    wasPanning = false;
    pinchStartTimes[0] = null;
    pinchStartTimes[1] = null;
  },
};
