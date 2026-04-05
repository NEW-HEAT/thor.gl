/**
 * GestureHandler — the core extension interface for thor.gl.
 *
 * Each handler detects one gesture from a ThorFrame and optionally
 * maps it to a ViewState delta and/or renders an overlay.
 */

import type { ThorFrame, BodyPart } from "../detection/types";

/** Deck.gl-compatible ViewState */
export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

/** What a gesture handler detects */
export interface GestureDetection {
  /** Handler name that produced this */
  gesture: string;
  /** Freeform data the handler passes to apply() */
  data: Record<string, unknown>;
}

/** Configuration passed to apply() */
export interface GestureConfig {
  panSensitivity: number;
  zoomSensitivity: number;
  zoomDeadzone: number;
}

/** Registration options */
export interface GestureRegistration {
  /** Higher priority wins within the same group. Default 10. */
  priority?: number;
  /** Conflict group. Handlers in the same group compete; different groups coexist. */
  group?: string;
}

/**
 * GestureHandler — implement this to add a new gesture to thor.gl.
 *
 * Lifecycle per frame:
 *   1. Engine calls detect(frame) — return detection or null
 *   2. Engine resolves conflicts (priority within groups)
 *   3. Engine calls apply(detection, viewState, config) for winners
 *   4. Engine calls render() on ThorWidget canvas for all active handlers
 */
export interface GestureHandler {
  /** Unique name — used for registry lookup and gesture selection */
  name: string;

  /** What landmark data this handler needs. Engine skips if unavailable. */
  requires: BodyPart[];

  /**
   * Detect gesture from a ThorFrame. Called every detection frame (~30fps).
   * Return null if the gesture is not active.
   * Must be pure — no side effects, no state mutation outside the handler.
   */
  detect(frame: ThorFrame): GestureDetection | null;

  /**
   * Apply detected gesture to viewState. Pure function.
   * Return the new viewState (or the same reference if no change).
   */
  apply(
    detection: GestureDetection,
    viewState: ViewState,
    config: GestureConfig
  ): ViewState;

  /**
   * Optional: render overlay graphics for this gesture.
   * Called on the ThorWidget canvas each frame when the handler has data.
   * The canvas is CSS-mirrored (scaleX -1), so text rendering must counter-flip.
   */
  render?(
    ctx: CanvasRenderingContext2D,
    frame: ThorFrame,
    vw: number,
    vh: number
  ): void;

  /**
   * Optional: called when the gesture activates (was not active, now is).
   * Useful for side effects like haptic feedback, sound, UI state changes.
   */
  onActivate?(): void;

  /**
   * Optional: called when the gesture deactivates (was active, now isn't).
   */
  onDeactivate?(): void;

  /**
   * Optional: reset internal state. Called when the handler is disabled
   * or the detector mode changes.
   */
  reset?(): void;
}
