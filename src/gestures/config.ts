/**
 * Shared gesture configuration — single source of truth for all tunable params.
 *
 * useThor sets overrides on mount. Gesture handlers read from `gestureConfig`.
 * All values have sensible defaults.
 */

export interface ThorGestureConfig {
  // Global
  minConfidence: number;
  grabDelay: number;
  pinchThreshold: number;

  // Pan
  panSensitivity: number;
  panSmoothing: number;
  panMoveDeadzone: number;
  /** Release momentum duration in milliseconds, capped at 600; 0 disables inertia. */
  inertiaDuration: number;

  // Zoom
  /** Multiplier of log2(hand span ratio). */
  zoomSensitivity: number;
  /** Slack in log2 scale units. */
  zoomDeadzone: number;

  // Rotate
  rotateSensitivity: number;
  rotateDeadzone: number;

  // Pitch
  pitchSensitivity: number;
  pitchDeadzone: number;

  // Fist
  fistConfirmMs: number;
  fistCooldownMs: number;
}

export const gestureConfig: ThorGestureConfig = {
  minConfidence: 0.5,
  grabDelay: 100,
  pinchThreshold: 0.06,

  panSensitivity: 1.6,
  panSmoothing: 0.4,
  panMoveDeadzone: 0.004,
  inertiaDuration: 280,

  // Multiplier of log2(hand span ratio): 1 means doubling span doubles scale.
  zoomSensitivity: 1,
  zoomDeadzone: 0.008,

  rotateSensitivity: 40,
  rotateDeadzone: 0.015,

  pitchSensitivity: 80,
  pitchDeadzone: 0.008,

  fistConfirmMs: 300,
  fistCooldownMs: 1500,
};

/** Apply overrides to the shared config. */
export function setGestureConfig(overrides: Partial<ThorGestureConfig>): void {
  Object.assign(gestureConfig, overrides);
}
