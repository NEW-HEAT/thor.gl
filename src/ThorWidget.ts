/**
 * ThorWidget — deck.gl Widget that renders hand/body overlays on the viewport.
 *
 * Draws:
 * - Soft glowing fingertip dots (5 per hand)
 * - Pinch cursor ring at thumb-index midpoint
 *
 * Delegates per-handler rendering: handlers with render() get called too.
 */

import { Widget, type WidgetPlacement, type WidgetProps } from "@deck.gl/core";
import type { ThorFrame } from "./detection/types";
import { HAND, FINGERTIPS, isPinching } from "./detection/landmarks";
import { gestureConfig as cfg } from "./gestures/config";
import { getActiveGestures } from "./gestures/registry";

// ── Color palette ──

const COLORS = {
  idle: {
    tip: [180, 220, 255] as const,
    tipAlpha: 0.45,
    glow: [180, 220, 255] as const,
    glowAlpha: 0.12,
    cursor: [180, 220, 255] as const,
    cursorAlpha: 0.3,
  },
  dwelling: {
    tip: [255, 220, 150] as const,
    tipAlpha: 0.7,
    glow: [255, 220, 150] as const,
    glowAlpha: 0.2,
    cursor: [255, 220, 150] as const,
    cursorAlpha: 0.5,
  },
  confirmed: {
    tip: [255, 180, 120] as const,
    tipAlpha: 0.85,
    glow: [255, 180, 120] as const,
    glowAlpha: 0.25,
    cursor: [255, 180, 120] as const,
    cursorAlpha: 0.7,
  },
} as const;

function rgba(c: readonly [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

export class ThorWidget extends Widget {
  placement: WidgetPlacement = "fill";
  className = "thor-gl";

  private _cameraSize: [number, number] | null = null;

  setCameraSize(size: [number, number] | null) { this._cameraSize = size; }

  private _canvas: HTMLCanvasElement | null = null;
  private _frame: ThorFrame | null = null;
  private _activeGestures: string[] = [];

  constructor(props: WidgetProps = {}) {
    super({ id: "thor-gl", ...props });
  }

  /** Push new frame data + active gesture names. Triggers overlay redraw. */
  setData(frame: ThorFrame | null, activeGestures: string[]): void {
    this._frame = frame;
    this._activeGestures = activeGestures;
    this.updateHTML();
  }

  onRenderHTML(rootElement: HTMLElement): void {
    Object.assign(rootElement.style, {
      width: "100%",
      height: "100%",
      position: "absolute",
      top: "0",
      left: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "10",
    });

    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      Object.assign(this._canvas.style, {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: "0",
        left: "0",
        pointerEvents: "none",
        transform: "scaleX(-1)",
      });
    }
    // deck.gl recreates the widget root when tracking is stopped and restarted.
    if (this._canvas.parentElement !== rootElement) rootElement.appendChild(this._canvas);

    this._draw();
  }

  private _draw(): void {
    const canvas = this._canvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width * dpr;
    const h = rect.height * dpr;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const frame = this._frame;
    if (!frame) return;

    let vw = rect.width;
    let vh = rect.height;
    if (this._cameraSize?.[0] && this._cameraSize[1]) {
      const scale = Math.max(vw / this._cameraSize[0], vh / this._cameraSize[1]);
      vw = this._cameraSize[0] * scale;
      vh = this._cameraSize[1] * scale;
      ctx.translate((rect.width - vw) / 2, (rect.height - vh) / 2);
    }

    // Draw hands
    for (let i = 0; i < frame.hands.length; i++) {
      const landmarks = frame.hands[i];
      if (!landmarks || landmarks.length < 21) continue;
      this._drawHand(ctx, landmarks, frame.handConfidences[i] ?? 0, vw, vh);
    }

    // Draw mode indicator (counter-flipped so text reads correctly)
    // The demo supplies one accessible status indicator outside the canvas.

    // Delegate to handler render() methods
    const registered = getActiveGestures();
    for (const { handler } of registered) {
      if (handler.render && this._activeGestures.includes(handler.name)) {
        handler.render(ctx, frame, vw, vh);
      }
    }
  }

  private _drawHand(
    ctx: CanvasRenderingContext2D,
    landmarks: import("./detection/types").HandLandmarks,
    confidence: number,
    vw: number,
    vh: number
  ): void {
    // Determine hand state from pinch detection
    const threshold = cfg.pinchThreshold * (confidence > 0.8 ? 1.5 : confidence > 0.6 ? 1.3 : 1);
    const pinching = isPinching(landmarks, threshold);
    const highConfidence = confidence >= cfg.minConfidence;
    const palette = pinching && highConfidence
      ? COLORS.confirmed
      : pinching
        ? COLORS.dwelling
        : COLORS.idle;

    // Draw fingertip dots
    for (const tipIdx of FINGERTIPS) {
      const lm = landmarks[tipIdx];
      if (!lm) continue;

      const x = lm.x * vw;
      const y = lm.y * vh;
      const isPinchFinger =
        tipIdx === HAND.THUMB_TIP || tipIdx === HAND.INDEX_TIP;
      const radius = isPinchFinger ? 6 : 4;

      // Outer glow
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
      glow.addColorStop(0, rgba(palette.glow, palette.glowAlpha));
      glow.addColorStop(1, rgba(palette.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle = rgba(palette.tip, palette.tipAlpha);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pinch cursor ring at thumb-index midpoint
    const thumbTip = landmarks[HAND.THUMB_TIP];
    const indexTip = landmarks[HAND.INDEX_TIP];
    if (!thumbTip || !indexTip) return;

    const cx = ((thumbTip.x + indexTip.x) / 2) * vw;
    const cy = ((thumbTip.y + indexTip.y) / 2) * vh;

    if (pinching && highConfidence) {
      // Full confirmed ring + glow
      const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 24);
      glow.addColorStop(0, rgba(palette.glow, palette.glowAlpha * 0.8));
      glow.addColorStop(1, rgba(palette.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(palette.cursor, palette.cursorAlpha);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

}
