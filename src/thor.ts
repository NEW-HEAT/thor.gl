/**
 * Thor — framework-agnostic entry point for thor.gl.
 *
 * Wraps the engine and wires up three output channels via the emit/ layer:
 *   1. Navigation: emits standard mjolnir events into deck.eventManager
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
import {
  createNavigationEmitter,
  type NavigationEmitter,
  type EventManagerLike,
} from "./emit/navigation";
import {
  createPickingEmitter,
  type PickingEmitter,
  type DeckLike as PickingDeckLike,
} from "./emit/picking";
import { SignalEmitter, type ThorSignalEvent } from "./emit/signals";

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
 * Duck-typed to the minimal surface Thor needs, so it works
 * with any version of deck.gl that satisfies the shape.
 */
export interface DeckInstance {
  readonly canvas: HTMLCanvasElement;
  readonly eventManager: EventManagerLike;
  pickObject(opts: { x: number; y: number; radius?: number }): any;
  readonly props: Record<string, any>;
}

// ── Thor class ──

export class Thor {
  private deck: DeckInstance;
  private options: ResolvedOptions;
  private engine: EngineHandle | null = null;
  private running = false;

  // The three output channels
  private navigation: NavigationEmitter | null = null;
  private picking: PickingEmitter | null = null;
  private signals: SignalEmitter;

  // State tracking
  private latestFrame: ThorFrame = EMPTY_FRAME;
  private latestViewState: ViewState | null = null;
  private activeGesturesPrev = new Set<string>();

  constructor(deck: DeckInstance, options?: ThorOptions) {
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

    // Wire up the three output channels
    this.navigation = createNavigationEmitter(this.deck.eventManager);
    this.picking = createPickingEmitter(this.deck as PickingDeckLike);

    const engine = createEngine({
      detector: this.options.detector,
      gestures: this.options.gestures,
      onViewStateChange: (updater) => {
        this.handleViewStateChange(updater);
      },
      onViewStateNotify: (vs) => {
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
    this.navigation = null;
    this.picking = null;
    this.latestFrame = EMPTY_FRAME;
    this.latestViewState = null;
    this.activeGesturesPrev.clear();
  }

  /** Whether Thor is currently running */
  get enabled(): boolean {
    return this.running;
  }

  // ── Signal event API ──

  /** Subscribe to a signal event (e.g. 'fist', 'blink', 'gaze:pick') */
  on(event: string, handler: (event: ThorSignalEvent) => void): this {
    this.signals.on(event, handler);
    return this;
  }

  /** Subscribe to a signal event, firing only once */
  once(event: string, handler: (event: ThorSignalEvent) => void): this {
    this.signals.once(event, handler);
    return this;
  }

  /** Unsubscribe from a signal event */
  off(event: string, handler: (event: ThorSignalEvent) => void): this {
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

    // Iris landmarks: left center = 468, right center = 473
    const leftIris = frame.face[468];
    const rightIris = frame.face[473];
    if (!leftIris || !rightIris) return null;

    return {
      x: (leftIris.x + rightIris.x) / 2,
      y: (leftIris.y + rightIris.y) / 2,
      confidence: ((leftIris.visibility ?? 0.5) + (rightIris.visibility ?? 0.5)) / 2,
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
   * If fallbackSetViewState is provided, we use it directly.
   * Otherwise, we figure out which gesture caused the change and
   * emit the corresponding mjolnir event via the navigation emitter.
   */
  private handleViewStateChange(updater: (vs: ViewState) => ViewState): void {
    if (this.options.fallbackSetViewState) {
      this.options.fallbackSetViewState(updater);
      return;
    }

    if (!this.navigation) return;

    const current = this.latestViewState ?? this.getInitialViewState();
    const next = updater(current);
    if (next === current) return;

    this.latestViewState = next;

    // Determine which navigation gestures are active and emit for each
    const canvas = this.deck.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const activeGestures = this.getActiveGestures();

    for (const name of activeGestures) {
      if (!this.navigation.isNavigationGesture(name)) continue;

      const phase = this.activeGesturesPrev.has(name) ? "move" : "start";

      // Build gesture data from the viewState delta
      const data: Record<string, unknown> = {
        centerX: cx,
        centerY: cy,
        deltaX: (next.longitude - current.longitude) * Math.pow(2, next.zoom),
        deltaY: (next.latitude - current.latitude) * Math.pow(2, next.zoom),
        scale: Math.pow(2, next.zoom - current.zoom),
        rotation: (next.bearing ?? 0) - (current.bearing ?? 0),
      };

      this.navigation.emitGesture(name, phase, data);
    }

    // Emit end events for gestures that just stopped
    for (const prevName of this.activeGesturesPrev) {
      if (this.navigation.isNavigationGesture(prevName) && !activeGestures.includes(prevName)) {
        this.navigation.emitGesture(prevName, "end", { centerX: cx, centerY: cy });
      }
    }
  }

  /**
   * Channel 2 & 3: PICKING + SIGNALS
   *
   * On each frame:
   * - Emit signal events for active gestures
   * - Run picking for gaze and hand-point if enabled
   * - Track gesture activation/deactivation
   */
  private handleFrame(frame: ThorFrame): void {
    const activeGestures = this.getActiveGestures();
    const activeSet = new Set(activeGestures);

    // ── Channel 3: SIGNALS ──
    for (const name of activeGestures) {
      if (this.signals.isSignalGesture(name)) {
        this.signals.emit(name, { gesture: name });
      }
    }

    // Emit activation/deactivation signals for all gesture types
    for (const name of activeGestures) {
      if (!this.activeGesturesPrev.has(name)) {
        this.signals.emit("gesture:activate", { gesture: name });
      }
    }
    for (const prev of this.activeGesturesPrev) {
      if (!activeSet.has(prev)) {
        this.signals.emit("gesture:deactivate", { gesture: prev });
      }
    }

    // ── Channel 2: PICKING ──
    if (this.picking) {
      // Gaze picking
      if (this.options.gaze || this.options.face) {
        const gazePos = this.getGaze();
        if (gazePos && gazePos.confidence > 0.3) {
          const canvas = this.deck.canvas;
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            this.picking.emitPicking("gazemove", {
              x: gazePos.x * rect.width,
              y: gazePos.y * rect.height,
            }, { confidence: gazePos.confidence });
          }
        }
      }

      // Hand-point picking (index fingertip = landmark 8)
      if (frame.hands.length > 0) {
        const indexTip = frame.hands[0]?.[8];
        if (indexTip) {
          const canvas = this.deck.canvas;
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            this.picking.emitPicking("handpoint", {
              x: indexTip.x * rect.width,
              y: indexTip.y * rect.height,
            }, { hand: 0 });
          }
        }
      }
    }

    // Emit raw frame for advanced consumers
    this.signals.emit("frame", { frame, activeGestures });

    // Update tracking
    this.activeGesturesPrev = activeSet;
  }

  /** Get initial viewState from deck props for delta computation */
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
