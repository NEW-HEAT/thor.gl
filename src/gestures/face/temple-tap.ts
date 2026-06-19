/**
 * Temple-tap gesture: double tap either temple with the index fingertip.
 *
 * This is intentionally small and local. It uses face-side landmarks as rough
 * temple anchors, then looks for two hand/temple contact edges in quick
 * succession. Consumers decide what "AI voice chat" means for their app.
 */

import type { GestureHandler, GestureDetection, ViewState } from "../types";
import type { ThorFrame, FaceLandmarks } from "../../detection/types";
import { FACE, HAND, distance2d } from "../../detection/landmarks";

const LEFT_TEMPLE = 127;
const RIGHT_TEMPLE = 356;
const DOUBLE_TAP_MS = 700;
const MIN_TAP_GAP_MS = 80;
const COOLDOWN_MS = 1200;

let touching = false;
let lastTapTime = 0;
let lastFireTime = 0;

function faceWidth(face: FaceLandmarks): number {
  const left = face[LEFT_TEMPLE] ?? face[234] ?? face[FACE.MOUTH_LEFT];
  const right = face[RIGHT_TEMPLE] ?? face[454] ?? face[FACE.MOUTH_RIGHT];
  if (!left || !right) return 0.35;
  return Math.max(0.2, distance2d(left, right));
}

function nearestTemple(
  frame: ThorFrame
): { touching: boolean; side: "left" | "right"; distance: number } | null {
  if (!frame.face || frame.hands.length === 0) return null;

  const leftTemple = frame.face[LEFT_TEMPLE] ?? frame.face[234];
  const rightTemple = frame.face[RIGHT_TEMPLE] ?? frame.face[454];
  if (!leftTemple && !rightTemple) return null;

  const width = faceWidth(frame.face);
  const contactThreshold = Math.max(0.045, Math.min(0.095, width * 0.18));
  const releaseThreshold = contactThreshold * 1.5;

  let best:
    | { side: "left" | "right"; distance: number; touching: boolean }
    | null = null;

  for (let i = 0; i < frame.hands.length; i++) {
    const indexTip = frame.hands[i]?.[HAND.INDEX_TIP];
    if (!indexTip) continue;

    if (leftTemple) {
      const distance = distance2d(indexTip, leftTemple);
      if (!best || distance < best.distance) {
        best = { side: "left", distance, touching: distance <= contactThreshold };
      }
    }

    if (rightTemple) {
      const distance = distance2d(indexTip, rightTemple);
      if (!best || distance < best.distance) {
        best = { side: "right", distance, touching: distance <= contactThreshold };
      }
    }
  }

  if (!best) return null;
  return {
    side: best.side,
    distance: best.distance,
    touching: touching ? best.distance <= releaseThreshold : best.touching,
  };
}

export const templeTap: GestureHandler = {
  name: "temple-tap",
  requires: ["hands", "face"],

  detect(frame: ThorFrame): GestureDetection | null {
    const contact = nearestTemple(frame);
    const now = frame.timestamp;

    if (!contact?.touching) {
      touching = false;
      return null;
    }

    if (touching) return null;
    touching = true;

    if (now - lastFireTime < COOLDOWN_MS) return null;

    const gap = now - lastTapTime;
    if (gap >= MIN_TAP_GAP_MS && gap <= DOUBLE_TAP_MS) {
      lastFireTime = now;
      lastTapTime = 0;
      return {
        gesture: "temple-tap",
        data: {
          side: contact.side,
          distance: contact.distance,
          taps: 2,
        },
      };
    }

    lastTapTime = now;
    return null;
  },

  apply(_detection, viewState): ViewState {
    return viewState;
  },

  reset() {
    touching = false;
    lastTapTime = 0;
    lastFireTime = 0;
  },
};
