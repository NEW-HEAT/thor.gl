/** One-hand pinch navigation with time-based release momentum. */
import type { GestureHandler, GestureDetection, ViewState } from "../types";
import type { ThorFrame, HandLandmarks } from "../../detection/types";
import { isPinching, pinchCenter } from "../../detection/landmarks";
import { gestureConfig as cfg } from "../config";

const FRAME_MS = 1000 / 30;
const MIN_SPEED = 0.004; // normalized camera widths/second
const MAX_SPEED = 1.5;
const pinchStartTimes: (number | null)[] = [null, null];
let anchor: { x: number; y: number } | null = null;
let sample: { x: number; y: number; time: number } | null = null;
let velocity = { x: 0, y: 0 };
let panningSide: string | null = null;
let wasPanning = false;
let previousTime: number | null = null;
let coastStart: number | null = null;
let coastElapsed = 0;

function clearMotion() {
  anchor = null;
  sample = null;
  velocity = { x: 0, y: 0 };
  panningSide = null;
  wasPanning = false;
  coastStart = null;
  coastElapsed = 0;
}

function confirmPinch(index: number, hand: HandLandmarks | undefined, confidence: number, now: number) {
  const threshold = cfg.pinchThreshold * (confidence > 0.8 ? 1.5 : confidence > 0.6 ? 1.3 : 1);
  if (!hand || confidence < cfg.minConfidence || !isPinching(hand, threshold)) {
    pinchStartTimes[index] = null;
    return { confirmed: false, dwelling: false };
  }
  pinchStartTimes[index] ??= now;
  const confirmed = now - pinchStartTimes[index]! >= cfg.grabDelay;
  return { confirmed, dwelling: !confirmed };
}

function coast(now: number, dt: number): GestureDetection | null {
  const duration = Math.max(0, cfg.inertiaDuration);
  if (!duration) { clearMotion(); return null; }
  if (wasPanning) {
    wasPanning = false;
    anchor = null;
    sample = null;
    panningSide = null;
    if (Math.hypot(velocity.x, velocity.y) < MIN_SPEED) { clearMotion(); return null; }
    coastStart = now - dt;
    coastElapsed = 0;
  }
  if (coastStart === null) return null;
  const elapsed = Math.min(duration, now - coastStart);
  const tau = duration / 4;
  // Integrate exponential drag over the frame, independent of detection FPS.
  const distance = tau / 1000 * (Math.exp(-coastElapsed / tau) - Math.exp(-elapsed / tau));
  const dx = velocity.x * distance;
  const dy = velocity.y * distance;
  coastElapsed = elapsed;
  if (elapsed >= duration) clearMotion();
  return distance > 0 ? { gesture: "pinch-pan", data: { dx, dy, inertia: true } } : null;
}

export const pinchPan: GestureHandler = {
  name: "pinch-pan",
  requires: ["hands"],

  detect(frame: ThorFrame): GestureDetection | null {
    const now = frame.timestamp;
    const gap = previousTime === null ? FRAME_MS : now - previousTime;
    previousTime = now;
    // Do not carry stale movement across a stalled camera or background tab.
    if (gap > 200 || gap < 0) { clearMotion(); pinchStartTimes.fill(null); }
    const dt = Math.max(1, Math.min(80, gap));
    const first = confirmPinch(0, frame.hands[0], frame.handConfidences[0] ?? 0, now);
    const second = confirmPinch(1, frame.hands[1], frame.handConfidences[1] ?? 0, now);
    if (first.confirmed && second.confirmed) { clearMotion(); return null; }

    const index = first.confirmed ? 0 : second.confirmed ? 1 : -1;
    if (index < 0) {
      // Catch the globe as soon as a new pinch starts, before dwell confirmation.
      if (first.dwelling || second.dwelling) { clearMotion(); return null; }
      return coast(now, dt);
    }

    const center = pinchCenter(frame.hands[index]);
    if (!center) { clearMotion(); return null; }
    const side = frame.handedness[index];
    if (panningSide !== side || !sample || !anchor) {
      clearMotion();
      panningSide = side;
      anchor = center;
      sample = { ...center, time: now };
      wasPanning = true;
      return null;
    }
    coastStart = null;
    wasPanning = true;
    const sampleMs = Math.max(1, now - sample.time);
    const smoothing = 1 - Math.pow(1 - cfg.panSmoothing, sampleMs / FRAME_MS);
    const speedX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (center.x - sample.x) * 1000 / sampleMs));
    const speedY = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (center.y - sample.y) * 1000 / sampleMs));
    // Still samples reduce velocity, so holding before release does not fling.
    velocity.x += (speedX - velocity.x) * smoothing;
    velocity.y += (speedY - velocity.y) * smoothing;
    sample = { ...center, time: now };

    const dx = center.x - anchor.x;
    const dy = center.y - anchor.y;
    if (Math.abs(dx) < cfg.panMoveDeadzone && Math.abs(dy) < cfg.panMoveDeadzone) return null;
    anchor = center;
    return { gesture: "pinch-pan", data: { dx, dy, inertia: false } };
  },

  apply(detection, viewState, config): ViewState {
    const { dx, dy } = detection.data as { dx: number; dy: number };
    const scale = config.panSensitivity / Math.pow(2, viewState.zoom);
    return {
      ...viewState,
      longitude: viewState.longitude + dx * scale * 180,
      latitude: Math.max(-85, Math.min(85, viewState.latitude + dy * scale * 90)),
    };
  },

  reset() {
    clearMotion();
    previousTime = null;
    pinchStartTimes.fill(null);
  },
};
