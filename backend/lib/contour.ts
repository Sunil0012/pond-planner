/**
 * Contour-map terrain analysis.
 *
 * Pure, isomorphic TypeScript: parses a KML/KMZ contour map, rasterises a DEM by
 * Laplace interpolation between contour lines, fills sinks, derives D8 flow
 * direction / accumulation / slope, then ranks pond sites and delineates the
 * upstream catchment for each site. Nothing here is specific to any input file.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ContourLine {
  elevation: number;
  pts: LatLng[];
}

export interface ContourParseResult {
  lines: ContourLine[];
  warnings: string[];
  placemarks: number;
}

const M_PER_DEG_LAT = 110574;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/* ------------------------------------------------------------------ parsing */

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function numberFrom(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = /-?\d+(\.\d+)?/.exec(decodeEntities(text));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse contour LineStrings + their elevation label out of a KML document. */
export function parseKmlContours(xml: string): ContourParseResult {
  const warnings: string[] = [];
  const lines: ContourLine[] = [];
  const placemarks = xml.split(/<Placemark[\s>]/i).slice(1);

  for (const chunk of placemarks) {
    const body = chunk.split(/<\/Placemark>/i)[0] ?? "";

    // Elevation: <name>, or any SimpleData/Data field that looks like a level.
    let elevation: number | null = null;
    const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(body);
    elevation = numberFrom(nameMatch?.[1]);

    if (elevation === null) {
      const sd =
        /<SimpleData\s+name="(?:elev|elevation|level|contour|height|z|alt)[^"]*"[^>]*>([\s\S]*?)<\/SimpleData>/i.exec(
          body,
        ) ?? /<Data\s+name="(?:elev|elevation|level|contour|height|z|alt)[^"]*"[\s\S]*?<value>([\s\S]*?)<\/value>/i.exec(body);
      elevation = numberFrom(sd?.[1]);
    }

    const coordBlocks = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/gi) ?? [];
    for (const block of coordBlocks) {
      const raw = block.replace(/<\/?coordinates>/gi, "").trim();
      if (!raw) continue;
      const pts: LatLng[] = [];
      let zSum = 0;
      let zCount = 0;
      for (const tuple of raw.split(/\s+/)) {
        const parts = tuple.split(",");
        if (parts.length < 2) continue;
        const lng = Number(parts[0]);
        const lat = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const z = Number(parts[2]);
        if (Number.isFinite(z) && z !== 0) {
          zSum += z;
          zCount++;
        }
        pts.push({ lat, lng });
      }
      if (pts.length < 2) continue;
      const elev = elevation ?? (zCount > 0 ? zSum / zCount : null);
      if (elev === null) continue;
      lines.push({ elevation: elev, pts });
    }
  }

  if (lines.length === 0) warnings.push("No contour line with a readable elevation was found in the file.");
  return { lines, warnings, placemarks: placemarks.length };
}

/* --------------------------------------------------------------------- grid */

export interface Dem {
  w: number;
  h: number;
  cell_m: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  kx: number; // metres per degree longitude at the centre latitude
  elev: Float32Array;
  known: Uint8Array;
  distToData: Int32Array; // cell distance to nearest contour cell
}

export function cellToLatLng(dem: Dem, x: number, y: number): LatLng {
  return {
    lat: dem.maxLat - ((y + 0.5) * dem.cell_m) / M_PER_DEG_LAT,
    lng: dem.minLng + ((x + 0.5) * dem.cell_m) / dem.kx,
  };
}

function cornerToLatLng(dem: Dem, x: number, y: number): LatLng {
  return {
    lat: dem.maxLat - (y * dem.cell_m) / M_PER_DEG_LAT,
    lng: dem.minLng + (x * dem.cell_m) / dem.kx,
  };
}

