import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinchPan, pinchZoom, pinchRotate, pinchPitch, fist, setFistAction } from "../../src/gestures";
import { gestureConfig as cfg } from "../../src/gestures/config";
import { EMPTY_FRAME, type ThorFrame } from "../../src/detection/types";

function hand(x: number, y = 0.5) {
  const points = Array.from({ length: 21 }, () => ({ x, y: y + 0.15, z: 0, visibility: 1 }));
  points[4] = { x: x - 0.01, y, z: 0, visibility: 1 };
  points[8] = { x: x + 0.01, y, z: 0, visibility: 1 };
  return points;
}
function frame(time: number, distance = 0.4, y = 0.5, angle = 0): ThorFrame {
  return { ...EMPTY_FRAME, timestamp: time,
    hands: [hand(0.5 - Math.cos(angle) * distance / 2, y - Math.sin(angle) * distance / 2), hand(0.5 + Math.cos(angle) * distance / 2, y + Math.sin(angle) * distance / 2)],
    handedness: ["Left", "Right"], handConfidences: [0.99, 0.99] };
}
beforeEach(() => { [pinchPan, pinchZoom, pinchRotate, pinchPitch, fist].forEach(h => h.reset?.()); });
describe("deliberate hand motion", () => {
  it("zooms proportionally across different starting hand spans", () => {
    const changes = [0.2, 0.4].map(span => {
      pinchZoom.reset?.(); pinchZoom.detect(frame(0, span)); pinchZoom.detect(frame(150, span));
      let view = { longitude: 0, latitude: 0, zoom: 2 };
      for (let i = 1; i <= 20; i++) {
        const d = pinchZoom.detect(frame(150 + i * 33, span * (1 + Math.min(i, 10) * 0.025)));
        if (d) view = pinchZoom.apply(d, view, cfg);
      }
      return view.zoom - 2;
    });
    expect(changes[0]).toBeCloseTo(changes[1], 5);
    expect(changes[0]).toBeGreaterThan(0.29);
    expect(changes[0]).toBeLessThan(0.33);
  });
  it("rebases zoom after a tracking spike without jumping", () => {
    pinchZoom.detect(frame(0)); pinchZoom.detect(frame(150));
    expect(pinchZoom.detect(frame(183, 0.8))).toBeNull();
    expect(pinchZoom.detect(frame(216, 0.8))).toBeNull();
  });
  it.each([
    [pinchZoom, (i: number) => frame(200 + i * 33, 0.4 + i * cfg.zoomDeadzone / 4), "zoom"],
    [pinchPitch, (i: number) => frame(200 + i * 33, 0.4, 0.5 + i * cfg.pitchDeadzone / 4), "pitch"],
    [pinchRotate, (i: number) => frame(200 + i * 33, 0.4, 0.5, i * cfg.rotateDeadzone / 4), "bearing"],
  ] as const)("accumulates slow movement for $name", (handler, next, property) => {
    handler.detect(frame(0)); handler.detect(frame(150));
    let view = { longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 };
    for (let i = 1; i <= 8; i++) {
      const detection = handler.detect(next(i));
      if (detection) view = handler.apply(detection, view, cfg) as typeof view;
    }
    expect(view[property]).toBeGreaterThan(property === "zoom" ? 2 : 0);
  });
  it.each([pinchZoom, pinchPitch, pinchRotate])("requires fresh confirmation after hand loss for $name", handler => {
    handler.detect(frame(0)); handler.detect(frame(150));
    handler.detect({ ...EMPTY_FRAME, timestamp: 200 });
    expect(handler.detect(frame(250))).toBeNull();
    expect(handler.detect(frame(280, 0.6, 0.7, 0.2))).toBeNull();
  });
  it("does not jump when the panning hand changes", () => {
    const one = (t: number, x: number, side: "Left" | "Right") => ({ ...frame(t), hands: [hand(x)], handedness: [side], handConfidences: [0.99] });
    pinchPan.detect(one(0, 0.2, "Left")); pinchPan.detect(one(150, 0.2, "Left"));
    expect(pinchPan.detect(one(200, 0.3, "Left"))).not.toBeNull();
    expect(pinchPan.detect(one(250, 0.8, "Right"))).toBeNull();
  });
  it("fires a fist action once outside replayable view updates", () => {
    const action = vi.fn(); setFistAction(action);
    const curled = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    const f = (timestamp: number) => ({ ...EMPTY_FRAME, timestamp, hands: [curled], handedness: ["Left" as const], handConfidences: [0.99] });
    fist.detect(f(0));
    const d = fist.detect(f(400))!;
    fist.onTrigger?.(d);
    const vs = { longitude: 0, latitude: 0, zoom: 2 };
    fist.apply(d, vs, cfg); fist.apply(d, vs, cfg);
    fist.onTrigger?.(fist.detect(f(600))!);
    expect(action).toHaveBeenCalledTimes(1);
    setFistAction(null);
  });
});
