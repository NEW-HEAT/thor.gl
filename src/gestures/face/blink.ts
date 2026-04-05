/**
 * Blink gesture: deliberate eye blink → click/action trigger.
 *
 * Uses face blendshapes (eyeBlinkLeft/Right) to detect intentional blinks.
 * Filters out natural blinks by requiring both eyes to blink together
 * for a minimum duration, with a cooldown to prevent rapid-fire.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";

const BLINK_THRESHOLD = 0.6; // blendshape score to count as "closed"
const MIN_BLINK_MS = 150;    // must be closed this long (filters natural blinks ~100ms)
const MAX_BLINK_MS = 800;    // too long = just closing eyes, not a blink
const COOLDOWN_MS = 1000;    // prevent rapid-fire

let blinkStart: number | null = null;
let lastBlinkTime = 0;

function getBlinkScore(blendshapes: import("../../detection/types").Blendshapes): {
  left: number;
  right: number;
} {
  let left = 0;
  let right = 0;
  for (const cat of blendshapes.categories) {
    if (cat.categoryName === "eyeBlinkLeft") left = cat.score;
    if (cat.categoryName === "eyeBlinkRight") right = cat.score;
  }
  return { left, right };
}

export const blink: GestureHandler = {
  name: "blink",
  requires: ["face"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.blendshapes) return null;

    const now = frame.timestamp;
    const { left, right } = getBlinkScore(frame.blendshapes);
    const bothClosed = left > BLINK_THRESHOLD && right > BLINK_THRESHOLD;

    if (bothClosed) {
      if (blinkStart === null) blinkStart = now;
      return null; // still blinking, don't fire yet
    }

    // Eyes just opened — check if it was an intentional blink
    if (blinkStart !== null) {
      const duration = now - blinkStart;
      blinkStart = null;

      if (
        duration >= MIN_BLINK_MS &&
        duration <= MAX_BLINK_MS &&
        now - lastBlinkTime > COOLDOWN_MS
      ) {
        lastBlinkTime = now;
        return {
          gesture: "blink",
          data: { duration },
        };
      }
    }

    return null;
  },

  apply(_detection, viewState, _config): ViewState {
    // Blink doesn't change viewState — it's an action trigger
    // Consumers can use onActivate or listen for the gesture
    return viewState;
  },

  onActivate() {
    console.log("[thor.gl] Blink detected!");
  },

  reset() {
    blinkStart = null;
    lastBlinkTime = 0;
  },
};
