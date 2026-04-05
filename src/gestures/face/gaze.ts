/**
 * Gaze gesture: iris position → viewport hover target.
 *
 * Uses iris landmarks to estimate gaze direction.
 * Emits a normalized screen position (0-1) for the gaze point.
 * No viewState change — consumers use this for hover/selection.
 */

import type { GestureHandler, GestureDetection, ViewState, GestureConfig } from "../types";
import type { ThorFrame } from "../../detection/types";
import { FACE, midpoint } from "../../detection/landmarks";

export const gaze: GestureHandler = {
  name: "gaze",
  requires: ["face"],

  detect(frame: ThorFrame): GestureDetection | null {
    if (!frame.face || frame.face.length < 474) return null;

    const leftIris = frame.face[FACE.LEFT_IRIS_CENTER];
    const rightIris = frame.face[FACE.RIGHT_IRIS_CENTER];

    if (!leftIris || !rightIris) return null;

    const gazePoint = midpoint(leftIris, rightIris);

    return {
      gesture: "gaze",
      data: { x: gazePoint.x, y: gazePoint.y },
    };
  },

  apply(_detection, viewState, _config): ViewState {
    // Gaze doesn't modify viewState — it's a hover signal
    return viewState;
  },
};
