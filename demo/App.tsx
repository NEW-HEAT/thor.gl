/**
 * thor.gl demo — Three output channels in action.
 *
 * NAVIGATION:  pinch-pan, pinch-zoom, pinch-rotate, pinch-pitch, fist
 * PICKING:     hand-point → highlight cities, gaze → hover
 * SIGNALS:     fist → projection toggle, open-palm → toast, gesture log
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { _GlobeView as GlobeView, MapView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import {
  useThor,
  setFistAction,
  listGestures,
  type ViewState,
  type ThorFrame,
  type EngineHandle,
  HAND,
  FINGERTIPS,
} from "thor.gl";

type InputMode = "mjolnir" | "thor";

const INITIAL_VIEW: ViewState = {
  longitude: -40,
  latitude: 25,
  zoom: 2.2,
  pitch: 0,
  bearing: 0,
};

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// ── City data for picking demo ──

interface City {
  name: string;
  coordinates: [number, number];
  population: number;
}

const CITIES: City[] = [
  { name: "New York", coordinates: [-74.006, 40.7128], population: 8336 },
  { name: "London", coordinates: [-0.1276, 51.5074], population: 8982 },
  { name: "Tokyo", coordinates: [139.6917, 35.6895], population: 13960 },
  { name: "Sydney", coordinates: [151.2093, -33.8688], population: 5312 },
  { name: "Cairo", coordinates: [31.2357, 30.0444], population: 9540 },
  { name: "Mumbai", coordinates: [72.8777, 19.076], population: 12442 },
  { name: "Shanghai", coordinates: [121.4737, 31.2304], population: 24870 },
  { name: "Lagos", coordinates: [3.3792, 6.5244], population: 15388 },
  { name: "Mexico City", coordinates: [-99.1332, 19.4326], population: 9209 },
  { name: "Moscow", coordinates: [37.6173, 55.7558], population: 12506 },
  { name: "Rio de Janeiro", coordinates: [-43.1729, -22.9068], population: 6748 },
  { name: "Paris", coordinates: [2.3522, 48.8566], population: 2161 },
  { name: "Istanbul", coordinates: [28.9784, 41.0082], population: 15462 },
  { name: "Buenos Aires", coordinates: [-58.3816, -34.6037], population: 3076 },
  { name: "Nairobi", coordinates: [36.8219, -1.2921], population: 4397 },
  { name: "Singapore", coordinates: [103.8198, 1.3521], population: 5686 },
  { name: "Dubai", coordinates: [55.2708, 25.2048], population: 3490 },
  { name: "Bangkok", coordinates: [100.5018, 13.7563], population: 10539 },
  { name: "Seoul", coordinates: [126.978, 37.5665], population: 9776 },
  { name: "Cape Town", coordinates: [18.4241, -33.9249], population: 4618 },
];

// ── Toast system ──

interface Toast {
  id: number;
  text: string;
  color: string;
  ts: number;
}

let toastId = 0;

// ── Event log ──

interface LogEntry {
  id: number;
  gesture: string;
  channel: "nav" | "pick" | "signal";
  ts: number;
}

let logId = 0;

// ── App ──

export function App() {
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW);
  const [inputMode, setInputMode] = useState<InputMode>("mjolnir");
  const [projection, setProjection] = useState<"globe" | "mercator">("globe");
  const [showDebug, setShowDebug] = useState(false);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Check camera when switching to thor mode
  useEffect(() => {
    if (inputMode !== "thor") {
      setCameraError(null);
      return;
    }

    let cancelled = false;

    async function checkCamera() {
      try {
        // First check if any video input devices exist
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        if (videoInputs.length === 0) {
          if (!cancelled) setCameraError("No camera detected. Thor requires a webcam for hand tracking.");
          return;
        }

        // Then try to actually get access (handles permission denied)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
        // Camera works — release immediately, the engine will request its own
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) setCameraError(null);
      } catch (err: any) {
        if (cancelled) return;
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setCameraError("No camera detected. Thor requires a webcam for hand tracking.");
        } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setCameraError("Camera access denied. Please allow camera permissions and try again.");
        } else {
          setCameraError(`Camera error: ${err.message || "Unknown error"}`);
        }
      }
    }

    checkCamera();
    return () => { cancelled = true; };
  }, [inputMode]);

  // Helpers
  const addToast = useCallback((text: string, color: string) => {
    const t: Toast = { id: ++toastId, text, color, ts: Date.now() };
    setToasts((prev) => [t, ...prev].slice(0, 5));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 2500);
  }, []);

  const addLog = useCallback((gesture: string, channel: LogEntry["channel"]) => {
    const entry: LogEntry = { id: ++logId, gesture, channel, ts: Date.now() };
    setEventLog((prev) => [entry, ...prev].slice(0, 30));
  }, []);

  // Wire fist → projection toggle
  useEffect(() => {
    setFistAction(() => {
      setProjection((p) => {
        const next = p === "globe" ? "mercator" : "globe";
        addToast(`${next.toUpperCase()}`, "rgba(168, 85, 247, 0.9)");
        addLog("fist", "signal");
        return next;
      });
    });
  }, [addToast, addLog]);

  // Thor gesture control
  const { widgets: thorWidgets, getEngine } = useThor({
    setViewState: setViewState as React.Dispatch<React.SetStateAction<ViewState>>,
    detector: "hands",
    enabled: inputMode === "thor",
  });

  // Track gestures for event log + toasts
  const prevGesturesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (inputMode !== "thor") return;

    let rafId = 0;
    function tick() {
      const engine = getEngine();
      if (engine) {
        const active = engine.getActiveGestureNames();
        const activeSet = new Set(active);
        const prev = prevGesturesRef.current;

        // Detect newly activated gestures
        for (const g of active) {
          if (!prev.has(g)) {
            // Navigation gestures
            if (["pinch-pan", "pinch-zoom", "pinch-rotate", "pinch-pitch"].includes(g)) {
              addLog(g, "nav");
            }
            // Signal gestures
            if (g === "open-palm") {
              addToast("OPEN PALM", "rgba(34, 197, 94, 0.9)");
              addLog(g, "signal");
            }
            if (g === "fist") {
              addLog(g, "signal");
            }
          }
        }

        // Hand-point picking: index fingertip near a city = highlight
        const frame = engine.getLatestFrame();
        if (frame && frame.hands.length > 0) {
          const hand = frame.hands[0];
          const indexTip = hand?.[8]; // HAND.INDEX_TIP
          if (indexTip) {
            // We'll let the ScatterplotLayer's onHover handle actual picking
            // but log when hand is present for the event log
          }
        }

        prevGesturesRef.current = activeSet;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [inputMode, getEngine, addToast, addLog]);

  const onViewStateChange = useCallback(
    ({ viewState: vs }: { viewState: Record<string, unknown> }) => {
      setViewState(vs as unknown as ViewState);
    },
    []
  );

  // ── Layers ──

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
        bounds: [
          props.tile.boundingBox[0][0],
          props.tile.boundingBox[0][1],
          props.tile.boundingBox[1][0],
          props.tile.boundingBox[1][1],
        ],
      }),
  });

  const cityLayer = new ScatterplotLayer<City>({
    id: "cities",
    data: CITIES,
    pickable: true,
    getPosition: (d) => d.coordinates,
    getRadius: (d) => Math.sqrt(d.population) * 800,
    getFillColor: (d) => {
      if (d.name === selectedCity) return [168, 85, 247, 220];
      if (d.name === hoveredCity) return [245, 158, 11, 200];
      return [255, 255, 255, 100];
    },
    getLineColor: (d) => {
      if (d.name === selectedCity) return [168, 85, 247, 255];
      if (d.name === hoveredCity) return [245, 158, 11, 255];
      return [255, 255, 255, 60];
    },
    stroked: true,
    lineWidthMinPixels: 1,
    radiusMinPixels: 4,
    radiusMaxPixels: 40,
    updateTriggers: {
      getFillColor: [hoveredCity, selectedCity],
      getLineColor: [hoveredCity, selectedCity],
    },
    onHover: (info: any) => {
      const name = info.object?.name ?? null;
      if (name !== hoveredCity) {
        setHoveredCity(name);
        if (name && inputMode === "thor") {
          addLog(`pick: ${name}`, "pick");
        }
      }
    },
    onClick: (info: any) => {
      if (info.object) {
        setSelectedCity((prev) =>
          prev === info.object.name ? null : info.object.name
        );
        addToast(`SELECTED: ${info.object.name}`, "rgba(168, 85, 247, 0.9)");
        addLog(`select: ${info.object.name}`, "pick");
      }
    },
  });

  const labelLayer = new TextLayer<City>({
    id: "city-labels",
    data: CITIES,
    getPosition: (d) => d.coordinates,
    getText: (d) => d.name,
    getSize: (d) => (d.name === hoveredCity || d.name === selectedCity ? 14 : 11),
    getColor: (d) => {
      if (d.name === selectedCity) return [168, 85, 247, 255];
      if (d.name === hoveredCity) return [245, 158, 11, 255];
      return [255, 255, 255, 140];
    },
    getPixelOffset: [0, -20],
    fontFamily: "monospace",
    fontWeight: "bold",
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 200],
    updateTriggers: {
      getSize: [hoveredCity, selectedCity],
      getColor: [hoveredCity, selectedCity],
    },
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
        layers={[tileLayer, cityLayer, labelLayer]}
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

      {/* Camera error overlay */}
      {inputMode === "thor" && cameraError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              maxWidth: 420,
              padding: "24px 32px",
              borderRadius: 16,
              background: "rgba(20,20,20,0.95)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {cameraError.includes("denied") ? "\u{1F6AB}" : "\u{1F4F7}"}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(252, 165, 165, 1)",
                marginBottom: 8,
              }}
            >
              Camera Required
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.5)",
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              {cameraError}
            </div>
            <button
              onClick={() => setInputMode("mjolnir")}
              style={{
                padding: "8px 20px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.7)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              switch to Mjolnir mode
            </button>
          </div>
        </div>
      )}

      {/* Gesture indicators */}
      {inputMode === "thor" && !cameraError && <GestureIndicators getEngine={getEngine} />}

      {/* Debug overlay */}
      {inputMode === "thor" && !cameraError && showDebug && (
        <CameraOverlay getEngine={getEngine} />
      )}

      {/* Event log */}
      {inputMode === "thor" && !cameraError && <EventLog entries={eventLog} />}

      {/* Toasts */}
      <ToastStack toasts={toasts} />

      {/* Hovered city info */}
      {hoveredCity && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            padding: "6px 16px",
            borderRadius: 999,
            background: "rgba(245, 158, 11, 0.15)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            color: "rgba(253, 230, 138, 1)",
            fontSize: 13,
            fontFamily: "monospace",
            fontWeight: 500,
            backdropFilter: "blur(12px)",
          }}
        >
          {hoveredCity}
          {inputMode === "thor" ? " (hand pick)" : ""}
        </div>
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

      {/* Channel legend + camera indicator */}
      {inputMode === "thor" && !cameraError && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <CameraIndicator getEngine={getEngine} />
          <div style={{ height: 4 }} />
          <ChannelBadge color="#3b82f6" label="NAV" desc="pinch gestures" />
          <ChannelBadge color="#f59e0b" label="PICK" desc="hover cities" />
          <ChannelBadge color="#a855f7" label="SIGNAL" desc="fist / palm" />
        </div>
      )}

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

