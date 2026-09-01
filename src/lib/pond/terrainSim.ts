/**
 * Village terrain model.
 *
 * Builds a deterministic elevation surface for a study boundary, then runs the
 * same hydrology used for uploaded contour maps: sink fill, D8 flow direction,
 * flow accumulation, stream extraction and confluence detection. Drainage paths
 * and candidate sites therefore follow the terrain of that particular village —
 * nothing is fixed or shared between areas.
 */

import { computeHydrology, maskOutline, simplify, upstreamCells, type Dem, type Hydrology, type LatLng } from "./contour";
import { hashSeed, mulberry32, pointInPolygon } from "./geo";
import type { Village } from "./types";

const M_PER_DEG_LAT = 110574;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

const DXK = [1, 1, 0, -1, -1, -1, 0, 1];
const DYK = [0, 1, 1, 1, 0, -1, -1, -1];

export interface VillageTerrain {
  dem: Dem;
  hyd: Hydrology;
  inside: Uint8Array;
  streams: Uint8Array;
  streamThreshold: number;
  drainage: { order: number; path: LatLng[] }[];
  confluences: number[];
  contourInterval_m: number;
  areaM2: number;
  contours: { elevation: number; ring: LatLng[] }[];
}

/** Seeded value noise sampled on a lattice and bilinearly interpolated. */
function valueNoise(rand: () => number, freq: number) {
  const size = freq + 1;
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  return (u: number, v: number) => {
    const x = Math.min(freq - 1e-6, Math.max(0, u * freq));
    const y = Math.min(freq - 1e-6, Math.max(0, v * freq));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = lattice[y0 * size + x0]!;
    const b = lattice[y0 * size + x0 + 1]!;
    const c = lattice[(y0 + 1) * size + x0]!;
    const d = lattice[(y0 + 1) * size + x0 + 1]!;
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

function buildDem(village: Village, targetCells: number): { dem: Dem; inside: Uint8Array; areaM2: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of village.boundary) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const centreLat = (minLat + maxLat) / 2;
  const kx = mPerDegLng(centreLat);
  const widthM = (maxLng - minLng) * kx;
  const heightM = (maxLat - minLat) * M_PER_DEG_LAT;
  const cell_m = Math.max(8, Math.max(widthM, heightM) / targetCells);
  const w = Math.max(16, Math.ceil(widthM / cell_m));
  const h = Math.max(16, Math.ceil(heightM / cell_m));
  const n = w * h;

  const rand = mulberry32(hashSeed(village.id + ":surface"));
  const base = 180 + Math.round(rand() * 420);
  const relief = 28 + rand() * 55;
  const octaves = [
    { noise: valueNoise(rand, 2), amp: 1 },
    { noise: valueNoise(rand, 4), amp: 0.5 },
    { noise: valueNoise(rand, 8), amp: 0.26 },
    { noise: valueNoise(rand, 16), amp: 0.12 },
  ];
  const tiltAngle = rand() * Math.PI * 2;
  const tiltStrength = 0.25 + rand() * 0.4;

  const elev = new Float32Array(n);
  const inside = new Uint8Array(n);
  let insideCells = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let f = 0;
      let amp = 0;
      for (const o of octaves) {
        f += o.noise(u, v) * o.amp;
        amp += o.amp;
      }
      f /= amp;
      // Ridge-and-valley shaping so the surface has real drainage lines.
      const ridged = 1 - Math.abs(f * 2 - 1);
      const surface = f * 0.62 + ridged * 0.38;
      const tilt = (Math.cos(tiltAngle) * (u - 0.5) + Math.sin(tiltAngle) * (v - 0.5)) * tiltStrength;
      const i = y * w + x;
      elev[i] = base + surface * relief + tilt * relief;
      const p = {
        lat: maxLat - ((y + 0.5) * cell_m) / M_PER_DEG_LAT,
        lng: minLng + ((x + 0.5) * cell_m) / kx,
      };
      if (pointInPolygon(p, village.boundary)) {
        inside[i] = 1;
        insideCells++;
      }
    }
  }

  const dem: Dem = {
    w,
    h,
    cell_m,
    minLat,
    maxLat,
    minLng,
    maxLng,
    kx,
    elev,
    known: new Uint8Array(n).fill(1),
    distToData: new Int32Array(n),
  };
  return { dem, inside, areaM2: insideCells * cell_m * cell_m };
}

function neighbourFromDir(dem: Dem, i: number, k: number) {
  const x = i % dem.w;
  const y = (i / dem.w) | 0;
  const nx = x + DXK[k]!;
  const ny = y + DYK[k]!;
  if (nx < 0 || ny < 0 || nx >= dem.w || ny >= dem.h) return -1;
  return ny * dem.w + nx;
}