/** Rasterise contour lines into a DEM using Laplace (heat-equation) interpolation. */
export function buildDem(lines: ContourLine[], targetCells = 190): Dem {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const l of lines)
    for (const p of l.pts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
  if (!Number.isFinite(minLat)) throw new Error("Contour file contains no coordinates.");

  const centreLat = (minLat + maxLat) / 2;
  const kx = mPerDegLng(centreLat);
  const widthM = Math.max(1, (maxLng - minLng) * kx);
  const heightM = Math.max(1, (maxLat - minLat) * M_PER_DEG_LAT);
  const cell_m = Math.max(1.5, Math.max(widthM, heightM) / targetCells);
  const w = Math.max(8, Math.ceil(widthM / cell_m));
  const h = Math.max(8, Math.ceil(heightM / cell_m));
  const n = w * h;

  const sum = new Float64Array(n);
  const count = new Int32Array(n);
  const elev = new Float32Array(n);
  const known = new Uint8Array(n);

  const toX = (lng: number) => ((lng - minLng) * kx) / cell_m;
  const toY = (lat: number) => ((maxLat - lat) * M_PER_DEG_LAT) / cell_m;

  const stamp = (x: number, y: number, z: number) => {
    const ix = Math.min(w - 1, Math.max(0, Math.floor(x)));
    const iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
    const i = iy * w + ix;
    sum[i]! += z;
    count[i]!++;
  };

  // Walk each segment so contours are continuous in raster space. We rasterise
  // each segment as a polyline (not just its endpoints) so long contours that
  // pass through many cells get full coverage instead of just their two ends.
  let covered = 0;
  // Stamp each segment as a polyline. We give the stamp a small radius (one
  // cell on either side) so a contour line influences a narrow band of cells
  // around it — closer to how a real line on a 1 m contour map renders.
  const STAMP_RADIUS = 1;
  for (const l of lines) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const a = l.pts[i]!;
      const b = l.pts[i + 1]!;
      const ax = toX(a.lng);
      const ay = toY(a.lat);
      const bx = toX(b.lng);
      const by = toY(b.lat);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        for (let dy = -STAMP_RADIUS; dy <= STAMP_RADIUS; dy++) {
          for (let dx = -STAMP_RADIUS; dx <= STAMP_RADIUS; dx++) {
            if (dx === 0 && dy === 0) continue;
            stamp(x + dx, y + dy, l.elevation);
          }
        }
        stamp(x, y, l.elevation);
      }
    }
  }

  let mean = 0;
  let knownCount = 0;
  for (let i = 0; i < n; i++) {
    if (count[i]! > 0) {
      elev[i] = sum[i]! / count[i]!;
      known[i] = 1;
      mean += elev[i]!;
      knownCount++;
    }
  }
  mean = knownCount ? mean / knownCount : 0;
  for (let i = 0; i < n; i++) if (!known[i]) elev[i] = mean;

  // Gauss-Seidel relaxation with contour cells held fixed.
  const iterations = Math.min(600, Math.max(150, Math.round(Math.max(w, h) * 2.2)));
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let s = 0;
        let c = 0;
        if (x > 0) (s += elev[i - 1]!), c++;
        if (x < w - 1) (s += elev[i + 1]!), c++;
        if (y > 0) (s += elev[i - w]!), c++;
        if (y < h - 1) (s += elev[i + w]!), c++;
        if (c) elev[i] = s / c;
      }
    }
  }

  // BFS distance (in cells) from contour data — used to flag extrapolated areas.
  const distToData = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++)
    if (known[i]) {
      distToData[i] = 0;
      queue[qt++] = i;
    }
  while (qh < qt) {
    const i = queue[qh++]!;
    const x = i % w;
    const y = (i / w) | 0;
    const d = distToData[i]! + 1;
    const push = (j: number) => {
      if (distToData[j]! < 0) {
        distToData[j] = d;
        queue[qt++] = j;
      }
    };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  return { w, h, cell_m, minLat, maxLat, minLng, maxLng, kx, elev, known, distToData };
}

/* ------------------------------------------------------- hydrology on the DEM */

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

export interface Hydrology {
  filled: Float32Array;
  sinksFilled: number;
  dir: Int8Array; // index into DX/DY, -1 = drains off the extent
  acc: Float32Array; // contributing cells
  slope: Float32Array; // percent
  relief: Float32Array; // elevation minus local mean (negative = depression)
  order: Int8Array; // Strahler stream order, 1..8
  minElev: number;
  maxElev: number;
  meanSlope: number;
}

