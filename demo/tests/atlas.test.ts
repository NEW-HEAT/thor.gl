import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { OCEAN, atlasLayers, facesCamera, type Atlas } from "../atlas";
import { _GlobeViewport as GlobeViewport } from "@deck.gl/core";

const atlas: Atlas = JSON.parse(readFileSync(new URL("../public/data/countries.geojson", import.meta.url), "utf8"));

it("ships usable country geometry and labels without runtime tile services", () => {
  expect(atlas.features.length).toBeGreaterThan(200);
  for (const feature of atlas.features) {
    expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
    expect(feature.properties.name.length).toBeGreaterThan(0);
    const [longitude, latitude] = feature.properties.label;
    expect(Number.isFinite(longitude) && Math.abs(longitude) <= 180).toBe(true);
    expect(Number.isFinite(latitude) && Math.abs(latitude) <= 90).toBe(true);
  }
  expect(atlas.features.some(f => f.properties.name === "Antarctica")).toBe(true);
  expect(atlasLayers(atlas, { viewState: { latitude: 25, longitude: 8.5, zoom: 1.5 }, projection: "globe",
    width: 1280, height: 720, selected: null, onSelect: () => {} }).every(layer => typeof layer.props.data !== "string")).toBe(true);
});

it("only draws labels facing the actual camera, including portrait viewports", () => {
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    const viewport = new GlobeViewport({ width, height, latitude: 25, longitude: 8.5, zoom: 1.5 });
    expect(facesCamera(viewport, [8.5, 25])).toBe(true);
    expect(facesCamera(viewport, [-171.5, -25])).toBe(false);
  }
});

it("covers both poles and keeps the ocean below independently triangulated land", () => {
  const points = OCEAN.flat();
  expect(Math.min(...points.map(p => p[1]))).toBe(-90);
  expect(Math.max(...points.map(p => p[1]))).toBe(90);
  expect(points.every(p => p[2] <= -10000)).toBe(true);
  expect(OCEAN.length * 15 * 15).toBe(360 * 180);
});
