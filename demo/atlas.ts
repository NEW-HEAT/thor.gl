import { GeoJsonLayer, PathLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { _GlobeViewport as GlobeViewport, WebMercatorViewport } from "@deck.gl/core";
import type { ViewState } from "thor.gl";
import { zoomOffset } from "./navigation";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type Atlas = FeatureCollection<Polygon | MultiPolygon, {
  name: string; code: string; label: [number, number]; rank: number;
}>;

// Small geographic cells tessellate onto the globe, including both poles.
export const OCEAN = Array.from({ length: 12 }, (_, y) => Array.from({ length: 24 }, (_, x) => {
  const west = -180 + x * 15, south = -90 + y * 15;
  // Separate the ocean mesh from independently triangulated country surfaces.
  return [[west, south, -10000], [west + 15, south, -10000], [west + 15, south + 15, -10000], [west, south + 15, -10000]];
})).flat();
const GRATICULE = [
  ...Array.from({ length: 12 }, (_, i) => Array.from({ length: 91 }, (_, j) => [-180 + i * 30, -90 + j * 2])),
  ...[-60, -30, 0, 30, 60].map(latitude => Array.from({ length: 181 }, (_, j) => [-180 + j * 2, latitude])),
];

export function facesCamera(viewport: GlobeViewport, coordinates: number[]) {
  const position = viewport.projectPosition(coordinates);
  const towardCamera = position.map((p, i) => viewport.cameraPosition[i] - p);
  const cosine = position.reduce((dot, p, i) => dot + p * towardCamera[i], 0) /
    (Math.hypot(...position) * Math.hypot(...towardCamera));
  return cosine > 0.22;
}

export function atlasLayers(data: Atlas | null, options: {
  viewState: ViewState; projection: "globe" | "map"; width: number; height: number;
  selected: string | null; onSelect: (name: string | null) => void;
}) {
  const { viewState, projection, width, height, selected, onSelect } = options;
  const zoom = viewState.zoom - zoomOffset(viewState.latitude, projection);
  const viewport = new GlobeViewport({ ...viewState, width, height });
  const labelViewport = projection === "map" ? new WebMercatorViewport({ ...viewState, width, height }) : viewport;
  const occupied: number[][] = [];
  const labels = (data?.features.filter(f => f.properties.rank <= (zoom >= 4 ? 6 : 3) &&
    (projection === "map" || facesCamera(viewport, f.properties.label))) ?? [])
    .sort((a, b) => a.properties.rank - b.properties.rank)
    .filter(f => {
      const [x, y] = labelViewport.project(f.properties.label);
      const halfWidth = f.properties.name.length * 3.6 + 5;
      const box = [x - halfWidth, y - 10, x + halfWidth, y + 10];
      if (occupied.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return false;
      occupied.push(box);
      return true;
    });
  return [
    new SolidPolygonLayer({ id: "atlas-ocean", data: OCEAN, getPolygon: d => d,
      getFillColor: [25, 53, 64, 255], parameters: { cullMode: "back" } }),
    new PathLayer({ id: "atlas-grid", data: GRATICULE, getPath: d => d,
      getColor: [112, 151, 161, 38], getWidth: 0.6, widthUnits: "pixels", pickable: false }),
    new GeoJsonLayer({ id: "atlas-land", data: data ?? undefined, filled: true, stroked: true, pickable: true,
      getFillColor: f => f.properties?.name === selected ? [228, 200, 153, 255] : [203, 214, 194, 255],
      getLineColor: [112, 136, 128, 190], getLineWidth: 0.65, lineWidthUnits: "pixels",
      getPolygonOffset: () => [0, -2], parameters: { cullMode: "back" },
      onClick: info => onSelect(info.object?.properties.name ?? null),
      updateTriggers: { getFillColor: [selected] },
    }),
    new TextLayer({ id: "atlas-country-names", data: labels,
      visible: zoom >= 2.5, getPosition: f => f.properties.label, getText: f => f.properties.name,
      getSize: 12, getColor: [39, 64, 62, 255], fontFamily: "system-ui, sans-serif", fontWeight: 500,
      fontSettings: { sdf: true }, outlineWidth: 2, outlineColor: [203, 214, 194, 180],
      // Labels are typography above the surface; cull their anchors explicitly so
      // characters neither sink into the sphere nor show through its far side.
      billboard: true, parameters: { cullMode: "none", depthCompare: "always", depthWriteEnabled: false },
    }),
  ];
}
