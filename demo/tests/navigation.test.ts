import { expect, it } from "vitest";
import { _GlobeViewport as GlobeViewport, WebMercatorViewport } from "@deck.gl/core";
import { panAtlas, zoomOffset } from "../navigation";
import { pinchPan, pinchZoom } from "../../src/gestures";
import { gestureConfig } from "../../src/gestures/config";

const options = { projection: "globe" as const, width: 1280, height: 720, cameraAspect: 16 / 9, sensitivity: 2.4 };
const initial = { longitude: 8.5, latitude: 25, zoom: 1.5, bearing: 0, pitch: 0 };

it("keeps globe scale constant while hand-panning toward the poles", () => {
  const before = new GlobeViewport({ ...initial, width: options.width, height: options.height });
  const next = panAtlas(initial, { dx: 0, dy: 0.6 }, options);
  const after = new GlobeViewport({ ...next, width: options.width, height: options.height });
  expect(next.latitude).toBeGreaterThan(70);
  expect(next.zoom).toBeLessThan(0);
  expect(after.scale).toBeCloseTo(before.scale, 5);
  expect(next.zoom - zoomOffset(next.latitude, "globe")).toBeCloseTo(initial.zoom - zoomOffset(initial.latitude, "globe"), 4);
});

it("routes both hand drag and release through the same native navigation mapping", () => {
  const config = { ...gestureConfig, panSensitivity: 2.4,
    panViewState: (view, delta, sensitivity) => panAtlas(view, delta, { ...options, sensitivity }) };
  const delta = { dx: 0.01, dy: 0.005 };
  const dragged = pinchPan.apply({ gesture: "pinch-pan", data: { ...delta, inertia: false } }, initial, config);
  const glided = pinchPan.apply({ gesture: "pinch-pan", data: { ...delta, inertia: true } }, initial, config);
  expect(glided).toEqual(dragged);
  expect(dragged.longitude).toBeGreaterThan(initial.longitude);
  expect(dragged.latitude).toBeGreaterThan(initial.latitude);
});

it("lets hand zoom move gradually from a negative polar zoom", () => {
  const polar = { ...initial, latitude: 80, zoom: -1 };
  const next = pinchZoom.apply({ gesture: "pinch-zoom", data: { zoomDelta: 0.1 } }, polar, { ...gestureConfig, minZoom: -6 });
  expect(next.zoom).toBeCloseTo(-0.9);
});

it("keeps a vertical hand pan vertical on a tilted flat map", () => {
  const view = { ...initial, zoom: 3, pitch: 60 };
  const next = panAtlas(view, { dx: 0, dy: 0.01 }, { ...options, projection: "map" });
  const after = new WebMercatorViewport({ ...next, width: options.width, height: options.height });
  const point = after.project([view.longitude, view.latitude]);
  expect(point[0]).toBeCloseTo(640, 4);
  expect(point[1]).toBeCloseTo(363.6, 4);
});
