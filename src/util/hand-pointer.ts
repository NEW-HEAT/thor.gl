import type { ThorFrame } from "../detection/types";
import { HAND, isPinching } from "../detection/landmarks";

export interface PointerViewport {
  width: number;
  height: number;
}

export interface HandPointer {
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
  handIndex: number;
  confidence: number;
  selecting: boolean;
}

export interface HandPointerOptions {
  mirror?: boolean;
  pinchThreshold?: number;
  minConfidence?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getIndexFingerPointer(
  frame: ThorFrame,
  viewport: PointerViewport,
  options: HandPointerOptions = {}
): HandPointer | null {
  const {
    mirror = true,
    pinchThreshold = 0.075,
    minConfidence = 0.35,
  } = options;

  let bestHandIndex = -1;
  let bestConfidence = -1;

  for (let i = 0; i < frame.hands.length; i++) {
    const hand = frame.hands[i];
    const indexTip = hand?.[HAND.INDEX_TIP];
    if (!indexTip) continue;

    const confidence = frame.handConfidences[i] ?? 0.5;
    if (confidence >= minConfidence && confidence > bestConfidence) {
      bestHandIndex = i;
      bestConfidence = confidence;
    }
  }

  if (bestHandIndex === -1) return null;

  const hand = frame.hands[bestHandIndex];
  const indexTip = hand[HAND.INDEX_TIP];
  const normalizedX = mirror ? 1 - indexTip.x : indexTip.x;
  const normalizedY = indexTip.y;

  return {
    x: clamp(normalizedX * viewport.width, 0, viewport.width),
    y: clamp(normalizedY * viewport.height, 0, viewport.height),
    normalizedX: clamp(normalizedX, 0, 1),
    normalizedY: clamp(normalizedY, 0, 1),
    handIndex: bestHandIndex,
    confidence: bestConfidence,
    selecting: isPinching(hand, pinchThreshold),
  };
}
