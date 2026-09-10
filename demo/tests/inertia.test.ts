import { afterEach, beforeEach, expect, it } from "vitest";
import { pinchPan } from "../../src/gestures/hand/pinch-pan";
import { gestureConfig as cfg } from "../../src/gestures/config";
import { EMPTY_FRAME, type ThorFrame } from "../../src/detection/types";
const original = { ...cfg };
function pinching(timestamp: number, x: number): ThorFrame {
  const hand = Array.from({ length: 21 }, () => ({ x, y: 0.7, z: 0, visibility: 1 }));
  hand[4] = { x: x - 0.01, y: 0.5, z: 0, visibility: 1 };
  hand[8] = { x: x + 0.01, y: 0.5, z: 0, visibility: 1 };
  return { ...EMPTY_FRAME, timestamp, hands: [hand], handedness: ["Left"], handConfidences: [0.99] };
}
const empty = (timestamp: number) => ({ ...EMPTY_FRAME, timestamp });
function released(timestamp: number) {
  const frame = pinching(timestamp, 0.28);
  frame.hands[0][4].x = 0.18;
  frame.hands[0][8].x = 0.38;
  return frame;
}
function drag(fps = 30) {
  const dt = 1000 / fps;
  pinchPan.detect(pinching(0, 0.2));
  pinchPan.detect(pinching(100, 0.2));
  let last: ReturnType<typeof pinchPan.detect> = null;
  for (let step = 1; step <= Math.round(400 / dt); step++) {
    const t = 100 + step * dt;
    last = pinchPan.detect(pinching(t, 0.2 + (t - 100) * 0.0002));
  }
  return last!;
}
beforeEach(() => { Object.assign(cfg, original, { inertiaDuration: 280 }); pinchPan.reset?.(); });
afterEach(() => { Object.assign(cfg, original); pinchPan.reset?.(); });
it("carries drag speed into the first released frame without the old sensitivity drop", () => {
  const lastDrag = drag();
  const coastFrame = pinchPan.detect(released(500 + 1000 / 30))!;
  const view = { longitude: 0, latitude: 0, zoom: 2 };
  const dragged = pinchPan.apply(lastDrag, view, cfg).longitude;
  const glided = pinchPan.apply(coastFrame, view, cfg).longitude;
  expect(coastFrame.data.inertia).toBe(true);
  expect(glided / dragged).toBeGreaterThan(0.7);
  expect(glided / dragged).toBeLessThan(1);
});
it("travels the same distance at 15, 30, and 60 detection frames per second", () => {
  const distances = [15, 30, 60].map(fps => {
    pinchPan.reset?.(); drag(fps);
    let view = { longitude: 0, latitude: 0, zoom: 2 };
    for (let step = 1; step <= Math.ceil(1000 / (1000 / fps)); step++) {
      const detection = pinchPan.detect(released(500 + step * 1000 / fps));
      if (detection) view = pinchPan.apply(detection, view, cfg);
    }
    return view.longitude;
  });
  expect(distances[0]).toBeGreaterThan(0.5);
  expect(distances[0]).toBeCloseTo(distances[1], 6);
  expect(distances[1]).toBeCloseTo(distances[2], 6);
});
it("decays smoothly and stops within the configured duration", () => {
  drag();
  const deltas: number[] = [];
  for (let t = 530; t <= 1460; t += 30) {
    const d = pinchPan.detect(released(t));
    if (d) deltas.push(d.data.dx as number);
  }
  expect(deltas.length).toBeGreaterThan(5);
  expect(deltas.every((d, i) => d > 0 && (i === 0 || d < deltas[i - 1]))).toBe(true);
  expect(pinchPan.detect(released(1490))).toBeNull();
});
it("does not fling if the hand holds still before releasing", () => {
  drag();
  for (let t = 530; t <= 1010; t += 30) pinchPan.detect(pinching(t, 0.28));
  expect(pinchPan.detect(released(1040))).toBeNull();
});
it("allows inertia to be disabled", () => {
  drag(); cfg.inertiaDuration = 0;
  expect(pinchPan.detect(released(530))).toBeNull();
});
it("catches momentum immediately when a new pinch begins", () => {
  drag(); expect(pinchPan.detect(released(530))).not.toBeNull();
  expect(pinchPan.detect(pinching(560, 0.8))).toBeNull();
  expect(pinchPan.detect(released(590))).toBeNull();
});
it("reset and a stalled camera both discard momentum", () => {
  drag(); pinchPan.reset?.(); expect(pinchPan.detect(released(530))).toBeNull();
  drag(); expect(pinchPan.detect(released(900))).toBeNull();
});

it("stops on tracking loss and low confidence instead of flinging", () => {
  drag(); expect(pinchPan.detect(empty(530))).toBeNull();
  expect(pinchPan.animate?.(546)).toBeNull();
  pinchPan.reset?.(); drag();
  const uncertain = released(530); uncertain.handConfidences = [0.1];
  expect(pinchPan.detect(uncertain)).toBeNull();
});
it("rejects a landmark teleport without moving or building release speed", () => {
  drag(); expect(pinchPan.detect(pinching(530, 0.85))).toBeNull();
  expect(pinchPan.detect(released(560))).toBeNull();
});
it("advances coast between camera frames and does not replay that distance", () => {
  drag(); pinchPan.detect(released(530));
  const middle = pinchPan.animate?.(546)!;
  const next = pinchPan.detect(released(563))!;
  expect(middle.data.dx).toBeGreaterThan(0);
  expect(next.data.dx).toBeLessThan(middle.data.dx as number);
});
it("keeps default release travel below three degrees after a fast swipe", () => {
  pinchPan.detect(pinching(0, 0.2)); pinchPan.detect(pinching(100, 0.2));
  for (let i = 1; i <= 10; i++) pinchPan.detect(pinching(100 + i * 33, 0.2 + i * 0.03));
  let view = { longitude: 0, latitude: 0, zoom: 1.2 };
  for (let t = 463; t < 800; t += 33) {
    const d = pinchPan.detect(released(t)); if (d) view = pinchPan.apply(d, view, cfg);
  }
  expect(view.longitude).toBeGreaterThan(0);
  expect(view.longitude).toBeLessThan(3.1);
});
it("keeps small stationary landmark jitter inside the pan slack region", () => {
  pinchPan.detect(pinching(0, 0.2)); pinchPan.detect(pinching(100, 0.2));
  for (let i = 1; i <= 20; i++) expect(pinchPan.detect(pinching(100 + i * 33, 0.2 + (i % 2 ? 0.001 : -0.001)))).toBeNull();
});
