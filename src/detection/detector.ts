/**
 * Unified MediaPipe detector for thor.gl.
 *
 * Wraps MediaPipe Tasks landmarkers behind a single interface.
 * Supports three modes:
 *   - "hands": lightweight, only hand landmarks (~8ms/frame)
 *   - "holistic": full body — hands + face + pose in one pass (~15ms/frame)
 *   - "auto": starts with hands, promotes to holistic when face/pose handlers register
 *
 * The "holistic" mode runs the needed hand, face, and pose Tasks models
 * together. MediaPipe Tasks JS does not expose a HolisticLandmarker class in
 * every release, so this module composes the stable single-purpose models.
 */

import {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
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
const FACE_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const POSE_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

// ── State ──

let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null =
  null;
let handLandmarker: HandLandmarker | null = null;
let faceLandmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let activeMode: "hands" | "holistic" | null = null;
let initPromise: Promise<void> | null = null;

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
  if (activeMode === targetMode && (handLandmarker || faceLandmarker || poseLandmarker)) {
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
        console.log("[thor.gl] Creating multi-task landmarkers...");
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

        if (config.requiredParts.has("face") || config.mode === "holistic") {
          faceLandmarker = await FaceLandmarker.createFromOptions(v!, {
            baseOptions: {
              modelAssetPath: FACE_MODEL_PATH,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
            minFaceDetectionConfidence: config.minDetectionConfidence ?? 0.5,
            minFacePresenceConfidence: config.minDetectionConfidence ?? 0.5,
            minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
          });
        }

        if (config.requiredParts.has("pose") || config.mode === "holistic") {
          poseLandmarker = await PoseLandmarker.createFromOptions(v!, {
            baseOptions: {
              modelAssetPath: POSE_MODEL_PATH,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: config.minDetectionConfidence ?? 0.5,
            minPosePresenceConfidence: config.minDetectionConfidence ?? 0.5,
            minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
          });
        }

        console.log("[thor.gl] Multi-task landmarkers ready");
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
    if (activeMode === "holistic") {
      return detectMultiTask(video, timestamp);
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

function detectMultiTask(
  video: HTMLVideoElement,
  timestamp: number
): ThorFrame {
  const hands: NormalizedLandmark[][] = [];
  const handedness: ("Left" | "Right")[] = [];
  const handConfidences: number[] = [];

  if (handLandmarker) {
    const handResult: HandLandmarkerResult = handLandmarker.detectForVideo(
      video,
      timestamp
    );
    hands.push(...(handResult.landmarks || []));
    const rawHandedness = handResult.handedness || [];
    handedness.push(
      ...rawHandedness.map(
        (h) => (h[0]?.categoryName as "Left" | "Right") || "Right"
      )
    );
    handConfidences.push(...rawHandedness.map((h) => h[0]?.score ?? 0));
  }

  const faceResult = faceLandmarker?.detectForVideo(video, timestamp);
  const faceRaw = faceResult?.faceLandmarks?.[0];
  const face = faceRaw && faceRaw.length > 0 ? faceRaw : null;

  const poseResult = poseLandmarker?.detectForVideo(video, timestamp);
  const poseRaw = poseResult?.landmarks?.[0];
  const pose = poseRaw && poseRaw.length > 0 ? poseRaw : null;

  let blendshapes: import("./types").Blendshapes | null = null;
  const faceBlendshapes = faceResult?.faceBlendshapes;
  if (faceBlendshapes && faceBlendshapes.length > 0) {
    blendshapes = { categories: faceBlendshapes[0].categories || [] };
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
  return handLandmarker !== null || faceLandmarker !== null || poseLandmarker !== null;
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
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
  }
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
  }
  activeMode = null;
  initPromise = null;
  console.log("[thor.gl] Detector destroyed");
}
