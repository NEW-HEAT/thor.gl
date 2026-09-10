/**
 * Thor Engine — the frame loop.
 *
 * detect → fan-out to handlers → resolve conflicts → merge viewState → emit
 *
 * Runs at ~30fps detection, delegating to the detector and gesture registry.
 * Not a React hook — pure imperative lifecycle managed by useThor.
 */

import { createDetector } from "./detection/detector";
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

export type EngineStatus = "idle" | "camera" | "model" | "running" | "error";

export interface EngineConfig {
  detector: DetectorMode;
  gestures?: string[];
  onViewStateChange: (updater: (vs: ViewState) => ViewState) => void;
  onViewStateNotify?: (vs: ViewState) => void;
  onFrame?: (frame: ThorFrame) => void;
  onStatus?: (status: EngineStatus, error?: Error) => void;
  onVideo?: (video: HTMLVideoElement | null) => void;
  paused?: boolean;
}

export interface EngineHandle {
  start(): Promise<void>;
  stop(): void;
  setPaused(paused: boolean): void;
  setGestures(gestures?: string[]): void;
  reset(): void;
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
  const detector = createDetector();
  let generation = 0;
  let controlVersion = 0;
  let paused = config.paused ?? false;
  let gestureNames = config.gestures;
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

    if (paused) {
      activeGestureNames = [];
      config.onFrame?.(frame);
      return;
    }

    // Fan-out: run all active gesture handlers
    const registered = getActiveGestures(gestureNames);
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
    let winners = resolveConflicts(detections);
    if (winners.some(w => w.detection.gesture === "open-palm")) {
      for (const { handler } of registered) {
        if (handler.name.startsWith("pinch-")) handler.reset?.();
      }
      winners = winners.filter(w => !w.detection.gesture.startsWith("pinch-"));
    }
    for (const winner of winners) {
      registered.find(g => g.handler.name === winner.detection.gesture)?.handler.onTrigger?.(winner.detection);
    }
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
      const version = controlVersion;
      config.onViewStateChange((vs) => {
        if (!mounted || paused || version !== controlVersion) return vs;
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

  function reset() {
    controlVersion++;
    for (const { handler } of getActiveGestures(gestureNames)) {
      if (wasActive.has(handler.name)) handler.onDeactivate?.();
      handler.reset?.();
    }
    activeGestureNames = [];
    wasActive.clear();
  }

  function stop() {
    mounted = false;
    generation++;
    cancelAnimationFrame(animationId);
    animationId = 0;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    if (video) { video.srcObject = null; video.remove(); video = null; }
    config.onVideo?.(null);
    reset();
    latestFrame = EMPTY_FRAME;
    detector.destroy();
    config.onStatus?.("idle");
  }

  return {
    async start() {
      if (mounted) return;
      mounted = true;
      const token = ++generation;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const current = () => mounted && token === generation;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost. Open the secure demo URL.");
        }
        config.onStatus?.("camera");
        await Promise.race([
          (async () => {
            const acquired = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
              audio: false,
            });
            if (!current()) { acquired.getTracks().forEach(t => t.stop()); return; }
            stream = acquired;
            const source = document.createElement("video");
            video = source;
            source.autoplay = true;
            source.playsInline = true;
            source.muted = true;
            source.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;pointer-events:none";
            document.body.appendChild(source);
            source.srcObject = acquired;
            await source.play();
            if (!current()) return;
            acquired.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
              if (!current()) return;
              stop();
              config.onStatus?.("error", new Error("The camera disconnected. Reconnect it and try again."));
            }, { once: true }));
            config.onVideo?.(source);
            config.onStatus?.("model");
            await detector.init({ mode: config.detector, requiredParts: getRequiredParts(getActiveGestures(gestureNames)), numHands: 2 });
          })(),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error("Camera or tracking model took too long to start. Check camera permission and your connection, then retry.")), 45000);
          }),
        ]);
        if (!current()) return;
        config.onStatus?.("running");
        let lastTime = 0;
        let lastVideoTime = -1;
        function loop(timestamp: number) {
          if (!current()) return;
          try {
            if (timestamp - lastTime >= 1000 / 30 && video && video.currentTime !== lastVideoTime && !document.hidden) {
              lastTime = timestamp;
              lastVideoTime = video.currentTime;
              const frame = detector.detect(video, timestamp);
              processFrame(frame ?? { ...EMPTY_FRAME, timestamp });
            }
            animationId = requestAnimationFrame(loop);
          } catch (error) {
            stop();
            config.onStatus?.("error", error instanceof Error ? error : new Error(String(error)));
          }
        }
        animationId = requestAnimationFrame(loop);
      } catch (error) {
        if (!current()) return;
        stop();
        const failure = error instanceof Error ? error : new Error(String(error));
        config.onStatus?.("error", failure);
        throw failure;
      } finally {
        clearTimeout(deadline);
      }
    },
    stop,
    reset,
    setPaused(value) { if (paused !== value) { reset(); paused = value; } },
    setGestures(value) { reset(); gestureNames = value; },
    getLatestFrame: () => latestFrame,
    getActiveGestureNames: () => activeGestureNames,
    getVideo: () => video,
  };
}
