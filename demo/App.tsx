/**
 * thor.gl demo — Full RFC showcase.
 *
 * NAVIGATION:  pinch-pan, pinch-zoom, pinch-rotate, pinch-pitch, head-tilt, lean
 * PICKING:     gaze → hover cities, hand-point → highlight, blink → select
 * SIGNALS:     fist → projection toggle, open-palm → toast, gesture log
 * ATTENTION:   iris tracking → pause when not looking at screen
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
  registerGesture,
  unregisterGesture,
  getGesture,
  headTilt,
  gaze,
  blink,
  lean,
  setGazeCalibration,
  getGazeCalibration,
  extractIrisPosition,
  extractHeadPose,
  fitCalibration,
  FACE,
  type ViewState,
  type ThorFrame,
  type EngineHandle,
  type CalibrationPoint,
  type CalibrationData,
  HAND,
  FINGERTIPS,
} from "thor.gl";

// ── Register face & pose gestures (not auto-registered) ──
registerGesture(gaze, { priority: 10, group: "gaze" });
registerGesture(blink, { priority: 12, group: "action" });
// head-tilt and lean are NOT registered — TBD, too flakey for nav currently

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
  const [showCalibration, setShowCalibration] = useState(false);

  // Check camera when switching to thor mode
  useEffect(() => {
    if (inputMode !== "thor") {
      setCameraError(null);
      return;
    }

    let cancelled = false;

    async function checkCamera() {
      try {
        // navigator.mediaDevices is undefined when served over plain HTTP
        // to a non-localhost origin (browsers restrict to secure contexts)
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) setCameraError(
            "Camera API unavailable. This page must be served over HTTPS or localhost. " +
            "Try accessing via localhost on this machine, or run: npx vite --host --https"
          );
          return;
        }

        // Try to get camera access (handles no device + permission denied)
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

  // Thor gesture control — holistic mode for hands + face + pose
  const { widgets: thorWidgets, getEngine } = useThor({
    setViewState: setViewState as React.Dispatch<React.SetStateAction<ViewState>>,
    detector: "holistic",
    enabled: inputMode === "thor",
  });

  // Gaze position (normalized 0-1, for cursor overlay)
  const [gazePos, setGazePos] = useState<{ x: number; y: number } | null>(null);
  // Attention gate
  const [isAttentive, setIsAttentive] = useState(true);
  const attentionLostAt = useRef<number | null>(null);
  const ATTENTION_DELAY = 1500; // ms before showing "pay attention" overlay

  // Track gestures for event log, toasts, gaze picking, attention
  const prevGesturesRef = useRef<Set<string>>(new Set());
  const gazeHoveredRef = useRef<string | null>(null);

  useEffect(() => {
    if (inputMode !== "thor") {
      setGazePos(null);
      setIsAttentive(true);
      attentionLostAt.current = null;
      return;
    }

    let rafId = 0;
    function tick() {
      const engine = getEngine();
      if (!engine) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const active = engine.getActiveGestureNames();
      const activeSet = new Set(active);
      const prev = prevGesturesRef.current;
      const frame = engine.getLatestFrame();

      // ── Gaze via model + attention gate ──
      if (frame?.face && frame.face.length > 474) {
        const iris = extractIrisPosition(frame.face);
        const headPose = extractHeadPose(frame.face);

        if (iris && headPose) {
          // Use the same model as the gesture handler
          const irisX = (iris.leftX + iris.rightX) / 2;
          const eyeDevX = (irisX - 0.5) * 2;
          const irisY = (iris.leftY + iris.rightY) / 2;
          const eyeDevY = (irisY - 0.5) * 2;
          const faceYOffset = (headPose.faceY - 0.45) * 1.5;

          // Horizontal: head yaw primary + iris X
          const gazeX = Math.max(0, Math.min(1,
            0.5 + headPose.yaw * 1.8 + eyeDevX * 1.0));
          // Vertical: head pitch primary + faceY + minimal iris Y
          const gazeY = Math.max(0, Math.min(1,
            0.5 - headPose.pitch * 1.4 + faceYOffset * 0.4 + eyeDevY * 0.15));

          setGazePos({ x: gazeX, y: gazeY });

          // Attention: is gaze within screen bounds (with margin)?
          const lookingAtScreen = gazeX > 0.05 && gazeX < 0.95 &&
                                  gazeY > 0.05 && gazeY < 0.95;
          if (lookingAtScreen) {
            attentionLostAt.current = null;
            setIsAttentive(true);
          } else if (!attentionLostAt.current) {
            attentionLostAt.current = Date.now();
          } else if (Date.now() - attentionLostAt.current > ATTENTION_DELAY) {
            setIsAttentive(false);
          }
        }
      } else if (!frame?.face) {
        setGazePos(null);
        if (!attentionLostAt.current) {
          attentionLostAt.current = Date.now();
        } else if (Date.now() - attentionLostAt.current > ATTENTION_DELAY * 2) {
          setIsAttentive(false);
        }
      }

      // ── Gesture events (only when attentive) ──
      for (const g of active) {
        if (!prev.has(g)) {
          // Navigation
          if (["pinch-pan", "pinch-zoom", "pinch-rotate", "pinch-pitch"].includes(g)) {
            addLog(g, "nav");
          }
          // Gaze
          if (g === "gaze") {
            addLog("gaze tracking", "pick");
          }
          // Signals
          if (g === "open-palm") {
            addToast("OPEN PALM", "rgba(34, 197, 94, 0.9)");
            addLog(g, "signal");
          }
          if (g === "fist") {
            addLog(g, "signal");
          }
          if (g === "blink") {
            addToast("BLINK", "rgba(59, 130, 246, 0.9)");
            addLog("blink", "signal");
            // Blink = select hovered city
            if (gazeHoveredRef.current) {
              setSelectedCity(gazeHoveredRef.current);
              addToast(`SELECTED: ${gazeHoveredRef.current}`, "rgba(168, 85, 247, 0.9)");
              addLog(`blink-select: ${gazeHoveredRef.current}`, "pick");
            }
          }
        }
      }

      prevGesturesRef.current = activeSet;
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

      {/* Attention gate overlay */}
      {inputMode === "thor" && !cameraError && !isAttentive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            transition: "opacity 500ms",
          }}
        >
          <div
            style={{
              padding: "20px 32px",
              borderRadius: 16,
              background: "rgba(20,20,20,0.9)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{"\u{1F440}"}</div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(253, 230, 138, 1)",
                marginBottom: 4,
              }}
            >
              look at the screen to engage
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.35)",
              }}
            >
              thor.gl pauses when you look away
            </div>
          </div>
        </div>
      )}

      {/* Calibration overlay */}
      {showCalibration && (
        <CalibrationOverlay
          getEngine={getEngine}
          onComplete={(data) => {
            setGazeCalibration(data);
            setShowCalibration(false);
            addToast("GAZE CALIBRATED", "rgba(59, 130, 246, 0.9)");
            addLog("calibration complete", "pick");
          }}
          onCancel={() => setShowCalibration(false)}
        />
      )}

      {/* Gaze cursor */}
      {inputMode === "thor" && !cameraError && isAttentive && gazePos && (
        <div
          style={{
            position: "absolute",
            left: `${(1 - gazePos.x) * 100}%`,
            top: `${gazePos.y * 100}%`,
            transform: "translate(-50%, -50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "2px solid rgba(59, 130, 246, 0.6)",
            background: "rgba(59, 130, 246, 0.1)",
            boxShadow: "0 0 12px rgba(59, 130, 246, 0.3)",
            pointerEvents: "none",
            zIndex: 45,
            transition: "left 100ms ease-out, top 100ms ease-out",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "rgba(59, 130, 246, 0.8)",
            }}
          />
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
            <>
              <button
                onClick={() => setShowCalibration(true)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: getGazeCalibration()
                    ? "1px solid rgba(59, 130, 246, 0.3)"
                    : "1px solid rgba(255,255,255,0.06)",
                  background: getGazeCalibration()
                    ? "rgba(59, 130, 246, 0.2)"
                    : "rgba(0,0,0,0.4)",
                  color: getGazeCalibration()
                    ? "rgba(147, 197, 253, 1)"
                    : "rgba(255,255,255,0.3)",
                  fontSize: 11,
                  cursor: "pointer",
                  backdropFilter: "blur(12px)",
                }}
              >
                {getGazeCalibration() ? "recalibrate" : "calibrate gaze"}
              </button>
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
            </>
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
  const [status, setStatus] = useState<"off" | "streaming" | "human">("off");

  useEffect(() => {
    let rafId = 0;
    function tick() {
      const engine = getEngine();
      if (!engine) {
        setStatus("off");
      } else {
        const video = engine.getVideo();
        const streaming = video && video.readyState >= 2 && !video.paused;
        const frame = engine.getLatestFrame();
        const hasHands = (frame?.hands.length ?? 0) > 0;
        setStatus(hasHands ? "human" : streaming ? "streaming" : "off");
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getEngine]);

  const isLive = status !== "off";
  const isHuman = status === "human";

  const borderColor = isHuman
    ? "rgba(239, 68, 68, 0.4)"
    : isLive
      ? "rgba(239, 68, 68, 0.2)"
      : "rgba(255,255,255,0.06)";

  const dotColor = isLive ? "#ef4444" : "#666";
  const textColor = isHuman
    ? "rgba(252, 165, 165, 0.9)"
    : isLive
      ? "rgba(239, 68, 68, 0.6)"
      : "rgba(255,255,255,0.3)";

  const label = isHuman
    ? "smile, you're on camera"
    : isLive
      ? "camera live — no hands detected"
      : "camera starting...";

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
        border: `1px solid ${borderColor}`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: isLive ? `0 0 8px ${dotColor}` : "none",
          animation: isLive ? "pulse 1.5s ease-in-out infinite" : "none",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: textColor,
          letterSpacing: "0.02em",
        }}
      >
        {label}
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

const CHANNEL_NAV = { label: "NAV", color: "#3b82f6" };
const CHANNEL_PICK = { label: "PICK", color: "#f59e0b" };
const CHANNEL_SIGNAL = { label: "SIGNAL", color: "#a855f7" };

const GESTURE_INFO: Record<
  string,
  { desc: string; input: string; effect: string; channel: { label: string; color: string } }
> = {
  "pinch-pan": {
    desc: "Pan the globe",
    input: "Pinch + drag (1 hand)",
    effect: "Moves longitude / latitude",
    channel: CHANNEL_NAV,
  },
  "pinch-zoom": {
    desc: "Zoom in / out",
    input: "Pinch (2 hands) apart / together",
    effect: "Changes zoom level",
    channel: CHANNEL_NAV,
  },
  "pinch-rotate": {
    desc: "Rotate bearing",
    input: "Pinch (2 hands) + twist",
    effect: "Rotates the map bearing",
    channel: CHANNEL_NAV,
  },
  "pinch-pitch": {
    desc: "Tilt the view",
    input: "Pinch (2 hands) + up/down",
    effect: "Changes map pitch / tilt",
    channel: CHANNEL_NAV,
  },
  "open-palm": {
    desc: "Stop / signal",
    input: "Show open palm to camera",
    effect: "Kills inertia, emits signal event",
    channel: CHANNEL_SIGNAL,
  },
  fist: {
    desc: "Action trigger",
    input: "Make a fist, hold 300ms",
    effect: "Fires action callback (globe toggle)",
    channel: CHANNEL_SIGNAL,
  },
  gaze: {
    desc: "Eye tracking cursor (experimental)",
    input: "Look at screen (iris position)",
    effect: "Blue cursor tracks gaze — assumes laptop webcam",
    channel: CHANNEL_PICK,
  },
  blink: {
    desc: "Blink to select",
    input: "Deliberate blink (both eyes, 150-800ms)",
    effect: "Selects the gaze-hovered city",
    channel: CHANNEL_SIGNAL,
  },
  "head-tilt": {
    desc: "Head rotation (TBD)",
    input: "Turn or tilt your head",
    effect: "Not yet wired — needs tuning for reliable nav",
    channel: { label: "TBD", color: "#666" },
  },
  lean: {
    desc: "Body lean panning (TBD)",
    input: "Lean left/right/forward/back",
    effect: "Not yet wired — needs tuning for reliable nav",
    channel: { label: "TBD", color: "#666" },
  },
};

// ── Gesture Indicators ──

/** All known gesture names + their registration config for re-enabling */
const GESTURE_REGISTRY: Record<string, { handler: any; priority: number; group: string }> = {
  "pinch-pan":    { handler: null, priority: 20, group: "navigation" },
  "pinch-zoom":   { handler: null, priority: 25, group: "navigation" },
  "pinch-rotate": { handler: null, priority: 22, group: "rotation" },
  "pinch-pitch":  { handler: null, priority: 21, group: "pitch" },
  "open-palm":    { handler: null, priority: 5,  group: "signal" },
  "fist":         { handler: null, priority: 30, group: "action" },
  "gaze":         { handler: gaze, priority: 10, group: "gaze" },
  "blink":        { handler: blink, priority: 12, group: "action" },
  "head-tilt":    { handler: headTilt, priority: 15, group: "navigation" },
  "lean":         { handler: lean, priority: 14, group: "navigation" },
};

function GestureIndicators({
  getEngine,
}: {
  getEngine: () => EngineHandle | null;
}) {
  const [state, setState] = useState({
    activeGestures: [] as string[],
    registeredGestures: [] as string[],
    handCount: 0,
    hasFace: false,
    confidence: [] as number[],
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disabledGestures, setDisabledGestures] = useState<Set<string>>(new Set());

  useEffect(() => {
    let rafId = 0;
    function tick() {
      const engine = getEngine();
      const frame = engine?.getLatestFrame();
      setState({
        activeGestures: engine?.getActiveGestureNames() ?? [],
        registeredGestures: listGestures(),
        handCount: frame?.hands.length ?? 0,
        hasFace: !!(frame?.face && frame.face.length > 0),
        confidence: frame?.handConfidences ?? [],
      });
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getEngine]);

  const toggleGesture = useCallback((name: string) => {
    setDisabledGestures((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        // Re-enable
        next.delete(name);
        const reg = GESTURE_REGISTRY[name];
        if (reg?.handler) {
          registerGesture(reg.handler, { priority: reg.priority, group: reg.group });
        }
      } else {
        // Disable
        next.add(name);
        unregisterGesture(name);
      }
      return next;
    });
  }, []);

  const { activeGestures, registeredGestures, handCount, hasFace, confidence } = state;

  // Show all known gestures (registered + disabled)
  const allGestures = Object.keys(GESTURE_INFO);

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
        gap: 6,
        maxWidth: 240,
      }}
    >
      {/* Live stats bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "4px 8px",
          borderRadius: 6,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
          fontSize: 9,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        <span>
          hands:{" "}
          <span style={{ color: handCount > 0 ? "#4ade80" : "#ef4444" }}>
            {handCount}
          </span>
        </span>
        {hasFace && <span style={{ color: "#4ade80" }}>face</span>}
        {confidence.length > 0 && (
          <span>
            conf:{" "}
            <span style={{ color: "rgba(255,255,255,0.6)" }}>
              {confidence.map((c) => `${(c * 100).toFixed(0)}%`).join("/")}
            </span>
          </span>
        )}
        <span>
          active:{" "}
          <span style={{ color: activeGestures.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.3)" }}>
            {activeGestures.length}
          </span>
        </span>
      </div>

      {/* Gesture cards */}
      {allGestures.map((name) => {
        const isDisabled = disabledGestures.has(name);
        const isActive = !isDisabled && activeGestures.includes(name);
        const info = GESTURE_INFO[name];
        const isExpanded = expanded === name;

        return (
          <div
            key={name}
            style={{
              width: "100%",
              padding: isExpanded ? "6px 8px" : "3px 8px",
              borderRadius: 6,
              fontSize: 10,
              fontFamily: "monospace",
              backdropFilter: "blur(12px)",
              transition: "all 150ms",
              opacity: isDisabled ? 0.4 : 1,
              background: isActive
                ? "rgba(245, 158, 11, 0.2)"
                : "rgba(0,0,0,0.5)",
              border: isActive
                ? "1px solid rgba(245,158,11,0.4)"
                : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Enable/disable toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleGesture(name); }}
                title={isDisabled ? "Enable gesture" : "Disable gesture"}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: isDisabled
                    ? "1px solid rgba(255,255,255,0.15)"
                    : isActive
                      ? "1px solid rgba(245,158,11,0.6)"
                      : "1px solid rgba(255,255,255,0.25)",
                  background: isDisabled
                    ? "transparent"
                    : isActive
                      ? "rgba(245, 158, 11, 0.5)"
                      : "rgba(255,255,255,0.15)",
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8,
                  color: isDisabled ? "rgba(255,255,255,0.2)" : "#fff",
                }}
              >
                {isDisabled ? "" : "\u2713"}
              </button>
              {/* Name */}
              <span
                onClick={() => setExpanded(isExpanded ? null : name)}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  color: isDisabled
                    ? "rgba(255,255,255,0.3)"
                    : isActive
                      ? "rgba(253, 230, 138, 1)"
                      : "rgba(255,255,255,0.5)",
                  fontWeight: isActive ? 600 : 400,
                  textDecoration: isDisabled ? "line-through" : "none",
                }}
              >
                {name}
              </span>
              {/* Channel tag */}
              {info && (
                <span
                  style={{
                    padding: "1px 4px",
                    borderRadius: 3,
                    fontSize: 7,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: info.channel.color,
                    background: `${info.channel.color}20`,
                    border: `1px solid ${info.channel.color}30`,
                  }}
                >
                  {info.channel.label}
                </span>
              )}
            </div>

            {/* Expanded details */}
            {isExpanded && info && (
              <div style={{ marginTop: 4, paddingLeft: 20 }}>
                <div style={{ color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>
                  {info.desc}
                </div>
                <div style={{ color: "rgba(255,255,255,0.35)" }}>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>input:</span> {info.input}
                </div>
                <div style={{ color: "rgba(255,255,255,0.35)" }}>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>output:</span> {info.effect}
                </div>
                <div style={{ color: "rgba(255,255,255,0.35)" }}>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>channel:</span>{" "}
                  <span style={{ color: info.channel.color }}>{info.channel.label}</span>
                </div>
                <div style={{ color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>status:</span>{" "}
                  <span style={{ color: isDisabled ? "#ef4444" : "#4ade80" }}>
                    {isDisabled ? "disabled" : registeredGestures.includes(name) ? "enabled" : "not registered"}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Calibration overlay ──

const CALIBRATION_DOTS = [
  { x: 0.1, y: 0.1 },   // top-left
  { x: 0.5, y: 0.1 },   // top-center
  { x: 0.9, y: 0.1 },   // top-right
  { x: 0.1, y: 0.5 },   // mid-left
  { x: 0.5, y: 0.5 },   // center
  { x: 0.9, y: 0.5 },   // mid-right
  { x: 0.1, y: 0.9 },   // bottom-left
  { x: 0.5, y: 0.9 },   // bottom-center
  { x: 0.9, y: 0.9 },   // bottom-right
];

function CalibrationOverlay({
  getEngine,
  onComplete,
  onCancel,
}: {
  getEngine: () => EngineHandle | null;
  onComplete: (data: CalibrationData) => void;
  onCancel: () => void;
}) {
  const [currentDot, setCurrentDot] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [samples, setSamples] = useState<CalibrationPoint[]>([]);
  const collectBuffer = useRef<{ irisX: number; irisY: number; headYaw: number; headPitch: number }[]>([]);
  const SAMPLES_PER_DOT = 15; // Collect 15 frames (~0.5s at 30fps) per dot

  useEffect(() => {
    if (!collecting) return;

    let rafId = 0;
    function tick() {
      const engine = getEngine();
      const frame = engine?.getLatestFrame();
      if (frame?.face && frame.face.length > 474) {
        const iris = extractIrisPosition(frame.face);
        const head = extractHeadPose(frame.face);
        if (iris && head) {
          const irisX = (iris.leftX + iris.rightX) / 2;
          const irisY = (iris.leftY + iris.rightY) / 2;
          collectBuffer.current.push({ irisX, irisY, headYaw: head.yaw, headPitch: head.pitch, faceY: head.faceY });

          if (collectBuffer.current.length >= SAMPLES_PER_DOT) {
            // Average the samples
            const buf = collectBuffer.current;
            const avg = {
              irisX: buf.reduce((s, b) => s + b.irisX, 0) / buf.length,
              irisY: buf.reduce((s, b) => s + b.irisY, 0) / buf.length,
              headYaw: buf.reduce((s, b) => s + b.headYaw, 0) / buf.length,
              headPitch: buf.reduce((s, b) => s + b.headPitch, 0) / buf.length,
              faceY: buf.reduce((s, b) => s + b.faceY, 0) / buf.length,
            };

            const dot = CALIBRATION_DOTS[currentDot];
            const point: CalibrationPoint = {
              screenX: dot.x,
              screenY: dot.y,
              ...avg,
            };

            setSamples((prev) => {
              const next = [...prev, point];
              if (currentDot + 1 >= CALIBRATION_DOTS.length) {
                // All dots collected — fit calibration
                try {
                  const calibData = fitCalibration(next);
                  onComplete(calibData);
                } catch {
                  // Not enough points (shouldn't happen with 9)
                  onCancel();
                }
              }
              return next;
            });

            setCollecting(false);
            collectBuffer.current = [];
            setCurrentDot((d) => d + 1);
            return; // Stop the loop
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [collecting, currentDot, getEngine, onComplete, onCancel]);

  const dot = CALIBRATION_DOTS[currentDot];
  const progress = collectBuffer.current.length / SAMPLES_PER_DOT;
  const done = currentDot >= CALIBRATION_DOTS.length;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.85)",
        cursor: "none",
      }}
    >
      {!done && dot && (
        <>
          {/* Target dot */}
          <div
            style={{
              position: "absolute",
              left: `${dot.x * 100}%`,
              top: `${dot.y * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {/* Outer ring (progress) */}
            <svg width="48" height="48" style={{ position: "absolute", top: -24, left: -24 }}>
              <circle
                cx="24" cy="24" r="20"
                fill="none"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="3"
              />
              {collecting && (
                <circle
                  cx="24" cy="24" r="20"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  strokeDasharray={`${progress * 125.6} 125.6`}
                  strokeLinecap="round"
                  transform="rotate(-90 24 24)"
                />
              )}
            </svg>
            {/* Center dot */}
            <div
              style={{
                width: collecting ? 12 : 8,
                height: collecting ? 12 : 8,
                borderRadius: "50%",
                background: collecting ? "#3b82f6" : "#fff",
                boxShadow: collecting ? "0 0 16px #3b82f6" : "0 0 8px rgba(255,255,255,0.5)",
                transition: "all 200ms",
              }}
            />
          </div>

          {/* Instructions */}
          <div
            style={{
              position: "absolute",
              bottom: 60,
              left: "50%",
              transform: "translateX(-50%)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, color: "#fff", fontWeight: 500, marginBottom: 4 }}>
              {collecting ? "Hold your gaze..." : "Look at the dot and click"}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
              Point {currentDot + 1} of {CALIBRATION_DOTS.length}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
              {!collecting && (
                <button
                  onClick={() => { collectBuffer.current = []; setCollecting(true); }}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 999,
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    background: "rgba(59, 130, 246, 0.2)",
                    color: "#93c5fd",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  capture
                </button>
              )}
              <button
                onClick={onCancel}
                style={{
                  padding: "8px 20px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                cancel
              </button>
            </div>
          </div>
        </>
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
      const video = engine.getVideo();
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

      // Draw the live camera feed (mirrored)
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);

      if (video && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, W, H);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.9)";
        ctx.fillRect(0, 0, W, H);
      }

      // Draw hand skeletons on top of the video
      if (frame) {
        for (let i = 0; i < frame.hands.length; i++) {
          const landmarks = frame.hands[i];
          const color =
            frame.handedness[i] === "Left"
              ? "rgba(255, 180, 120, 0.9)"
              : "rgba(120, 180, 255, 0.9)";
          if (!landmarks || landmarks.length < 21) continue;

          // Bones
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;
          for (const [a, b] of HAND_CONNECTIONS) {
            const la = landmarks[a];
            const lb = landmarks[b];
            if (!la || !lb) continue;
            ctx.beginPath();
            ctx.moveTo(la.x * W, la.y * H);
            ctx.lineTo(lb.x * W, lb.y * H);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;

          // Joints
          for (let j = 0; j < 21; j++) {
            const lm = landmarks[j];
            if (!lm) continue;
            const isTip = (FINGERTIPS as readonly number[]).includes(j);
            ctx.fillStyle = isTip ? "#fff" : color;
            ctx.beginPath();
            ctx.arc(lm.x * W, lm.y * H, isTip ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fill();
            if (isTip) {
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
      }

      // Draw face mesh outline + iris
      if (frame?.face && frame.face.length > 474) {
        // Draw sparse face outline (key points only)
        const faceColor = "rgba(100, 200, 255, 0.5)";
        ctx.fillStyle = faceColor;

        // Nose, forehead, chin, mouth corners
        const keyPoints = [1, 10, 152, 61, 291, 33, 263, 133, 362];
        for (const idx of keyPoints) {
          const pt = frame.face[idx];
          if (!pt) continue;
          ctx.beginPath();
          ctx.arc(pt.x * W, pt.y * H, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Iris — larger, brighter
        const leftIris = frame.face[468];
        const rightIris = frame.face[473];
        if (leftIris) {
          ctx.fillStyle = "#3b82f6";
          ctx.shadowColor = "#3b82f6";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(leftIris.x * W, leftIris.y * H, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (rightIris) {
          ctx.fillStyle = "#3b82f6";
          ctx.shadowColor = "#3b82f6";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(rightIris.x * W, rightIris.y * H, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      ctx.restore();

      // HUD overlay (drawn un-mirrored on top)
      ctx.font = "bold 10px monospace";
      const count = frame?.hands.length ?? 0;
      const hasFace = !!(frame?.face && frame.face.length > 0);
      const activeGestures = engine.getActiveGestureNames();

      // Top-left: detection status
      const statusParts: string[] = [];
      if (count) statusParts.push(`${count} hand${count > 1 ? "s" : ""}`);
      if (hasFace) statusParts.push("face");

      if (statusParts.length > 0) {
        const statusText = statusParts.join(" + ");
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(4, 4, ctx.measureText(statusText).width + 8, 16);
        ctx.fillStyle = "#4ade80";
        ctx.fillText(statusText, 8, 15);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(4, 4, 76, 16);
        ctx.fillStyle = "#ef4444";
        ctx.fillText("no detection", 8, 15);
      }

      // Bottom-left: active gestures
      if (activeGestures.length > 0) {
        const text = activeGestures.join(" + ");
        ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
        ctx.fillRect(4, H - 20, ctx.measureText(text).width + 8, 16);
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 9px monospace";
        ctx.fillText(text, 8, H - 8);
      }

      // Bottom-right: branding
      ctx.font = "500 9px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.textAlign = "right";
      ctx.fillText("thor.gl", W - 8, H - 8);
      ctx.textAlign = "left";

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
        border: "1px solid rgba(255,255,255,0.15)",
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
      : "Pinch to navigate \u00b7 Eyes track gaze \u00b7 Blink to select \u00b7 Fist to toggle \u00b7 Look away to pause";

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
