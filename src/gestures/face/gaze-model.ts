/**
 * Gaze estimation model for thor.gl.
 *
 * Computes where on-screen the user is looking using:
 *   1. Iris-in-eye position (iris center relative to eye contour)
 *   2. Head pose estimation (yaw/pitch from face landmarks)
 *   3. Calibrated polynomial mapping (iris coords → screen coords)
 *
 * Without calibration, falls back to a geometric model assuming a
 * standard laptop with integrated webcam.
 *
 * All coordinates are normalized 0-1 (top-left origin for screen).
 */

import type { FaceLandmarks } from "../../detection/types";

// ── Eye contour landmark indices (MediaPipe face mesh 478-point model) ──

/** Left eye contour — key points for bounding box */
const LEFT_EYE = {
  OUTER: 33,    // outer corner (toward ear)
  INNER: 133,   // inner corner (toward nose)
  TOP: 159,     // upper eyelid peak
  BOTTOM: 145,  // lower eyelid valley
  IRIS: 468,    // iris center
};

/** Right eye contour */
const RIGHT_EYE = {
  OUTER: 263,
  INNER: 362,
  TOP: 386,
  BOTTOM: 374,
  IRIS: 473,
};

/** Face landmarks for head pose */
const HEAD_POSE = {
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHIN: 152,
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
};

// ── Types ──

export interface GazePoint {
  /** Screen X coordinate, 0 (left) to 1 (right) */
  x: number;
  /** Screen Y coordinate, 0 (top) to 1 (bottom) */
  y: number;
  /** Confidence in this estimate (0-1) */
  confidence: number;
}

export interface IrisPosition {
  /** Left iris position within left eye (0=outer corner, 1=inner corner) */
  leftX: number;
  /** Left iris vertical position (0=top, 1=bottom) */
  leftY: number;
  /** Right iris position within right eye (0=inner corner, 1=outer corner) */
  rightX: number;
  /** Right iris vertical position */
  rightY: number;
}

export interface HeadPose {
  /** Yaw: negative = turned left, positive = turned right */
  yaw: number;
  /** Pitch: negative = looking down, positive = looking up */
  pitch: number;
  /** Roll: head tilt (not used for gaze, but available) */
  roll: number;
}

export interface CalibrationPoint {
  /** Screen position of the calibration dot (0-1) */
  screenX: number;
  screenY: number;
  /** Measured iris position when looking at the dot */
  irisX: number;
  irisY: number;
  /** Head pose at calibration time */
  headYaw: number;
  headPitch: number;
}

export interface CalibrationData {
  points: CalibrationPoint[];
  /** Polynomial coefficients for X mapping: ax*ix + bx*iy + cx*ix*iy + dx*ix^2 + ex*iy^2 + fx */
  coeffsX: number[];
  /** Polynomial coefficients for Y mapping */
  coeffsY: number[];
  /** Timestamp when calibration was performed */
  timestamp: number;
}

// ── Iris-in-eye extraction ──

/**
 * Extract normalized iris position within the eye contour.
 * This is the core signal — where the iris sits relative to the eye socket.
 *
 * Returns values in [0, 1] where:
 * - X: 0 = looking left, 0.5 = center, 1 = looking right (from user's perspective)
 * - Y: 0 = looking up, 0.5 = center, 1 = looking down
 */
export function extractIrisPosition(face: FaceLandmarks): IrisPosition | null {
  const le = LEFT_EYE;
  const re = RIGHT_EYE;

  const lOuter = face[le.OUTER];
  const lInner = face[le.INNER];
  const lTop = face[le.TOP];
  const lBottom = face[le.BOTTOM];
  const lIris = face[le.IRIS];

  const rOuter = face[re.OUTER];
  const rInner = face[re.INNER];
  const rTop = face[re.TOP];
  const rBottom = face[re.BOTTOM];
  const rIris = face[re.IRIS];

  if (!lOuter || !lInner || !lTop || !lBottom || !lIris) return null;
  if (!rOuter || !rInner || !rTop || !rBottom || !rIris) return null;

  // Left eye: normalize iris within eye bounding box
  const lWidth = lInner.x - lOuter.x;
  const lHeight = lBottom.y - lTop.y;
  if (lWidth < 0.005 || lHeight < 0.003) return null;

  const leftX = (lIris.x - lOuter.x) / lWidth;
  const leftY = (lIris.y - lTop.y) / lHeight;

  // Right eye: normalize iris within eye bounding box
  const rWidth = rOuter.x - rInner.x;
  const rHeight = rBottom.y - rTop.y;
  if (rWidth < 0.005 || rHeight < 0.003) return null;

  const rightX = (rIris.x - rInner.x) / rWidth;
  const rightY = (rIris.y - rTop.y) / rHeight;

  return { leftX, leftY, rightX, rightY };
}

