/**
 * ThorWidget — deck.gl Widget that renders hand/body overlays on the viewport.
 *
 * Draws:
 * - Soft glowing fingertip dots (5 per hand)
 * - Pinch cursor ring at thumb-index midpoint
 * - Dwell progress arc
 * - Mode indicator pill (Pan/Zoom)
 *
 * Delegates per-handler rendering: handlers with render() get called too.
 */

import { Widget, type WidgetPlacement, type WidgetProps } from "@deck.gl/core";
import type { ThorFrame } from "./detection/types";
import { HAND, FINGERTIPS, isPinching, distance } from "./detection/landmarks";
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
      rootElement.appendChild(this._canvas);
    }

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

    const vw = rect.width;
    const vh = rect.height;

    // Draw hands
    for (let i = 0; i < frame.hands.length; i++) {
      const landmarks = frame.hands[i];
      if (!landmarks || landmarks.length < 21) continue;
      this._drawHand(ctx, landmarks, frame.handConfidences[i] ?? 0, vw, vh);
    }

    // Draw mode indicator (counter-flipped so text reads correctly)
    this._drawModeIndicator(ctx, vw);

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
    const pinching = isPinching(landmarks, 0.06);
    const highConfidence = confidence > 0.45;
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

  private _drawModeIndicator(ctx: CanvasRenderingContext2D, vw: number): void {
    // Determine mode from active gestures
    let label: string | null = null;
    let color: (typeof COLORS)[keyof typeof COLORS] = COLORS.dwelling;

    if (this._activeGestures.includes("fist")) {
      label = "Switch";
      color = COLORS.confirmed;
    } else if (this._activeGestures.includes("pinch-zoom")) {
      label = "Zoom";
      color = COLORS.confirmed;
    } else if (this._activeGestures.includes("pinch-rotate")) {
      label = "Rotate";
      color = COLORS.dwelling;
    } else if (this._activeGestures.includes("pinch-pan")) {
      label = "Pan";
      color = COLORS.dwelling;
    }

    if (!label) return;

    ctx.font = "500 11px -apple-system, BlinkMacSystemFont, sans-serif";
    const textWidth = ctx.measureText(label).width;
    const pillW = textWidth + 16;
    const pillH = 22;
    // Counter-flip: canvas is scaleX(-1), so we flip this section back
    const x = vw - pillW - 12;
    const y = 12;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-vw, 0);

    ctx.fillStyle = rgba(color.tip, 0.15);
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 11);
    ctx.fill();

    ctx.fillStyle = rgba(color.tip, 0.8);
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 8, y + pillH / 2);

    ctx.restore();
  }
}
