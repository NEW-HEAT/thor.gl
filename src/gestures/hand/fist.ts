/**
 * Fist gesture: closed fist → trigger an action (e.g. projection toggle).
 *
 * Flow: make fist → hold 300ms (confirms intent) → release fist → FIRES.
 * This means the action happens on RELEASE, not while holding. So you
 * can't accidentally double-fire by keeping your fist closed.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { HAND, distance } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

let fistStart: number | null = null;
let fired = false;         // already fired this hold
let lastFireTime = 0;
let _onAction: (() => void) | null = null;

/** Check if all 4 fingertips are curled toward the palm. */
function isFist(landmarks: import("../../detection/types").HandLandmarks): boolean {
  if (!landmarks || landmarks.length < 21) return false;

  const wrist = landmarks[HAND.WRIST];
  const tips = [
    landmarks[HAND.INDEX_TIP],
    landmarks[HAND.MIDDLE_TIP],
    landmarks[HAND.RING_TIP],
    landmarks[HAND.PINKY_TIP],
  ];
  const mcps = [
    landmarks[HAND.INDEX_MCP],
    landmarks[HAND.MIDDLE_MCP],
    landmarks[HAND.RING_MCP],
    landmarks[HAND.PINKY_MCP],
  ];

  for (let i = 0; i < 4; i++) {
    if (!tips[i] || !mcps[i]) return false;
    if (distance(tips[i], wrist) > distance(mcps[i], wrist) * 1.15) {
      return false;
    }
  }

  const thumbTip = landmarks[HAND.THUMB_TIP];
  const indexMcp = landmarks[HAND.INDEX_MCP];
  if (distance(thumbTip, indexMcp) > 0.12) return false;

  return true;
}

/** Set the action callback. Call before enabling the gesture. */
export function setFistAction(action: () => void): void {
  _onAction = action;
}

export const fist: GestureHandler = {
  name: "fist",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const { hands, handConfidences } = frame;
    const now = frame.timestamp;

    let hasFist = false;
    for (let i = 0; i < hands.length; i++) {
      if ((handConfidences[i] ?? 0) < cfg.minConfidence) continue;
      if (isFist(hands[i])) {
        hasFist = true;
        break;
      }
    }

    if (hasFist) {
      // Fist is held — start or continue dwell
      if (fistStart === null) {
        fistStart = now;
        fired = false;
      }

      const elapsed = now - fistStart;
      const confirmed = elapsed >= cfg.fistConfirmMs;

      // Fire once on confirmation, not again until released + re-fisted
      if (confirmed && !fired && now - lastFireTime > cfg.fistCooldownMs) {
        fired = true;
        lastFireTime = now;
        return {
          gesture: "fist",
          data: { holding: true, fired: true, progress: 1 },
        };
      }

      return {
        gesture: "fist",
        data: { holding: true, fired: false, progress: Math.min(1, elapsed / cfg.fistConfirmMs) },
      };
    }

    // Fist released — reset
    fistStart = null;
    fired = false;
    return null;
  },

  apply(detection, viewState, _config): ViewState {
    if (detection.data?.fired) {
      _onAction?.();
    }
    return viewState;
  },

  reset() {
    fistStart = null;
    fired = false;
    lastFireTime = 0;
  },
};
