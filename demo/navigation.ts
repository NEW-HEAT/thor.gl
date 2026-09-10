import { _GlobeController as GlobeController, MapController, _GlobeViewport as GlobeViewport, WebMercatorViewport } from "@deck.gl/core";
import type { ViewState } from "thor.gl";

// Reuse deck.gl's controller states, including bearing and polar scale corrections.
const GlobeState = new GlobeController({} as any).ControllerState;
const MapState = new MapController({} as any).ControllerState;

export function zoomOffset(latitude: number, projection: "globe" | "map") {
  // deck.gl's GlobeController bounds are measured relative to equatorial zoom.
  return projection === "globe" ? Math.log2(Math.cos(Math.max(-85, Math.min(85, latitude)) * Math.PI / 180)) : 0;
}

export function panAtlas(view: ViewState, delta: { dx: number; dy: number }, options: {
  projection: "globe" | "map"; width: number; height: number; cameraAspect: number; sensitivity: number;
}): ViewState {
  const { projection, width, height, cameraAspect, sensitivity } = options;
  const cameraWidth = Math.max(width, height * cameraAspect);
  const cameraHeight = cameraWidth / cameraAspect;
  const State = projection === "globe" ? GlobeState : MapState;
  const Viewport = projection === "globe" ? GlobeViewport : WebMercatorViewport;
  const state = new State({ ...view, width, height, minZoom: 0, maxZoom: 6, minPitch: 0, maxPitch: 60,
    makeViewport: props => new Viewport(props) });
  const gain = sensitivity / 2.4 * 0.5;
  const center: [number, number] = [width / 2, height / 2];
  return state.panStart({ pos: center }).pan({
    pos: [center[0] - delta.dx * cameraWidth * gain, center[1] + delta.dy * cameraHeight * gain],
  }).panEnd().getViewportProps();
}
