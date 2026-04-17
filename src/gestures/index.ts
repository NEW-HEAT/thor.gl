/**
 * Gesture system — registry + built-in handlers.
 *
 * Built-in gestures are registered on import. Custom gestures can be
 * added via registerGesture() at any time.
 */

// Re-export types
export type {
  GestureHandler,
  GestureDetection,
  GestureConfig,
  GestureRegistration,
  ViewState,
} from "./types";

// Re-export registry
export {
  registerGesture,
  getGesture,
  listGestures,
  getAllGestures,
  getActiveGestures,
  getRequiredParts,
  unregisterGesture,
  clearRegistry,
} from "./registry";

// Re-export conflict resolution
export { resolveConflicts } from "./conflicts";

// ── Built-in handlers ──
export { pinchPan } from "./hand/pinch-pan";
export { pinchZoom } from "./hand/pinch-zoom";
export { pinchRotate } from "./hand/pinch-rotate";
export { pinchPitch } from "./hand/pinch-pitch";
export { openPalm } from "./hand/open-palm";
export { fist, setFistAction } from "./hand/fist";
export { fingergun } from "./hand/fingergun";
export { fourFinger } from "./hand/four-finger";
export { headTilt } from "./face/head-tilt";
export { gaze } from "./face/gaze";
export { blink } from "./face/blink";
export { lean } from "./pose/lean";

// ── Register built-ins (hand gestures only — face/pose are opt-in exports) ──
import { registerGesture } from "./registry";
import { pinchPan } from "./hand/pinch-pan";
import { pinchZoom } from "./hand/pinch-zoom";
import { pinchRotate } from "./hand/pinch-rotate";
import { pinchPitch } from "./hand/pinch-pitch";
import { openPalm } from "./hand/open-palm";
import { fist } from "./hand/fist";
import { fingergun } from "./hand/fingergun";
import { fourFinger } from "./hand/four-finger";

registerGesture(pinchPan, { priority: 20, group: "navigation" });
registerGesture(pinchZoom, { priority: 25, group: "navigation" });
registerGesture(pinchRotate, { priority: 22, group: "rotation" });
registerGesture(pinchPitch, { priority: 21, group: "pitch" });
registerGesture(openPalm, { priority: 5, group: "signal" });
registerGesture(fist, { priority: 30, group: "action" });
// Signal gestures — different groups from nav gestures, coexist freely
registerGesture(fingergun, { priority: 15, group: "signal-aim" });
registerGesture(fourFinger, { priority: 15, group: "signal-erase" });
