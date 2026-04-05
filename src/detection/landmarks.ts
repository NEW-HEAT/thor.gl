/**
 * Landmark indices and math utilities for thor.gl.
 *
 * Constants for MediaPipe hand (21), face (478), and pose (33) landmarks.
 * Math helpers operate on NormalizedLandmark — pure functions, no state.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ── Hand landmarks (21 points) ──

export const HAND = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const FINGERTIPS = [
  HAND.THUMB_TIP,
  HAND.INDEX_TIP,
  HAND.MIDDLE_TIP,
  HAND.RING_TIP,
  HAND.PINKY_TIP,
] as const;

// ── Pose landmarks (33 points) ──

export const POSE = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

// ── Face landmark regions (478 points — key indices only) ──

export const FACE = {
  // Iris centers (from the 478-point model)
  LEFT_IRIS_CENTER: 468,
  RIGHT_IRIS_CENTER: 473,
  // Nose tip
  NOSE_TIP: 1,
  // Chin
  CHIN: 152,
  // Forehead
  FOREHEAD: 10,
  // Lip corners
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
} as const;

// ── Math utilities ──

/** Euclidean distance between two landmarks (normalized coords). */
export function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 2D distance (ignoring z). */
export function distance2d(
  a: NormalizedLandmark,
  b: NormalizedLandmark
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Midpoint between two landmarks. */
export function midpoint(
  a: NormalizedLandmark,
  b: NormalizedLandmark
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Check if a hand is pinching (thumb tip near index tip). */
export function isPinching(
  landmarks: NormalizedLandmark[],
  threshold = 0.09
): boolean {
  if (!landmarks || landmarks.length < 21) return false;
  const thumb = landmarks[HAND.THUMB_TIP];
  const index = landmarks[HAND.INDEX_TIP];
  if (!thumb || !index) return false;
  return distance(thumb, index) < threshold;
}

/** Get pinch center (midpoint of thumb tip and index tip). */
export function pinchCenter(
  landmarks: NormalizedLandmark[]
): { x: number; y: number } | null {
  if (!landmarks || landmarks.length < 21) return null;
  const thumb = landmarks[HAND.THUMB_TIP];
  const index = landmarks[HAND.INDEX_TIP];
  if (!thumb || !index) return null;
  return midpoint(thumb, index);
}

/** Angle between three landmarks (in radians). b is the vertex. */
export function angle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA === 0 || magBC === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}
