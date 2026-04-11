/**
 * Thor — framework-agnostic entry point for thor.gl.
 *
 * Wraps the engine and wires up three output channels:
 *   1. Navigation: emits synthetic mjolnir events into deck.eventManager
 *   2. Picking: calls deck.pickObject() for interaction gestures
 *   3. Signals: fires callbacks for discrete gestures (blink, fist, etc.)
 *
 * Usage:
 * ```ts
 * const thor = new Thor(deck, { hand: true, face: true });
 * thor.on('fist', (e) => console.log('fist detected'));
 * await thor.start();
 * // ...later
 * thor.destroy();
 * ```
 */

import type { ThorFrame, DetectorMode, HandLandmarks } from "./detection/types";
import { EMPTY_FRAME } from "./detection/types";
import type { ViewState } from "./gestures/types";
import type { ThorGestureConfig } from "./gestures/config";
import { setGestureConfig } from "./gestures/config";
import { createEngine, type EngineHandle } from "./engine";

// ── Types ──

/** Configuration for the Thor instance */
export interface ThorOptions {
  /** Enable hand tracking. Default: true */
  hand?: boolean;
  /** Enable face tracking (iris, blendshapes). Default: false */
  face?: boolean;
  /** Enable gaze/eye tracking (requires face). Default: false */
  gaze?: boolean;
  /** Enable pose tracking. Default: false */
  pose?: boolean;
  /** MediaPipe detector mode. Default: "auto" */
  detector?: DetectorMode;
  /** Specific gestures to enable. Default: all registered */
  gestures?: string[];
  /** Gesture tuning overrides */
  config?: Partial<ThorGestureConfig>;
  /**
   * Fallback: directly set viewState instead of emitting mjolnir events.
   * Use this when EventManager injection isn't available or isn't working.
   * When provided, navigation bypasses event emission and calls this directly.
   */
  fallbackSetViewState?: (updater: (vs: ViewState) => ViewState) => void;
}

/** Resolved options with defaults applied */
interface ResolvedOptions {
  hand: boolean;
  face: boolean;
  gaze: boolean;
  pose: boolean;
  detector: DetectorMode;
  gestures: string[] | undefined;
  config: Partial<ThorGestureConfig> | undefined;
  fallbackSetViewState: ((updater: (vs: ViewState) => ViewState) => void) | undefined;
}

/**
 * Minimal deck.gl Deck interface.
 *
 * We only require the parts of Deck that Thor actually uses, so this works
 * with any version of deck.gl that satisfies the shape.
 */
interface DeckLike {
  /** The deck's canvas element (used for coordinate mapping) */
  readonly canvas: HTMLCanvasElement;
  /**
   * The mjolnir EventManager — we emit synthetic navigation events here.
   * Typed as `any` because we access internal APIs until mjolnir provides
   * a public emit() method.
   */
  readonly eventManager: any;
  /** Public picking API */
  pickObject(opts: { x: number; y: number; radius?: number }): any;
  /** Current props (for firing deck-level callbacks) */
  readonly props: Record<string, any>;
}

// ── Signal Emitter (lightweight built-in EventEmitter) ──

type SignalHandler = (event: any) => void;

class SignalEmitter {
  private handlers = new Map<string, Set<SignalHandler>>();
  private onceWrappers = new WeakMap<SignalHandler, SignalHandler>();

  on(event: string, handler: SignalHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  once(event: string, handler: SignalHandler): void {
    const wrapper: SignalHandler = (e) => {
      this.off(event, wrapper);
      handler(e);
    };
    this.onceWrappers.set(handler, wrapper);
    this.on(event, wrapper);
  }

  off(event: string, handler: SignalHandler): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Try removing the handler directly, then try removing its once-wrapper
    if (!set.delete(handler)) {
      const wrapper = this.onceWrappers.get(handler);
      if (wrapper) {
        set.delete(wrapper);
        this.onceWrappers.delete(handler);
      }
    }
    if (set.size === 0) this.handlers.delete(event);
  }

