/**
 * thor.gl demo — Deck.gl globe with hand gesture controls.
 *
 * Gestures:
 * - Pinch + drag (1 hand)      -> pan
 * - Pinch (2 hands)             -> zoom
 * - Pinch + twist (2 hands)     -> rotate bearing
 * - Open palm                   -> stop inertia
 * - Fist (hold 300ms)           -> toggle globe / mercator projection
 * - Fingergun (index+thumb up)  -> aim reticle at fingertip
 * - Fingergun trigger (thumb drop) -> draw point at aim location
 * - Four-finger salute           -> erase features under palm region
 *
 * AI-forward editable-layers integration:
 * - EditableGeoJsonLayer with starter features
 * - createEditTools factory wired to React state
 * - Thor signals -> tools bridge (orthogonality demonstration):
 *     trigger signal  -> deck.unproject -> tools.draw_point.execute()
 *     eraser-move     -> deck.pickObjects -> tools.delete_feature.execute()
 * - Text-channel path: "text channel: draw at center" button
 *
 * Orthogonality: thor.gl does not import editable-layers. editable-layers
 * does not import thor.gl. The useEffect blocks below are the ONLY place they
 * meet — user code, not library code.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import type { DeckGLRef } from "@deck.gl/react";
import { _GlobeView as GlobeView, MapView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import {
  useThor,
  setFistAction,
  listGestures,
  getActiveMode,
  type ViewState,
  type ThorFrame,
  type EngineHandle,
  HAND,
  FINGERTIPS,
} from "thor.gl";

// AI-forward editable-layers integration
import { EditableGeoJsonLayer } from "@deck.gl-community/editable-layers";
import { createEditTools } from "@deck.gl-community/editable-layers";
import type { FeatureCollection } from "geojson";

type InputMode = "mjolnir" | "thor";

// ── Starter FeatureCollection for editable-layers demo ───────────────────────

const STARTER_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Golden Gate Bridge area" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.52, 37.83],
            [-122.44, 37.83],
            [-122.44, 37.78],
            [-122.52, 37.78],
            [-122.52, 37.83],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { name: "Ferry Building" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.40, 37.80],
            [-122.37, 37.80],
            [-122.37, 37.77],
            [-122.40, 37.77],
            [-122.40, 37.80],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { name: "Alcatraz" },
      geometry: {
        type: "Point",
        coordinates: [-122.4229, 37.8267],
      },
    },
  ],
};

// ── ─────────────────────────────────────────────────────────────────────────

const INITIAL_VIEW: ViewState = {
  longitude: -100,
  latitude: 40,
  zoom: 3,
  pitch: 0,
  bearing: 0,
};

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function App() {
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW);
  const [inputMode, setInputMode] = useState<InputMode>("mjolnir");
  const [projection, setProjection] = useState<"globe" | "mercator">("globe");
  const [showDebug, setShowDebug] = useState(false);

  // Ref to the DeckGL component — used for unproject() and pickObjects()
  const deckRef = useRef<DeckGLRef>(null);

  // ── Editable-layers state ──────────────────────────────────────────────────
  const [featureCollection, setFeatureCollection] = useState<FeatureCollection>(STARTER_FC);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [lastToolResult, setLastToolResult] = useState<string | null>(null);

  // Fingergun aim reticle position (canvas pixels, null when not aiming)
  const [aimPos, setAimPos] = useState<{ x: number; y: number } | null>(null);
  // Eraser circle while four-finger is held
  const [eraserState, setEraserState] = useState<{ center: { x: number; y: number }; radius: number } | null>(null);

  // createEditTools — wired to React state
  const featureCollectionRef = useRef(featureCollection);
  featureCollectionRef.current = featureCollection;

  const tools = createEditTools({
    getFeatureCollection: () => featureCollectionRef.current,
    onFeatureCollectionChange: setFeatureCollection,
  });

  // ── Wire fist gesture -> projection toggle ─────────────────────────────────
  useEffect(() => {
    setFistAction(() => {
      setProjection((p) => (p === "globe" ? "mercator" : "globe"));
    });
  }, []);

  // Thor gesture control — pass canvas getter so Thor can project landmarks
  const { widgets: thorWidgets, getEngine, thor } = useThor({
    setViewState: setViewState as React.Dispatch<
      React.SetStateAction<ViewState>
    >,
    detector: "hands",
    enabled: inputMode === "thor",
    canvas: () => deckRef.current?.deck?.getCanvas() ?? null,
  });

  // ── ORTHOGONALITY BOUNDARY ─────────────────────────────────────────────────
  // thor.gl does NOT import editable-layers.
  // editable-layers does NOT import thor.gl.
  // These useEffect blocks are the ONLY place they meet — user code, not library
  // code. Any other AI input channel (text/LLM, voice, another sensor) can drive
  // the same createEditTools() vocabulary independently.

  // Fingergun aim: drive the reticle overlay
  useEffect(() => {
    if (!thor) {
      setAimPos(null);
      return;
    }
    const onAim = ({ screenPos }: { screenPos: { x: number; y: number } }) => {
      setAimPos(screenPos);
    };
    const onEnd = () => setAimPos(null);
    thor.on("fingergun-aim", onAim);
    thor.on("eraser-end", onEnd);  // clear aim when gesture changes
    return () => {
      thor.off("fingergun-aim", onAim);
      thor.off("eraser-end", onEnd);
      setAimPos(null);
    };
  }, [thor]);

  // Trigger pull: unproject aim position and draw a point there
  // ORTHOGONALITY: thor signal -> deck.unproject -> tools.draw_point.execute()
  useEffect(() => {
    if (!thor) return;
    const onTrigger = ({ screenPos }: { screenPos: { x: number; y: number } }) => {
      const deck = deckRef.current;
      if (!deck) return;
      const coords = deck.pickObject({ x: screenPos.x, y: screenPos.y, radius: 1 });
      // Use unproject via pickObject viewport — DeckGLRef doesn't expose unproject directly,
      // so we use the deck instance's underlying method.
      const deckInstance = deck.deck;
      if (!deckInstance) return;
      // deck.gl Deck.unproject() returns [lng, lat] or [lng, lat, alt]
      const unprojected = (deckInstance as any).unproject([screenPos.x, screenPos.y]) as [number, number] | null;
      if (!unprojected) return;
      const [lng, lat] = unprojected;
      tools.draw_point
        .execute({ position: [lng, lat], properties: { source: "thor:trigger" } })
        .then((result) => {
          setLastToolResult(
            result.ok
              ? `fired point at [${lng.toFixed(3)}, ${lat.toFixed(3)}]`
              : `error: ${result.reason}`
          );
        });
    };
    thor.on("trigger", onTrigger);
    return () => thor.off("trigger", onTrigger);
    // tools re-created each render but closes over featureCollectionRef — stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thor]);

  // Eraser: while four-finger held, delete features under the palm region
  // ORTHOGONALITY: thor signal -> deck.pickObjects -> tools.delete_feature.execute()
  useEffect(() => {
    if (!thor) {
      setEraserState(null);
      return;
    }
    const onEraserMove = ({ center, radius }: { center: { x: number; y: number }; radius: number }) => {
      setEraserState({ center, radius });
      const deck = deckRef.current;
      if (!deck) return;
      const picked = deck.pickObjects({
        x: center.x - radius,
        y: center.y - radius,
        width: 2 * radius,
        height: 2 * radius,
        layerIds: ["editable-geojson"],
      });
      const indices = [...new Set(picked.map((p) => p.index))].sort((a, b) => b - a);
      // Delete highest indices first so lower ones stay valid
      if (indices.length > 0) {
        indices.forEach((i) => tools.delete_feature.execute({ featureIndex: i }));
        setLastToolResult(`erased ${indices.length} feature${indices.length > 1 ? "s" : ""}`);
      }
    };
    const onEraserEnd = () => setEraserState(null);
    thor.on("eraser-move", onEraserMove);
    thor.on("eraser-end", onEraserEnd);
    return () => {
      thor.off("eraser-move", onEraserMove);
      thor.off("eraser-end", onEraserEnd);
      setEraserState(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thor]);

  // ── END ORTHOGONALITY BOUNDARY ─────────────────────────────────────────────

  const onViewStateChange = useCallback(
    ({ viewState: vs }: { viewState: Record<string, unknown> }) => {
      setViewState(vs as unknown as ViewState);
    },
    []
  );

  const tileLayer = new TileLayer({
    id: "satellite-tiles",
    data: TILE_URL,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props: any) =>
      new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [props.tile.boundingBox[0][0], props.tile.boundingBox[0][1], props.tile.boundingBox[1][0], props.tile.boundingBox[1][1]],
      }),
  });

  // ── EditableGeoJsonLayer — AI tools demo ───────────────────────────────────
  const editableLayer = new EditableGeoJsonLayer({
    id: "editable-geojson",
    data: featureCollection,
    mode: "view" as any,  // view-only interactive mode; mutations go through tools
    selectedFeatureIndexes: selectedIndexes,
    onEdit: ({ updatedData }: any) => {
      setFeatureCollection(updatedData);
    },
    onHover: ({ index }: any) => {
      setHoveredIndex(index >= 0 ? index : null);
    },
    onClick: ({ index }: any) => {
      setSelectedIndexes(index >= 0 ? [index] : []);
    },
    // Visual styling
    getFillColor: (_: any, { index }: any) => {
      if (index === hoveredIndex) return [255, 200, 50, 120];
      if (selectedIndexes.includes(index)) return [100, 180, 255, 120];
      return [100, 220, 150, 80];
    },
    getLineColor: [255, 255, 255, 200],
    getLineWidth: 2,
    lineWidthMinPixels: 1,
    pointRadiusMinPixels: 6,
    updateTriggers: {
      getFillColor: [hoveredIndex, selectedIndexes],
    },
  } as any);

  const view =
    projection === "globe"
      ? new GlobeView({ id: "globe" })
      : new MapView({ id: "map" });

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DeckGL
        ref={deckRef}
        views={view}
        viewState={viewState}
        onViewStateChange={onViewStateChange as any}
        layers={[tileLayer, editableLayer]}
        widgets={inputMode === "thor" ? thorWidgets : undefined}
        parameters={{ cull: true }}
        controller={{ touchRotate: false, touchZoom: true, dragPan: true }}
        getCursor={
          inputMode === "thor"
            ? () => "default"
            : ({ isHovering }: { isHovering: boolean }) =>
                isHovering ? "pointer" : "grab"
        }
      />

      {/* Fingergun aim reticle */}
      {inputMode === "thor" && aimPos && (
        <AimReticle x={aimPos.x} y={aimPos.y} />
      )}

      {/* Eraser circle overlay */}
      {inputMode === "thor" && eraserState && (
        <EraserCircle center={eraserState.center} radius={eraserState.radius} />
      )}

      {/* Gesture indicators */}
      {inputMode === "thor" && (
        <GestureIndicators getEngine={getEngine} />
      )}

      {/* Debug overlay */}
      {inputMode === "thor" && showDebug && (
        <CameraOverlay getEngine={getEngine} />
      )}

      {/* AI tools demo overlay */}
      <EditToolsOverlay
        tools={tools}
        featureCount={featureCollection.features.length}
        hoveredIndex={hoveredIndex}
        viewState={viewState}
        lastResult={lastToolResult}
        onResult={setLastToolResult}
      />

      {/* Bottom bar */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <HintText inputMode={inputMode} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <InputModeToggle mode={inputMode} onChange={setInputMode} />
          {inputMode === "thor" && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: showDebug
                  ? "1px solid rgba(245, 158, 11, 0.3)"
                  : "1px solid rgba(255,255,255,0.06)",
                background: showDebug
                  ? "rgba(245, 158, 11, 0.2)"
                  : "rgba(0,0,0,0.4)",
                color: showDebug
                  ? "rgba(252, 211, 77, 1)"
                  : "rgba(255,255,255,0.3)",
                fontSize: 11,
                cursor: "pointer",
                backdropFilter: "blur(12px)",
              }}
            >
              debug
            </button>
          )}
        </div>
      </div>

      {/* Attribution */}
      <a
        href="https://newheat.co"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          position: "absolute",
          bottom: 8,
          right: 12,
          zIndex: 40,
          fontSize: 10,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.25)",
          textDecoration: "none",
        }}
      >
        built by NEWHEAT
      </a>
    </div>
  );
}