export function computeHydrology(dem: Dem): Hydrology {
  const { w, h, elev, cell_m } = dem;
  const n = w * h;
  const filled = Float32Array.from(elev);

  // Iterative sink filling (Planchon-Darboux style, bounded).
  let sinksFilled = 0;
  for (let pass = 0; pass < 40; pass++) {
    let changed = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        let lowest = Infinity;
        for (let k = 0; k < 8; k++) {
          const v = filled[(y + DY[k]!) * w + (x + DX[k]!)]!;
          if (v < lowest) lowest = v;
        }
        if (filled[i]! <= lowest) {
          filled[i] = lowest + 0.001;
          changed++;
        }
      }
    }
    sinksFilled += changed;
    if (changed === 0) break;
  }

  const dir = new Int8Array(n).fill(-1);
  const slope = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = -1;
      let bestDrop = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const dist = cell_m * (DX[k]! && DY[k]! ? Math.SQRT2 : 1);
        const drop = (filled[i]! - filled[ny * w + nx]!) / dist;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = k;
        }
      }
      dir[i] = best;
      // slope from the raw (unfilled) surface, in percent
      const zx =
        ((elev[y * w + Math.min(w - 1, x + 1)]! - elev[y * w + Math.max(0, x - 1)]!) /
          (cell_m * (Math.min(w - 1, x + 1) - Math.max(0, x - 1)))) || 0;
      const zy =
        ((elev[Math.min(h - 1, y + 1) * w + x]! - elev[Math.max(0, y - 1) * w + x]!) /
          (cell_m * (Math.min(h - 1, y + 1) - Math.max(0, y - 1)))) || 0;
      slope[i] = Math.sqrt(zx * zx + zy * zy) * 100;
    }
  }

  // Flow accumulation: process cells from high to low.
  const idxOrder = new Int32Array(n);
  for (let i = 0; i < n; i++) idxOrder[i] = i;
  const arr = Array.from(idxOrder).sort((a, b) => filled[b]! - filled[a]!);
  const acc = new Float32Array(n).fill(1);
  for (const i of arr) {
    const k = dir[i]!;
    if (k < 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const j = (y + DY[k]!) * w + (x + DX[k]!);
    acc[j]! += acc[i]!;
  }

  // Local relief over a ~5-cell window.
  const relief = new Float32Array(n);
  const r = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          s += elev[ny * w + nx]!;
          c++;
        }
      }
      relief[y * w + x] = elev[y * w + x]! - s / c;
    }
  }

  let minElev = Infinity;
  let maxElev = -Infinity;
  let slopeSum = 0;
  for (let i = 0; i < n; i++) {
    if (elev[i]! < minElev) minElev = elev[i]!;
    if (elev[i]! > maxElev) maxElev = elev[i]!;
    slopeSum += slope[i]!;
  }

  // Strahler order on the flow-direction grid. Cells with no outflow are
  // order 1 (leaves). A cell that receives two or more inflows of equal
  // order takes order+1; otherwise the maximum incoming order. Process cells
  // high-to-low so every upstream cell is settled before its downstream.
  const order: Int8Array = new Int8Array(n);
  const highestIn = new Int8Array(n);
  const tieIn = new Uint8Array(n);
  const sortIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) sortIndices[i] = i;
  const sortedCells = Array.from(sortIndices).sort((a, b) => filled[b]! - filled[a]!);
  for (const i of sortedCells) {
    const d = dir[i]!;
    if (d < 0) {
      order[i] = 1;
      continue;
    }
    const incoming = order[i]!;
    if (incoming > highestIn[d]!) {
      highestIn[d] = incoming;
      tieIn[d] = 0;
    } else if (incoming === highestIn[d]! && incoming > 0) {
      tieIn[d] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (order[i] === 0) {
      const h = highestIn[i]!;
      order[i] = tieIn[i] && h > 0 ? Math.min(8, h + 1) : h;
    }
  }

  return {
    filled,
    sinksFilled,
    dir,
    acc,
    slope,
    relief,
    minElev,
    maxElev,
    meanSlope: slopeSum / n,
    order,
  };
}

/* ------------------------------------------------------ catchment delineation */

export function upstreamCells(dem: Dem, hyd: Hydrology, outlet: number): Int32Array {
  const { w, h } = dem;
  const n = w * h;
  const inSet = new Uint8Array(n);
  const stack: number[] = [outlet];
  inSet[outlet] = 1;
  const out: number[] = [outlet];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (inSet[j]) continue;
      const d = hyd.dir[j]!;
      if (d < 0) continue;
      if (nx + DX[d]! === x && ny + DY[d]! === y) {
        inSet[j] = 1;
        out.push(j);
        stack.push(j);
      }
    }
  }
  return Int32Array.from(out);
}

