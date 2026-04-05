/**
 * useThor — main React hook for thor.gl.
 *
 * Orchestrates: engine lifecycle, ThorWidget instance, viewState bridging.
 *
 * Usage:
 * ```tsx
 * const { widgets } = useThor({
 *   setViewState,
 *   onViewStateChange: (vs) => handleZoomSwitch(vs.zoom),
 *   gestures: ['pinch-pan', 'pinch-zoom'],  // optional filter
 * });
 *
 * <DeckGL widgets={widgets} />
 * ```
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Widget } from "@deck.gl/core";
import type { DetectorMode } from "./detection/types";
import type { ViewState } from "./gestures/types";
import { ThorWidget } from "./ThorWidget";
import { createEngine, type EngineHandle } from "./engine";
import { setGestureConfig, type ThorGestureConfig } from "./gestures/config";

export interface ThorConfig {
  /** ViewState setter — typically shell.setViewState */
  setViewState: (updater: (vs: ViewState) => ViewState) => void;
  /** Side-effect callback on viewState change (e.g. projection switching) */
  onViewStateChange?: (newViewState: ViewState) => void;
  /** Whether the hook is active. Default true. */
  enabled?: boolean;
  /** Detector mode. Default "auto". */
  detector?: DetectorMode;
  /** Which gestures to enable (by name). Default: all registered. */
  gestures?: string[];

  /** Gesture tuning — all fields optional, merged with defaults. */
  config?: Partial<ThorGestureConfig>;
}

export interface ThorResult {
  /** Stable widget array — pass to DeckGL `widgets` prop */
  widgets: Widget[];
  /** Pass-through viewState change handler for mouse/touch input */
  onViewStateChange: (params: { viewState: Record<string, unknown> }) => void;
  /** Get the engine handle for debug/inspection (null when disabled) */
  getEngine: () => EngineHandle | null;
}

export function useThor({
  setViewState,
  onViewStateChange: onViewStateChangeCb,
  enabled = true,
  detector = "auto",
  gestures,
  config: configOverrides,
}: ThorConfig): ThorResult {
  // Stable refs
  const onViewStateChangeRef = useRef(onViewStateChangeCb);
  onViewStateChangeRef.current = onViewStateChangeCb;

  const setViewStateRef = useRef(setViewState);
  setViewStateRef.current = setViewState;

  // Widget instance — stable, never recreated
  const widget = useMemo(() => new ThorWidget({ id: "thor-gl" }), []);
  const widgets = useMemo(() => [widget] as unknown as Widget[], [widget]);

  // Engine ref
  const engineRef = useRef<EngineHandle | null>(null);

  // Serialized gesture list for dep comparison
  const gestureKey = gestures?.join(",") ?? "__all__";

  // Stable serialization for config overrides dep
  const configKey = configOverrides ? JSON.stringify(configOverrides) : "";

  useEffect(() => {
    if (!enabled) {
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
      widget.setData(null, []);
      return;
    }

    // Apply config overrides to shared gesture config
    if (configOverrides) {
      setGestureConfig(configOverrides);
    }

    const engine = createEngine({
      detector,
      gestures,
      onViewStateChange: (updater) => {
        setViewStateRef.current((vs) => {
          const newVs = updater(vs);
          if (newVs !== vs) {
            onViewStateChangeRef.current?.(newVs);
          }
          return newVs;
        });
      },
      onFrame: (frame) => {
        widget.setData(frame, engine.getActiveGestureNames());
      },
    });

    engineRef.current = engine;

    engine.start().catch((err) => {
      console.error("[thor.gl] Engine start failed:", err);
    });

    return () => {
      engine.stop();
      engineRef.current = null;
      widget.setData(null, []);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, detector, gestureKey, configKey]);

  // Pass-through for mouse/touch viewState changes
  const onViewStateChange = useCallback(
    (params: { viewState: Record<string, unknown> }) => {
      const vs = params.viewState as unknown as ViewState;
      setViewStateRef.current(() => vs);
      onViewStateChangeRef.current?.(vs);
    },
    []
  );

  const getEngine = useCallback(() => engineRef.current, []);

  return { widgets, onViewStateChange, getEngine };
}
