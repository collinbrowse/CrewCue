import type { NavigationRouteResult, RaceCourseCheckpoint } from "@crewcue/contracts";

/** Rough axis-aligned bounds [west, south, east, north] with degree padding (~5km at mid-lat). */
export function corridorBoundsFromRouteAndCheckpoints(
  route: NavigationRouteResult | undefined,
  checkpoints: RaceCourseCheckpoint[],
  padDegrees = 0.06
): [number, number, number, number] {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  const bump = (lng: number, lat: number) => {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };

  if (route?.geometry?.coordinates) {
    for (const [lng, lat] of route.geometry.coordinates) {
      bump(lng, lat);
    }
  }

  for (const cp of checkpoints) {
    bump(cp.longitude, cp.latitude);
  }

  if (!Number.isFinite(west)) {
    return [-122.5, 37.7, -122.3, 37.85];
  }

  return [west - padDegrees, south - padDegrees, east + padDegrees, north + padDegrees];
}

/** Very rough tile-count proxy for analytics (not exact vs native downloads). */
export function estimateTilesForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number
): number {
  const [west, south, east, north] = bounds;
  const latSpan = Math.max(0.0001, north - south);
  const lngSpan = Math.max(0.0001, east - west);
  const midLat = (south + north) / 2;
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const areaDegrees2 = latSpan * lngSpan * cos;

  let sum = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const tilesAtEquator = Math.pow(2, z);
    const approx = areaDegrees2 * tilesAtEquator * tilesAtEquator * (512 / 360) * (512 / 180);
    sum += Math.max(1, Math.round(approx));
  }
  return sum;
}
