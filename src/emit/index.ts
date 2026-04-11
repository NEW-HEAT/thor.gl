/**
 * Emit layer — translates gesture detections into three output channels.
 *
 * Navigation: gestures → mjolnir events → deck.gl camera control
 * Picking:    gestures → deck.pickObject() → layer callbacks
 * Signals:    gestures → typed events → application code
 */

export {
  createNavigationEmitter,
  type NavigationEmitter,
  type EventManagerLike,
  type GesturePhase,
} from "./navigation";

export {
  createPickingEmitter,
  type PickingEmitter,
  type DeckLike,
  type PickingResult,
  type ThorPickingEvent,
} from "./picking";

export {
  SignalEmitter,
  SIGNAL_EVENTS,
  type ThorSignalEvent,
  type SignalEventType,
} from "./signals";