// ── Head pose estimation ──

/**
 * Estimate head yaw, pitch, roll from face landmarks.
 * Uses a simple geometric approach (not full PnP).
 */
export function extractHeadPose(face: FaceLandmarks): HeadPose | null {
  const nose = face[HEAD_POSE.NOSE_TIP];
  const forehead = face[HEAD_POSE.FOREHEAD];
  const chin = face[HEAD_POSE.CHIN];
  const eyeL = face[HEAD_POSE.LEFT_EYE_OUTER];
  const eyeR = face[HEAD_POSE.RIGHT_EYE_OUTER];
  const mouthL = face[HEAD_POSE.MOUTH_LEFT];
  const mouthR = face[HEAD_POSE.MOUTH_RIGHT];

  if (!nose || !forehead || !chin || !eyeL || !eyeR || !mouthL || !mouthR) return null;

  // Yaw: asymmetry in eye-to-nose distances
  const eyeMidX = (eyeL.x + eyeR.x) / 2;
  const eyeWidth = eyeR.x - eyeL.x;
  if (eyeWidth < 0.01) return null;
  const yaw = (nose.x - eyeMidX) / eyeWidth; // -1 to 1 roughly

  // Pitch: nose position along forehead-chin axis
  const faceHeight = chin.y - forehead.y;
  if (faceHeight < 0.02) return null;
  const noseRatio = (nose.y - forehead.y) / faceHeight;
  const pitch = (0.38 - noseRatio) * 2; // 0.38 is roughly neutral, positive = looking up

  // Roll: angle of the eye line
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);

  return { yaw, pitch, roll };
}

// ── Uncalibrated gaze estimation ──

/**
 * Estimate gaze point WITHOUT calibration.
 *
 * Uses a geometric model assuming:
 * - Standard laptop, camera at top-center of screen
 * - User ~50-70cm from screen
 * - Screen subtends ~35 degrees horizontal FOV
 *
 * This is approximate but much better than raw iris midpoint.
 */
export function estimateGazeUncalibrated(
  iris: IrisPosition,
  headPose: HeadPose
): GazePoint {
  // Average left and right eye iris positions
  const irisX = (iris.leftX + iris.rightX) / 2;
  const irisY = (iris.leftY + iris.rightY) / 2;

  // Iris center in eye is roughly 0.5, 0.5
  // Deviation from center = gaze direction relative to head
  const eyeDeviationX = (irisX - 0.5) * 2; // -1 to 1
  const eyeDeviationY = (irisY - 0.5) * 2; // -1 to 1

  // Combine head rotation and eye-in-head rotation
  // Head yaw contributes to horizontal gaze, eye deviation adds the fine component
  // Scale factors tuned for typical laptop geometry
  const HEAD_YAW_WEIGHT = 1.2;
  const HEAD_PITCH_WEIGHT = 0.8;
  const EYE_X_WEIGHT = 0.7;
  const EYE_Y_WEIGHT = 0.5;

  const gazeX = 0.5 + headPose.yaw * HEAD_YAW_WEIGHT + eyeDeviationX * EYE_X_WEIGHT;
  const gazeY = 0.5 - headPose.pitch * HEAD_PITCH_WEIGHT + eyeDeviationY * EYE_Y_WEIGHT;

  // Confidence based on agreement between left and right eyes
  const eyeAgreement = 1 - Math.abs(iris.leftX - iris.rightX) * 2;
  const confidence = Math.max(0, Math.min(1, eyeAgreement * 0.8 + 0.2));

  return {
    x: clamp(gazeX, 0, 1),
    y: clamp(gazeY, 0, 1),
    confidence,
  };
}

