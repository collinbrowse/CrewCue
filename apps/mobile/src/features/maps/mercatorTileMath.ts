/**
 * Web Mercator (XYZ / 256px tiles): tile containing `lon`/`lat` at integer zoom `z`,
 * and the point as pixel offset within a **logical 256×256** tile (MapTiler `/256/{z}/{x}/{y}.png`).
 */
export function mercatorTilePixelForLngLat(
  lon: number,
  lat: number,
  z: number
): { tileX: number; tileY: number; ox256: number; oy256: number } {
  const z2 = 2 ** z;
  const worldX = ((lon + 180) / 360) * z2 * 256;
  const latRad = (lat * Math.PI) / 180;
  const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  const worldY = yFloat * z2 * 256;
  const tileX = Math.min(Math.max(0, Math.floor(worldX / 256)), z2 - 1);
  const tileY = Math.min(Math.max(0, Math.floor(worldY / 256)), z2 - 1);
  const ox256 = worldX - tileX * 256;
  const oy256 = worldY - tileY * 256;
  return { tileX, tileY, ox256, oy256 };
}
