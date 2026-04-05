/**
 * Head-Tilt gesture: head rotation → bearing/pitch adjustment.
 *
 * Derives head orientation from face landmark positions.
 * Tilting left/right adjusts bearing, nodding adjusts pitch.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { FACE } from "../../detection/landmarks";

let prevYaw: number | null = null;
let prevPitch: number | null = null;

const YAW_SENSITIVITY = 0.5;
const PITCH_SENSITIVITY = 0.3;
const DEADZONE = 0.01;

function getFaceOrientation(face: import("../../detection/types").FaceLandmarks) {
  // Use nose tip + forehead + chin to estimate head rotation
  const nose = face[FACE.NOSE_TIP];
  const forehead = face[FACE.FOREHEAD];
  const chin = face[FACE.CHIN];
  const mouthL = face[FACE.MOUTH_LEFT];
  const mouthR = face[FACE.MOUTH_RIGHT];

  if (!nose || !forehead || !chin || !mouthL || !mouthR) return null;

  // Yaw: nose position relative to mouth center
  const mouthCenterX = (mouthL.x + mouthR.x) / 2;
  const yaw = nose.x - mouthCenterX; // positive = turned right

  // Pitch: vertical position of nose relative to forehead-chin axis
  const faceHeight = chin.y - forehead.y;
  if (faceHeight < 0.01) return null;
  const noseRelative = (nose.y - forehead.y) / faceHeight;
  const pitch = noseRelative - 0.4; // 0.4 is roughly neutral

  return { yaw, pitch };
}

export const headTilt: GestureHandler = {
  name: "head-tilt",
  requires: ["face"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.face) return null;

    const orientation = getFaceOrientation(frame.face);
    if (!orientation) return null;

    if (prevYaw === null || prevPitch === null) {
      prevYaw = orientation.yaw;
      prevPitch = orientation.pitch;
      return null;
    }

    const yawDelta = orientation.yaw - prevYaw;
    const pitchDelta = orientation.pitch - prevPitch;
    prevYaw = orientation.yaw;
    prevPitch = orientation.pitch;

    if (Math.abs(yawDelta) < DEADZONE && Math.abs(pitchDelta) < DEADZONE) {
      return null;
    }

    return {
      gesture: "head-tilt",
      data: { yawDelta, pitchDelta },
    };
  },

  apply(detection, viewState, _config): ViewState {
    const { yawDelta, pitchDelta } = detection.data as {
      yawDelta: number;
      pitchDelta: number;
    };

    return {
      ...viewState,
      bearing: (viewState.bearing ?? 0) + yawDelta * YAW_SENSITIVITY * 100,
      pitch: Math.max(
        0,
        Math.min(85, (viewState.pitch ?? 0) + pitchDelta * PITCH_SENSITIVITY * 100)
      ),
    };
  },

  reset() {
    prevYaw = null;
    prevPitch = null;
  },
};