// ── Calibrated gaze estimation ──

/**
 * Estimate gaze point WITH calibration data.
 *
 * Uses a 2nd-order polynomial fitted from calibration points.
 * Input features: average iris X/Y + head yaw/pitch.
 */
export function estimateGazeCalibrated(
  iris: IrisPosition,
  headPose: HeadPose,
  calibration: CalibrationData
): GazePoint {
  const irisX = (iris.leftX + iris.rightX) / 2;
  const irisY = (iris.leftY + iris.rightY) / 2;

  const gazeX = evalPolynomial(calibration.coeffsX, irisX, irisY, headPose.yaw, headPose.pitch);
  const gazeY = evalPolynomial(calibration.coeffsY, irisX, irisY, headPose.yaw, headPose.pitch);

  const eyeAgreement = 1 - Math.abs(iris.leftX - iris.rightX) * 2;
  const confidence = Math.max(0, Math.min(1, eyeAgreement * 0.9 + 0.1));

  return {
    x: clamp(gazeX, 0, 1),
    y: clamp(gazeY, 0, 1),
    confidence,
  };
}

// ── Calibration fitting ──

/**
 * Fit calibration data to produce polynomial coefficients.
 *
 * Uses least-squares regression on the feature vector:
 * [irisX, irisY, headYaw, headPitch, irisX*irisY, irisX^2, irisY^2, 1]
 *
 * Needs at least 4 calibration points (8 recommended for good fit).
 */
export function fitCalibration(points: CalibrationPoint[]): CalibrationData {
  if (points.length < 4) {
    throw new Error("Need at least 4 calibration points");
  }

  // Build feature matrix and target vectors
  const features = points.map((p) => buildFeatures(p.irisX, p.irisY, p.headYaw, p.headPitch));
  const targetX = points.map((p) => p.screenX);
  const targetY = points.map((p) => p.screenY);

  // Solve via normal equations: coeffs = (F^T F)^-1 F^T target
  const coeffsX = leastSquares(features, targetX);
  const coeffsY = leastSquares(features, targetY);

  return {
    points,
    coeffsX,
    coeffsY,
    timestamp: Date.now(),
  };
}

// ── Combined estimator ──

/**
 * Full gaze estimation pipeline.
 *
 * Extracts iris position + head pose, then applies calibrated or
 * uncalibrated model. Returns null if face data is insufficient.
 */
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

// ── Math utilities ──

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Build polynomial feature vector from inputs */
function buildFeatures(ix: number, iy: number, hw: number, hp: number): number[] {
  return [ix, iy, hw, hp, ix * iy, ix * ix, iy * iy, 1];
}

/** Evaluate polynomial: coeffs . features */
function evalPolynomial(coeffs: number[], ix: number, iy: number, hw: number, hp: number): number {
  const f = buildFeatures(ix, iy, hw, hp);
  let sum = 0;
  for (let i = 0; i < Math.min(coeffs.length, f.length); i++) {
    sum += coeffs[i] * f[i];
  }
  return sum;
}

/** Least squares solve: (F^T F)^-1 F^T y */
function leastSquares(features: number[][], targets: number[]): number[] {
  const n = features.length;
  const m = features[0].length;

  // F^T F (m x m)
  const FtF: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += features[k][i] * features[k][j];
      FtF[i][j] = sum;
    }
  }

  // F^T y (m x 1)
  const FtY: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += features[k][i] * targets[k];
    FtY[i] = sum;
  }

  // Add small ridge for numerical stability
  for (let i = 0; i < m; i++) FtF[i][i] += 1e-6;

  // Solve FtF * coeffs = FtY via Gaussian elimination
  return solveLinear(FtF, FtY);
}

/** Solve Ax = b via Gaussian elimination with partial pivoting */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  // Forward elimination
  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let col = row + 1; col < n; col++) {
      sum -= aug[row][col] * x[col];
    }
    const diag = aug[row][row];
    x[row] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }

  return x;
}
