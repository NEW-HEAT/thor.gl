/**
 * thor.gl — Mjolnir for Humans.
 *
 * Hand, face, and pose gesture control for deck.gl.
 * MediaPipe handles detection. Thor handles the bridge to deck.gl.
 */

// ── Framework-agnostic class ──
export { Thor, type ThorOptions, type DeckInstance } from "./thor";

// ── React hook ──
export { useThor, type ThorConfig, type ThorResult } from "./useThor";

// ── Emit layer (output channels) ──
export {
  createNavigationEmitter,
  type NavigationEmitter,
  type EventManagerLike,
  type GesturePhase,
  createPickingEmitter,
  type PickingEmitter,
  type PickingResult,
  type ThorPickingEvent,
  SignalEmitter,
  SIGNAL_EVENTS,
  type ThorSignalEvent,
  type SignalEventType,
} from "./emit";

// ── Widget ──
export { ThorWidget } from "./ThorWidget";

// ── Detection ──
export {
  type ThorFrame,
  type DetectorMode,
  type BodyPart,
  type HandLandmarks,
  type FaceLandmarks,
  type PoseLandmarks,
  type Blendshapes,
  EMPTY_FRAME,
} from "./detection/types";
export {
  initDetector,
  detect,
  isReady,
  getActiveMode,
  destroyDetector,
} from "./detection/detector";
export {
  HAND,
  FACE,
  POSE,
  FINGERTIPS,
  distance,
  distance2d,
  midpoint,
  isPinching,
  pinchCenter,
  angle,
} from "./detection/landmarks";

// ── Gesture system ──
export {
  type GestureHandler,
  type GestureDetection,
  type GestureConfig,
  type GestureRegistration,
  type ViewState,
} from "./gestures/types";
export {
  gestureConfig,
  setGestureConfig,
  type ThorGestureConfig,
} from "./gestures/config";
export {
  registerGesture,
  getGesture,
  listGestures,
  unregisterGesture,
  clearRegistry,
} from "./gestures/registry";

// ── Built-in gesture handlers ──
export { pinchPan } from "./gestures/hand/pinch-pan";
export { pinchZoom } from "./gestures/hand/pinch-zoom";
export { pinchRotate } from "./gestures/hand/pinch-rotate";
export { pinchPitch } from "./gestures/hand/pinch-pitch";
export { openPalm } from "./gestures/hand/open-palm";
export { fist, setFistAction } from "./gestures/hand/fist";
export { headTilt } from "./gestures/face/head-tilt";
export { gaze, setGazeCalibration, getGazeCalibration, getLastGazePoint } from "./gestures/face/gaze";
export {
  estimateGaze,
  extractIrisPosition,
  extractHeadPose,
  fitCalibration,
  type GazePoint,
  type CalibrationData,
  type CalibrationPoint,
  type IrisPosition,
  type HeadPose,
} from "./gestures/face/gaze-model";
export { blink } from "./gestures/face/blink";
export { lean } from "./gestures/pose/lean";

// ── Engine (advanced usage) ──
export { createEngine, type EngineConfig, type EngineHandle } from "./engine";

// ── Utilities ──
export { hideCursor, showCursor } from "./util/pointer-emulation";
