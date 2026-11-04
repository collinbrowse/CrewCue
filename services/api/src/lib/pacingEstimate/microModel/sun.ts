/**
 * Sun elevation above the horizon (degrees) — NOAA low-precision solar position, good to ~0.5°,
 * which is plenty to tell daylight from dark for pacing.
 */
export function sunElevationDegrees(atMs: number, latitude: number, longitude: number): number {
  const n = atMs / 86_400_000 + 2_440_587.5 - 2_451_545.0; // days since J2000.0
  const rad = Math.PI / 180;
  const meanLongitude = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * rad;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * n) * rad;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  const siderealHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const hourAngle = (siderealHours * 15 + longitude) * rad - rightAscension;
  const lat = latitude * rad;
  return (
    Math.asin(
      Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
    ) / rad
  );
}
