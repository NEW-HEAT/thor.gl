/**
 * Signal emitter — typed event emitter for application-level gesture signals.
 *
 * Signals are discrete events that don't map to navigation or picking.
 * They're consumed by application code for UI actions, mode switches,
 * confirmations, etc. Think "blink to confirm" or "wave to dismiss".
 */

// ── Types ──

export type ThorSignalEvent = {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
};

/** All signal event types */
export const SIGNAL_EVENTS = [
  "blink",
  "nod",
  "headshake",
  "fist",
  "openpalm",
  "wave",
  "thumbsup",
  "fingergun",
  "handenter",
  "handleave",
  "faceenter",
  "faceleave",
] as const;

export type SignalEventType = (typeof SIGNAL_EVENTS)[number];

type SignalHandler = (event: ThorSignalEvent) => void;

// ── Class ──

/**
 * Simple typed event emitter for thor.gl signal gestures.
 *
 * Usage:
 *   const signals = new SignalEmitter();
 *   signals.on('blink', (e) => console.log('Blink!', e.data));
 *   // Later, from the engine:
 *   signals.emit('blink', { duration: 250 });
 */
export class SignalEmitter {
  private listeners = new Map<string, Set<SignalHandler>>();

  /** Subscribe to a signal event */
  on(event: string, handler: SignalHandler): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  /** Subscribe to a signal event, auto-unsubscribe after first firing */
  once(event: string, handler: SignalHandler): void {
    const wrapper: SignalHandler = (e) => {
      this.off(event, wrapper);
      handler(e);
    };
    this.on(event, wrapper);
  }

  /** Unsubscribe from a signal event */
  off(event: string, handler: SignalHandler): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Emit a signal event to all registered listeners */
  emit(event: string, data: Record<string, unknown> = {}): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    const thorEvent: ThorSignalEvent = {
      type: event,
      timestamp: performance.now(),
      data,
    };

    // Iterate over a copy so handlers can call off() during emission
    for (const handler of [...set]) {
      handler(thorEvent);
    }
  }

  /** Check if a gesture name is a signal gesture */
  isSignalGesture(name: string): boolean {
    return (SIGNAL_EVENTS as readonly string[]).includes(name);
  }

  /** Remove all listeners for all events */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
