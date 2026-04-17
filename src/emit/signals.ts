/**
 * SignalEmitter — typed pubsub for discrete gesture signals.
 *
 * Usage:
 *   const emitter = new SignalEmitter<ThorSignalMap>();
 *   emitter.on('blink', ({ eye, ts }) => { ... });
 *   emitter.emit('blink', { eye: 'left', ts: Date.now() });
 */

/** Base payload shared by all hand-gesture signals. */
export interface HandSignalData {
  hand?: 'Left' | 'Right';
  ts: number;
}

/** Per-signal payload map. Extend here as new signals are added. */
export interface ThorSignalMap {
  blink: HandSignalData & {eye?: 'left' | 'right'};
  nod: HandSignalData;
  headshake: HandSignalData;
  fist: HandSignalData;
  openpalm: HandSignalData;
  wave: HandSignalData;
  thumbsup: HandSignalData;
  fingergun: HandSignalData & {pointing?: 'left' | 'right'};

  /**
   * Fired once per trigger pull (thumb-drop while index-extended).
   * screenPos is in deck canvas pixel space (mirror-corrected).
   * Emitted by Thor._dispatchSignals after getCanvasPos() projection.
   */
  trigger: HandSignalData & {screenPos: {x: number; y: number}};

  /**
   * Emitted every detection frame while the fingergun pose is held.
   * Used to drive the aim-reticle overlay in the demo.
   * screenPos is in deck canvas pixel space (mirror-corrected).
   */
  'fingergun-aim': HandSignalData & {screenPos: {x: number; y: number}};

  /**
   * Emitted every detection frame while the four-finger eraser is held.
   * center and radius are in deck canvas pixel space (mirror-corrected).
   */
  'eraser-move': HandSignalData & {center: {x: number; y: number}; radius: number};

  /**
   * Fired once when the four-finger eraser pose deactivates.
   */
  'eraser-end': HandSignalData;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler<T = any> = (data: T) => void;

export class SignalEmitter<TEventMap extends ThorSignalMap = ThorSignalMap> {
  // Using any internally to avoid index-signature constraint issues on strict union maps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _listeners: Map<keyof TEventMap, Set<Handler<any>>> = new Map();

  on<K extends keyof TEventMap>(event: K, handler: Handler<TEventMap[K]>): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler);
    return this;
  }

  off<K extends keyof TEventMap>(event: K, handler: Handler<TEventMap[K]>): this {
    this._listeners.get(event)?.delete(handler);
    return this;
  }

  emit<K extends keyof TEventMap>(event: K, data: TEventMap[K]): void {
    this._listeners.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch (err) {
        console.error(`[thor.gl] SignalEmitter handler error for "${String(event)}":`, err);
      }
    });
  }

  /** Remove all listeners for all events. */
  clear(): void {
    this._listeners.clear();
  }
}
