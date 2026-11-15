/** Coordinates are [lng, lat] (GeoJSON order). */
export type LngLat = [number, number];
export type Ring = LngLat[];

/** Ray-casting point-in-polygon. Ring may be open or closed. */
export function pointInPolygon(pt: LngLat, ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function haversineM(a: LngLat, b: LngLat): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Regular-ish polygon around a centre — handy for building weather cells. */
export function circlePolygon(center: LngLat, radiusM: number, sides = 24): Ring {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return Array.from({ length: sides }, (_, i) => {
    const t = (2 * Math.PI * i) / sides;
    return [center[0] + dLng * Math.cos(t), center[1] + dLat * Math.sin(t)] as LngLat;
  });
}