/** Outline a cell mask as a closed ring of lat/lng points (largest loop). */
export function maskOutline(dem: Dem, cells: Int32Array): LatLng[] {
  const { w, h } = dem;
  const mask = new Uint8Array(w * h);
  for (const i of cells) mask[i] = 1;
  const key = (x: number, y: number) => `${x},${y}`;
  const edges = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => {
    const k = key(a[0], a[1]);
    const list = edges.get(k);
    if (list) list.push(b);
    else edges.set(k, [b]);
  };
  for (const i of cells) {
    const x = i % w;
    const y = (i / w) | 0;
    const up = y > 0 ? mask[i - w] : 0;
    const down = y < h - 1 ? mask[i + w] : 0;
    const left = x > 0 ? mask[i - 1] : 0;
    const right = x < w - 1 ? mask[i + 1] : 0;
    // Clockwise winding in screen space.
    if (!up) add([x, y], [x + 1, y]);
    if (!right) add([x + 1, y], [x + 1, y + 1]);
    if (!down) add([x + 1, y + 1], [x, y + 1]);
    if (!left) add([x, y + 1], [x, y]);
  }

  let best: [number, number][] = [];
  const used = new Set<string>();
  for (const [startKey, targets] of edges) {
    for (const first of targets) {
      const edgeId = `${startKey}>${first[0]},${first[1]}`;
      if (used.has(edgeId)) continue;
      const startXY = startKey.split(",").map(Number) as [number, number];
      const loop: [number, number][] = [startXY];
      let cur = first;
      let prevKey = startKey;
      used.add(edgeId);
      let guard = 0;
      while (guard++ < 200000) {
        loop.push(cur);
        const k = key(cur[0], cur[1]);
        if (k === startKey) break;
        const nexts = edges.get(k);
        if (!nexts) break;
        let picked: [number, number] | null = null;
        for (const cand of nexts) {
          const id = `${k}>${cand[0]},${cand[1]}`;
          if (used.has(id)) continue;
          picked = cand;
          used.add(id);
          break;
        }
        if (!picked) break;
        prevKey = k;
        cur = picked;
      }
      void prevKey;
      if (loop.length > best.length) best = loop;
    }
  }

  const ring = simplifyRing(best.map(([x, y]) => cornerToLatLng(dem, x, y)), dem.cell_m * 0.9);
  return ring;
}

/**
 * Simplify a closed ring. Plain Douglas-Peucker degenerates on closed rings:
 * the chord runs from the first vertex to the same vertex at the end, so every
 * vertex sits ~0 distance from it and everything is dropped but 2 points.
 * Instead, split the ring at the vertex farthest from the anchor and simplify
 * each half against its own chord, then rejoin.
 */
function simplifyRing(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length < 5) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const closed = Math.abs(first.lat - last.lat) < 1e-12 && Math.abs(first.lng - last.lng) < 1e-12;
  const ring = closed ? points.slice(0, -1) : points;
  if (ring.length < 4) return points;

  // Anchor A = index 0; anchor B = the vertex farthest from A.
  const kx = mPerDegLng(ring[0]!.lat);
  let farIdx = 1;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(
      (ring[i]!.lng - ring[0]!.lng) * kx,
      (ring[i]!.lat - ring[0]!.lat) * M_PER_DEG_LAT,
    );
    if (d > farD) {
      farD = d;
      farIdx = i;
    }
  }

  const halfA = simplify(ring.slice(0, farIdx + 1), toleranceM);
  const halfB = simplify([...ring.slice(farIdx), ring[0]!], toleranceM);
  // halfB ends at the anchor (ring[0]) — drop it to avoid duplicating the start.
  const merged = [...halfA, ...halfB.slice(0, -1)];
  return merged.length >= 3 ? merged : points;
}

/** Douglas-Peucker in approximate metres. */
export function simplify(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length < 4) return points;
  const kx = mPerDegLng(points[0]!.lat);
  const px = points.map((p) => [p.lng * kx, p.lat * M_PER_DEG_LAT] as [number, number]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = px[s]!;
    const [x2, y2] = px[e]!;
    let maxD = -1;
    let idx = -1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = px[i]!;
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

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