// ── Camera indicator ──

function CameraIndicator({
  getEngine,
}: {
  getEngine: () => EngineHandle | null;
}) {
  const [hasHands, setHasHands] = useState(false);

  useEffect(() => {
    let rafId = 0;
    function tick() {
      const engine = getEngine();
      const frame = engine?.getLatestFrame();
      setHasHands((frame?.hands.length ?? 0) > 0);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getEngine]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(12px)",
        border: hasHands
          ? "1px solid rgba(239, 68, 68, 0.4)"
          : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: hasHands ? "#ef4444" : "#666",
          boxShadow: hasHands ? "0 0 8px #ef4444" : "none",
          animation: hasHands ? "pulse 1.5s ease-in-out infinite" : "none",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: hasHands ? "rgba(252, 165, 165, 0.9)" : "rgba(255,255,255,0.3)",
          letterSpacing: "0.02em",
        }}
      >
        {hasHands ? "smile, you're on camera" : "camera standby"}
      </span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ── Channel badge ──

function ChannelBadge({
  color,
  label,
  desc,
}: {
  color: string;
  label: string;
  desc: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${color}33`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span
        style={{
          fontSize: 9,
          fontFamily: "monospace",
          fontWeight: 600,
          color,
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 9,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.3)",
        }}
      >
        {desc}
      </span>
    </div>
  );
}

// ── Toast stack ──

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        right: 16,
        zIndex: 60,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 6,
      }}
    >
      {toasts.map((t) => {
        const age = Date.now() - t.ts;
        const opacity = age < 200 ? age / 200 : age > 2000 ? 1 - (age - 2000) / 500 : 1;
        return (
          <div
            key={t.id}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: t.color,
              color: "white",
              fontSize: 12,
              fontFamily: "monospace",
              fontWeight: 600,
              letterSpacing: "0.05em",
              opacity: Math.max(0, opacity),
              transform: `translateX(${age < 200 ? 20 - (age / 200) * 20 : 0}px)`,
              transition: "opacity 200ms, transform 200ms",
              backdropFilter: "blur(8px)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {t.text}
          </div>
        );
      })}
    </div>
  );
}

// ── Event log ──

function EventLog({ entries }: { entries: LogEntry[] }) {
  const CHANNEL_COLORS: Record<string, string> = {
    nav: "#3b82f6",
    pick: "#f59e0b",
    signal: "#a855f7",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        left: 16,
        zIndex: 50,
        width: 200,
        maxHeight: 240,
        overflow: "hidden",
        borderRadius: 8,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "6px 0",
      }}
    >
      <div
        style={{
          padding: "0 8px 4px",
          fontSize: 9,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.25)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        event log
      </div>
      {entries.length === 0 && (
        <div
          style={{
            padding: "8px",
            fontSize: 10,
            fontFamily: "monospace",
            color: "rgba(255,255,255,0.2)",
            textAlign: "center",
          }}
        >
          waiting for gestures...
        </div>
      )}
      {entries.slice(0, 15).map((e) => (
        <div
          key={e.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            fontSize: 10,
            fontFamily: "monospace",
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: CHANNEL_COLORS[e.channel] ?? "#666",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: CHANNEL_COLORS[e.channel] ?? "#888",
              fontWeight: 500,
              fontSize: 8,
              width: 30,
              flexShrink: 0,
            }}
          >
            {e.channel.toUpperCase()}
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.gesture}
          </span>
        </div>
      ))}
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
    desc: "Stop / signal",
    input: "Show open palm",
    effect: "Kills inertia, fires signal",
  },
  fist: {
    desc: "Toggle globe / mercator",
    input: "Make a fist (hold 300ms)",
    effect: "Switches projection (SIGNAL)",
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

function CameraOverlay({
  getEngine,
}: {
  getEngine: () => EngineHandle | null;
}) {
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
        bottom: 330,
        left: 16,
        zIndex: 50,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H, display: "block" }}
      />
    </div>
  );
}

// ── Hint ──

function HintText({ inputMode }: { inputMode: InputMode }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [inputMode]);

  const text =
    inputMode === "mjolnir"
      ? "Drag to pan, scroll to zoom. Click cities to select."
      : "Pinch to navigate \u00b7 Hover cities \u00b7 Fist to switch projection \u00b7 Open palm to signal";

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
              color: active
                ? "rgba(255,255,255,0.8)"
                : "rgba(255,255,255,0.3)",
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
