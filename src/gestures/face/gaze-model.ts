/**
 * Gaze estimation model for thor.gl.
 *
 * Computes where on-screen the user is looking using:
 *   1. Iris-in-eye position (iris center relative to eye contour)
 *   2. Head pose estimation (yaw/pitch from face landmarks)
 *   3. Optional calibrated polynomial mapping
 *
 * Key insight: VERTICAL gaze on a laptop is driven primarily by head
 * pitch (you tilt your head to look at different screen heights).
 * Iris vertical movement within the eye is tiny and noisy.
 * HORIZONTAL gaze uses both head yaw and iris-in-eye position.
 */

import type { FaceLandmarks } from "../../detection/types";

// ── Eye contour landmark indices (MediaPipe 478-point face mesh) ──
// Using multiple points per edge for a more stable bounding box

const LEFT_EYE = {
  // Horizontal bounds — multiple points averaged for stability
  OUTER_POINTS: [33, 246, 161],  // outer corner region
  INNER_POINTS: [133, 173, 157], // inner corner region
  // Vertical: use the bony orbit (more stable than eyelid)
  TOP_ORBIT: [27, 28, 56],       // brow bone — doesn't move with blinks
  BOTTOM_ORBIT: [110, 111, 117], // cheekbone — stable reference
  IRIS: 468,
};

const RIGHT_EYE = {
  OUTER_POINTS: [263, 466, 388],
  INNER_POINTS: [362, 398, 384],
  TOP_ORBIT: [257, 258, 286],
  BOTTOM_ORBIT: [339, 340, 346],
  IRIS: 473,
};

const HEAD_POSE = {
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHIN: 152,
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  LEFT_CHEEK: 234,
  RIGHT_CHEEK: 454,
};

// ── Types ──

export interface GazePoint {
  x: number;
  y: number;
  confidence: number;
}

