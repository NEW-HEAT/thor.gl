/** React lifecycle and live controls for one Thor engine. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Widget } from "@deck.gl/core";
import type { DetectorMode } from "./detection/types";
import type { ViewState } from "./gestures/types";
import { ThorWidget } from "./ThorWidget";
import { createEngine, type EngineHandle, type EngineStatus } from "./engine";
import { setGestureConfig, type ThorGestureConfig } from "./gestures/config";

export interface ThorConfig {
  setViewState: (updater: (vs: ViewState) => ViewState) => void;
  onViewStateChange?: (newViewState: ViewState) => void;
  enabled?: boolean;
  detector?: DetectorMode;
  gestures?: string[];
  config?: Partial<ThorGestureConfig>;
  /** Freeze navigation while keeping camera and landmarks live. */
  paused?: boolean;
  /** Match landmarks to a camera background using object-fit: cover. */
  cameraOverlay?: boolean;
  showOverlay?: boolean;
}

export interface ThorResult {
  widgets: Widget[];
  onViewStateChange: (params: { viewState: Record<string, unknown> }) => void;
  getEngine: () => EngineHandle | null;
  status: EngineStatus;
  error: Error | null;
  video: HTMLVideoElement | null;
  retry: () => void;
}

export function useThor({ setViewState, onViewStateChange: notify, enabled = true,
  detector = "auto", gestures, config, paused = false, cameraOverlay = false, showOverlay = true,
}: ThorConfig): ThorResult {
  const callbacks = useRef({ setViewState, notify });
  callbacks.current = { setViewState, notify };
  const widget = useMemo(() => new ThorWidget({ id: "thor-gl" }), []);
  const widgets = useMemo(() => [widget] as Widget[], [widget]);
  const engineRef = useRef<EngineHandle | null>(null);
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controls = useRef({ gestures, paused, cameraOverlay, showOverlay });
  controls.current = { gestures, paused, cameraOverlay, showOverlay };
  const gestureKey = gestures?.join(",") ?? "__all__";
  const configKey = JSON.stringify(config ?? {});

  // Live tuning does not reacquire the camera or reload the model.
  useEffect(() => { if (config) setGestureConfig(config); }, [configKey]);
  useEffect(() => { engineRef.current?.setGestures(gestures); }, [gestureKey]);
  useEffect(() => { engineRef.current?.setPaused(paused); }, [paused]);

  useEffect(() => {
    if (!enabled) { setStatus("idle"); setError(null); setVideo(null); return; }
    let cancelled = false;
    setError(null);
    setVideo(null);
    const engine = createEngine({
      detector, gestures: controls.current.gestures, paused: controls.current.paused,
      onViewStateChange: updater => callbacks.current.setViewState(updater),
      onViewStateNotify: vs => callbacks.current.notify?.(vs),
      onStatus: (next, failure) => { if (!cancelled) { setStatus(next); setError(failure ?? null); } },
      onVideo: source => { if (!cancelled) setVideo(source); },
      onFrame: frame => {
        const source = engine.getVideo();
        widget.setCameraSize(controls.current.cameraOverlay && source ? [source.videoWidth, source.videoHeight] : null);
        widget.setData(controls.current.showOverlay ? frame : null, engine.getActiveGestureNames());
      },
    });
    engineRef.current = engine;
    void engine.start().catch(() => { /* surfaced through onStatus */ });
    return () => {
      cancelled = true;
      engine.stop();
      engineRef.current = null;
      widget.setData(null, []);
    };
  }, [enabled, detector, attempt, widget]);

  const onViewStateChange = useCallback(({ viewState }: { viewState: Record<string, unknown> }) => {
    const vs = viewState as unknown as ViewState;
    callbacks.current.setViewState(() => vs);
    callbacks.current.notify?.(vs);
  }, []);
  const getEngine = useCallback(() => engineRef.current, []);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { widgets, getEngine, onViewStateChange, status, error, video, retry };
}
