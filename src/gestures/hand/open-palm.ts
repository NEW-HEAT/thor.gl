/**
 * Open-Palm gesture: open palm → reset/stop gesture.
 *
 * Detects when all fingers are extended (no pinch, no fist).
 * Uses this as a "stop" signal — kills inertia, resets gesture state.
 * No viewState change — just a signal for the engine.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { HAND, distance } from "../../detection/landmarks";

/** Check if all fingers are extended (rough heuristic). */
function isOpenPalm(landmarks: import("../../detection/types").HandLandmarks): boolean {
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

  // Each fingertip should be farther from wrist than its MCP
  for (let i = 0; i < 4; i++) {
    if (distance(tips[i], wrist) < distance(mcps[i], wrist) * 1.1) {
      return false;
    }
  }

  // Thumb tip should also be extended
  const thumbTip = landmarks[HAND.THUMB_TIP];
  const thumbMcp = landmarks[HAND.THUMB_MCP];
  if (distance(thumbTip, wrist) < distance(thumbMcp, wrist)) {
    return false;
  }

  // Fingers should be spread (not pinching)
  const indexTip = landmarks[HAND.INDEX_TIP];
  const thumbDist = distance(thumbTip, indexTip);
  if (thumbDist < 0.08) return false; // too close = pinch

  return true;
}

export const openPalm: GestureHandler = {
  name: "open-palm",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    for (const hand of frame.hands) {
      if (isOpenPalm(hand)) {
        return { gesture: "open-palm", data: {} };
      }
    }
    return null;
  },

  apply(_detection, viewState, _config): ViewState {
    // No viewState change — open palm is a "stop" signal
    return viewState;
  },
};
