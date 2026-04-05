/**
 * Unified MediaPipe detector for thor.gl.
 *
 * Wraps HandLandmarker and HolisticLandmarker behind a single interface.
 * Supports three modes:
 *   - "hands": lightweight, only hand landmarks (~8ms/frame)
 *   - "holistic": full body — hands + face + pose in one pass (~15ms/frame)
 *   - "auto": starts with hands, promotes to holistic when face/pose handlers register
 *
 * HolisticLandmarker gracefully returns empty arrays for body parts it can't see,
 * so a holistic detector works fine even if only hands are visible.
 */

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { ThorFrame, DetectorMode, BodyPart } from "./types";
import { EMPTY_FRAME } from "./types";

// CDN URLs for MediaPipe assets
const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const HAND_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// ── State ──

let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null =
  null;
let handLandmarker: HandLandmarker | null = null;
let activeMode: "hands" | "holistic" | null = null;
let initPromise: Promise<void> | null = null;

// ── Holistic support ──
// HolisticLandmarker requires a separate import path. We'll dynamic-import
// it only when needed so the hands-only path stays lightweight.
let holisticLandmarker: any = null;

async function ensureVision(): Promise<typeof vision> {
  if (vision) return vision;
  console.log("[thor.gl] Loading vision WASM...");
  vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  return vision;
}

export interface DetectorConfig {
  mode: DetectorMode;
  /** Required body parts (from registered gesture handlers) */
  requiredParts: Set<BodyPart>;
  numHands?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
}

/**
 * Resolve which concrete detector to use.
 * "auto" picks based on what body parts are needed.
 */
function resolveMode(
  mode: DetectorMode,
  requiredParts: Set<BodyPart>
): "hands" | "holistic" {
  if (mode === "hands") return "hands";
  if (mode === "holistic") return "holistic";
  // auto: promote if face or pose handlers are registered
  if (requiredParts.has("face") || requiredParts.has("pose")) return "holistic";
  return "hands";
}

/**
 * Initialize the detector. Safe to call multiple times — reuses cached instance.
 * If mode changes (e.g. auto promotes from hands → holistic), tears down and reinits.
 */
export async function initDetector(config: DetectorConfig): Promise<void> {
  const targetMode = resolveMode(config.mode, config.requiredParts);

  // Already initialized in the right mode
  if (activeMode === targetMode && (handLandmarker || holisticLandmarker)) {
    return;
  }

  // Wait for any in-flight init
  if (initPromise) await initPromise;

  // Tear down existing detector if mode changed
  if (activeMode && activeMode !== targetMode) {
    destroyDetector();
  }

  initPromise = (async () => {
    try {
      const v = await ensureVision();

      if (targetMode === "hands") {
        console.log("[thor.gl] Creating HandLandmarker...");
        handLandmarker = await HandLandmarker.createFromOptions(v!, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_PATH,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: config.numHands ?? 2,
          minHandDetectionConfidence: config.minDetectionConfidence ?? 0.5,
          minHandPresenceConfidence: config.minDetectionConfidence ?? 0.5,
          minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
        });
        console.log("[thor.gl] HandLandmarker ready");
      } else {
        // Holistic — dynamic import to keep hands-only path light
        console.log("[thor.gl] Creating HolisticLandmarker...");
        try {
          const mod = await import("@mediapipe/tasks-vision");
          const HolisticLandmarker = (mod as any).HolisticLandmarker;
          if (!HolisticLandmarker) {
            // HolisticLandmarker may not be available in all versions.
            // Fall back to HandLandmarker + log warning.
            console.warn(
              "[thor.gl] HolisticLandmarker not available in this @mediapipe/tasks-vision version. Falling back to HandLandmarker."
            );
            handLandmarker = await HandLandmarker.createFromOptions(v!, {
              baseOptions: {
                modelAssetPath: HAND_MODEL_PATH,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numHands: config.numHands ?? 2,
              minHandDetectionConfidence: config.minDetectionConfidence ?? 0.5,
              minHandPresenceConfidence: config.minDetectionConfidence ?? 0.5,
              minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
            });
            activeMode = "hands";
            initPromise = null;
            return;
          }

          holisticLandmarker = await HolisticLandmarker.createFromOptions(v!, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
          });
          console.log("[thor.gl] HolisticLandmarker ready");
        } catch (err) {
          console.warn(
            "[thor.gl] HolisticLandmarker failed, falling back to HandLandmarker:",
            err
          );
          handLandmarker = await HandLandmarker.createFromOptions(v!, {
            baseOptions: {
              modelAssetPath: HAND_MODEL_PATH,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numHands: config.numHands ?? 2,
            minHandDetectionConfidence: config.minDetectionConfidence ?? 0.5,
            minHandPresenceConfidence: config.minDetectionConfidence ?? 0.5,
            minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
          });
          activeMode = "hands";
          initPromise = null;
          return;
        }
      }

      activeMode = targetMode;
    } catch (error) {
      console.error("[thor.gl] Detector init failed:", error);
      initPromise = null;
      throw error;
    }
  })();

  await initPromise;
  initPromise = null;
}

