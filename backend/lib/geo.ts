/** Shared geometry + type helpers for the PondSite backend. */

export interface LatLng {
  lat: number;
  lng: number;
}

export const M_PER_DEG_LAT = 110574;
export const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Fraction of a point inside a closed ring (even-odd rule). */
export function pointInPolygon(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i]!.lat;
    const yj = ring[j]!.lat;
    const xi = ring[i]!.lng;
    const xj = ring[j]!.lng;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shoelace area of a ring in approximate square metres. */
export function ringAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const kx = mPerDegLng(ring[0]!.lat);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.lng * kx * (b.lat * M_PER_DEG_LAT) - b.lng * kx * (a.lat * M_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

/** Shortest distance in metres from point p to a polyline/polygon ring. */
export function distanceToRingM(p: LatLng, ring: LatLng[]): number {
  const kx = mPerDegLng(p.lat);
  const px = p.lng * kx;
  const py = p.lat * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = ring[i]!.lng * kx;
    const ay = ring[i]!.lat * M_PER_DEG_LAT;
    const bx = ring[i + 1]!.lng * kx;
    const by = ring[i + 1]!.lat * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Min distance from p to any ring in a list (Infinity when empty). */
export function distanceToRingsM(p: LatLng, rings: LatLng[][]): number {
  let best = Infinity;
  for (const r of rings) {
    const d = distanceToRingM(p, r);
    if (d < best) best = d;
  }
  return best;
}
