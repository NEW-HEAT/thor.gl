import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ init: vi.fn(), destroy: vi.fn(), detect: vi.fn() }));
vi.mock("../../src/detection/detector", () => ({ createDetector: () => mock }));
import { createEngine } from "../../src/engine";
import { EMPTY_FRAME } from "../../src/detection/types";
import { registerGesture, unregisterGesture } from "../../src/gestures";

let stopTrack: ReturnType<typeof vi.fn>;
let getMedia: ReturnType<typeof vi.fn>;
let source: any;
let tick: FrameRequestCallback;
let engine: ReturnType<typeof createEngine>;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  stopTrack = vi.fn();
  const track = { stop: stopTrack, addEventListener: vi.fn() };
  getMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
  source = { style: {}, play: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), currentTime: 0, srcObject: null };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: getMedia } });
  vi.stubGlobal("document", { createElement: () => source, body: { appendChild: vi.fn() }, hidden: false });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { tick = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mock.init.mockReset().mockResolvedValue(undefined);
  mock.destroy.mockClear();
  mock.detect.mockReset().mockReturnValue(EMPTY_FRAME);
});
afterEach(() => { engine?.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("reports startup stages and reuses the stream for live controls", async () => {
  const status = vi.fn();
  engine = createEngine({ detector: "hands", onViewStateChange: vi.fn(), onStatus: status });
  await engine.start();
  expect(status.mock.calls.map(c => c[0])).toEqual(["camera", "model", "running"]);
  engine.setPaused(true); engine.setGestures(["pinch-pan"]); engine.setPaused(false);
  expect(getMedia).toHaveBeenCalledTimes(1); expect(mock.init).toHaveBeenCalledTimes(1);
  engine.stop(); expect(stopTrack).toHaveBeenCalledTimes(1); expect(source.srcObject).toBeNull();
});
it("releases a permission request that resolves after stop", async () => {
  let resolve!: (value: any) => void;
  const late = new Promise(r => { resolve = r; }); getMedia.mockReturnValue(late);
  engine = createEngine({ detector: "hands", onViewStateChange: vi.fn() });
  const starting = engine.start(); engine.stop();
  resolve({ getTracks: () => [{ stop: stopTrack }] }); await starting;
  expect(stopTrack).toHaveBeenCalledTimes(1); expect(mock.init).not.toHaveBeenCalled();
});
it("does not restart after stop during model loading", async () => {
  let resolve!: () => void;
  mock.init.mockReturnValue(new Promise<void>(r => { resolve = r; }));
  const status = vi.fn(); engine = createEngine({ detector: "hands", onViewStateChange: vi.fn(), onStatus: status });
  const starting = engine.start(); await settle(); engine.stop(); resolve(); await starting;
  expect(status.mock.calls.map(c => c[0])).not.toContain("running");
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it("cleans up camera resources and surfaces model failures", async () => {
  mock.init.mockRejectedValue(new Error("Model unavailable"));
  const status = vi.fn(); engine = createEngine({ detector: "hands", onViewStateChange: vi.fn(), onStatus: status });
  await expect(engine.start()).rejects.toThrow("Model unavailable");
  expect(stopTrack).toHaveBeenCalledTimes(1); expect(engine.getVideo()).toBeNull();
  expect(status).toHaveBeenLastCalledWith("error", expect.any(Error));
});
it("bounds startup and cleans up a late stream", async () => {
  let resolve!: (value: any) => void;
  getMedia.mockReturnValue(new Promise(r => { resolve = r; }));
  engine = createEngine({ detector: "hands", onViewStateChange: vi.fn() });
  const result = expect(engine.start()).rejects.toThrow("took too long");
  await vi.advanceTimersByTimeAsync(45000); await result;
  resolve({ getTracks: () => [{ stop: stopTrack }] }); await settle();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it("an open palm stops pan movement and resets momentum", async () => {
  const panApply = vi.fn((_: any, vs: any) => ({ ...vs, longitude: vs.longitude + 20 }));
  const reset = vi.fn();
  registerGesture({ name: "pinch-test", requires: ["hands"], detect: () => ({ gesture: "pinch-test", data: {} }), apply: panApply, reset }, { group: "navigation" });
  registerGesture({ name: "open-palm-test", requires: ["hands"], detect: () => ({ gesture: "open-palm", data: {} }), apply: (_, vs) => vs }, { group: "signal" });
  engine = createEngine({ detector: "hands", gestures: ["pinch-test", "open-palm-test"], onViewStateChange: fn => fn({ longitude: 0, latitude: 0, zoom: 2 }) });
  await engine.start(); source.currentTime = 1; tick(100);
  expect(panApply).not.toHaveBeenCalled(); expect(reset).toHaveBeenCalled();
  unregisterGesture("pinch-test"); unregisterGesture("open-palm-test");
});
