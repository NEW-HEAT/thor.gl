import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { _GlobeView as GlobeView, MapView } from "@deck.gl/core";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useThor, setFistAction, type ViewState } from "thor.gl";
import { CITIES, type City } from "./cities";
import { MotionController } from "./MotionController";
import { atlasLayers, type Atlas } from "./atlas";
import { panAtlas, zoomOffset } from "./navigation";
import "./styles.css";

const INITIAL_VIEW: ViewState = { longitude: 8.5, latitude: 25, zoom: 1.5, pitch: 0, bearing: 0 };
const openingView = () => ({ ...INITIAL_VIEW, zoom: Math.min(1.5, 1.5 + Math.log2(window.innerWidth / 500)) });
const GESTURES = [
  { id: "pinch-pan", label: "Move", hint: "Pinch one hand and drag" },
  { id: "pinch-zoom", label: "Zoom", hint: "Pinch both hands, move apart or together" },
  { id: "pinch-rotate", label: "Rotate", hint: "Pinch both hands and twist" },
  { id: "pinch-pitch", label: "Tilt", hint: "Pinch both hands and move up or down" },
  { id: "open-palm", label: "Stop", hint: "Open your palm to stop movement" },
  { id: "fist", label: "Switch view", hint: "Hold a fist to switch globe and map" },
];

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    camera: <><rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-3v10l-6-3"/></>,
    hand: <><path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a1.5 1.5 0 0 1 2-2l3 3"/></>,
    reset: <><path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/></>,
    sliders: <><path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/></>,
    fullscreen: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    minus: <path d="M5 12h14"/>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CameraBackground({ source, visible, strength }: { source: HTMLVideoElement | null; visible: boolean; strength: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    target.srcObject = source?.srcObject ?? null;
    if (source) void target.play().catch(() => {});
    return () => { target.srcObject = null; };
  }, [source]);
  return <video ref={ref} className="camera-background" style={{ opacity: source && visible ? strength : 0 }} autoPlay playsInline muted aria-hidden="true" data-visible={!!source && visible} />;
}

function cameraMessage(error: Error) {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error.name)) return "Camera access is blocked. Allow camera access in your browser’s site settings, then retry.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error.name)) return "No camera found. Connect a webcam, then retry.";
  if (error.name === "NotReadableError") return "Your camera is busy. Close the other app using it, then retry.";
  return error.message || "Tracking could not start. Check your connection, then retry.";
}

