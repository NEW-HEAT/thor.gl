/**
 * Picking emitter — translates gesture detections into deck.gl picking calls.
 *
 * Gestures like gaze, hand-point, and grab need to know *what* the user is
 * looking at or pointing at. This module calls deck.pickObject() with screen
 * coordinates from the gesture, then invokes the appropriate layer callback
 * (onGaze, onGrab, etc.) if the picked layer declares one.
 */

import type { GestureDetection } from "../gestures/types";

// ── Types ──

/** Minimal Deck interface needed for picking */
export interface DeckLike {
  pickObject(opts: {
    x: number;
    y: number;
    radius?: number;
    unproject3D?: boolean;
  }): PickingResult;
}

export interface PickingResult {
  object?: unknown;
  layer?: { props: Record<string, unknown> };
  coordinate?: number[];
  x: number;
  y: number;
  [key: string]: unknown;
}

/** Thor-specific event info passed to layer callbacks */
export interface ThorPickingEvent {
  type: string;
  screenPos: { x: number; y: number };
  pickingResult: PickingResult;
  data: Record<string, unknown>;
}

/** Maps thor event types to layer callback prop names */
const EVENT_TO_CALLBACK: Record<string, string> = {
  gazemove: "onGaze",
  gazeenter: "onGazeEnter",
  gazeleave: "onGazeLeave",
  gazefix: "onGazeFix",
  handpoint: "onHandPoint",
  handray: "onHandRay",
  handgrab: "onGrab",
  handrelease: "onRelease",
};

/** Maps gesture handler names to picking event types */
const GESTURE_TO_PICKING_EVENT: Record<string, string> = {
  gaze: "gazemove",
  blink: "gazefix",
  "open-palm": "handrelease",
  fist: "handgrab",
};

// ── Factory ──

export interface PickingEmitter {
  /** Pick an object and fire the appropriate layer/deck callback */
  emitPicking(
    eventType: string,
    screenPos: { x: number; y: number },
    eventData?: Record<string, unknown>
  ): void;

  /** Check if a gesture name triggers picking behavior */
  isPickingGesture(name: string): boolean;

  /** Get the picking event type for a gesture name */
  getPickingEventType(name: string): string | undefined;
}

/**
 * Create a picking emitter bound to a Deck instance.
 *
 * Tracks last picked object for gaze events so it can emit
 * gazeenter/gazeleave when the gaze target changes.
 */
export function createPickingEmitter(deck: DeckLike): PickingEmitter {
  // Track last gaze target for enter/leave detection
  let lastGazeObject: unknown = null;
  let lastGazeLayer: { props: Record<string, unknown> } | undefined = undefined;

  /** Try to invoke a callback on a layer's props or on deck.props */
  function invokeCallback(
    callbackName: string,
    info: PickingResult,
    thorEvent: ThorPickingEvent
  ): void {
    const layerProps = info.layer?.props;
    if (layerProps && typeof layerProps[callbackName] === "function") {
      (layerProps[callbackName] as (info: PickingResult, event: ThorPickingEvent) => void)(
        info,
        thorEvent
      );
    }

    // Also check deck-level props (for global handlers)
    const deckProps = (deck as Record<string, unknown>).props as
      | Record<string, unknown>
      | undefined;
    if (deckProps && typeof deckProps[callbackName] === "function") {
      (deckProps[callbackName] as (info: PickingResult, event: ThorPickingEvent) => void)(
        info,
        thorEvent
      );
    }
  }

  function emitPicking(
    eventType: string,
    screenPos: { x: number; y: number },
    eventData: Record<string, unknown> = {}
  ): void {
    const pickResult = deck.pickObject({
      x: screenPos.x,
      y: screenPos.y,
      radius: 5,
    });

    const thorEvent: ThorPickingEvent = {
      type: eventType,
      screenPos,
      pickingResult: pickResult,
      data: eventData,
    };

    // Handle gaze enter/leave transitions
    if (eventType === "gazemove") {
      const currentObject = pickResult.object ?? null;
      const objectChanged = currentObject !== lastGazeObject;

      if (objectChanged) {
        // Emit leave on the old target
        if (lastGazeObject !== null && lastGazeLayer) {
          const leaveCallbackName = EVENT_TO_CALLBACK["gazeleave"];
          if (leaveCallbackName) {
            const leaveEvent: ThorPickingEvent = {
              type: "gazeleave",
              screenPos,
              pickingResult: {
                object: lastGazeObject,
                layer: lastGazeLayer,
                x: screenPos.x,
                y: screenPos.y,
              },
              data: eventData,
            };
            invokeCallback(leaveCallbackName, leaveEvent.pickingResult, leaveEvent);
          }
        }

        // Emit enter on the new target
        if (currentObject !== null) {
          const enterCallbackName = EVENT_TO_CALLBACK["gazeenter"];
          if (enterCallbackName) {
            const enterEvent: ThorPickingEvent = {
              type: "gazeenter",
              screenPos,
              pickingResult: pickResult,
              data: eventData,
            };
            invokeCallback(enterCallbackName, pickResult, enterEvent);
          }
        }

        lastGazeObject = currentObject;
        lastGazeLayer = pickResult.layer;
      }
    }

    // Emit the primary event callback
    const callbackName = EVENT_TO_CALLBACK[eventType];
    if (callbackName) {
      invokeCallback(callbackName, pickResult, thorEvent);
    }
  }

  function isPickingGesture(name: string): boolean {
    return name in GESTURE_TO_PICKING_EVENT;
  }

  function getPickingEventType(name: string): string | undefined {
    return GESTURE_TO_PICKING_EVENT[name];
  }

  return { emitPicking, isPickingGesture, getPickingEventType };
}
