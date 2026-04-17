/**
 * Four-finger eraser gesture — continuous "erase region" state.
 *
 * Pose: index + middle + ring + pinky all extended, thumb tucked across the
 * palm. "Four-finger salute." Looks like a flat hand with thumb retracted.
 *
 * Semantics:
 *   - Continuous detection — emits every frame the pose is held.
 *   - No edge event on activation; consumers react per-frame.
 *   - `data.normalizedCenter` is the palm center in MediaPipe [0,1] space
 *     (average of the four finger MCPs). Thor reprojects to canvas pixels.
 *   - `data.normalizedRadius` is the palm half-width in normalized units
 *     (wrist-to-middle-MCP distance, scaled up). Thor scales to canvas pixels.
 *
 * Signal contract (emitted by Thor, not directly here):
 *   eraser-move — continuous event, canvas-space center + radius
 *   eraser-end  — edge event when pose deactivates
 *
 * This handler is a pure signal gesture — apply() is a no-op.
 */

import type {GestureHandler, GestureDetection, ViewState} from '../types';
import type {ThorFrame} from '../../detection/types';
import {HAND, distance} from '../../detection/landmarks';
import {gestureConfig as cfg} from '../config';

/**
 * Last detection result cached so Thor._dispatchSignals can read it without
 * re-calling detect() (which could produce different results if called twice).
 */
let _lastDetection: GestureDetection | null = null;

/** Get the detection result from the most recent detect() call. */
export function getFourFingerLastDetection(): GestureDetection | null {
  return _lastDetection;
}

/** Four fingers (index/middle/ring/pinky) extended, thumb tucked. */
function isFourFinger(lm: import('../../detection/types').HandLandmarks): boolean {
  if (!lm || lm.length < 21) return false;

  const wrist = lm[HAND.WRIST];
  if (!wrist) return false;

  // All four non-thumb fingers must be extended
  const tips = [lm[HAND.INDEX_TIP], lm[HAND.MIDDLE_TIP], lm[HAND.RING_TIP], lm[HAND.PINKY_TIP]];
  const mcps = [lm[HAND.INDEX_MCP], lm[HAND.MIDDLE_MCP], lm[HAND.RING_MCP], lm[HAND.PINKY_MCP]];

  for (let i = 0; i < 4; i++) {
    const tip = tips[i];
    const mcp = mcps[i];
    if (!tip || !mcp) return false;
    // Each tip must be farther from wrist than its MCP
    if (distance(tip, wrist) < distance(mcp, wrist) * 1.1) return false;
  }

  // Thumb must be tucked: tip close to index MCP (or wrist region)
  const thumbTip = lm[HAND.THUMB_TIP];
  const indexMcp = lm[HAND.INDEX_MCP];
  if (!thumbTip || !indexMcp) return false;
  if (distance(thumbTip, indexMcp) > 0.15) return false;

  return true;
}

export const fourFinger: GestureHandler = {
  name: 'four-finger',
  requires: ['hands'],

  detect(frame: ThorFrame): GestureDetection | null {
    const {hands, handConfidences} = frame;

    for (let i = 0; i < hands.length; i++) {
      if ((handConfidences[i] ?? 0) < cfg.minConfidence) continue;
      const lm = hands[i];
      if (!isFourFinger(lm)) continue;

      // Palm center = average of the four MCPs
      const mcps = [lm[HAND.INDEX_MCP], lm[HAND.MIDDLE_MCP], lm[HAND.RING_MCP], lm[HAND.PINKY_MCP]];
      const cx = mcps.reduce((s, p) => s + (p?.x ?? 0), 0) / 4;
      const cy = mcps.reduce((s, p) => s + (p?.y ?? 0), 0) / 4;

      // Palm radius: wrist-to-middle-MCP distance, scaled up slightly for the eraser region
      const wrist = lm[HAND.WRIST];
      const midMcp = lm[HAND.MIDDLE_MCP];
      const normalizedRadius = wrist && midMcp ? distance(wrist, midMcp) * 1.2 : 0.08;

      const result: GestureDetection = {
        gesture: 'four-finger',
        data: {
          active: true,
          // Normalized [0,1] MediaPipe palm center.
          // Thor reprojects to canvas pixels accounting for mirror.
          normalizedCenter: {x: cx, y: cy},
          // Normalized palm half-size.
          // Thor scales to canvas pixels.
          normalizedRadius,
          hand: frame.handedness[i] ?? undefined,
        },
      };
      _lastDetection = result;
      return result;
    }

    _lastDetection = null;
    return null;
  },

  apply(_detection, viewState: ViewState): ViewState {
    // Signal gesture only — no viewState change.
    return viewState;
  },

  reset() {
    _lastDetection = null;
  },
};
