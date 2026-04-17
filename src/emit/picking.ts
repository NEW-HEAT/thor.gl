/**
 * picking.ts — screen coords → deck.pickObject → dispatch callbacks on layer/deck props.
 *
 * Supports any callback name declared in PICK_EVENT_TO_CALLBACK.
 * Errors are swallowed gracefully — a bad callback should not crash the gesture loop.
 */

import {PICK_EVENT_TO_CALLBACK} from './events';

export interface PickInfo {
  object?: unknown;
  layer?: {props: Record<string, unknown>} | null;
  index?: number;
  x?: number;
  y?: number;
  coordinate?: [number, number] | null;
}

export interface DeckLike {
  pickObject: (opts: {x: number; y: number; radius?: number}) => PickInfo | null;
  props?: Record<string, unknown>;
}

/**
 * Dispatch a pick-based event.
 *
 * 1. Calls deck.pickObject at (x, y) with radius 10.
 * 2. Looks up the callback name from PICK_EVENT_TO_CALLBACK[eventType].
 * 3. Dispatches on info.layer?.props[callbackName] first, then deck.props[callbackName].
 *
 * Swallows errors from callback invocations so a broken handler cannot
 * crash the thor gesture loop.
 */
export function dispatchPickEvent(
  deck: DeckLike,
  eventType: string,
  x: number,
  y: number,
  extra?: Record<string, unknown>
): void {
  const callbackName = PICK_EVENT_TO_CALLBACK[eventType];
  if (!callbackName) return;

  let info: PickInfo | null = null;
  try {
    info = deck.pickObject({x, y, radius: 10});
  } catch {
    return;
  }

  const payload = {
    eventType,
    x,
    y,
    picked: info !== null,
    object: info?.object ?? null,
    layer: info?.layer ?? null,
    index: info?.index ?? -1,
    coordinate: info?.coordinate ?? null,
    ...extra,
  };

  // Layer-level callback first
  if (info?.layer?.props) {
    const layerCb = info.layer.props[callbackName];
    if (typeof layerCb === 'function') {
      try {
        layerCb(payload);
      } catch (err) {
        console.error(`[thor.gl] Layer callback ${callbackName} threw:`, err);
      }
    }
  }

  // Deck-level callback second (always fires, even if layer handled it)
  const deckCb = deck.props?.[callbackName];
  if (typeof deckCb === 'function') {
    try {
      deckCb(payload);
    } catch (err) {
      console.error(`[thor.gl] Deck callback ${callbackName} threw:`, err);
    }
  }
}
