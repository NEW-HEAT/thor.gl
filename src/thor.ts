/**
 * Thor — framework-agnostic gesture orchestrator.
 *
 * Owns:
 *   - The engine lifecycle (start/stop/detect)
 *   - The three emit channels (navigation, picking, signals)
 *   - The signal pubsub (on/off)
 *
 * Does NOT import @deck.gl-community/editable-layers or any layer-specific code.
 * Layer integration is the caller's responsibility (see demo for the pattern).
 *
 * Usage (imperative, non-React):
 * ```ts
 * const thor = new Thor(deckInstance, { hand: true });
 * await thor.start();
 * thor.on('fist', ({ hand, ts }) => doSomething());
 * // later:
 * thor.destroy();
 * ```
 */

import {createEngine, type EngineConfig, type EngineHandle} from './engine';
import {SignalEmitter, type ThorSignalMap} from './emit/signals';
import type {ViewState} from './gestures/types';
import type {ThorFrame} from './detection/types';
import {getFingergUnLastDetection} from './gestures/hand/fingergun';
import {getFourFingerLastDetection} from './gestures/hand/four-finger';

/** Normalized [0,1] landmark position from MediaPipe. */
interface NormalizedPos {
  x: number;
  y: number;
}

export interface ThorDetectorConfig {
  /** Enable hand tracking. Default true. */
  hand?: boolean;
  /** Enable face tracking. Default false. */
  face?: boolean;
  /** Enable pose tracking. Default false. */
  pose?: boolean;
}

export interface ThorOptions {
  /** Which detector channels to enable. */
  detectors?: ThorDetectorConfig;
  /** Which gesture names to enable (default: all registered). */
  gestures?: string[];
  /**
   * Called when the engine wants to update the viewState.
   * Pass a DeckGL setViewState setter here.
   */
  onViewStateChange?: (updater: (vs: ViewState) => ViewState) => void;
  /** Called each detection frame. */
  onFrame?: (frame: ThorFrame) => void;
  /**
   * The deck.gl canvas element (or a getter that returns it).
   * Required for getCanvasPos() — the projection from normalized MediaPipe
   * landmark space to canvas pixel space used by trigger / fingergun-aim /
   * eraser-move signals. If omitted those signals are silently skipped.
   */
  canvas?: HTMLCanvasElement | (() => HTMLCanvasElement | null);
}

export class Thor {
  private _engine: EngineHandle | null = null;
  private _signals: SignalEmitter<ThorSignalMap>;
  private _options: ThorOptions;
  private _started = false;
  /** Whether the four-finger eraser was active last frame (for eraser-end edge). */
  private _eraserWasActive = false;

  constructor(options: ThorOptions = {}) {
    this._options = options;
    this._signals = new SignalEmitter<ThorSignalMap>();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    const {detectors = {hand: true}, gestures, onViewStateChange, onFrame} = this._options;

    // Determine detector mode
    let detectorMode: EngineConfig['detector'] = 'auto';
    if (detectors.face || detectors.pose) {
      detectorMode = 'holistic';
    } else if (detectors.hand) {
      detectorMode = 'hands';
    }

    const engine = createEngine({
      detector: detectorMode,
      gestures,
      onViewStateChange:
        onViewStateChange ??
        ((_updater) => {
          // no-op if caller doesn't provide viewState wiring
        }),
      onFrame: (frame) => {
        this._dispatchSignals(frame);
        onFrame?.(frame);
      },
    });

    this._engine = engine;
    await engine.start();
  }

  destroy(): void {
    this._started = false;
    this._engine?.stop();
    this._engine = null;
    this._signals.clear();
  }

  // ── Signal pubsub ──────────────────────────────────────────────────────────

  on<K extends keyof ThorSignalMap>(
    signal: K,
    handler: (data: ThorSignalMap[K]) => void
  ): this {
    this._signals.on(signal, handler);
    return this;
  }

  off<K extends keyof ThorSignalMap>(
    signal: K,
    handler: (data: ThorSignalMap[K]) => void
  ): this {
    this._signals.off(signal, handler);
    return this;
  }

  // ── Frame access ───────────────────────────────────────────────────────────

  getFrame(): ThorFrame | null {
    return this._engine?.getLatestFrame() ?? null;
  }

  getGaze(): {x: number; y: number} | null {
    const frame = this.getFrame();
    if (!frame?.face) return null;
    // Approximate gaze from nose tip landmark (index 4 in face mesh)
    const nose = frame.face[4];
    if (!nose) return null;
    return {x: nose.x, y: nose.y};
  }

  getHands(): ThorFrame['hands'] {
    return this.getFrame()?.hands ?? [];
  }

  getEngine(): EngineHandle | null {
    return this._engine;
  }

  // ── Canvas projection ──────────────────────────────────────────────────────