  emit(event: string, data: any): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[thor.gl] Signal handler error for "${event}":`, err);
      }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}

// ── Navigation helpers ──

/** Gestures whose group is "signal" or "action" — these produce signals, not navigation */
const SIGNAL_GROUPS = new Set(["signal", "action"]);

/**
 * Create a synthetic WheelEvent-like object for zoom injection.
 * deck.gl's ViewStateController listens for 'wheel' events via mjolnir.
 */
function syntheticWheelEvent(
  canvas: HTMLCanvasElement,
  deltaY: number,
  center: { x: number; y: number }
): WheelEvent {
  const rect = canvas.getBoundingClientRect();
  return new WheelEvent("wheel", {
    deltaY,
    clientX: rect.left + center.x,
    clientY: rect.top + center.y,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * Create a synthetic PointerEvent for pan injection.
 * We emit pointermove to simulate drag-panning through the EventManager.
 */
function syntheticPointerEvent(
  type: string,
  canvas: HTMLCanvasElement,
  position: { x: number; y: number },
  extra: Record<string, any> = {}
): PointerEvent {
  const rect = canvas.getBoundingClientRect();
  return new PointerEvent(type, {
    clientX: rect.left + position.x,
    clientY: rect.top + position.y,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    ...extra,
  });
}

// ── Thor class ──

export class Thor {
  private deck: DeckLike;
  private options: ResolvedOptions;
  private engine: EngineHandle | null = null;
  private signals: SignalEmitter;
  private running = false;
  private latestFrame: ThorFrame = EMPTY_FRAME;
  private latestViewState: ViewState | null = null;
  private previousViewState: ViewState | null = null;

  constructor(deck: DeckLike, options?: ThorOptions) {
    this.deck = deck;
    this.options = {
      hand: options?.hand ?? true,
      face: options?.face ?? false,
      gaze: options?.gaze ?? false,
      pose: options?.pose ?? false,
      detector: options?.detector ?? "auto",
      gestures: options?.gestures,
      config: options?.config,
      fallbackSetViewState: options?.fallbackSetViewState,
    };
    this.signals = new SignalEmitter();
  }

  // ── Lifecycle ──

  /** Start detection and event emission */
  async start(): Promise<void> {
    if (this.running) return;

    // Apply config overrides
    if (this.options.config) {
      setGestureConfig(this.options.config);
    }

    const engine = createEngine({
      detector: this.options.detector,
      gestures: this.options.gestures,
      onViewStateChange: (updater) => {
        this.handleViewStateChange(updater);
      },
      onViewStateNotify: (vs) => {
        this.previousViewState = this.latestViewState;
        this.latestViewState = vs;
      },
      onFrame: (frame) => {
        this.latestFrame = frame;
        this.handleFrame(frame);
      },
    });

    this.engine = engine;
    this.running = true;

    try {
      await engine.start();
    } catch (err) {
      this.running = false;
      this.engine = null;
      throw err;
    }
  }

  /** Stop detection and clean up */
  stop(): void {
    if (!this.running) return;
    this.engine?.stop();
    this.engine = null;
    this.running = false;
    this.latestFrame = EMPTY_FRAME;
    this.latestViewState = null;
    this.previousViewState = null;
  }

  /** Whether Thor is currently running */
  get enabled(): boolean {
    return this.running;
  }

  // ── Signal event API ──

  /** Subscribe to a signal event (e.g. 'fist', 'blink', 'open-palm') */
  on(event: string, handler: (event: any) => void): this {
    this.signals.on(event, handler);
    return this;
  }

  /** Subscribe to a signal event, firing only once */
  once(event: string, handler: (event: any) => void): this {
    this.signals.once(event, handler);
    return this;
  }

  /** Unsubscribe from a signal event */
  off(event: string, handler: (event: any) => void): this {
    this.signals.off(event, handler);
    return this;
  }

  // ── Continuous state accessors ──

  /** Get the latest detection frame */
  getFrame(): ThorFrame {
    return this.latestFrame;
  }

  /** Get the current gaze position in normalized coordinates (0-1) */
  getGaze(): { x: number; y: number; confidence: number } | null {
    const frame = this.latestFrame;
    if (!frame.face) return null;

    // Iris landmarks are at indices 468-477 in the face mesh.
    // Left iris center: 468, Right iris center: 473
    const leftIris = frame.face[468];
    const rightIris = frame.face[473];

    if (!leftIris || !rightIris) return null;

    return {
      x: (leftIris.x + rightIris.x) / 2,
      y: (leftIris.y + rightIris.y) / 2,
      confidence: (leftIris.visibility ?? 0.5 + (rightIris.visibility ?? 0.5)) / 2,
    };
  }

  /** Get the current hand landmarks */
  getHands(): HandLandmarks[] {
    return this.latestFrame.hands;
  }

  /** Get the names of currently active gestures */
  getActiveGestures(): string[] {
    return this.engine?.getActiveGestureNames() ?? [];
  }

  /** Clean up all resources */
  destroy(): void {
    this.stop();
    this.signals.removeAllListeners();
  }

  // ── Internal: Output channel routing ──

  /**
   * Channel 1: NAVIGATION
   *
   * The engine reports viewState changes via onViewStateChange(updater).
   * We intercept the updater, compute a delta, and emit synthetic events
   * into deck.eventManager so deck.gl's built-in ViewStateController
   * processes them like normal user input.
   *
   * Fallback: if fallbackSetViewState is provided, we skip event emission
   * and call the setter directly (backward-compatible with useThor pattern).
   */
  private handleViewStateChange(updater: (vs: ViewState) => ViewState): void {
    // If we have a fallback, use it directly — no event emission needed
    if (this.options.fallbackSetViewState) {
      this.options.fallbackSetViewState(updater);
      return;
    }

    // Compute the viewState delta by applying the updater to our tracked state
    const current = this.latestViewState ?? this.getInitialViewState();
    const next = updater(current);
    if (next === current) return;

    // Track the new state
    this.previousViewState = current;
    this.latestViewState = next;

    // Emit synthetic events based on what changed
    this.emitNavigationEvents(current, next);
  }

  /**
   * Emit synthetic DOM events into the deck's EventManager based on
   * the viewState delta. This is the core navigation integration.
   *
   * TODO: Once mjolnir.js provides a public emit() API, switch to that
   * instead of dispatching DOM events on the canvas. The current approach
   * works because EventManager listens on the canvas element.
   */
  private emitNavigationEvents(prev: ViewState, next: ViewState): void {
    const canvas = this.deck.canvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const center = { x: centerX, y: centerY };

    // Zoom changed — emit wheel event
    const zoomDelta = next.zoom - prev.zoom;
    if (Math.abs(zoomDelta) > 0.001) {
      // WheelEvent deltaY: negative = zoom in, positive = zoom out
      // deck.gl convention: zoom increase = zoom in
      const wheelDelta = -zoomDelta * 100;
      const wheelEvent = syntheticWheelEvent(canvas, wheelDelta, center);
      canvas.dispatchEvent(wheelEvent);
    }

    // Pan changed (longitude/latitude) — emit pointer events to simulate drag
    const lonDelta = next.longitude - prev.longitude;
    const latDelta = next.latitude - prev.latitude;
    if (Math.abs(lonDelta) > 0.0001 || Math.abs(latDelta) > 0.0001) {
      // Convert geo deltas to approximate pixel movement
      // This is rough — the actual px/deg ratio depends on zoom level
      const scale = Math.pow(2, next.zoom);
      const pxPerDeg = (256 * scale) / 360;
      const dx = -lonDelta * pxPerDeg;
      const dy = latDelta * pxPerDeg;

      // Simulate a pointer drag: down → move → up
      const startX = centerX;
      const startY = centerY;
      const endX = startX + dx;
      const endY = startY + dy;

      canvas.dispatchEvent(
        syntheticPointerEvent("pointerdown", canvas, { x: startX, y: startY }, {
          button: 0,
          buttons: 1,
        })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointermove", canvas, { x: endX, y: endY }, {
          buttons: 1,
        })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointerup", canvas, { x: endX, y: endY })
      );
    }

    // Bearing changed — emit pointer events with right button (rotate)
    const bearingDelta = (next.bearing ?? 0) - (prev.bearing ?? 0);
    if (Math.abs(bearingDelta) > 0.01) {
      const dx = bearingDelta * 2; // px per degree of bearing
      canvas.dispatchEvent(
        syntheticPointerEvent("pointerdown", canvas, center, {
          button: 2,
          buttons: 2,
        })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointermove", canvas, {
          x: centerX + dx,
          y: centerY,
        }, { buttons: 2 })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointerup", canvas, {
          x: centerX + dx,
          y: centerY,
        })
      );
    }

    // Pitch changed — emit pointer events with ctrl+right or middle button
    const pitchDelta = (next.pitch ?? 0) - (prev.pitch ?? 0);
    if (Math.abs(pitchDelta) > 0.01) {
      const dy = -pitchDelta * 2; // px per degree of pitch
      canvas.dispatchEvent(
        syntheticPointerEvent("pointerdown", canvas, center, {
          button: 1,
          buttons: 4,
        })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointermove", canvas, {
          x: centerX,
          y: centerY + dy,
        }, { buttons: 4 })
      );
      canvas.dispatchEvent(
        syntheticPointerEvent("pointerup", canvas, {
          x: centerX,
          y: centerY + dy,
        })
      );
    }
  }

  /**
   * Channel 2 & 3: PICKING + SIGNALS
   *
   * On each frame, check for:
   * - Interaction gestures (gaze, hand-point) → call deck.pickObject()
   * - Signal gestures (fist, blink, open-palm) → emit via this.signals
   */
  private handleFrame(frame: ThorFrame): void {
    const activeGestures = this.getActiveGestures();

    // ── Channel 3: SIGNALS ──
    // Emit signal events for discrete gesture activations
    for (const gestureName of activeGestures) {
      // Emit every active gesture as a signal — consumers can filter
      this.signals.emit(gestureName, {
        gesture: gestureName,
        frame,
        timestamp: frame.timestamp,
      });
    }

    // ── Channel 2: PICKING ──
    // For gaze-based picking
    if (this.options.gaze || this.options.face) {
      const gazePos = this.getGaze();
      if (gazePos && gazePos.confidence > 0.3) {
        const canvas = this.deck.canvas;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = gazePos.x * rect.width;
          const y = gazePos.y * rect.height;

          try {
            const picked = this.deck.pickObject({ x, y, radius: 10 });
            if (picked) {
              this.signals.emit("gaze:pick", {
                gesture: "gaze",
                object: picked,
                x,
                y,
                frame,
                timestamp: frame.timestamp,
              });

              // Fire onGazePick callback on deck props if defined
              if (typeof this.deck.props.onGazePick === "function") {
                this.deck.props.onGazePick(picked);
              }
            }
          } catch {
            // pickObject may throw if deck is not ready — ignore
          }
        }
      }
    }

    // For hand-based picking (index finger tip)
    if (frame.hands.length > 0) {
      const primaryHand = frame.hands[0];
      // Index fingertip is landmark 8
      const indexTip = primaryHand?.[8];
      if (indexTip) {
        const canvas = this.deck.canvas;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = indexTip.x * rect.width;
          const y = indexTip.y * rect.height;

          try {
            const picked = this.deck.pickObject({ x, y, radius: 5 });
            if (picked) {
              this.signals.emit("hand:pick", {
                gesture: "hand-point",
                object: picked,
                x,
                y,
                hand: 0,
                frame,
                timestamp: frame.timestamp,
              });

              // Fire onHandPick callback on deck props if defined
              if (typeof this.deck.props.onHandPick === "function") {
                this.deck.props.onHandPick(picked);
              }
            }
          } catch {
            // pickObject may throw if deck is not ready — ignore
          }
        }
      }
    }

    // Emit a generic frame event for consumers who want raw frame data
    this.signals.emit("frame", {
      frame,
      activeGestures,
      timestamp: frame.timestamp,
    });
  }

  /**
   * Get a reasonable initial viewState from deck props.
   * This is used as the starting point for delta computation
   * before the first onViewStateNotify fires.
   */
  private getInitialViewState(): ViewState {
    const props = this.deck.props;
    const vs = props.viewState ?? props.initialViewState ?? {};
    return {
      longitude: vs.longitude ?? 0,
      latitude: vs.latitude ?? 0,
      zoom: vs.zoom ?? 1,
      pitch: vs.pitch ?? 0,
      bearing: vs.bearing ?? 0,
    };
  }
}
