import type { MapWorkspaceLayer } from "@crewcue/contracts";

/** Minimal LineString overlay for integration tests (merged as primary course route on PUT /course). */
export function lineStringRouteOverlayForCheckpoints(
  checkpoints: Array<{ latitude: number; longitude: number }>
): MapWorkspaceLayer {
  return {
    id: "integration-test-route",
    label: "integration",
    visible: true,
    geometry: {
      type: "LineString",
      coordinates: checkpoints.map((c) => [c.longitude, c.latitude] as [number, number])
    }
  };
}
