import { _GlobeController as GlobeController } from "@deck.gl/core";
import type { MjolnirGestureEvent } from "mjolnir.js";

/** Keep fast pointer releases bounded; reuse deck.gl's spherical pan geometry. */
export class MotionController extends GlobeController {
  protected _onPanMoveEnd(event: MjolnirGestureEvent): boolean {
    const duration = this.inertia;
    const state = this.controllerState;
    const pos = this.getCenter(event);
    const vx = Number(event.velocityX) || 0;
    const vy = Number(event.velocityY) || 0;
    const speed = Math.hypot(vx, vy);
    // Bound distance as well as duration: a very quick flick must not spin a hemisphere.
    const travel = Math.min(24, speed * duration / 2);
    const end = this.dragPan && duration && speed > 0.01
      ? state.pan({ pos: [pos[0] + vx / speed * travel, pos[1] + vy / speed * travel] }).panEnd()
      : null;
    this.inertia = 0;
    try { super._onPanMoveEnd(event); }
    finally { this.inertia = duration; }
    if (end) this.updateViewport(end, {
      ...this._getTransitionProps(),
      transitionDuration: duration,
      transitionEasing: (t: number) => 1 - (1 - t) * (1 - t),
    }, { isDragging: false, isPanning: true });
    return true;
  }
}
