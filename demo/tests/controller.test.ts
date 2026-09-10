import { expect, it } from "vitest";
import { _GlobeViewport as GlobeViewport } from "@deck.gl/core";
import { MotionController } from "../MotionController";

function replay(velocity: number, inertia = 168) {
  let latest: any;
  const controller = new MotionController({
    makeViewport: options => new GlobeViewport(options),
    onViewStateChange: ({ viewState }) => { latest = viewState; },
    onStateChange: () => {},
  } as any);
  const props = { id: "world", x: 0, y: 0, width: 1280, height: 720,
    longitude: 8.5, latitude: 25, zoom: 1.2, bearing: 0, pitch: 0, inertia };
  controller.setProps(props);
  const event = (type: string, x: number) => ({ type, offsetCenter: { x, y: 360 },
    srcEvent: {}, velocity, velocityX: velocity, velocityY: 0, stopPropagation() {} } as any);
  controller.handleEvent(event("panstart", 590));
  controller.setProps({ ...props, ...latest, transitionDuration: 0 });
  controller.handleEvent(event("panmove", 690));
  const dragged = latest;
  controller.setProps({ ...props, ...latest, transitionDuration: 0 });
  controller.handleEvent(event("panend", 690));
  const coast = latest;
  controller.finalize();
  return { dragged, coast };
}

it("bounds an extreme pointer fling while retaining a small release glide", () => {
  const { dragged, coast } = replay(100);
  const before = new GlobeViewport(dragged);
  const after = new GlobeViewport(coast);
  const anchor = before.unproject([640, 360]);
  const position = after.project(anchor);
  const travel = Math.hypot(position[0] - 640, position[1] - 360);
  expect(travel).toBeGreaterThan(0);
  expect(travel).toBeLessThan(30);
  expect(coast.transitionDuration).toBe(168);
});

it("stops at the dragged position when glide is off or release velocity is zero", () => {
  for (const [velocity, duration] of [[100, 0], [0, 168]]) {
    const { dragged, coast } = replay(velocity, duration);
    expect(coast.longitude).toBeCloseTo(dragged.longitude);
    expect(coast.latitude).toBeCloseTo(dragged.latitude);
  }
});
