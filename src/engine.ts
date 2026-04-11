/**
 * Thor Engine — the frame loop.
 *
 * detect → fan-out to handlers → resolve conflicts → merge viewState → emit
 *
 * Runs at ~30fps detection, delegating to the detector and gesture registry.
 * Not a React hook — pure imperative lifecycle managed by useThor.
 */

import { initDetector, detect, destroyDetector, isReady } from "./detection/detector";
import type { ThorFrame, DetectorMode, BodyPart } from "./detection/types";
import { EMPTY_FRAME } from "./detection/types";
import {
  getActiveGestures,
  getRequiredParts,
  type GestureConfig,
  type ViewState,
} from "./gestures";
import { resolveConflicts } from "./gestures/conflicts";
import { gestureConfig as cfg } from "./gestures/config";
import { hideCursor, showCursor } from "./util/pointer-emulation";

export interface EngineConfig {
  detector: DetectorMode;
  gestures?: string[];
  onViewStateChange: (updater: (vs: ViewState) => ViewState) => void;
  onViewStateNotify?: (vs: ViewState) => void;
  onFrame?: (frame: ThorFrame) => void;
}

export interface EngineHandle {
  start(): Promise<void>;
  stop(): void;
  /** Get the latest ThorFrame (for widget rendering) */
  getLatestFrame(): ThorFrame;
  /** Get currently active gesture names */
  getActiveGestureNames(): string[];
  /** Get the hidden video element (for debug overlays) */
  getVideo(): HTMLVideoElement | null;
}

export function createEngine(config: EngineConfig): EngineHandle {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let animationId = 0;
  let mounted = false;
  let cursorHidden = false;
  let latestFrame: ThorFrame = EMPTY_FRAME;
  let activeGestureNames: string[] = [];
  // Track which handlers were active last frame for onActivate/onDeactivate
  const wasActive = new Set<string>();

  const gcfg: GestureConfig = {
    get panSensitivity() { return cfg.panSensitivity; },
    get zoomSensitivity() { return cfg.zoomSensitivity; },
    get zoomDeadzone() { return cfg.zoomDeadzone; },
  };

  function processFrame(frame: ThorFrame) {
    latestFrame = frame;

    // Cursor management
    const hasHands = frame.hands.length > 0;
    if (hasHands && !cursorHidden) {
      hideCursor();
      cursorHidden = true;
    } else if (!hasHands && cursorHidden) {
      showCursor();
      cursorHidden = false;
    }

    // Fan-out: run all active gesture handlers
    const registered = getActiveGestures(config.gestures);
    const detections: {
      detection: import("./gestures").GestureDetection;
      priority: number;
      group: string;
      apply: typeof registered[0]["handler"]["apply"];
      name: string;
    }[] = [];

    for (const { handler, priority, group } of registered) {
      // Check if required body parts are available
      const hasRequired = handler.requires.every((part: BodyPart) => {
        if (part === "hands") return frame.hands.length > 0;
        if (part === "face") return frame.face !== null;
        if (part === "pose") return frame.pose !== null;
        return false;
      });

      // Special case: hand gesture handlers should still run when no hands
      // are visible so they can trigger inertia
      const isHandGesture = handler.requires.length === 1 && handler.requires[0] === "hands";

      if (!hasRequired && !isHandGesture) continue;

      const detection = handler.detect(frame);
      if (detection) {
        detections.push({
          detection,
          priority,
          group,
          apply: handler.apply.bind(handler),
          name: handler.name,
        });
      }
    }

    // Resolve conflicts
    const winners = resolveConflicts(detections);
    const currentActive = new Set(winners.map((w) => w.detection.gesture));
    activeGestureNames = Array.from(currentActive);

    // Fire onActivate/onDeactivate
    for (const { handler } of registered) {
      if (currentActive.has(handler.name) && !wasActive.has(handler.name)) {
        handler.onActivate?.();
      }
      if (!currentActive.has(handler.name) && wasActive.has(handler.name)) {
        handler.onDeactivate?.();
      }
    }
    wasActive.clear();
    for (const name of currentActive) wasActive.add(name);

    // Apply viewState changes
    if (winners.length > 0) {
      config.onViewStateChange((vs) => {
        let newVs = vs;
        for (const winner of winners) {
          newVs = winner.apply(winner.detection, newVs, gcfg);
        }
        if (newVs !== vs) {
          config.onViewStateNotify?.(newVs);
        }
        return newVs;
      });
    }

    // Notify after processing so widget/debug gets current active gestures
    config.onFrame?.(frame);
  }

  return {
    async start() {
      mounted = true;

      // Determine required body parts from registered gestures
      const registered = getActiveGestures(config.gestures);
      const requiredParts = getRequiredParts(registered);

      await initDetector({
        mode: config.detector,
        requiredParts,
        numHands: 2,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      if (!mounted) return;

      // Create hidden video element
      video = document.createElement("video");
      video.setAttribute("autoplay", "");
      video.setAttribute("playsinline", "");
      video.muted = true;
      Object.assign(video.style, {
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.appendChild(video);

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (!mounted) {
        stream.getTracks().forEach((t) => t.stop());
        video.remove();
        return;
      }

      video.srcObject = stream;
      await video.play();

      // Detection loop at ~30fps
      let lastTime = 0;
      const FPS_INTERVAL = 1000 / 30;

      function loop(timestamp: number) {
        if (!mounted) return;

        const elapsed = timestamp - lastTime;
        if (elapsed >= FPS_INTERVAL) {
          lastTime = timestamp;
          if (video && isReady()) {
            const frame = detect(video, timestamp);
            if (frame) {
              processFrame(frame);
            } else {
              latestFrame = EMPTY_FRAME;
              if (cursorHidden) {
                showCursor();
                cursorHidden = false;
              }
            }
          }
        }

        animationId = requestAnimationFrame(loop);
      }

      animationId = requestAnimationFrame(loop);
    },

    stop() {
      mounted = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = 0;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (video) {
        video.remove();
        video = null;
      }
      if (cursorHidden) {
        showCursor();
        cursorHidden = false;
      }

      // Reset all gesture handler state
      const registered = getActiveGestures(config.gestures);
      for (const { handler } of registered) {
        handler.reset?.();
      }

      latestFrame = EMPTY_FRAME;
      activeGestureNames = [];
      wasActive.clear();
      destroyDetector();
    },

    getLatestFrame() {
      return latestFrame;
    },

    getActiveGestureNames() {
      return activeGestureNames;
    },

    getVideo() {
      return video;
    },
  };
}