  /**
   * Project a normalized MediaPipe landmark position [0,1] into deck canvas
   * pixel space, accounting for the video mirror transform.
   *
   * MediaPipe outputs coords from the raw (unmirrored) video frame. The camera
   * preview is shown mirrored (ctx.scale(-1,1)), so a hand at screen-left
   * appears on the left side of the canvas even though MediaPipe reports it on
   * the right. We mirror the X axis: canvasX = (1 - landmark.x) * canvasWidth.
   *
   * Returns null if no canvas is configured or the canvas has zero dimensions.
   */
  getCanvasPos(normalized: NormalizedPos): {x: number; y: number} | null {
    const canvas = typeof this._options.canvas === 'function'
      ? this._options.canvas()
      : (this._options.canvas ?? null);
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;
    if (w === 0 || h === 0) return null;

    return {
      x: (1 - normalized.x) * w,
      y: normalized.y * h,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Map active gesture detections to typed signal emissions.
   *
   * Called every detection frame (~30 fps). Handles three categories:
   *
   * 1. Edge gestures (fist, open-palm, blink): emit once on rising edge.
   * 2. Fingergun: continuous `fingergun-aim` each frame + `trigger` on fire edge.
   *    Reads raw detection data from the engine's latest frame so we get the
   *    normalized landmark position and `fired` flag.
   * 3. Four-finger eraser: continuous `eraser-move` each frame + `eraser-end`
   *    on falling edge (pose released).
   *
   * Canvas-space reprojection (getCanvasPos) happens here, not in the gesture
   * handlers — keeps gesture handlers pure, Thor owns the canvas-aware step.
   * If no canvas is configured, fingergun-aim / trigger / eraser-move are
   * silently skipped (no crash).
   */
  private _prevActiveGestures = new Set<string>();

  private _dispatchSignals(frame: ThorFrame): void {
    const engine = this._engine;
    if (!engine) return;

    const active = new Set(engine.getActiveGestureNames());
    const ts = frame.timestamp;

    // Determine dominant hand for signals
    const hand: 'Left' | 'Right' | undefined =
      frame.handedness.length > 0 ? frame.handedness[0] : undefined;

    // ── Edge gestures (rising edge only) ──
    for (const name of active) {
      if (!this._prevActiveGestures.has(name)) {
        this._emitEdgeSignal(name, {hand, ts});
      }
    }

    // ── Fingergun: continuous aim + trigger pull edge ──
    if (active.has('fingergun')) {
      // Find the fingergun detection in the latest active detections.
      // The engine exposes active gesture names but not their raw data, so we
      // pull it from the gesture handler directly via re-running detect().
      // Simpler: the engine already called detect() this frame — we re-read
      // the frame data we have. We walk frame.hands to find the one that is
      // a fingergun and extract the normalizedPos.
      this._handleFingergungFrame(frame, ts, hand);
    }

    // ── Four-finger eraser: continuous + falling edge ──
    if (active.has('four-finger')) {
      this._handleFourFingerFrame(frame, ts, hand);
      this._eraserWasActive = true;
    } else if (this._eraserWasActive) {
      // Falling edge — pose just released
      this._signals.emit('eraser-end', {hand, ts});
      this._eraserWasActive = false;
    }

    this._prevActiveGestures = active;
  }

  private _emitEdgeSignal(
    gestureName: string,
    data: {hand?: 'Left' | 'Right'; ts: number}
  ): void {
    switch (gestureName) {
      case 'fist':
        this._signals.emit('fist', data);
        break;
      case 'open-palm':
        this._signals.emit('openpalm', data);
        break;
      case 'blink':
        this._signals.emit('blink', data);
        break;
      // head-tilt drives nod/headshake — not a simple name map
      default:
        break;
    }
  }

  /** Emit `fingergun-aim` every frame and `trigger` on fire edge. */
  private _handleFingergungFrame(
    _frame: ThorFrame,
    ts: number,
    hand: 'Left' | 'Right' | undefined
  ): void {
    // Read the cached detection from this frame — the engine already called
    // detect() and the result is stored without re-running side effects.
    const detection = getFingergUnLastDetection();
    if (!detection) return;

    const {normalizedPos, fired} = detection.data as {
      normalizedPos: NormalizedPos;
      fired: boolean;
    };

    const screenPos = this.getCanvasPos(normalizedPos);
    if (!screenPos) return;

    // Always emit aim (consumer drives reticle overlay)
    this._signals.emit('fingergun-aim', {screenPos, hand, ts});

    // Emit trigger on fire edge
    if (fired) {
      this._signals.emit('trigger', {screenPos, hand, ts});
    }
  }

  /** Emit `eraser-move` every frame while four-finger is active. */
  private _handleFourFingerFrame(
    _frame: ThorFrame,
    ts: number,
    hand: 'Left' | 'Right' | undefined
  ): void {
    const detection = getFourFingerLastDetection();
    if (!detection) return;

    const {normalizedCenter, normalizedRadius} = detection.data as {
      normalizedCenter: NormalizedPos;
      normalizedRadius: number;
    };

    const center = this.getCanvasPos(normalizedCenter);
    if (!center) return;

    // Scale normalizedRadius from [0,1] frame space to canvas pixels.
    // Use canvas width as the reference dimension (radius is horizontal extent).
    const canvas = typeof this._options.canvas === 'function'
      ? this._options.canvas()
      : (this._options.canvas ?? null);
    const rect = canvas?.getBoundingClientRect();
    const canvasW = (rect?.width || canvas?.width) ?? 0;
    const radius = normalizedRadius * canvasW;

    this._signals.emit('eraser-move', {center, radius, hand, ts});
  }
}