/**
 * Detect from a video frame. Returns a ThorFrame with whatever data is available.
 */
export function detect(
  video: HTMLVideoElement,
  timestamp: number
): ThorFrame | null {
  if (video.readyState < 2) return null;

  try {
    if (holisticLandmarker && activeMode === "holistic") {
      return detectHolistic(video, timestamp);
    }
    if (handLandmarker) {
      return detectHands(video, timestamp);
    }
    return null;
  } catch (error) {
    console.error("[thor.gl] Detection error:", error);
    return null;
  }
}

function detectHands(
  video: HTMLVideoElement,
  timestamp: number
): ThorFrame {
  const result: HandLandmarkerResult = handLandmarker!.detectForVideo(
    video,
    timestamp
  );

  const hands: NormalizedLandmark[][] = result.landmarks || [];
  const rawHandedness = result.handedness || [];
  const handedness = rawHandedness.map(
    (h) => (h[0]?.categoryName as "Left" | "Right") || "Right"
  );
  const handConfidences = rawHandedness.map((h) => h[0]?.score ?? 0);

  return {
    timestamp,
    hands,
    handedness,
    handConfidences,
    face: null,
    blendshapes: null,
    pose: null,
  };
}

function detectHolistic(
  video: HTMLVideoElement,
  timestamp: number
): ThorFrame {
  const result = holisticLandmarker.detectForVideo(video, timestamp);

  // HolisticLandmarker wraps all results in outer arrays (one per person).
  // We unwrap [0] to get the actual landmark arrays.
  const hands: NormalizedLandmark[][] = [];
  const handedness: ("Left" | "Right")[] = [];
  const handConfidences: number[] = [];

  // Left hand — result.leftHandLandmarks is NormalizedLandmark[][] (wrapped)
  const leftHand = result.leftHandLandmarks?.[0];
  if (leftHand?.length) {
    hands.push(leftHand);
    handedness.push("Left");
    handConfidences.push(0.9); // holistic doesn't give per-hand confidence; estimate high
  }
  // Right hand
  const rightHand = result.rightHandLandmarks?.[0];
  if (rightHand?.length) {
    hands.push(rightHand);
    handedness.push("Right");
    handConfidences.push(0.9);
  }

  // Face — result.faceLandmarks is NormalizedLandmark[][] (wrapped)
  const faceRaw = result.faceLandmarks?.[0];
  const face = faceRaw?.length > 0 ? faceRaw : null;

  // Pose — result.poseLandmarks is NormalizedLandmark[][] (wrapped)
  const poseRaw = result.poseLandmarks?.[0];
  const pose = poseRaw?.length > 0 ? poseRaw : null;

  // Blendshapes
  let blendshapes: import("./types").Blendshapes | null = null;
  if (result.faceBlendshapes?.length > 0) {
    blendshapes = { categories: result.faceBlendshapes[0].categories || [] };
  }

  return {
    timestamp,
    hands,
    handedness,
    handConfidences,
    face,
    blendshapes,
    pose,
  };
}

/** Check if the detector is initialized and ready. */
export function isReady(): boolean {
  return handLandmarker !== null || holisticLandmarker !== null;
}

/** Get the current active detector mode. */
export function getActiveMode(): "hands" | "holistic" | null {
  return activeMode;
}

/** Tear down the detector and free resources. */
export function destroyDetector(): void {
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
  if (holisticLandmarker) {
    holisticLandmarker.close();
    holisticLandmarker = null;
  }
  activeMode = null;
  initPromise = null;
  console.log("[thor.gl] Detector destroyed");
}
