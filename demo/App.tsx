/**
 * thor.gl demo — Deck.gl globe with hand gesture controls.
 *
 * Gestures:
 * - Pinch + drag (1 hand) -> pan
 * - Pinch (2 hands) -> zoom
 * - Pinch + twist (2 hands) -> rotate bearing
 * - Open palm -> stop inertia
 * - Fist (hold 300ms) -> fire action callback
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
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

type InputMode = "mjolnir" | "thor";

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

  // Wire fist gesture -> projection toggle
  useEffect(() => {
    setFistAction(() => {
      setProjection((p) => (p === "globe" ? "mercator" : "globe"));
    });
  }, []);

  // Thor gesture control
  const { widgets: thorWidgets, getEngine } = useThor({
    setViewState: setViewState as React.Dispatch<
      React.SetStateAction<ViewState>
    >,
    detector: "hands",
    enabled: inputMode === "thor",
  });

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

  const view =
    projection === "globe"
      ? new GlobeView({ id: "globe" })
      : new MapView({ id: "map" });

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DeckGL
        views={view}
        viewState={viewState}
        onViewStateChange={onViewStateChange as any}
        layers={[tileLayer]}
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

      {/* Gesture indicators */}
      {inputMode === "thor" && (
        <GestureIndicators getEngine={getEngine} />
      )}

      {/* Debug overlay */}
      {inputMode === "thor" && showDebug && (
        <CameraOverlay getEngine={getEngine} />
      )}

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
          maxWidth: 192,
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
            maxWidth: 208,
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
      : "Pinch to pan \u00b7 Two hands to zoom \u00b7 Fist to switch projection";

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