export interface IrisPosition {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export interface HeadPose {
  /** Yaw: negative = turned left, positive = turned right. Range roughly -0.5 to 0.5 */
  yaw: number;
  /** Pitch: negative = looking down, positive = looking up. Range roughly -0.3 to 0.3 */
  pitch: number;
  roll: number;
  /** Raw vertical position of face in frame (0-1). Used for vertical gaze estimation. */
  faceY: number;
}

export interface CalibrationPoint {
  screenX: number;
  screenY: number;
  irisX: number;
  irisY: number;
  headYaw: number;
  headPitch: number;
  faceY: number;
}

export interface CalibrationData {
  points: CalibrationPoint[];
  coeffsX: number[];
  coeffsY: number[];
  /** Per-feature mean for normalization */
  featureMeans: number[];
  /** Per-feature stddev for normalization */
  featureStds: number[];
  timestamp: number;
}

// ── Helpers ──

function avgLandmarks(face: FaceLandmarks, indices: number[], axis: "x" | "y"): number {
  let sum = 0;
  let count = 0;
  for (const idx of indices) {
    const lm = face[idx];
    if (lm) { sum += lm[axis]; count++; }
  }
  return count > 0 ? sum / count : 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Iris-in-eye extraction ──

export function extractIrisPosition(face: FaceLandmarks): IrisPosition | null {
  const lIris = face[LEFT_EYE.IRIS];
  const rIris = face[RIGHT_EYE.IRIS];
  if (!lIris || !rIris) return null;

  // Left eye — use averaged multi-point bounds for stability
  const lLeft = avgLandmarks(face, LEFT_EYE.OUTER_POINTS, "x");
  const lRight = avgLandmarks(face, LEFT_EYE.INNER_POINTS, "x");
  const lTop = avgLandmarks(face, LEFT_EYE.TOP_ORBIT, "y");
  const lBottom = avgLandmarks(face, LEFT_EYE.BOTTOM_ORBIT, "y");

  const lWidth = lRight - lLeft;
  const lHeight = lBottom - lTop;
  if (lWidth < 0.005 || lHeight < 0.005) return null;

  const leftX = (lIris.x - lLeft) / lWidth;
  const leftY = (lIris.y - lTop) / lHeight;

  // Right eye
  const rLeft = avgLandmarks(face, RIGHT_EYE.INNER_POINTS, "x");
  const rRight = avgLandmarks(face, RIGHT_EYE.OUTER_POINTS, "x");
  const rTop = avgLandmarks(face, RIGHT_EYE.TOP_ORBIT, "y");
  const rBottom = avgLandmarks(face, RIGHT_EYE.BOTTOM_ORBIT, "y");

  const rWidth = rRight - rLeft;
  const rHeight = rBottom - rTop;
  if (rWidth < 0.005 || rHeight < 0.005) return null;

  const rightX = (rIris.x - rLeft) / rWidth;
  const rightY = (rIris.y - rTop) / rHeight;

  return { leftX, leftY, rightX, rightY };
}

// ── Head pose estimation ──

export function extractHeadPose(face: FaceLandmarks): HeadPose | null {
  const nose = face[HEAD_POSE.NOSE_TIP];
  const forehead = face[HEAD_POSE.FOREHEAD];
  const chin = face[HEAD_POSE.CHIN];
  const eyeL = face[HEAD_POSE.LEFT_EYE_OUTER];
  const eyeR = face[HEAD_POSE.RIGHT_EYE_OUTER];

  if (!nose || !forehead || !chin || !eyeL || !eyeR) return null;

  const eyeMidX = (eyeL.x + eyeR.x) / 2;
  const eyeWidth = eyeR.x - eyeL.x;
  if (eyeWidth < 0.01) return null;

  // Yaw: nose offset from eye midpoint, normalized by eye width
  const yaw = (nose.x - eyeMidX) / eyeWidth;

  // Pitch: use nose-to-forehead vs nose-to-chin ratio
  // When looking down, nose appears closer to chin. When looking up, closer to forehead.
  const noseToForehead = nose.y - forehead.y;
  const noseToChin = chin.y - nose.y;
  const faceHeight = chin.y - forehead.y;
  if (faceHeight < 0.02) return null;

  // Ratio of upper face to total face — ~0.38 is neutral
  const upperRatio = noseToForehead / faceHeight;
  const pitch = (0.38 - upperRatio) * 3.0; // Amplified — this is our primary vertical signal

  // Roll
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);

  // Raw face Y position in camera frame (for vertical gaze backup signal)
  const faceY = (forehead.y + chin.y) / 2;

  return { yaw, pitch, roll, faceY };
}

// ── Uncalibrated gaze ──

export function estimateGazeUncalibrated(
  iris: IrisPosition,
  headPose: HeadPose
): GazePoint {
  const irisX = (iris.leftX + iris.rightX) / 2;
  const irisY = (iris.leftY + iris.rightY) / 2;

  // HORIZONTAL: head yaw is primary, iris X adds precision
  const eyeDevX = (irisX - 0.5) * 2;
  const gazeX = 0.5 + headPose.yaw * 1.8 + eyeDevX * 1.0;

  // VERTICAL: head pitch is PRIMARY signal (amplified 3x in extraction).
  // Face Y position in frame is a strong secondary signal.
  // Iris Y contributes minimally — it's too noisy.
  const faceYOffset = (headPose.faceY - 0.45) * 1.5; // 0.45 is roughly centered
  const eyeDevY = (irisY - 0.5) * 2;
  const gazeY = 0.5 - headPose.pitch * 1.4 + faceYOffset * 0.4 + eyeDevY * 0.15;

  const eyeAgreement = 1 - Math.abs(iris.leftX - iris.rightX) * 3;
  const confidence = clamp(eyeAgreement * 0.7 + 0.3, 0, 1);

  return {
    x: clamp(gazeX, 0, 1),
    y: clamp(gazeY, 0, 1),
    confidence,
  };
}

// ── Calibrated gaze ──

export function estimateGazeCalibrated(
  iris: IrisPosition,
  headPose: HeadPose,
  calibration: CalibrationData
): GazePoint {
  const raw = buildRawFeatures(iris, headPose);
  const normalized = normalizeFeatures(raw, calibration.featureMeans, calibration.featureStds);

  const gazeX = evalPolynomial(calibration.coeffsX, normalized);
  const gazeY = evalPolynomial(calibration.coeffsY, normalized);

  const eyeAgreement = 1 - Math.abs(iris.leftX - iris.rightX) * 3;
  const confidence = clamp(eyeAgreement * 0.8 + 0.2, 0, 1);

  return {
    x: clamp(gazeX, 0, 1),
    y: clamp(gazeY, 0, 1),
    confidence,
  };
}

// ── Calibration fitting ──

export function fitCalibration(points: CalibrationPoint[]): CalibrationData {
  if (points.length < 4) throw new Error("Need at least 4 calibration points");

  // Build raw feature vectors
  const rawFeatures = points.map((p) => [
    p.irisX, p.irisY, p.headYaw, p.headPitch, p.faceY,
  ]);

  // Compute per-feature mean and stddev for normalization
  const nFeatures = rawFeatures[0].length;
  const means = new Array(nFeatures).fill(0);
  const stds = new Array(nFeatures).fill(0);

  for (const f of rawFeatures) {
    for (let i = 0; i < nFeatures; i++) means[i] += f[i];
  }
  for (let i = 0; i < nFeatures; i++) means[i] /= rawFeatures.length;

  for (const f of rawFeatures) {
    for (let i = 0; i < nFeatures; i++) stds[i] += (f[i] - means[i]) ** 2;
  }
  for (let i = 0; i < nFeatures; i++) {
    stds[i] = Math.sqrt(stds[i] / rawFeatures.length) || 1; // avoid div by zero
  }

  // Normalize and build polynomial features
  const features = rawFeatures.map((f) => {
    const n = f.map((v, i) => (v - means[i]) / stds[i]);
    return expandFeatures(n);
  });

  const targetX = points.map((p) => p.screenX);
  const targetY = points.map((p) => p.screenY);

  const coeffsX = leastSquares(features, targetX);
  const coeffsY = leastSquares(features, targetY);

  return {
    points,
    coeffsX,
    coeffsY,
    featureMeans: means,
    featureStds: stds,
    timestamp: Date.now(),
  };
}

// ── Combined estimator ──

export function estimateGaze(
  face: FaceLandmarks,
  calibration: CalibrationData | null
): GazePoint | null {
  if (!face || face.length < 474) return null;

  const iris = extractIrisPosition(face);
  if (!iris) return null;

  const headPose = extractHeadPose(face);
  if (!headPose) return null;

  if (calibration && calibration.coeffsX.length > 0) {
    return estimateGazeCalibrated(iris, headPose, calibration);
  }

  return estimateGazeUncalibrated(iris, headPose);
}

// ── Math internals ──

function buildRawFeatures(iris: IrisPosition, headPose: HeadPose): number[] {
  const irisX = (iris.leftX + iris.rightX) / 2;
  const irisY = (iris.leftY + iris.rightY) / 2;
  return [irisX, irisY, headPose.yaw, headPose.pitch, headPose.faceY];
}

function normalizeFeatures(raw: number[], means: number[], stds: number[]): number[] {
  return raw.map((v, i) => (v - means[i]) / stds[i]);
}

/** Expand normalized features into polynomial basis */
function expandFeatures(n: number[]): number[] {
  const [ix, iy, hw, hp, fy] = n;
  return [
    ix, iy, hw, hp, fy,           // linear
    ix * ix, iy * iy, hw * hw, hp * hp, // quadratic
    ix * iy, ix * hw, iy * hp,     // cross terms
    1,                              // bias
  ];
}

function evalPolynomial(coeffs: number[], features: number[]): number {
  const expanded = expandFeatures(features);
  let sum = 0;
  for (let i = 0; i < Math.min(coeffs.length, expanded.length); i++) {
    sum += coeffs[i] * expanded[i];
  }
  return sum;
}

function leastSquares(features: number[][], targets: number[]): number[] {
  const n = features.length;
  const m = features[0].length;

  const FtF: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += features[k][i] * features[k][j];
      FtF[i][j] = sum;
    }
  }

  const FtY: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += features[k][i] * targets[k];
    FtY[i] = sum;
  }

  // Ridge regularization — stronger to prevent overfitting with few points
  for (let i = 0; i < m; i++) FtF[i][i] += 0.01;

  return solveLinear(FtF, FtY);
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let col = row + 1; col < n; col++) sum -= aug[row][col] * x[col];
    const diag = aug[row][row];
    x[row] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }
  return x;
}
