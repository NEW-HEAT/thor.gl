/** Matching, pinned MediaPipe assets; every engine owns its detector. */
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { ThorFrame, DetectorMode, BodyPart } from "./types";

export const VISION_VERSION = "1.0.1";
const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const HOLISTIC_MODEL = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";

export interface DetectorConfig {
  mode: DetectorMode;
  requiredParts: Set<BodyPart>;
  numHands?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
}

export function createDetector() {
  let hand: HandLandmarker | null = null;
  let holistic: any = null;
  let mode: "hands" | "holistic" | null = null;
  let generation = 0;

  function destroy() {
    generation++;
    hand?.close();
    holistic?.close();
    hand = null;
    holistic = null;
    mode = null;
  }

  async function init(config: DetectorConfig) {
    destroy();
    const token = generation;
    const wanted = config.mode === "auto"
      ? config.requiredParts.has("face") || config.requiredParts.has("pose") ? "holistic" : "hands"
      : config.mode;
    const tasks = await import("@mediapipe/tasks-vision");
    if (token !== generation) return;
    const vision = await tasks.FilesetResolver.forVisionTasks(WASM_PATH);
    if (token !== generation) return;
    let instance: any;
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        if (wanted === "hands") {
          instance = await tasks.HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate },
            runningMode: "VIDEO", numHands: config.numHands ?? 2,
            minHandDetectionConfidence: config.minDetectionConfidence ?? 0.5,
            minHandPresenceConfidence: config.minDetectionConfidence ?? 0.5,
            minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
          });
        } else {
          const { HolisticLandmarker } = tasks as any;
          if (!HolisticLandmarker) throw new Error("Full-body tracking is unavailable in this runtime. Use hand tracking.");
          instance = await HolisticLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HOLISTIC_MODEL, delegate }, runningMode: "VIDEO",
          });
        }
        break;
      } catch (error) {
        if (token !== generation) return;
        if (delegate === "CPU") throw error;
      }
    }
    if (token !== generation) { instance?.close(); return; }
    if (wanted === "hands") hand = instance;
    else holistic = instance;
    mode = wanted;
  }

  function detect(video: HTMLVideoElement, timestamp: number): ThorFrame | null {
    if (video.readyState < 2) return null;
    if (hand) {
      const result = hand.detectForVideo(video, timestamp);
      // Stable slots prevent a half-turn jump when MediaPipe reorders hands.
      const indices = result.landmarks.map((_, i) => i).sort((a, b) =>
        (result.handedness[a]?.[0]?.categoryName ?? "").localeCompare(result.handedness[b]?.[0]?.categoryName ?? ""));
      return {
        timestamp, hands: indices.map(i => result.landmarks[i]),
        handedness: indices.map(i => result.handedness[i]?.[0]?.categoryName as "Left" | "Right"),
        handConfidences: indices.map(i => result.handedness[i]?.[0]?.score ?? 0),
        face: null, blendshapes: null, pose: null,
      };
    }
    if (holistic) {
      const r = holistic.detectForVideo(video, timestamp);
      const entries = [
        { landmarks: r.leftHandLandmarks?.[0], side: "Left" as const },
        { landmarks: r.rightHandLandmarks?.[0], side: "Right" as const },
      ].filter(h => h.landmarks?.length);
      return {
        timestamp, hands: entries.map(h => h.landmarks), handedness: entries.map(h => h.side),
        // Holistic has no per-hand score; presence is used for the gesture gate.
        handConfidences: entries.map(() => 1),
        face: r.faceLandmarks?.[0]?.length ? r.faceLandmarks[0] : null,
        pose: r.poseLandmarks?.[0]?.length ? r.poseLandmarks[0] : null,
        blendshapes: r.faceBlendshapes?.[0] ?? null,
      };
    }
    return null;
  }
  return { init, detect, destroy, isReady: () => !!(hand || holistic), getActiveMode: () => mode };
}

const shared = createDetector();
export const initDetector = shared.init;
export const detect = shared.detect;
export const destroyDetector = shared.destroy;
export const isReady = shared.isReady;
export const getActiveMode = shared.getActiveMode;