export function App() {
  const [viewState, setViewState] = useState<ViewState>(openingView);
  const [sessionOn, setSessionOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pointerActive, setPointerActive] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(true);
  const [cameraStrength, setCameraStrength] = useState(0.65);
  const [overlay, setOverlay] = useState(true);
  const [panel, setPanel] = useState(false);
  const [projection, setProjection] = useState<"globe" | "map">("globe");
  const [sensitivity, setSensitivity] = useState(1);
  const [inertia, setInertia] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280);
  const [enabledGestures, setEnabledGestures] = useState(["pinch-pan", "pinch-zoom", "open-palm"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tracking, setTracking] = useState({ hands: 0, active: [] as string[] });
  const [notice, setNotice] = useState("");
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [atlasError, setAtlasError] = useState(false);
  const [atlasAttempt, setAtlasAttempt] = useState(0);
  const [country, setCountry] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const cameraAspect = useRef(16 / 9);
  const controlsButton = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const pointerRelease = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const releasePointer = useCallback(() => {
    clearTimeout(pointerRelease.current);
    pointerRelease.current = setTimeout(() => setPointerActive(false), Math.max(200, inertia * 0.6));
  }, [inertia]);

  const updateView = useCallback((updater: (previous: ViewState) => ViewState) => setViewState(previous => {
    const next = updater(previous);
    if (next === previous) return previous;
    const offset = zoomOffset(next.latitude, projection);
    return { ...next, longitude: ((next.longitude + 180) % 360 + 360) % 360 - 180,
      latitude: Math.max(-85, Math.min(85, next.latitude)), zoom: Math.max(offset, Math.min(6 + offset, next.zoom)),
      pitch: Math.max(0, Math.min(60, next.pitch ?? 0)) };
  }), [projection]);
  const panViewState = useCallback((view: ViewState, delta: { dx: number; dy: number }, gain: number) =>
    panAtlas(view, delta, { ...viewportSize, projection, cameraAspect: cameraAspect.current, sensitivity: gain }), [viewportSize, projection]);
  const { widgets, status, error, video, retry, getEngine, onViewStateChange } = useThor({
    setViewState: updateView, enabled: sessionOn, detector: "hands", paused: paused || pointerActive,
    panViewState,
    gestures: enabledGestures, cameraOverlay: cameraVisible, showOverlay: overlay,
    config: { inertiaDuration: inertia, grabDelay: 35, minZoom: -6, panSensitivity: 2.4 * sensitivity, zoomSensitivity: sensitivity,
      rotateSensitivity: 57.3 * sensitivity, pitchSensitivity: 70 * sensitivity,
      panMoveDeadzone: 0.0008, zoomDeadzone: 0.008, rotateDeadzone: 0.025, pitchDeadzone: 0.008 },
  });
  if (video?.videoWidth && video.videoHeight) cameraAspect.current = video.videoWidth / video.videoHeight;
  const displayZoom = viewState.zoom - zoomOffset(viewState.latitude, projection);
  const changeProjection = useCallback((next: "globe" | "map") => {
    getEngine()?.reset();
    setViewState(v => ({ ...v, zoom: v.zoom - zoomOffset(v.latitude, projection) + zoomOffset(v.latitude, next), transitionDuration: 0 }));
    setProjection(next);
  }, [getEngine, projection]);
  const reset = useCallback(() => {
    getEngine()?.reset();
    setViewState(openingView());
    setProjection("globe");
    setSelected(null);
    setCountry(null);
  }, [getEngine]);
  const closePanel = useCallback(() => { setPanel(false); controlsButton.current?.focus(); }, []);

  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    const deadline = setTimeout(() => abort.abort(), 15000);
    setAtlasError(false);
    fetch("/data/countries.geojson", { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error("Atlas unavailable"); return response.json(); })
      .then(data => setAtlas(data as Atlas))
      .catch(() => { if (!cancelled) setAtlasError(true); })
      .finally(() => clearTimeout(deadline));
    return () => { cancelled = true; abort.abort(); clearTimeout(deadline); };
  }, [atlasAttempt]);

  useEffect(() => {
    setFistAction(() => changeProjection(projection === "globe" ? "map" : "globe"));
    return () => setFistAction(null);
  }, [changeProjection, projection]);
  useEffect(() => {
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("blur", releasePointer);
    return () => {
      clearTimeout(pointerRelease.current);
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      window.removeEventListener("blur", releasePointer);
    };
  }, [releasePointer]);
  useEffect(() => {
    if (!panel) return;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !controlsButton.current?.contains(event.target as Node)) setPanel(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [panel]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") { closePanel(); setPaused(true); return; }
      if ((event.target as HTMLElement)?.closest("input, button, select, textarea, a") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Space" && sessionOn) { event.preventDefault(); setPaused(p => !p); }
      if (event.key.toLowerCase() === "r") reset();
      if (event.key.toLowerCase() === "c") setCameraVisible(v => !v);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sessionOn, reset, closePanel]);
  useEffect(() => {
    if (status !== "running") { setTracking({ hands: 0, active: [] }); return; }
    let lastStamp = 0;
    const timer = window.setInterval(() => {
      const engine = getEngine();
      const frame = engine?.getLatestFrame();
      if (!frame) return;
      const fresh = frame.timestamp !== lastStamp;
      setTracking({ hands: fresh ? frame.hands.length : 0, active: fresh ? engine?.getActiveGestureNames() ?? [] : [] });
      lastStamp = frame.timestamp;
    }, 150);
    return () => clearInterval(timer);
  }, [status, getEngine]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(timer); }, [notice]);

  const view = useMemo(() => projection === "globe" ? new GlobeView({ id: "world", resolution: 2 }) : new MapView({ id: "world" }), [projection]);
  const layers = useMemo(() => [
    ...atlasLayers(atlas, { viewState, projection, ...viewportSize, selected: country, onSelect: setCountry }),
    new ScatterplotLayer<City>({ id: "cities", data: CITIES, pickable: true, getPosition: d => d.coordinates,
      getRadius: 3, radiusUnits: "pixels", stroked: true, lineWidthMinPixels: 1,
      getFillColor: d => d.name === selected ? [238, 187, 115, 255] : [33, 62, 64, 220],
      getLineColor: [241, 245, 233, 170],
      onHover: info => setHovered(info.object?.name ?? null),
      onClick: info => setSelected(info.object?.name ?? null), updateTriggers: { getFillColor: [selected] },
    }),
    new TextLayer<City>({ id: "labels", data: CITIES.filter(d => d.name === selected || d.name === hovered),
      getPosition: d => d.coordinates, getText: d => d.name, getSize: 14, getColor: [255, 240, 225, 255],
      getPixelOffset: [0, -18], fontFamily: "sans-serif", fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [0, 0, 0, 230],
    }),
  ], [selected, hovered, atlas, country, viewState, projection, viewportSize]);
  const active = GESTURES.filter(g => tracking.active.includes(g.id)).map(g => g.label).join(" + ");
  const loading = status === "camera" || status === "model";
  const statusText = status === "camera" ? "Waiting for camera permission" : status === "model" ? "Loading hand tracking" :
    status === "error" ? "Camera needs attention" : status === "running" ? paused ? "Motion paused" :
    tracking.hands ? "Pinch to grab" : "Raise a hand to begin" : "Drag to explore · Scroll to zoom";

  return <main className="app" aria-label="Thor interactive globe">
    <CameraBackground source={video} visible={cameraVisible} strength={cameraStrength} />
    <div className="vignette" aria-hidden="true" />
    <div className="globe-stage" onPointerDown={() => { clearTimeout(pointerRelease.current); getEngine()?.reset(); setPointerActive(true); }}
      onWheel={() => { getEngine()?.reset(); setPointerActive(true); releasePointer(); }}>
      <DeckGL views={view} viewState={{ ...viewState, minZoom: 0, maxZoom: 6, maxPitch: 60 }} onViewStateChange={onViewStateChange as any}
        onResize={setViewportSize}
        layers={layers} widgets={sessionOn ? widgets : []} parameters={{ cullMode: "back" }}
        controller={{ ...(projection === "globe" ? { type: MotionController } : {}), touchRotate: true, touchZoom: true, dragPan: true,
          inertia: Math.round(inertia * 0.6), scrollZoom: { speed: 0.005, smooth: true } }}
        getCursor={({ isDragging, isHovering }) => isDragging ? "grabbing" : isHovering ? "pointer" : "grab"} />
    </div>

    <header className="header">
      <div className="header-actions">
        <button className="icon-button" disabled={displayZoom <= 0.001} aria-label="Zoom out" title="Zoom out" onClick={() => { getEngine()?.reset(); updateView(v => ({ ...v, zoom: v.zoom - 0.5, transitionDuration: 0 })); }}><Icon name="minus" /></button>
        <button className="icon-button" disabled={displayZoom >= 5.999} aria-label="Zoom in" title="Zoom in" onClick={() => { getEngine()?.reset(); updateView(v => ({ ...v, zoom: v.zoom + 0.5, transitionDuration: 0 })); }}><Icon name="plus" /></button>
        <button className="icon-button" onClick={reset} aria-label="Reset globe" title="Reset globe (R)"><Icon name="reset" /></button>
        <button className="icon-button fullscreen" aria-label="Toggle fullscreen" title="Fullscreen" onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => setNotice("Fullscreen is unavailable in this browser."));
          else setNotice("Fullscreen is unavailable in this browser.");
        }}><Icon name="fullscreen" /></button>
      </div>
    </header>


    {error && <section className="error-card" role="alert"><h2>Camera unavailable</h2><p>{cameraMessage(error)}</p><div className="error-actions"><button className="primary" onClick={retry}>Retry camera</button><button onClick={() => setSessionOn(false)}>Use mouse & touch</button></div></section>}

    {panel && <aside className="controls-panel" ref={panelRef} aria-label="Motion controls" id="motion-controls">
      <div className="panel-heading"><h2>Controls</h2><button className="icon-button" onClick={closePanel} aria-label="Close controls"><Icon name="close" /></button></div>
      <div className="segmented" aria-label="Projection"><button aria-pressed={projection === "globe"} onClick={() => changeProjection("globe")}>Globe</button><button aria-pressed={projection === "map"} onClick={() => changeProjection("map")}>Flat map</button></div>
      {sessionOn && <button className="stop-camera" onClick={() => { setSessionOn(false); setPanel(false); }}>Stop camera & tracking</button>}
      <label className="range-label" htmlFor="sensitivity"><span>Hand sensitivity</span><output>{sensitivity.toFixed(1)}×</output></label>
      <input id="sensitivity" type="range" min="0.5" max="1.5" step="0.1" value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
      <label className="range-label" htmlFor="inertia"><span>Glide</span><output>{inertia ? `${inertia} ms` : "Off"}</output></label>
      <input id="inertia" type="range" min="0" max="600" step="20" value={inertia} onChange={e => { getEngine()?.reset(); setInertia(Number(e.target.value)); }} />
      <div className="gesture-list">{GESTURES.map(g => <label className="gesture-row" key={g.id}><span><strong>{g.label}</strong><small>{g.hint}</small></span><input type="checkbox" checked={enabledGestures.includes(g.id)} onChange={e => setEnabledGestures(current => e.target.checked ? [...current, g.id] : current.filter(id => id !== g.id))} /></label>)}</div>
      <label className="gesture-row compact"><span>Hand landmarks</span><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} /></label>
      <label className="range-label" htmlFor="camera-strength"><span>Camera visibility</span><output>{Math.round(cameraStrength * 100)}%</output></label>
      <input id="camera-strength" type="range" min="0.2" max="1" step="0.05" value={cameraStrength} onChange={e => setCameraStrength(Number(e.target.value))} />
      <p className="panel-note">Your camera stays on this device. Space pauses motion; R resets the globe.</p>
    </aside>}

    <footer className="dock-area">
      <div className="status-line" role="status"><span hidden={!sessionOn} className={`status-dot ${status === "running" && !paused ? "live" : ""} ${loading ? "loading" : ""}`} />{notice || (!atlas && !atlasError ? "Loading atlas" : active && !paused ? active : statusText)}{sessionOn && video && !cameraVisible && <span className="camera-hidden-label">Camera hidden</span>}</div>
      <div className="dock">
        {!sessionOn ? <button className="primary start-button" onClick={() => { setSessionOn(true); setPaused(false); }}><Icon name="hand" />Use hands</button> :
          <button className={paused ? "" : "motion-button"} aria-pressed={!paused} disabled={loading || !!error} onClick={() => setPaused(value => !value)}><Icon name={paused ? "hand" : "pause"} /><span>{paused ? "Resume motion" : "Pause motion"}</span></button>}
        <span className="dock-divider" />
        <button aria-label="Camera background" aria-pressed={cameraVisible} title="Show camera behind globe (C)" onClick={() => setCameraVisible(v => !v)}><Icon name="camera" /><span>Background<span className="toggle-word"> {cameraVisible ? "on" : "off"}</span></span></button>
        <button ref={controlsButton} aria-expanded={panel} aria-controls="motion-controls" onClick={() => setPanel(v => !v)}><Icon name="sliders" /><span>Controls</span></button>
      </div>
      {sessionOn && <p className="hint">{paused ? "Camera on · Mouse & touch ready" : "Pinch to grab · Open to release · Two hands to zoom"}</p>}
    </footer>
    {country && <div className="place-caption"><span>{country}</span><button aria-label="Clear selected country" onClick={() => setCountry(null)}><Icon name="close" /></button></div>}
    {atlasError && <div className="atlas-error" role="alert">Atlas could not load.<button onClick={() => setAtlasAttempt(n => n + 1)}>Retry</button></div>}
    <div className="atlas-caption">Atlas <span>Countries & coastlines</span></div>
    <div className="attribution"><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a><span> · </span><a href="https://github.com/NEW-HEAT/thor.gl" target="_blank" rel="noreferrer">Source</a></div>
  </main>;
}
