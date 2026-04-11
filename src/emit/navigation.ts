/**
 * Navigation emitter — translates gesture detections into mjolnir.js events.
 *
 * Gestures like pinch-pan, pinch-zoom, pinch-rotate produce the same
 * panstart/panmove/panend and pinchstart/pinchmove/pinchend events that
 * deck.gl's MapController already understands. We just need to emit them
 * through EventManager with pointerType: 'hand' so deck.gl moves the camera.
 */

import type { GestureDetection } from "../gestures/types";

// ── Types ──

/** Minimal shape needed from mjolnir.js EventManager */
export interface EventManagerLike {
  emit?: (event: { type: string; [key: string]: unknown }) => void;
  getElement(): HTMLElement | null;
}

/** Gesture phase within its lifecycle */
export type GesturePhase = "start" | "move" | "end";

/** Map of gesture name to the mjolnir event lifecycle it produces */
const GESTURE_EVENT_MAP: Record<string, { start: string; move: string; end: string }> = {
  "pinch-pan":    { start: "panstart",   move: "panmove",   end: "panend" },
  "pinch-zoom":   { start: "pinchstart", move: "pinchmove", end: "pinchend" },
  "pinch-rotate": { start: "pinchstart", move: "pinchmove", end: "pinchend" },
  "pinch-pitch":  { start: "pinchstart", move: "pinchmove", end: "pinchend" },
  "head-tilt":    { start: "panstart",   move: "panmove",   end: "panend" },
  "lean":         { start: "panstart",   move: "panmove",   end: "panend" },
};

// ── Helpers ──

/** Create a synthetic PointerEvent for the srcEvent field */
function syntheticPointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    pointerType: "touch", // closest native type to hand tracking
  });
}

// ── Factory ──

export interface NavigationEmitter {
  /** Emit a navigation event for a gesture phase transition */
  emitGesture(
    gestureName: string,
    phase: GesturePhase,
    data: Record<string, unknown>
  ): void;

  /** Check if a gesture name maps to a navigation event */
  isNavigationGesture(name: string): boolean;
}

/**
 * Create a navigation emitter bound to an EventManager.
 *
 * Tracks gesture lifecycle internally so it knows when to emit
 * start vs move vs end for each gesture.
 */
export function createNavigationEmitter(eventManager: EventManagerLike): NavigationEmitter {
  // Track which gestures are currently active (have emitted a start)
  const activeGestures = new Set<string>();

  /** Resolve the emit function — prefer public emit(), fall back to _onOtherEvent */
  function getEmitFn(): ((event: { type: string; [key: string]: unknown }) => void) | null {
    if (eventManager.emit) {
      return eventManager.emit.bind(eventManager);
    }
    // Fallback for mjolnir.js versions without public emit()
    const em = eventManager as Record<string, unknown>;
    if (typeof em._onOtherEvent === "function") {
      return (em._onOtherEvent as (event: Record<string, unknown>) => void).bind(em);
    }
    return null;
  }

  function emitGesture(
    gestureName: string,
    phase: GesturePhase,
    data: Record<string, unknown>
  ): void {
    const mapping = GESTURE_EVENT_MAP[gestureName];
    if (!mapping) return;

    const emitFn = getEmitFn();
    if (!emitFn) return;

    const target = eventManager.getElement();
    if (!target) return;

    // Determine the actual phase based on lifecycle tracking
    let effectivePhase = phase;
    if (phase === "move" && !activeGestures.has(gestureName)) {
      // First move without a start — emit start first
      effectivePhase = "start";
    }

    if (effectivePhase === "start") {
      activeGestures.add(gestureName);
    }

    const eventType = mapping[effectivePhase];
    const centerX = (data.centerX as number) ?? 0;
    const centerY = (data.centerY as number) ?? 0;

    const event: Record<string, unknown> = {
      type: eventType,
      center: { x: centerX, y: centerY },
      srcEvent: syntheticPointerEvent(eventType, centerX, centerY),
      target,
      pointerType: "hand",
      // Pass through gesture-specific data
      deltaX: data.deltaX ?? 0,
      deltaY: data.deltaY ?? 0,
    };

    // Add pinch-specific fields
    if (eventType.startsWith("pinch")) {
      event.scale = data.scale ?? 1;
      event.rotation = data.rotation ?? 0;
    }

    emitFn(event);

    // If we emitted a start but the caller wanted a move, emit the move too
    if (effectivePhase === "start" && phase === "move") {
      emitFn({ ...event, type: mapping.move });
    }

    // Clean up on end
    if (phase === "end") {
      activeGestures.delete(gestureName);
    }
  }

  function isNavigationGesture(name: string): boolean {
    return name in GESTURE_EVENT_MAP;
  }

  return { emitGesture, isNavigationGesture };
}
