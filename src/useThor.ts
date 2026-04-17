/**
 * useThor — main React hook for thor.gl.
 *
 * Orchestrates: Thor instance lifecycle, ThorWidget instance, viewState bridging.
 * Delegates to the Thor class for engine management and signal pubsub.
 *
 * Existing public surface is preserved — callers of useThor do not need changes.
 *
 * Usage:
 * ```tsx
 * const { widgets, thor } = useThor({
 *   setViewState,
 *   onViewStateChange: (vs) => handleZoomSwitch(vs.zoom),
 *   gestures: ['pinch-pan', 'pinch-zoom'],  // optional filter
 * });
 *
 * // Wire signals in the same component:
 * useEffect(() => {
 *   thor?.on('fist', ({ hand }) => console.log('fist', hand));
 * }, [thor]);
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
import { Thor } from "./thor";

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
  /**
   * The deck.gl canvas (or a getter). Required for canvas-space signals:
   * `trigger`, `fingergun-aim`, `eraser-move`. Pass `() => deckRef.current?.deck?.getCanvas() ?? null`.
   * Omitting it means those signals are silently skipped.
   */
  canvas?: HTMLCanvasElement | (() => HTMLCanvasElement | null);
}

export interface ThorResult {
  /** Stable widget array — pass to DeckGL `widgets` prop */
  widgets: Widget[];
  /** Pass-through viewState change handler for mouse/touch input */
  onViewStateChange: (params: { viewState: Record<string, unknown> }) => void;
  /** Get the underlying engine handle for debug/inspection (null when disabled) */
  getEngine: () => EngineHandle | null;
  /**
   * The Thor instance — use to subscribe to signals:
   *   thor?.on('fist', handler)
   * Null when `enabled` is false.
   */
  thor: Thor | null;
}

export function useThor({
  setViewState,
  onViewStateChange: onViewStateChangeCb,
  enabled = true,
  detector = "auto",
  gestures,
  config: configOverrides,
  canvas,
}: ThorConfig): ThorResult {
  // Stable refs — capture latest callbacks without causing effect re-runs
  const onViewStateChangeRef = useRef(onViewStateChangeCb);
  onViewStateChangeRef.current = onViewStateChangeCb;

  const setViewStateRef = useRef(setViewState);
  setViewStateRef.current = setViewState;

  // Widget instance — stable, never recreated
  const widget = useMemo(() => new ThorWidget({ id: "thor-gl" }), []);
  const widgets = useMemo(() => [widget] as unknown as Widget[], [widget]);

  // Engine ref (for getEngine() pass-through — kept for backward compat)
  const engineRef = useRef<EngineHandle | null>(null);

  // Thor instance ref — stable per enabled/detector/gestures lifecycle
  const thorRef = useRef<Thor | null>(null);

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
      thorRef.current?.destroy();
      thorRef.current = null;
      widget.setData(null, []);
      return;
    }

    // Apply config overrides to shared gesture config
    if (configOverrides) {
      setGestureConfig(configOverrides);
    }

    // Build the engine directly (same as before) so getEngine() still works
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

    // Wrap the engine in a Thor instance so callers can use on(signal, handler)
    const thor = new Thor({
      detectors: {hand: detector !== 'holistic', face: detector === 'holistic', pose: detector === 'holistic'},
      gestures,
      canvas,
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

    // We wired the engine manually above; the Thor instance is used for
    // signal subscriptions. To avoid double-starting the detector, we
    // assign the engine to Thor's internal ref via a lightweight bridge.
    // Thor.start() is not called — we drive the engine ourselves.
    (thor as any)._engine = engine;
    (thor as any)._started = true;
    thorRef.current = thor;

    engine.start().catch((err) => {
      console.error("[thor.gl] Engine start failed:", err);
    });

    return () => {
      engine.stop();
      engineRef.current = null;
      thor.destroy();
      thorRef.current = null;
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

  return { widgets, onViewStateChange, getEngine, thor: thorRef.current };
}