// ── Aim reticle — shown at fingergun tip while aiming ──

function AimReticle({ x, y }: { x: number; y: number }) {
  const SIZE = 20;
  return (
    <div
      style={{
        position: "fixed",
        left: x - SIZE / 2,
        top: y - SIZE / 2,
        width: SIZE,
        height: SIZE,
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Outer ring */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} fill="none" stroke="rgba(255,80,80,0.9)" strokeWidth={1.5} />
        {/* Center dot */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={2} fill="rgba(255,80,80,0.95)" />
        {/* Crosshairs */}
        <line x1={SIZE / 2} y1={2} x2={SIZE / 2} y2={SIZE / 2 - 4} stroke="rgba(255,80,80,0.9)" strokeWidth={1} />
        <line x1={SIZE / 2} y1={SIZE / 2 + 4} x2={SIZE / 2} y2={SIZE - 2} stroke="rgba(255,80,80,0.9)" strokeWidth={1} />
        <line x1={2} y1={SIZE / 2} x2={SIZE / 2 - 4} y2={SIZE / 2} stroke="rgba(255,80,80,0.9)" strokeWidth={1} />
        <line x1={SIZE / 2 + 4} y1={SIZE / 2} x2={SIZE - 2} y2={SIZE / 2} stroke="rgba(255,80,80,0.9)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Eraser circle — shown under palm while four-finger is held ──

function EraserCircle({ center, radius }: { center: { x: number; y: number }; radius: number }) {
  const d = radius * 2;
  return (
    <div
      style={{
        position: "fixed",
        left: center.x - radius,
        top: center.y - radius,
        width: d,
        height: d,
        zIndex: 60,
        pointerEvents: "none",
        borderRadius: "50%",
        border: "2px solid rgba(255, 100, 50, 0.7)",
        background: "rgba(255, 60, 20, 0.12)",
        backdropFilter: "blur(2px)",
      }}
    />
  );
}

// ── Gesture info ──

const GESTURE_INFO: Record<
  string,
  { desc: string; input: string; effect: string }
> = {
  "pinch-pan": {
    desc: "Pan the globe",
    input: "Pinch + drag with one hand",
    effect: "Moves longitude/latitude",
  },
  "pinch-zoom": {
    desc: "Zoom in/out",
    input: "Pinch with both hands",
    effect: "Hands apart = zoom in",
  },
  "pinch-rotate": {
    desc: "Rotate the bearing",
    input: "Pinch both hands + twist",
    effect: "Changes map bearing",
  },
  "pinch-pitch": {
    desc: "Tilt the view",
    input: "Pinch both hands + move up/down",
    effect: "Changes map pitch",
  },
  "open-palm": {
    desc: "Stop / reset",
    input: "Show open palm",
    effect: "Kills inertia",
  },
  fist: {
    desc: "Toggle globe / mercator",
    input: "Make a fist (hold 300ms)",
    effect: "Switches projection",
  },
  fingergun: {
    desc: "Aim + shoot point",
    input: "Index up, thumb up, others curled",
    effect: "Reticle tracks fingertip; drop thumb to place point",
  },
  "four-finger": {
    desc: "Erase features",
    input: "Four fingers extended, thumb tucked",
    effect: "Deletes features under palm region while held",
  },
};

// ── Gesture Indicators ──

function GestureIndicators({
  getEngine,
}: {
  getEngine: () => EngineHandle | null;
}) {
  const [state, setState] = useState({
    activeGestures: [] as string[],
    registeredGestures: [] as string[],
  });
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let rafId = 0;
    function tick() {
      const engine = getEngine();
      setState({
        activeGestures: engine?.getActiveGestureNames() ?? [],
        registeredGestures: listGestures(),
      });
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getEngine]);

  const { activeGestures, registeredGestures } = state;
  const info = hovered ? GESTURE_INFO[hovered] : null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          maxWidth: 224,
          justifyContent: "flex-end",
        }}
      >
        {registeredGestures.map((name) => {
          const isActive = activeGestures.includes(name);
          return (
            <span
              key={name}
              onMouseEnter={() => setHovered(name)}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 10,
                fontFamily: "monospace",
                cursor: "default",
                backdropFilter: "blur(12px)",
                transition: "all 150ms",
                background: isActive
                  ? "rgba(245, 158, 11, 0.3)"
                  : "rgba(0,0,0,0.4)",
                color: isActive
                  ? "rgba(253, 230, 138, 1)"
                  : "rgba(255,255,255,0.4)",
                border: isActive
                  ? "1px solid rgba(245,158,11,0.4)"
                  : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {name}
            </span>
          );
        })}
      </div>

      {info && (
        <div
          style={{
            padding: 8,
            borderRadius: 8,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 11,
            fontFamily: "monospace",
            maxWidth: 224,
          }}
        >
          <div style={{ color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>
            {info.desc}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            <span style={{ color: "rgba(255,255,255,0.25)" }}>how:</span>{" "}
            {info.input}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)" }}>
            <span style={{ color: "rgba(255,255,255,0.25)" }}>does:</span>{" "}
            {info.effect}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Camera overlay with hand skeleton ──

const HAND_CONNECTIONS: [number, number][] = [
  [HAND.WRIST, HAND.THUMB_CMC],
  [HAND.THUMB_CMC, HAND.THUMB_MCP],
  [HAND.THUMB_MCP, HAND.THUMB_IP],
  [HAND.THUMB_IP, HAND.THUMB_TIP],
  [HAND.WRIST, HAND.INDEX_MCP],
  [HAND.INDEX_MCP, HAND.INDEX_PIP],
  [HAND.INDEX_PIP, HAND.INDEX_DIP],
  [HAND.INDEX_DIP, HAND.INDEX_TIP],
  [HAND.WRIST, HAND.MIDDLE_MCP],
  [HAND.MIDDLE_MCP, HAND.MIDDLE_PIP],
  [HAND.MIDDLE_PIP, HAND.MIDDLE_DIP],
  [HAND.MIDDLE_DIP, HAND.MIDDLE_TIP],
  [HAND.WRIST, HAND.RING_MCP],
  [HAND.RING_MCP, HAND.RING_PIP],
  [HAND.RING_PIP, HAND.RING_DIP],
  [HAND.RING_DIP, HAND.RING_TIP],
  [HAND.WRIST, HAND.PINKY_MCP],
  [HAND.PINKY_MCP, HAND.PINKY_PIP],
  [HAND.PINKY_PIP, HAND.PINKY_DIP],
  [HAND.PINKY_DIP, HAND.PINKY_TIP],
  [HAND.INDEX_MCP, HAND.MIDDLE_MCP],
  [HAND.MIDDLE_MCP, HAND.RING_MCP],
  [HAND.RING_MCP, HAND.PINKY_MCP],
];

function CameraOverlay({ getEngine }: { getEngine: () => EngineHandle | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 320;
  const H = 240;

  useEffect(() => {
    let rafId = 0;
    function draw() {
      const canvas = canvasRef.current;
      const engine = getEngine();
      if (!canvas || !engine) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const frame = engine.getLatestFrame();
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, 0, W, H);

      // Mirror
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);

      if (frame) {
        for (let i = 0; i < frame.hands.length; i++) {
          const landmarks = frame.hands[i];
          const color =
            frame.handedness[i] === "Left"
              ? "rgba(255, 180, 120, 0.8)"
              : "rgba(120, 180, 255, 0.8)";
          if (!landmarks || landmarks.length < 21) continue;

          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          for (const [a, b] of HAND_CONNECTIONS) {
            const la = landmarks[a];
            const lb = landmarks[b];
            if (!la || !lb) continue;
            ctx.beginPath();
            ctx.moveTo(la.x * W, la.y * H);
            ctx.lineTo(lb.x * W, lb.y * H);
            ctx.stroke();
          }

          for (let j = 0; j < 21; j++) {
            const lm = landmarks[j];
            if (!lm) continue;
            const isTip = (FINGERTIPS as readonly number[]).includes(j);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(lm.x * W, lm.y * H, isTip ? 4 : 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.restore();

      ctx.font = "500 10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText("thor.gl", 8, H - 8);

      const count = frame?.hands.length ?? 0;
      if (count) {
        ctx.fillStyle = "rgba(0,255,170,0.6)";
        ctx.fillText(`${count} hand${count > 1 ? "s" : ""}`, 8, 14);
      } else {
        ctx.fillStyle = "rgba(255,100,100,0.6)";
        ctx.fillText("no detection", 8, 14);
      }

      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [getEngine]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        left: 16,
        zIndex: 50,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
      }}
    >
      <canvas ref={canvasRef} style={{ width: W, height: H, display: "block" }} />
    </div>
  );
}

// ── Hint ──

function HintText({ inputMode }: { inputMode: InputMode }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [inputMode]);

  const text =
    inputMode === "mjolnir"
      ? "Drag to pan, scroll to zoom"
      : "Pinch to pan \u00b7 Fingergun to place \u00b7 Four-finger to erase \u00b7 Fist to switch projection";

  return (
    <span
      style={{
        fontSize: 11,
        color: "rgba(255,255,255,0.4)",
        transition: "opacity 700ms",
        opacity: visible ? 1 : 0,
      }}
    >
      {text}
    </span>
  );
}

// ── Input mode toggle ──

function InputModeToggle({
  mode,
  onChange,
}: {
  mode: InputMode;
  onChange: (m: InputMode) => void;
}) {
  const modes: { key: InputMode; label: string }[] = [
    { key: "mjolnir", label: "Mjolnir" },
    { key: "thor", label: "Thor" },
  ];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: 2,
        gap: 2,
      }}
    >
      {modes.map(({ key, label }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 11,
              border: "none",
              cursor: "pointer",
              transition: "all 200ms",
              background: active ? "rgba(255,255,255,0.1)" : "transparent",
              color: active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── EditToolsOverlay ──────────────────────────────────────────────────────────
//
// Demonstrates the text-channel path: a button calls tools.draw_point.execute()
// directly — same vocabulary as the signal path (trigger -> draw_point above).
// This proves any AI input channel (text, voice, vision) drives the same tools.

function EditToolsOverlay({
  tools,
  featureCount,
  hoveredIndex,
  viewState,
  lastResult,
  onResult,
}: {
  tools: ReturnType<typeof createEditTools>;
  featureCount: number;
  hoveredIndex: number | null;
  viewState: ViewState;
  lastResult: string | null;
  onResult: (r: string) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 240,
      }}
    >
      {/* Legend */}
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontSize: 10,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginBottom: 4, fontSize: 11 }}>
          AI Edit Tools Demo
        </div>
        <div>{featureCount} features</div>
        {hoveredIndex != null && (
          <div style={{ color: "rgba(255, 200, 50, 0.9)" }}>hover: #{hoveredIndex}</div>
        )}
        <div style={{ marginTop: 4, color: "rgba(255,255,255,0.3)" }}>
          thor signal &#x2192; tool boundary in console
        </div>
      </div>

      {/* Text-channel: draw point at view center */}
      <button
        onClick={() => {
          // TEXT CHANNEL PATH — any LLM, voice assistant, or UI button can call
          // execute() here. Same tool vocabulary as the fingergun trigger above.
          tools.draw_point
            .execute({
              position: [viewState.longitude, viewState.latitude],
              properties: { source: "text-channel:button" },
            })
            .then((result) => {
              onResult(
                result.ok
                  ? `drew point at [${viewState.longitude.toFixed(3)}, ${viewState.latitude.toFixed(3)}]`
                  : `error: ${result.reason}`
              );
            });
        }}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid rgba(100, 220, 150, 0.3)",
          background: "rgba(100, 220, 150, 0.15)",
          color: "rgba(150, 255, 180, 0.9)",
          fontSize: 11,
          fontFamily: "monospace",
          cursor: "pointer",
          backdropFilter: "blur(12px)",
          textAlign: "left",
        }}
      >
        text channel: draw at center
      </button>

      {/* Delete hovered feature button */}
      <button
        disabled={hoveredIndex == null}
        onClick={() => {
          if (hoveredIndex == null) return;
          tools.delete_feature
            .execute({ featureIndex: hoveredIndex })
            .then((result) => {
              onResult(result.ok ? `deleted #${hoveredIndex}` : `error: ${result.reason}`);
            });
        }}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: hoveredIndex != null ? "1px solid rgba(255, 100, 100, 0.3)" : "1px solid rgba(255,255,255,0.06)",
          background: hoveredIndex != null ? "rgba(255, 80, 80, 0.15)" : "rgba(0,0,0,0.3)",
          color: hoveredIndex != null ? "rgba(255, 150, 150, 0.9)" : "rgba(255,255,255,0.2)",
          fontSize: 11,
          fontFamily: "monospace",
          cursor: hoveredIndex != null ? "pointer" : "default",
          backdropFilter: "blur(12px)",
          textAlign: "left",
        }}
      >
        delete_feature {hoveredIndex != null ? `#${hoveredIndex}` : "(hover a feature)"}
      </button>

      {/* Last result */}
      {lastResult && (
        <div
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 10,
            fontFamily: "monospace",
            color: "rgba(180, 255, 200, 0.7)",
          }}
        >
          {lastResult}
        </div>
      )}
    </div>
  );
}
