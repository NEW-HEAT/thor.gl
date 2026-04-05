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

  // Zoom
  zoomSensitivity: number;
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

  panSensitivity: 5.0,
  panSmoothing: 0.4,
  panMoveDeadzone: 0.004,

  zoomSensitivity: 10,
  zoomDeadzone: 0.015,

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
