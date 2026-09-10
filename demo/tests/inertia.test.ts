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
beforeEach(() => { Object.assign(cfg, original, { inertiaDuration: 900 }); pinchPan.reset?.(); });
afterEach(() => { Object.assign(cfg, original); pinchPan.reset?.(); });
it("carries drag speed into the first released frame without the old sensitivity drop", () => {
  const lastDrag = drag();
  const released = pinchPan.detect(empty(500 + 1000 / 30))!;
  const view = { longitude: 0, latitude: 0, zoom: 2 };
  const dragged = pinchPan.apply(lastDrag, view, cfg).longitude;
  const glided = pinchPan.apply(released, view, cfg).longitude;
  expect(released.data.inertia).toBe(true);
  expect(glided / dragged).toBeGreaterThan(0.8);
  expect(glided / dragged).toBeLessThan(1);
});
it("travels the same distance at 15, 30, and 60 detection frames per second", () => {
  const distances = [15, 30, 60].map(fps => {
    pinchPan.reset?.(); drag(fps);
    let view = { longitude: 0, latitude: 0, zoom: 2 };
    for (let step = 1; step <= Math.ceil(1000 / (1000 / fps)); step++) {
      const detection = pinchPan.detect(empty(500 + step * 1000 / fps));
      if (detection) view = pinchPan.apply(detection, view, cfg);
    }
    return view.longitude;
  });
  expect(distances[0]).toBeGreaterThan(5);
  expect(distances[0]).toBeCloseTo(distances[1], 6);
  expect(distances[1]).toBeCloseTo(distances[2], 6);
});
it("decays smoothly and stops within the configured duration", () => {
  drag();
  const deltas: number[] = [];
  for (let t = 530; t <= 1460; t += 30) {
    const d = pinchPan.detect(empty(t));
    if (d) deltas.push(d.data.dx as number);
  }
  expect(deltas.length).toBeGreaterThan(20);
  expect(deltas.every((d, i) => d > 0 && (i === 0 || d < deltas[i - 1]))).toBe(true);
  expect(pinchPan.detect(empty(1490))).toBeNull();
});
it("does not fling if the hand holds still before releasing", () => {
  drag();
  for (let t = 530; t <= 1010; t += 30) pinchPan.detect(pinching(t, 0.28));
  expect(pinchPan.detect(empty(1040))).toBeNull();
});
it("allows inertia to be disabled", () => {
  drag(); cfg.inertiaDuration = 0;
  expect(pinchPan.detect(empty(530))).toBeNull();
});
it("catches momentum immediately when a new pinch begins", () => {
  drag(); expect(pinchPan.detect(empty(530))).not.toBeNull();
  expect(pinchPan.detect(pinching(560, 0.8))).toBeNull();
  expect(pinchPan.detect(empty(590))).toBeNull();
});
it("reset and a stalled camera both discard momentum", () => {
  drag(); pinchPan.reset?.(); expect(pinchPan.detect(empty(530))).toBeNull();
  drag(); expect(pinchPan.detect(empty(900))).toBeNull();
});
