import type { LatLng } from "./types";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const M_PER_DEG_LAT = 110574;
export const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

export function offset(p: LatLng, dxM: number, dyM: number): LatLng {
  return { lat: p.lat + dyM / M_PER_DEG_LAT, lng: p.lng + dxM / mPerDegLng(p.lat) };
}

/** Irregular closed polygon around a center, radius in metres. */
export function blob(center: LatLng, radiusM: number, points: number, rand: () => number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = radiusM * (0.72 + rand() * 0.55);
    out.push(offset(center, Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

export function polygonAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0]!.lat;
  const kx = mPerDegLng(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += (a.lng * kx) * (b.lat * M_PER_DEG_LAT) - (b.lng * kx) * (a.lat * M_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

export function pointInPolygon(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.lng,
      yi = ring[i]!.lat,
      xj = ring[j]!.lng,
      yj = ring[j]!.lat;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function toGeoJSONPolygon(ring: LatLng[]) {
  const coords = ring.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
  coords.push(coords[0]!);
  return { type: "Polygon" as const, coordinates: [coords] };
}

export const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });