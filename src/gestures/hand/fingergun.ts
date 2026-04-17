/**
 * Fingergun gesture — continuous aim state + trigger-pull edge event.
 *
 * Pose: index finger extended forward, thumb extended UP (perpendicular
 * to index), middle/ring/pinky curled. Classic "finger gun" hand shape.
 *
 * Semantics:
 *   - While the pose is held, emits continuously with `{aiming: true, fired: false}`
 *     so consumers can track the aim position each frame.
 *   - Trigger pull: thumb drops from extended to curled while index remains
 *     extended. Rising edge only — fires ONCE per pull. Thumb must return to
 *     extended before the next fire is possible. Cooldown ~200 ms prevents
 *     double-taps.
 *   - `data.normalizedPos` carries the index fingertip in MediaPipe [0,1]
 *     normalized space. Thor._dispatchSignals reprojects to canvas pixels via
 *     getCanvasPos() before emitting the `trigger` / `fingergun-aim` signals.
 *
 * Signal contract (emitted by Thor, not directly here):
 *   trigger       — edge event, fires once per trigger pull
 *   fingergun-aim — continuous event each frame while aiming
 *
 * This handler is a pure signal gesture — apply() is a no-op.
 */

import type {GestureHandler, GestureDetection, ViewState} from '../types';
import type {ThorFrame} from '../../detection/types';
import {HAND, distance} from '../../detection/landmarks';
import {gestureConfig as cfg} from '../config';

/** Internal mutable state — module-level singleton, reset via reset(). */
let thumbWasExtended = false;
let triggerArmed = false;       // thumb came back up after a fire, ready to fire again
let lastFireTime = 0;

/**
 * Last detection result cached so Thor._dispatchSignals can read it without
 * re-calling detect() (which has side effects on thumb-tracking state).
 */
let _lastDetection: GestureDetection | null = null;

/** Get the detection result from the most recent detect() call. */
export function getFingergUnLastDetection(): GestureDetection | null {
  return _lastDetection;
}

const TRIGGER_COOLDOWN_MS = 200;

/** Index tip extended, middle/ring/pinky curled toward palm. */
function isIndexExtended(lm: import('../../detection/types').HandLandmarks): boolean {
  const wrist = lm[HAND.WRIST];
  const indexTip = lm[HAND.INDEX_TIP];
  const indexMcp = lm[HAND.INDEX_MCP];
  if (!wrist || !indexTip || !indexMcp) return false;
  // Index tip must be farther from wrist than its MCP by a clear margin
  return distance(indexTip, wrist) > distance(indexMcp, wrist) * 1.25;
}

function isThumbUp(lm: import('../../detection/types').HandLandmarks): boolean {
  const wrist = lm[HAND.WRIST];
  const thumbTip = lm[HAND.THUMB_TIP];
  const thumbMcp = lm[HAND.THUMB_MCP];
  if (!wrist || !thumbTip || !thumbMcp) return false;
  return distance(thumbTip, wrist) > distance(thumbMcp, wrist) * 1.1;
}

/** Middle, ring, and pinky all curled (fingertips close to wrist). */
function areCurlingFingersCurled(lm: import('../../detection/types').HandLandmarks): boolean {
  const wrist = lm[HAND.WRIST];
  if (!wrist) return false;

  const tips = [lm[HAND.MIDDLE_TIP], lm[HAND.RING_TIP], lm[HAND.PINKY_TIP]];
  const mcps = [lm[HAND.MIDDLE_MCP], lm[HAND.RING_MCP], lm[HAND.PINKY_MCP]];

  for (let i = 0; i < 3; i++) {
    const tip = tips[i];
    const mcp = mcps[i];
    if (!tip || !mcp) return false;
    // Tip must be CLOSER to wrist than MCP (curled inward)
    if (distance(tip, wrist) > distance(mcp, wrist) * 1.05) return false;
  }
  return true;
}

/** Full fingergun shape: index + thumb up, other three curled. */
function isFingergun(lm: import('../../detection/types').HandLandmarks): boolean {
  if (!lm || lm.length < 21) return false;
  return isIndexExtended(lm) && isThumbUp(lm) && areCurlingFingersCurled(lm);
}

export const fingergun: GestureHandler = {
  name: 'fingergun',
  requires: ['hands'],

  detect(frame: ThorFrame): GestureDetection | null {
    const {hands, handConfidences} = frame;
    const now = frame.timestamp;

    for (let i = 0; i < hands.length; i++) {
      if ((handConfidences[i] ?? 0) < cfg.minConfidence) continue;
      const lm = hands[i];
      if (!isFingergun(lm)) continue;

      // Hand is in fingergun pose.
      const indexTip = lm[HAND.INDEX_TIP];
      if (!indexTip) continue;

      const thumbUp = isThumbUp(lm);

      // Arm on first frame where thumb is up (startup or after no-fingergun gap)
      if (thumbUp && !thumbWasExtended) {
        triggerArmed = true;
      }

      // Fire on the frame where thumb drops while index stays extended
      let fired = false;
      if (thumbWasExtended && !thumbUp && triggerArmed) {
        const elapsed = now - lastFireTime;
        if (elapsed > TRIGGER_COOLDOWN_MS) {
          fired = true;
          lastFireTime = now;
          triggerArmed = false;  // disarmed until thumb comes back up
        }
      }

      // Re-arm when thumb returns after a fire
      if (!triggerArmed && thumbUp) {
        triggerArmed = true;
      }

      thumbWasExtended = thumbUp;

      const result: GestureDetection = {
        gesture: 'fingergun',
        data: {
          aiming: true,
          fired,
          // Normalized [0,1] MediaPipe coords of the index fingertip.
          // Thor reprojects to canvas pixels (accounting for mirror) before emitting.
          normalizedPos: {x: indexTip.x, y: indexTip.y},
          hand: frame.handedness[i] ?? undefined,
        },
      };
      _lastDetection = result;
      return result;
    }

    // No fingergun detected this frame — reset thumb tracking
    thumbWasExtended = false;
    _lastDetection = null;
    return null;
  },

  apply(_detection, viewState: ViewState): ViewState {
    // Signal gesture only — no viewState change.
    return viewState;
  },

  reset() {
    thumbWasExtended = false;
    triggerArmed = false;
    lastFireTime = 0;
    _lastDetection = null;
  },
};