/** Marching-squares contour lines from the DEM, chained into polylines. */
function contourLines(dem: Dem, level: number): LatLng[][] {
  const { w, h, elev } = dem;
  const toLL = (x: number, y: number): LatLng => ({
    lat: dem.maxLat - (y * dem.cell_m) / M_PER_DEG_LAT,
    lng: dem.minLng + (x * dem.cell_m) / dem.kx,
  });
  const segs: [[number, number], [number, number]][] = [];
  const interp = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): [number, number] => {
    const t = (level - az) / (bz - az || 1e-6);
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const z0 = elev[y * w + x]!;
      const z1 = elev[y * w + x + 1]!;
      const z2 = elev[(y + 1) * w + x + 1]!;
      const z3 = elev[(y + 1) * w + x]!;
      const pts: [number, number][] = [];
      if (z0 < level !== z1 < level) pts.push(interp(x, y, z0, x + 1, y, z1));
      if (z1 < level !== z2 < level) pts.push(interp(x + 1, y, z1, x + 1, y + 1, z2));
      if (z2 < level !== z3 < level) pts.push(interp(x + 1, y + 1, z2, x, y + 1, z3));
      if (z3 < level !== z0 < level) pts.push(interp(x, y + 1, z3, x, y, z0));
      if (pts.length >= 2) segs.push([pts[0]!, pts[1]!]);
      if (pts.length === 4) segs.push([pts[2]!, pts[3]!]);
    }
  }

  // Chain segments by rounded endpoints.
  const key = (p: [number, number]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const map = new Map<string, [number, number][]>();
  for (const [a, b] of segs) {
    (map.get(key(a)) ?? map.set(key(a), []).get(key(a))!).push(b);
    (map.get(key(b)) ?? map.set(key(b), []).get(key(b))!).push(a);
  }
  const seen = new Set<string>();
  const lines: LatLng[][] = [];
  for (const [a, b] of segs) {
    const id = `${key(a)}|${key(b)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    seen.add(`${key(b)}|${key(a)}`);
    const path: [number, number][] = [a, b];
    // extend forward
    for (let side = 0; side < 2; side++) {
      let cur = side === 0 ? b : a;
      let prev = side === 0 ? a : b;
      let guard = 0;
      while (guard++ < 4000) {
        const nexts = map.get(key(cur)) ?? [];
        const next = nexts.find((c) => key(c) !== key(prev) && !seen.has(`${key(cur)}|${key(c)}`));
        if (!next) break;
        seen.add(`${key(cur)}|${key(next)}`);
        seen.add(`${key(next)}|${key(cur)}`);
        if (side === 0) path.push(next);
        else path.unshift(next);
        prev = cur;
        cur = next;
      }
    }
    if (path.length > 3) lines.push(simplify(path.map(([x, y]) => toLL(x, y)), dem.cell_m * 0.6));
  }
  return lines;
}

export function buildVillageTerrain(village: Village): VillageTerrain {
  const { dem, inside, areaM2 } = buildDem(village, 150);
  const hyd = computeHydrology(dem);
  const n = dem.w * dem.h;
  const cellArea = dem.cell_m * dem.cell_m;

  // Stream threshold ~ 1.5 ha of contributing area.
  const streamThreshold = Math.max(12, Math.round(15000 / cellArea));
  const streams = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (hyd.acc[i]! >= streamThreshold) streams[i] = 1;

  // Confluences: stream cells fed by two or more stream cells.
  const inflow = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!streams[i]) continue;
    const k = hyd.dir[i]!;
    if (k < 0) continue;
    const j = neighbourFromDir(dem, i, k);
    if (j >= 0 && streams[j]) inflow[j]!++;
  }
  const confluences: number[] = [];
  for (let i = 0; i < n; i++) if (streams[i] && inflow[i]! >= 2 && inside[i]) confluences.push(i);
  confluences.sort((a, b) => hyd.acc[b]! - hyd.acc[a]!);

  // Drainage polylines traced downstream from every stream head.
  const visited = new Uint8Array(n);
  const heads: number[] = [];
  for (let i = 0; i < n; i++) if (streams[i] && inflow[i] === 0) heads.push(i);
  heads.sort((a, b) => hyd.acc[b]! - hyd.acc[a]!);
  const drainage: { order: number; path: LatLng[] }[] = [];
  for (const head of heads.slice(0, 90)) {
    let i = head;
    const pts: LatLng[] = [];
    let maxAcc = 0;
    let guard = 0;
    while (guard++ < n) {
      const x = i % dem.w;
      const y = (i / dem.w) | 0;
      pts.push({
        lat: dem.maxLat - ((y + 0.5) * dem.cell_m) / M_PER_DEG_LAT,
        lng: dem.minLng + ((x + 0.5) * dem.cell_m) / dem.kx,
      });
      maxAcc = Math.max(maxAcc, hyd.acc[i]!);
      if (visited[i] && pts.length > 2) break;
      visited[i] = 1;
      const k = hyd.dir[i]!;
      if (k < 0) break;
      const j = neighbourFromDir(dem, i, k);
      if (j < 0 || !streams[j]) break;
      i = j;
    }
    if (pts.length > 3)
      drainage.push({
        order: maxAcc > streamThreshold * 20 ? 3 : maxAcc > streamThreshold * 6 ? 2 : 1,
        path: simplify(pts, dem.cell_m * 0.6),
      });
  }

  // Contours at a readable interval for the map layer.
  const span = hyd.maxElev - hyd.minElev;
  const interval = span > 60 ? 10 : span > 30 ? 5 : span > 12 ? 2 : 1;
  const contours: { elevation: number; ring: LatLng[] }[] = [];
  for (let z = Math.ceil(hyd.minElev / interval) * interval; z < hyd.maxElev; z += interval) {
    for (const ring of contourLines(dem, z)) contours.push({ elevation: Math.round(z), ring });
    if (contours.length > 400) break;
  }

  return {
    dem,
    hyd,
    inside,
    streams,
    streamThreshold,
    drainage,
    confluences,
    contourInterval_m: interval,
    areaM2,
    contours,
  };
}

const cache = new Map<string, VillageTerrain>();

export function villageTerrain(village: Village): VillageTerrain {
  const key = `${village.id}:${village.center.lat.toFixed(5)},${village.center.lng.toFixed(5)}`;
  let t = cache.get(key);
  if (!t) {
    t = buildVillageTerrain(village);
    cache.set(key, t);
  }
  return t;
}

/**
 * Candidate outlets: the confluences where small flow paths merge into a larger
 * one. The number returned scales with the study area, so a bigger village
 * yields more candidates than a small one.
 */
export function candidateOutlets(t: VillageTerrain) {
  const areaHa = t.areaM2 / 10000;
  const want = Math.max(3, Math.min(12, Math.round(areaHa / 110) + 2));
  const minSep = Math.max(4, Math.round(Math.min(t.dem.w, t.dem.h) / 11));
  const picked: number[] = [];
  const consider = t.confluences.length >= want ? t.confluences : [...t.confluences, ...highFlowCells(t, want * 4)];
  for (const i of consider) {
    const x = i % t.dem.w;
    const y = (i / t.dem.w) | 0;
    if (picked.some((p) => Math.hypot((p % t.dem.w) - x, ((p / t.dem.w) | 0) - y) < minSep)) continue;
    picked.push(i);
    if (picked.length >= want) break;
  }
  return picked;
}

function highFlowCells(t: VillageTerrain, limit: number) {
  const out: number[] = [];
  for (let i = 0; i < t.inside.length; i++) if (t.inside[i] && t.streams[i]) out.push(i);
  out.sort((a, b) => t.hyd.acc[b]! - t.hyd.acc[a]!);
  return out.slice(0, limit);
}

export function outletGeometry(t: VillageTerrain, i: number) {
  const cells = upstreamCells(t.dem, t.hyd, i);
  const cellArea = t.dem.cell_m * t.dem.cell_m;
  return {
    cells,
    catchment: maskOutline(t.dem, cells),
    catchmentArea_m2: Math.round(cells.length * cellArea),
  };
}

export function cellLatLng(t: VillageTerrain, i: number): LatLng {
  const x = i % t.dem.w;
  const y = (i / t.dem.w) | 0;
  return {
    lat: t.dem.maxLat - ((y + 0.5) * t.dem.cell_m) / M_PER_DEG_LAT,
    lng: t.dem.minLng + ((x + 0.5) * t.dem.cell_m) / t.dem.kx,
  };
}

/** Count of upstream stream branches meeting at this cell. */
export function junctionOrder(t: VillageTerrain, i: number) {
  let count = 0;
  for (let k = 0; k < 8; k++) {
    const x = i % t.dem.w;
    const y = (i / t.dem.w) | 0;
    const nx = x + DXK[k]!;
    const ny = y + DYK[k]!;
    if (nx < 0 || ny < 0 || nx >= t.dem.w || ny >= t.dem.h) continue;
    const j = ny * t.dem.w + nx;
    if (!t.streams[j]) continue;
    const d = t.hyd.dir[j]!;
    if (d >= 0 && neighbourFromDir(t.dem, j, d) === i) count++;
  }
  return count;
}
