import type {
  MapWorkspaceLayer,
  MapWorkspacePosition,
  MapWorkspaceTrackGeometry,
  RaceCourseBaselineTrack,
  RaceMapWorkspace
} from "@crewcue/contracts";
import {
  buildBaselineTrackFromGpxPoints,
  type GpxTrackPoint,
  type ParsedGpxTrack,
  parseCourseTrack,
  summarizeParsedCourseUploadAnalytics
} from "./courseParse.js";

export const MAX_LAYER_VERTICES = 4000;

function newRandomId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const id = globalCrypto?.randomUUID?.();
  if (id) {
    return id;
  }
  return `id-${Math.random().toString(36).slice(2)}`;
}

function stripExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}

export function flattenWorkspaceGeometry(geometry: MapWorkspaceTrackGeometry): [number, number][] {
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  return geometry.coordinates.flat();
}

export function simplifyPositions(ring: [number, number][], maxPoints: number): [number, number][] {
  if (ring.length <= maxPoints) {
    return ring;
  }
  const out: [number, number][] = [];
  out.push(ring[0]!);
  const interior = Math.max(0, maxPoints - 2);
  for (let i = 1; i <= interior; i += 1) {
    const index = Math.round((i * (ring.length - 1)) / (interior + 1));
    out.push(ring[index]!);
  }
  out.push(ring[ring.length - 1]!);
  return out;
}

function normalizeGeometry(geometry: MapWorkspaceTrackGeometry): MapWorkspaceTrackGeometry {
  if (geometry.type === "LineString") {
    return {
      type: "LineString",
      coordinates: simplifyPositions(geometry.coordinates, MAX_LAYER_VERTICES)
    };
  }
  return {
    type: "MultiLineString",
    coordinates: geometry.coordinates.map((ring: MapWorkspacePosition[]) =>
      simplifyPositions(ring, MAX_LAYER_VERTICES)
    )
  };
}

/** Server-side normalization: cap vertices per layer for storage and render cost. */
export function normalizeRaceMapWorkspace(workspace: RaceMapWorkspace): RaceMapWorkspace {
  return {
    ...workspace,
    layers: workspace.layers.map((layer: MapWorkspaceLayer) => ({
      ...layer,
      geometry: normalizeGeometry(layer.geometry)
    }))
  };
}

export function parsedTrackToWorkspaceLayer(fileName: string, parsed: ParsedGpxTrack): MapWorkspaceLayer {
  const coordinates = simplifyPositions(
    parsed.points.map((p) => [p.longitude, p.latitude] as [number, number]),
    MAX_LAYER_VERTICES
  );
  return {
    id: newRandomId(),
    label: stripExtension(fileName),
    visible: true,
    sourceFileName: fileName,
    geometry: { type: "LineString", coordinates }
  };
}

export function parseUploadToWorkspaceLayer(fileContents: string, fileName: string): MapWorkspaceLayer {
  const parsed = parseCourseTrack(fileContents, fileName);
  return parsedTrackToWorkspaceLayer(fileName, parsed);
}

export function parseUploadToWorkspaceLayerWithAnalytics(
  fileContents: string,
  fileName: string
): {
  layer: MapWorkspaceLayer;
  uploadAnalytics: ReturnType<typeof summarizeParsedCourseUploadAnalytics>;
} {
  const parsed = parseCourseTrack(fileContents, fileName);
  return {
    layer: parsedTrackToWorkspaceLayer(fileName, parsed),
    uploadAnalytics: summarizeParsedCourseUploadAnalytics(parsed)
  };
}

export function workspaceGeometryToBaseline(
  geometry: MapWorkspaceTrackGeometry
): RaceCourseBaselineTrack | undefined {
  const coords = flattenWorkspaceGeometry(geometry);
  if (coords.length < 2) {
    return undefined;
  }
  const points: GpxTrackPoint[] = coords.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
    elevationMeters: null,
    timestampMs: null
  }));
  return buildBaselineTrackFromGpxPoints(points);
}
