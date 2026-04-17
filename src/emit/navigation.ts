/**
 * navigation.ts — gesture output → mjolnir events via EventManager._onOtherEvent.
 *
 * TODO: Replace with public EventManager.emit(type, event) when visgl/mjolnir.js
 * PR lands (see thor.gl#1 "Upstream PRs"). Private API is the stopgap.
 * Track: https://github.com/visgl/mjolnir.js/issues (pending upstream PR)
 */

export interface MjolnirEventLike {
  type: string;
  srcEvent: Event;
  offsetCenter?: {x: number; y: number};
  scale?: number;
  rotation?: number;
  deltaX?: number;
  deltaY?: number;
  velocity?: number;
  velocityX?: number;
  velocityY?: number;
  [key: string]: unknown;
}

/**
 * Emit a synthetic mjolnir-style event on the EventManager.
 *
 * Uses the private `_onOtherEvent` escape hatch because mjolnir.js does
 * not currently expose a public `emit(type, event)` API. A try/catch
 * fallback is intentional — if the private API changes shape, we fail
 * silently rather than crashing the entire gesture loop.
 */
export function emitMjolnirEvent(
  eventManager: unknown,
  event: MjolnirEventLike
): void {
  if (!eventManager) return;

  try {
    // TODO: Replace with public EventManager.emit(type, event) when visgl/mjolnir.js
    // PR lands (see thor.gl#1 "Upstream PRs"). Private API is the stopgap.
    const mgr = eventManager as {_onOtherEvent?: (e: MjolnirEventLike) => void};
    if (typeof mgr._onOtherEvent === 'function') {
      mgr._onOtherEvent.call(mgr, event);
    }
  } catch (err) {
    // Silently swallow — private API mismatch should not crash the gesture loop
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[thor.gl] emitMjolnirEvent fallback — _onOtherEvent unavailable:', err);
    }
  }
}

/**
 * Synthesize a pan (pointermove) mjolnir event from a pixel delta.
 */
export function emitPanEvent(
  eventManager: unknown,
  deltaX: number,
  deltaY: number,
  center: {x: number; y: number}
): void {
  emitMjolnirEvent(eventManager, {
    type: 'panmove',
    srcEvent: new MouseEvent('mousemove'),
    offsetCenter: center,
    deltaX,
    deltaY,
    velocity: Math.sqrt(deltaX * deltaX + deltaY * deltaY),
    velocityX: deltaX,
    velocityY: deltaY,
  });
}

/**
 * Synthesize a pinch (zoom) mjolnir event from a scale factor.
 */
export function emitZoomEvent(
  eventManager: unknown,
  scale: number,
  center: {x: number; y: number}
): void {
  emitMjolnirEvent(eventManager, {
    type: 'pinchmove',
    srcEvent: new TouchEvent('touchmove'),
    offsetCenter: center,
    scale,
  });
}

/**
 * Synthesize a rotate mjolnir event from a bearing delta (degrees).
 */
export function emitRotateEvent(
  eventManager: unknown,
  rotation: number,
  center: {x: number; y: number}
): void {
  emitMjolnirEvent(eventManager, {
    type: 'rotatemove',
    srcEvent: new TouchEvent('touchmove'),
    offsetCenter: center,
    rotation,
  });
}
