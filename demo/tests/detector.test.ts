import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ vision: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mock.vision },
  HandLandmarker: { createFromOptions: mock.create },
}));
import { createDetector } from "../../src/detection/detector";
const config = { mode: "hands" as const, requiredParts: new Set<"hands">(["hands"]) };
beforeEach(() => { mock.vision.mockReset().mockResolvedValue({}); mock.create.mockReset(); });
it("pins WASM to the installed MediaPipe version", async () => {
  mock.create.mockResolvedValue({ close: vi.fn() });
  const detector = createDetector(); await detector.init(config);
  expect(mock.vision).toHaveBeenCalledWith(expect.stringContaining("@1.0.1/wasm"));
  detector.destroy();
});
it("retries inference on CPU when GPU initialization fails", async () => {
  const model = { close: vi.fn() };
  mock.create.mockRejectedValueOnce(new Error("No GPU context")).mockResolvedValueOnce(model);
  const detector = createDetector(); await detector.init(config);
  expect(mock.create.mock.calls.map(c => c[1].baseOptions.delegate)).toEqual(["GPU", "CPU"]);
  expect(detector.isReady()).toBe(true); detector.destroy();
});
it("closes a model that finishes loading after its detector is destroyed", async () => {
  let resolve!: (value: any) => void;
  mock.create.mockReturnValue(new Promise(r => { resolve = r; }));
  const detector = createDetector(); const loading = detector.init(config);
  await vi.waitFor(() => expect(mock.create).toHaveBeenCalled());
  detector.destroy(); const close = vi.fn(); resolve({ close }); await loading;
  expect(close).toHaveBeenCalledTimes(1); expect(detector.isReady()).toBe(false);
});
it("keeps left and right hands ordered when the model swaps result slots", async () => {
  const left = [{ x: 0.2, y: 0.5, z: 0 }]; const right = [{ x: 0.8, y: 0.5, z: 0 }];
  const detectForVideo = vi.fn().mockReturnValue({ landmarks: [right, left], handedness: [[{ categoryName: "Right", score: 0.95 }], [{ categoryName: "Left", score: 0.9 }]] });
  mock.create.mockResolvedValue({ close: vi.fn(), detectForVideo });
  const detector = createDetector(); await detector.init(config);
  const frame = detector.detect({ readyState: 2 } as HTMLVideoElement, 100)!;
  expect(frame.handedness).toEqual(["Left", "Right"]); expect(frame.hands).toEqual([left, right]);
  expect(frame.handConfidences).toEqual([0.9, 0.95]); detector.destroy();
});
