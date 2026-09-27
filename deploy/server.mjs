// backend/server.ts
import express from "express";
import cors from "cors";
import multer from "multer";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { strFromU8, unzipSync } from "fflate";

// backend/lib/contour.ts
var M_PER_DEG_LAT = 110574;
var mPerDegLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}
function numberFrom(text) {
  if (!text) return null;
  const m = /-?\d+(\.\d+)?/.exec(decodeEntities(text));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
function parseKmlContours(xml) {
  const warnings = [];
  const lines = [];
  const placemarks = xml.split(/<Placemark[\s>]/i).slice(1);
  for (const chunk of placemarks) {
    const body = chunk.split(/<\/Placemark>/i)[0] ?? "";
    let elevation = null;
    const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(body);
    elevation = numberFrom(nameMatch?.[1]);
    if (elevation === null) {
      const sd = /<SimpleData\s+name="(?:elev|elevation|level|contour|height|z|alt)[^"]*"[^>]*>([\s\S]*?)<\/SimpleData>/i.exec(
        body
      ) ?? /<Data\s+name="(?:elev|elevation|level|contour|height|z|alt)[^"]*"[\s\S]*?<value>([\s\S]*?)<\/value>/i.exec(body);
      elevation = numberFrom(sd?.[1]);
    }
    const coordBlocks = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/gi) ?? [];
    for (const block of coordBlocks) {
      const raw = block.replace(/<\/?coordinates>/gi, "").trim();
      if (!raw) continue;
      const pts = [];
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
function cellToLatLng(dem, x, y) {
  return {
    lat: dem.maxLat - (y + 0.5) * dem.cell_m / M_PER_DEG_LAT,
    lng: dem.minLng + (x + 0.5) * dem.cell_m / dem.kx
  };
}
function cornerToLatLng(dem, x, y) {
  return {
    lat: dem.maxLat - y * dem.cell_m / M_PER_DEG_LAT,
    lng: dem.minLng + x * dem.cell_m / dem.kx
  };
}
function buildDem(lines, targetCells = 190) {
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
  const toX = (lng) => (lng - minLng) * kx / cell_m;
  const toY = (lat) => (maxLat - lat) * M_PER_DEG_LAT / cell_m;
  const stamp = (x, y, z) => {
    const ix = Math.min(w - 1, Math.max(0, Math.floor(x)));
    const iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
    const i = iy * w + ix;
    sum[i] += z;
    count[i]++;
  };
  let covered = 0;
  const STAMP_RADIUS = 1;
  for (const l of lines) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const a = l.pts[i];
      const b = l.pts[i + 1];
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
    if (count[i] > 0) {
      elev[i] = sum[i] / count[i];
      known[i] = 1;
      mean += elev[i];
      knownCount++;
    }
  }
  mean = knownCount ? mean / knownCount : 0;
  for (let i = 0; i < n; i++) if (!known[i]) elev[i] = mean;
  const iterations = Math.min(600, Math.max(150, Math.round(Math.max(w, h) * 2.2)));
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let s = 0;
        let c = 0;
        if (x > 0) s += elev[i - 1], c++;
        if (x < w - 1) s += elev[i + 1], c++;
        if (y > 0) s += elev[i - w], c++;
        if (y < h - 1) s += elev[i + w], c++;
        if (c) elev[i] = s / c;
      }
    }
  }
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
    const i = queue[qh++];
    const x = i % w;
    const y = i / w | 0;
    const d = distToData[i] + 1;
    const push = (j) => {
      if (distToData[j] < 0) {
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
var DX = [1, 1, 0, -1, -1, -1, 0, 1];
var DY = [0, 1, 1, 1, 0, -1, -1, -1];
function computeHydrology(dem) {
  const { w, h, elev, cell_m } = dem;
  const n = w * h;
  const filled = Float32Array.from(elev);
  let sinksFilled = 0;
  for (let pass = 0; pass < 40; pass++) {
    let changed = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        let lowest = Infinity;
        for (let k = 0; k < 8; k++) {
          const v = filled[(y + DY[k]) * w + (x + DX[k])];
          if (v < lowest) lowest = v;
        }
        if (filled[i] <= lowest) {
          filled[i] = lowest + 1e-3;
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
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const dist = cell_m * (DX[k] && DY[k] ? Math.SQRT2 : 1);
        const drop = (filled[i] - filled[ny * w + nx]) / dist;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = k;
        }
      }
      dir[i] = best;
      const zx = (elev[y * w + Math.min(w - 1, x + 1)] - elev[y * w + Math.max(0, x - 1)]) / (cell_m * (Math.min(w - 1, x + 1) - Math.max(0, x - 1))) || 0;
      const zy = (elev[Math.min(h - 1, y + 1) * w + x] - elev[Math.max(0, y - 1) * w + x]) / (cell_m * (Math.min(h - 1, y + 1) - Math.max(0, y - 1))) || 0;
      slope[i] = Math.sqrt(zx * zx + zy * zy) * 100;
    }
  }
  const idxOrder = new Int32Array(n);
  for (let i = 0; i < n; i++) idxOrder[i] = i;
  const arr = Array.from(idxOrder).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(n).fill(1);
  for (const i of arr) {
    const k = dir[i];
    if (k < 0) continue;
    const x = i % w;
    const y = i / w | 0;
    const j = (y + DY[k]) * w + (x + DX[k]);
    acc[j] += acc[i];
  }
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
          s += elev[ny * w + nx];
          c++;
        }
      }
      relief[y * w + x] = elev[y * w + x] - s / c;
    }
  }
  let minElev = Infinity;
  let maxElev = -Infinity;
  let slopeSum = 0;
  for (let i = 0; i < n; i++) {
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) maxElev = elev[i];
    slopeSum += slope[i];
  }
  const order = new Int8Array(n);
  const highestIn = new Int8Array(n);
  const tieIn = new Uint8Array(n);
  const sortIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) sortIndices[i] = i;
  const sortedCells = Array.from(sortIndices).sort((a, b) => filled[b] - filled[a]);
  for (const i of sortedCells) {
    const d = dir[i];
    if (d < 0) {
      order[i] = 1;
      continue;
    }
    const incoming = order[i];
    if (incoming > highestIn[d]) {
      highestIn[d] = incoming;
      tieIn[d] = 0;
    } else if (incoming === highestIn[d] && incoming > 0) {
      tieIn[d] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (order[i] === 0) {
      const h2 = highestIn[i];
      order[i] = tieIn[i] && h2 > 0 ? Math.min(8, h2 + 1) : h2;
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
    order
  };
}
function upstreamCells(dem, hyd, outlet) {
  const { w, h } = dem;
  const n = w * h;
  const inSet = new Uint8Array(n);
  const stack = [outlet];
  inSet[outlet] = 1;
  const out = [outlet];
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = i / w | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (inSet[j]) continue;
      const d = hyd.dir[j];
      if (d < 0) continue;
      if (nx + DX[d] === x && ny + DY[d] === y) {
        inSet[j] = 1;
        out.push(j);
        stack.push(j);
      }
    }
  }
  return Int32Array.from(out);
}
function maskOutline(dem, cells) {
  const { w, h } = dem;
  const mask = new Uint8Array(w * h);
  for (const i of cells) mask[i] = 1;
  const key = (x, y) => `${x},${y}`;
  const edges = /* @__PURE__ */ new Map();
  const add = (a, b) => {
    const k = key(a[0], a[1]);
    const list = edges.get(k);
    if (list) list.push(b);
    else edges.set(k, [b]);
  };
  for (const i of cells) {
    const x = i % w;
    const y = i / w | 0;
    const up = y > 0 ? mask[i - w] : 0;
    const down = y < h - 1 ? mask[i + w] : 0;
    const left = x > 0 ? mask[i - 1] : 0;
    const right = x < w - 1 ? mask[i + 1] : 0;
    if (!up) add([x, y], [x + 1, y]);
    if (!right) add([x + 1, y], [x + 1, y + 1]);
    if (!down) add([x + 1, y + 1], [x, y + 1]);
    if (!left) add([x, y + 1], [x, y]);
  }
  let best = [];
  const used = /* @__PURE__ */ new Set();
  for (const [startKey, targets] of edges) {
    for (const first of targets) {
      const edgeId = `${startKey}>${first[0]},${first[1]}`;
      if (used.has(edgeId)) continue;
      const startXY = startKey.split(",").map(Number);
      const loop = [startXY];
      let cur = first;
      let prevKey = startKey;
      used.add(edgeId);
      let guard = 0;
      while (guard++ < 2e5) {
        loop.push(cur);
        const k = key(cur[0], cur[1]);
        if (k === startKey) break;
        const nexts = edges.get(k);
        if (!nexts) break;
        let picked = null;
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
function simplifyRing(points, toleranceM) {
  if (points.length < 5) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.abs(first.lat - last.lat) < 1e-12 && Math.abs(first.lng - last.lng) < 1e-12;
  const ring = closed ? points.slice(0, -1) : points;
  if (ring.length < 4) return points;
  const kx = mPerDegLng(ring[0].lat);
  let farIdx = 1;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(
      (ring[i].lng - ring[0].lng) * kx,
      (ring[i].lat - ring[0].lat) * M_PER_DEG_LAT
    );
    if (d > farD) {
      farD = d;
      farIdx = i;
    }
  }
  const halfA = simplify(ring.slice(0, farIdx + 1), toleranceM);
  const halfB = simplify([...ring.slice(farIdx), ring[0]], toleranceM);
  const merged = [...halfA, ...halfB.slice(0, -1)];
  return merged.length >= 3 ? merged : points;
}
function simplify(points, toleranceM) {
  if (points.length < 4) return points;
  const kx = mPerDegLng(points[0].lat);
  const px = points.map((p) => [p.lng * kx, p.lat * M_PER_DEG_LAT]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = px[s];
    const [x2, y2] = px[e];
    let maxD = -1;
    let idx = -1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = px[i];
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
function ringAreaM2(ring) {
  if (ring.length < 3) return 0;
  const kx = mPerDegLng(ring[0].lat);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.lng * kx * (b.lat * M_PER_DEG_LAT) - b.lng * kx * (a.lat * M_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

// backend/lib/analyze-contour.ts
var clamp01 = (n) => Math.max(0, Math.min(1, n));
function bandSizeScore(accCells, minCells, maxCells) {
  const pos = clamp01((accCells - minCells) / Math.max(1e-9, maxCells - minCells));
  return clamp01(0.4 + 0.6 * (1 - Math.abs(pos - 0.5) * 2));
}
function medianInterval(levels) {
  const diffs = [];
  for (let i = 1; i < levels.length; i++) {
    const d = Math.round((levels[i] - levels[i - 1]) * 1e3) / 1e3;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}
function pondPool(dem, hyd, outlet, depth, maxCells) {
  const level = hyd.filled[outlet] + depth;
  const { w, h } = dem;
  const visited = new Uint8Array(w * h);
  const cells = [];
  const stack = [outlet];
  visited[outlet] = 1;
  let volume = 0;
  while (stack.length && cells.length < maxCells) {
    const i = stack.pop();
    const z = dem.elev[i];
    if (z > level) continue;
    cells.push(i);
    volume += (level - z) * dem.cell_m * dem.cell_m;
    const x = i % w;
    const y = i / w | 0;
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const j = ny * w + nx;
      if (!visited[j]) {
        visited[j] = 1;
        stack.push(j);
      }
    };
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return { cells: Int32Array.from(cells), volume };
}
function pondForCatchment(dem, hyd, outlet, depth, annualRunoff, catchmentCells) {
  const minCells = Math.max(3, Math.round(catchmentCells * 0.15));
  const maxCells = Math.max(minCells, Math.min(3e4, Math.round(catchmentCells * 0.4)));
  const targetVolume = Math.max(1, annualRunoff) * 0.6;
  let best = pondPool(dem, hyd, outlet, depth, minCells);
  if (best.volume >= targetVolume) return best;
  let prevVolume = best.volume;
  let prevCells = best.cells.length;
  for (let next = minCells * 4; next <= maxCells; next = Math.round(next * 1.7)) {
    const candidate = pondPool(dem, hyd, outlet, depth, next);
    if (candidate.volume >= targetVolume) return candidate;
    if (candidate.volume - prevVolume < prevVolume * 0.05 && candidate.cells.length - prevCells > 50) {
      return best;
    }
    best = candidate;
    prevVolume = best.volume;
    prevCells = best.cells.length;
  }
  return best;
}
function extractDrainage(dem, hyd, threshold, limit = 60) {
  const { w, h } = dem;
  const n = w * h;
  const stream = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (hyd.acc[i] >= threshold) stream[i] = 1;
  const inflow = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!stream[i]) continue;
    const k = hyd.dir[i];
    if (k < 0) continue;
    const x = i % w;
    const y = i / w | 0;
    const nx = x + (k === 0 || k === 1 || k === 7 ? 1 : k === 3 || k === 4 || k === 5 ? -1 : 0);
    const ny = y + (k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (stream[ny * w + nx]) inflow[ny * w + nx]++;
  }
  const paths = [];
  const visited = new Uint8Array(n);
  const heads = [];
  for (let i = 0; i < n; i++) if (stream[i] && inflow[i] === 0) heads.push(i);
  heads.sort((a, b) => hyd.acc[b] - hyd.acc[a]);
  for (const head of heads.slice(0, limit)) {
    let i = head;
    const pts = [];
    let maxAcc = 0;
    let guard = 0;
    while (guard++ < n) {
      pts.push(cellToLatLng(dem, i % w, i / w | 0));
      maxAcc = Math.max(maxAcc, hyd.acc[i]);
      if (visited[i] && pts.length > 2) break;
      visited[i] = 1;
      const k = hyd.dir[i];
      if (k < 0) break;
      const x = i % w;
      const y = i / w | 0;
      const nx = x + (k === 0 || k === 1 || k === 7 ? 1 : k === 3 || k === 4 || k === 5 ? -1 : 0);
      const ny = y + (k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
      i = ny * w + nx;
      if (!stream[i]) break;
    }
    if (pts.length > 3)
      paths.push({
        order: maxAcc > threshold * 12 ? 3 : maxAcc > threshold * 4 ? 2 : 1,
        path: simplify(pts, dem.cell_m * 0.8)
      });
  }
  return paths;
}
function analyzeContourMap(xml, meta, opts = {}) {
  const depth = opts.designDepth_m ?? 3;
  const coeff = opts.runoffCoefficient ?? 0.45;
  const rain = opts.annualRainfall_mm ?? 900;
  const maxSlope = opts.maxSlopePct ?? 8;
  const wantCandidates = opts.maxCandidates ?? 6;
  const parsed = parseKmlContours(xml);
  if (!parsed.lines.length) throw new Error("No contour geometry with elevations found in the uploaded file.");
  const dem = buildDem(parsed.lines, opts.gridTarget ?? 190);
  const hyd = computeHydrology(dem);
  const { w, h } = dem;
  const n = w * h;
  const cellArea = dem.cell_m * dem.cell_m;
  const levels = Array.from(new Set(parsed.lines.map((l) => Math.round(l.elevation * 100) / 100))).sort((a, b) => a - b);
  const vertices = parsed.lines.reduce((s, l) => s + l.pts.length, 0);
  const interval = medianInterval(levels);
  const minCatchCells = (opts.minCatchmentArea_m2 ?? 1e3) / cellArea;
  const maxCatchCells = 6e3 / cellArea;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const scored = [];
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const acc = hyd.acc[i];
      if (acc < minCatchCells || acc > maxCatchCells) continue;
      const accScore = bandSizeScore(acc, minCatchCells, maxCatchCells);
      const slopeScore = clamp01(1 - hyd.slope[i] / (maxSlope * 1.25));
      const concaveScore = clamp01(-hyd.relief[i] / (Math.max(0.4, interval || 1) * 1.2) + 0.35);
      const dataScore = clamp01(1 - dem.distToData[i] / 10);
      const score = 0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore;
      scored.push({ i, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const minSepCells = Math.max(4, Math.round(Math.min(w, h) / 9));
  const picked = [];
  for (const s of scored) {
    const x = s.i % w;
    const y = s.i / w | 0;
    if (picked.some((p) => Math.hypot(p.i % w - x, (p.i / w | 0) - y) < minSepCells)) continue;
    picked.push(s);
    if (picked.length >= wantCandidates) break;
  }
  const candidates = picked.map((p, idx) => {
    const i = p.i;
    const x = i % w;
    const y = i / w | 0;
    const location = cellToLatLng(dem, x, y);
    const cells = upstreamCells(dem, hyd, i);
    const catchmentArea = cells.length * cellArea;
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const c of cells) {
      const z = dem.elev[c];
      if (z < cMin) cMin = z;
      if (z > cMax) cMax = z;
    }
    const catchment = maskOutline(dem, cells);
    const runoff = Math.round(rain / 1e3 * catchmentArea * coeff);
    const pool = pondForCatchment(dem, hyd, i, depth, runoff, cells.length);
    const footprint = maskOutline(dem, pool.cells);
    const footprintArea = pool.cells.length * cellArea;
    const storage = Math.round(pool.volume);
    const meanDepth = storage / Math.max(1, footprintArea);
    const edgeTruncated = cells.some((c) => {
      const cx = c % w;
      const cy = c / w | 0;
      return cx <= 1 || cy <= 1 || cx >= w - 2 || cy >= h - 2;
    });
    const support = dem.distToData[i] <= 1 ? "DIRECT" : dem.distToData[i] <= 6 ? "INTERPOLATED" : "EXTRAPOLATED";
    const strahler = Math.max(1, Math.min(8, hyd.order[i] ?? 1));
    const accScore = bandSizeScore(hyd.acc[i], minCatchCells, maxCatchCells);
    const slopeScore = clamp01(1 - hyd.slope[i] / (maxSlope * 1.25));
    const concaveScore = clamp01(-hyd.relief[i] / (Math.max(0.4, interval || 1) * 1.2) + 0.35);
    const dataScore = clamp01(1 - dem.distToData[i] / 10);
    const storageScore = clamp01(storage / Math.max(1, runoff * 0.35));
    const factors = [
      {
        key: "flow",
        label: "Flow convergence",
        weight: 0.36,
        value: accScore,
        detail: `Upstream catchment of ${Math.round(catchmentArea).toLocaleString("en-IN")} m\xB2 \u2014 inside the 1,000\u20136,000 m\xB2 village-pond band.`
      },
      {
        key: "slope",
        label: "Local slope",
        weight: 0.28,
        value: slopeScore,
        detail: `Contour-derived slope ${hyd.slope[i].toFixed(2)}% against a ${maxSlope}% ceiling.`
      },
      {
        key: "concavity",
        label: "Natural depression",
        weight: 0.21,
        value: concaveScore,
        detail: `Site sits ${(-hyd.relief[i]).toFixed(2)} m below the surrounding ${(dem.cell_m * 7).toFixed(0)} m neighbourhood.`
      },
      {
        key: "support",
        label: "Contour support",
        weight: 0.15,
        value: dataScore,
        detail: `${(dem.distToData[i] * dem.cell_m).toFixed(0)} m from the nearest mapped contour line (${support.toLowerCase()}).`
      }
    ];
    const reasons = [];
    const cautions = [];
    if (accScore > 0.6) reasons.push("Sits on a natural flow line where runoff from the upper slopes converges.");
    if (slopeScore > 0.7) reasons.push(`Gentle ${hyd.slope[i].toFixed(1)}% slope keeps excavation and embankment volumes low.`);
    if (concaveScore > 0.55) reasons.push("Contours close around the site, so it is already a natural depression.");
    if (storageScore > 0.6)
      reasons.push(`Terrain holds ${storage.toLocaleString("en-IN")} m\xB3 at ${depth} m depth without a large bund.`);
    if (support === "DIRECT") reasons.push("Elevation is read directly from a mapped contour, not interpolated.");
    if (hyd.slope[i] > maxSlope) cautions.push(`Slope ${hyd.slope[i].toFixed(1)}% exceeds the ${maxSlope}% limit.`);
    if (catchmentArea < (opts.minCatchmentArea_m2 ?? 1e3))
      cautions.push(`Catchment ${Math.round(catchmentArea).toLocaleString("en-IN")} m\xB2 is below the configured minimum.`);
    if (edgeTruncated) cautions.push("Catchment reaches the edge of the contour sheet and may be truncated.");
    if (support === "EXTRAPOLATED") cautions.push("Elevation here is extrapolated \u2014 no contour line nearby.");
    if (runoff < storage * 0.8)
      cautions.push("Estimated annual runoff may not fill the basin; consider a shallower design depth.");
    const score = Math.round(
      (0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore) * 1e3
    ) / 10;
    const hardFail = hyd.slope[i] > maxSlope || catchmentArea < (opts.minCatchmentArea_m2 ?? 1e3);
    const status = hardFail ? "REJECTED" : cautions.length === 0 && score >= 62 ? "RECOMMENDED" : "CONDITIONAL";
    const supportScore = support === "DIRECT" ? 1 : support === "INTERPOLATED" ? 0.6 : 0.25;
    const confidenceValue = clamp01(
      0.55 * supportScore + 0.25 * slopeScore + 0.2 * (edgeTruncated ? 0.3 : 0.9)
    );
    const confidence = confidenceValue >= 0.78 ? "HIGH" : confidenceValue >= 0.5 ? "MEDIUM" : "LOW";
    const explanation = status === "REJECTED" ? `Excluded by the hard constraints: ${cautions[0]}` : `Ranked ${idx + 1} with a suitability score of ${score}. ${reasons[0] ?? "Terrain is workable."} The upstream catchment of ${Math.round(catchmentArea).toLocaleString("en-IN")} m\xB2 yields about ${runoff.toLocaleString("en-IN")} m\xB3 of runoff a year at ${rain} mm rainfall and a ${coeff} runoff coefficient, against a terrain-derived storage of ${storage.toLocaleString("en-IN")} m\xB3 at ${depth} m depth.${cautions.length ? ` Field team to resolve: ${cautions[0]}` : ""}`;
    return {
      id: `pond_${idx + 1}`,
      code: `CS-${String(idx + 1).padStart(2, "0")}`,
      rank: idx + 1,
      status,
      confidence,
      score,
      location,
      elevation_m: Number(dem.elev[i].toFixed(2)),
      slope_pct: Number(hyd.slope[i].toFixed(2)),
      localRelief_m: Number(hyd.relief[i].toFixed(2)),
      flowAccumulationCells: Math.round(hyd.acc[i]),
      streamOrderProxy: strahler,
      catchmentArea_m2: Math.round(catchmentArea),
      catchmentRelief_m: Number((cMax - cMin).toFixed(2)),
      catchment,
      pondFootprint: footprint,
      pondFootprint_m2: Math.round(footprintArea),
      storage_m3: storage,
      designDepth_m: depth,
      meanDepth_m: Number(meanDepth.toFixed(2)),
      annualRunoff_m3: runoff,
      fillRatio: Number((runoff / Math.max(1, storage)).toFixed(2)),
      edgeTruncated,
      demSupport: support,
      factors,
      reasons,
      cautions,
      explanation
    };
  });
  const drainage = extractDrainage(dem, hyd, Math.max(12, minCatchCells * 0.35));
  const displayLines = parsed.lines.filter((l) => l.pts.length > 2).map((l) => ({ elevation: l.elevation, pts: simplify(l.pts, dem.cell_m * 0.7) })).filter((l) => l.pts.length > 1).slice(0, 2500);
  let knownCells = 0;
  for (let i = 0; i < n; i++) if (dem.known[i]) knownCells++;
  const extentRing = [
    { lat: dem.maxLat, lng: dem.minLng },
    { lat: dem.maxLat, lng: dem.maxLng },
    { lat: dem.minLat, lng: dem.maxLng },
    { lat: dem.minLat, lng: dem.minLng }
  ];
  return {
    ok: true,
    source: meta,
    contours: {
      lines: parsed.lines.length,
      vertices,
      interval_m: interval,
      minElevation_m: levels[0] ?? 0,
      maxElevation_m: levels[levels.length - 1] ?? 0,
      levels
    },
    extent: {
      minLat: dem.minLat,
      minLng: dem.minLng,
      maxLat: dem.maxLat,
      maxLng: dem.maxLng,
      center: { lat: (dem.minLat + dem.maxLat) / 2, lng: (dem.minLng + dem.maxLng) / 2 },
      areaHa: Number((ringAreaM2(extentRing) / 1e4).toFixed(2))
    },
    dem: {
      method: "Laplace interpolation between contour lines, Planchon\u2013Darboux sink fill, D8 flow routing",
      cellSize_m: Number(dem.cell_m.toFixed(2)),
      columns: w,
      rows: h,
      coveragePct: Number((knownCells / n * 100).toFixed(2)),
      sinksFilled: hyd.sinksFilled,
      meanSlope_pct: Number(hyd.meanSlope.toFixed(2)),
      minElevation_m: Number(hyd.minElev.toFixed(2)),
      maxElevation_m: Number(hyd.maxElev.toFixed(2)),
      crs: "EPSG:4326 input, local metric plane for analysis"
    },
    assumptions: [
      `Runoff coefficient ${coeff} applied uniformly; annual rainfall ${rain} mm.`,
      `Design depth ${depth} m with storage integrated from the interpolated surface.`,
      "Elevations between contour lines are interpolated, not surveyed.",
      "Land ownership, soil strength and utilities are not represented in a contour map and must be verified in the field."
    ],
    candidates,
    drainage,
    contourLines: displayLines,
    computedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// backend/lib/elevation.ts
var OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation";
var OPEN_TOPO_URL = "https://api.opentopodata.org/v1/srtm30m";
var OPEN_ELEV_URL = "https://api.open-elevation.com/api/v1/lookup";
var BATCH = 100;
var BATCH_OT = 50;
var BATCH_OE = 100;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchOpenMeteoBatch(coords) {
  const lats = coords.map((c) => c.lat.toFixed(6)).join(",");
  const lngs = coords.map((c) => c.lng.toFixed(6)).join(",");
  const res = await fetch(`${OPEN_METEO_URL}?latitude=${lats}&longitude=${lngs}`, {
    signal: AbortSignal.timeout(25e3)
  });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  const elev = data.elevation;
  if (!Array.isArray(elev) || elev.length !== coords.length)
    throw new Error(`Open-Meteo: expected ${coords.length} values, got ${Array.isArray(elev) ? elev.length : 0}`);
  return elev.map((e) => {
    const n = Number(e);
    if (!Number.isFinite(n)) throw new Error("Open-Meteo returned non-numeric elevation");
    return n;
  });
}
async function fetchOpenTopoBatch(coords) {
  const locations = coords.map((c) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`).join("|");
  const res = await fetch(`${OPEN_TOPO_URL}?locations=${locations}`, {
    signal: AbortSignal.timeout(25e3)
  });
  if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length !== coords.length)
    throw new Error(`OpenTopoData status: ${data.status ?? "unknown"}`);
  return data.results.map((r) => {
    const n = Number(r.elevation);
    if (!Number.isFinite(n)) throw new Error("OpenTopoData returned non-numeric elevation");
    return n;
  });
}
async function fetchOpenElevBatch(coords) {
  const body = { locations: coords.map((c) => ({ latitude: c.lat, longitude: c.lng })) };
  const res = await fetch(OPEN_ELEV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25e3)
  });
  if (!res.ok) throw new Error(`Open-Elevation HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.results) || data.results.length !== coords.length)
    throw new Error("Open-Elevation: result count mismatch");
  return data.results.map((r) => {
    const n = Number(r.elevation);
    if (!Number.isFinite(n)) throw new Error("Open-Elevation returned non-numeric elevation");
    return n;
  });
}
async function fetchAll(coords, batchFn, providerName, batchSize, pauseMs) {
  const out = new Array(coords.length);
  const batches = Math.ceil(coords.length / batchSize);
  for (let b = 0; b < batches; b++) {
    const slice = coords.slice(b * batchSize, (b + 1) * batchSize);
    let done = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const values = await batchFn(slice);
        values.forEach((v, i) => {
          out[b * batchSize + i] = v;
        });
        done = true;
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await sleep(1500);
      }
    }
    if (!done) {
      throw new Error(
        `${providerName} failed on batch ${b + 1}/${batches}: ${lastErr instanceof Error ? lastErr.message : "request failed"}`
      );
    }
    if (b < batches - 1) await sleep(pauseMs);
  }
  return out;
}
function hash(ix, iy) {
  let h = (ix * 1619 ^ iy * 31337) & 2147483647;
  h = (h >> 16 ^ h) * 73244475;
  h = (h >> 16 ^ h) * 73244475;
  h = h >> 16 ^ h;
  return (h & 2147483647) / 2147483647;
}
function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (d - b - c + a) * ux * uy;
}
function fbm(x, y, octaves = 5) {
  let val = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return val / max;
}
function estimateBaseElevation(lat, lng) {
  if (lat > 28 && lng < 78) return 220;
  if (lat > 28 && lng >= 78 && lng < 85) return 180;
  if (lat > 28 && lng >= 85) return 250;
  if (lat >= 23 && lat <= 28 && lng >= 80 && lng <= 85) return 300;
  if (lat >= 20 && lat < 23 && lng >= 78 && lng < 83) return 350;
  if (lat >= 17 && lat < 20 && lng >= 73 && lng < 80) return 580;
  if (lat >= 15 && lat < 17 && lng >= 74 && lng < 78) return 650;
  if (lat < 15 && lng > 77) return 120;
  if (lat < 13) return 150;
  return 280;
}
function syntheticElevations(coords) {
  const midLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const midLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  const base = estimateBaseElevation(midLat, midLng);
  const latSpan = Math.max(...coords.map((c) => c.lat)) - Math.min(...coords.map((c) => c.lat));
  const relief = Math.max(5, Math.min(40, latSpan * 111e3 * 0.04));
  return coords.map((c) => {
    const nx = c.lng * 8;
    const ny = c.lat * 8;
    const noise = fbm(nx, ny, 5);
    return Math.round((base + (noise - 0.5) * 2 * relief) * 10) / 10;
  });
}
async function fetchElevations(coords) {
  if (coords.length === 0) throw new Error("No elevation sample points requested.");
  try {
    const elevations2 = await fetchAll(coords, fetchOpenMeteoBatch, "Open-Meteo elevation", BATCH, 400);
    return { elevations: elevations2, source: "Copernicus DEM GLO-90 via Open-Meteo" };
  } catch (e) {
    console.warn("[elevation] Open-Meteo failed:", e instanceof Error ? e.message : e);
  }
  try {
    const elevations2 = await fetchAll(coords, fetchOpenTopoBatch, "OpenTopoData", BATCH_OT, 1100);
    return { elevations: elevations2, source: "SRTM 30 m via OpenTopoData" };
  } catch (e) {
    console.warn("[elevation] OpenTopoData failed:", e instanceof Error ? e.message : e);
  }
  try {
    const elevations2 = await fetchAll(coords, fetchOpenElevBatch, "Open-Elevation", BATCH_OE, 500);
    return { elevations: elevations2, source: "SRTM via Open-Elevation" };
  } catch (e) {
    console.warn("[elevation] Open-Elevation failed:", e instanceof Error ? e.message : e);
  }
  console.warn(
    "[elevation] All live DEM providers unreachable. Using synthetic terrain (multi-octave noise seeded by coordinates). Results are approximate \u2014 verify with a local survey."
  );
  const elevations = syntheticElevations(coords);
  return {
    elevations,
    source: "Synthetic terrain estimate (DEM APIs unavailable \u2014 verify with local survey)"
  };
}

// backend/lib/rainfall.ts
var ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
var FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodBounds(now) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  end.setUTCMonth(end.getUTCMonth() - 1);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  start.setUTCDate(start.getUTCDate() + 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
function parseDailyResponse(data) {
  const times = data.daily?.time ?? [];
  const precip = data.daily?.precipitation_sum ?? [];
  if (!times.length) return null;
  const sums = new Array(12).fill(0);
  const years = /* @__PURE__ */ new Set();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const p = precip[i];
    if (typeof p !== "number" || !Number.isFinite(p)) continue;
    const month = Number(t.slice(5, 7)) - 1;
    sums[month] += p;
    years.add(Number(t.slice(0, 4)));
  }
  return { sums, yearCount: Math.max(1, years.size) };
}
function buildRainfall(sums, yearCount, provider, period) {
  const monthly = MONTHS.map((month, i) => ({ month, mm: Math.round(sums[i] / yearCount) }));
  const annual = monthly.reduce((s, m) => s + m.mm, 0);
  return { provider, period, annual_mm: annual, monthly };
}
async function tryArchive(lat, lng) {
  const { start, end } = periodBounds(/* @__PURE__ */ new Date());
  const url = `${ARCHIVE_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${start}&end_date=${end}&daily=precipitation_sum&timezone=GMT`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25e3) });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = parseDailyResponse(data);
    if (!parsed || parsed.sums.reduce((a, b) => a + b, 0) <= 0) return null;
    return buildRainfall(
      parsed.sums,
      parsed.yearCount,
      "Open-Meteo ERA5 archive",
      `${start} \u2192 ${end} (mean of ${parsed.yearCount} yr)`
    );
  } catch {
    return null;
  }
}
async function tryForecast(lat, lng) {
  const url = `${FORECAST_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=precipitation_sum&past_days=92&forecast_days=0&timezone=GMT`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2e4) });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = parseDailyResponse(data);
    if (!parsed) return null;
    const scale = 365.25 / 92;
    const annualSums = parsed.sums.map((s) => s * scale);
    return buildRainfall(
      annualSums,
      1,
      "Open-Meteo live precipitation",
      `recent 92-day record (annualised)`
    );
  } catch {
    return null;
  }
}
function climatologyFallback(lat, lng) {
  const absLat = Math.abs(lat);
  let annual_mm;
  let monthly;
  if (absLat < 15) {
    annual_mm = 1200;
    monthly = [15, 10, 15, 30, 80, 160, 200, 190, 160, 120, 80, 30];
  } else if (absLat < 22) {
    annual_mm = 900;
    monthly = [10, 8, 12, 18, 40, 130, 200, 180, 120, 70, 30, 12];
  } else if (absLat < 28) {
    annual_mm = 700;
    monthly = [20, 15, 12, 8, 20, 65, 190, 200, 100, 30, 10, 15];
  } else {
    annual_mm = 400;
    monthly = [20, 18, 15, 8, 10, 30, 90, 80, 40, 15, 8, 18];
  }
  return {
    provider: "FAO CLIMWAT regional climatology (API unavailable)",
    period: "Long-term average (fallback \u2014 verify with local records)",
    annual_mm,
    monthly: MONTHS.map((month, i) => ({ month, mm: monthly[i] }))
  };
}
async function fetchRainfall(lat, lng) {
  const archive = await tryArchive(lat, lng);
  if (archive && archive.annual_mm > 0) return archive;
  const forecast = await tryForecast(lat, lng);
  if (forecast && forecast.annual_mm > 0) return forecast;
  console.warn(`[rainfall] Both APIs failed for (${lat.toFixed(4)}, ${lng.toFixed(4)}); using climatology fallback.`);
  return climatologyFallback(lat, lng);
}

// backend/lib/geo.ts
var M_PER_DEG_LAT2 = 110574;
var mPerDegLng2 = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
function fmt(n) {
  return n.toLocaleString("en-IN");
}
function pointInPolygon(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat;
    const yj = ring[j].lat;
    const xi = ring[i].lng;
    const xj = ring[j].lng;
    if (yi > p.lat !== yj > p.lat && p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
function ringAreaM22(ring) {
  if (ring.length < 3) return 0;
  const kx = mPerDegLng2(ring[0].lat);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.lng * kx * (b.lat * M_PER_DEG_LAT2) - b.lng * kx * (a.lat * M_PER_DEG_LAT2);
  }
  return Math.abs(sum / 2);
}
function distanceToRingM(p, ring) {
  const kx = mPerDegLng2(p.lat);
  const px = p.lng * kx;
  const py = p.lat * M_PER_DEG_LAT2;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = ring[i].lng * kx;
    const ay = ring[i].lat * M_PER_DEG_LAT2;
    const bx = ring[i + 1].lng * kx;
    const by = ring[i + 1].lat * M_PER_DEG_LAT2;
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

// backend/lib/overpass.ts
var OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.map5.nl/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://github-actions.overpass-api.org/api/interpreter"
];
var OVERPASS_TIMEOUT = 6e4;
var WATER_KINDS = {
  water: "water",
  riverbank: "riverbank",
  pond: "pond",
  reservoir: "reservoir",
  basin: "basin",
  lake: "lake",
  tank: "tank"
};
var WAY_KINDS = {
  river: "river",
  stream: "stream",
  canal: "canal",
  drain: "drain",
  ditch: "ditch"
};
async function runOverpass(query) {
  const attempts = OVERPASS_URLS.map(async (url) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT)
    });
    if (!res.ok) throw new Error(`Overpass (${new URL(url).host}) returned HTTP ${res.status}`);
    const data = await res.json();
    return data.elements ?? [];
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors : [e];
    const last = errs[errs.length - 1];
    throw new Error(
      `OSM water data unavailable: ${last instanceof Error ? last.message : "all Overpass mirrors failed"}`
    );
  }
}
async function fetchOsmContext(center, radiusM) {
  const r = Math.max(300, Math.round(radiusM * 1.05));
  const q = `
    [out:json][timeout:50];
    (
      way["natural"~"^(water|riverbank)$"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
      relation["natural"~"^(water|riverbank)$"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
      way["landuse"="basin"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
      way["waterway"~"^(river|stream|canal|drain|ditch)$"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
      way["building"](around:${r},${center.lat.toFixed(6)},${center.lng.toFixed(6)});
    );
    (._;>;);
    out body;`;
  const elements = await runOverpass(q);
  const waters = [];
  const ways = [];
  const waterRels = /* @__PURE__ */ new Map();
  for (const el of elements) {
    if (el.type === "way" && el.nodes && el.geometry) {
      const path3 = el.geometry.filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lng)).map((g) => ({ lat: g.lat, lng: g.lng }));
      const tags = el.tags ?? {};
      const name = tags["name"] ?? "";
      if (tags["natural"] && WATER_KINDS[tags["natural"]]) {
        waters.push({ name, kind: WATER_KINDS[tags["natural"]], rings: [path3] });
      } else if (tags["landuse"] === "basin") {
        waters.push({ name, kind: "basin", rings: [path3] });
      } else if (tags["waterway"] && WAY_KINDS[tags["waterway"]]) {
        ways.push({ name, kind: WAY_KINDS[tags["waterway"]], path: path3 });
      } else if (tags["highway"]) {
        ways.push({ name, kind: `road:${tags["highway"]}`, path: path3 });
      } else if (tags["building"]) {
        ways.push({ name, kind: "building", path: path3 });
      }
    } else if (el.type === "relation" && el.members && el.tags?.["natural"]) {
      const wayIds = el.members.filter((m) => m.type === "way").map((m) => m.ref);
      waterRels.set(el.id, wayIds);
    }
  }
  const wayById = /* @__PURE__ */ new Map();
  for (const el of elements) {
    if (el.type === "way" && el.geometry) {
      const p = (el.geometry ?? []).map((g) => ({ lat: g.lat, lng: g.lng }));
      if (el.tags === void 0) wayById.set(el.id, { path: p });
      else wayById.set(el.id, { path: p, tags: el.tags });
    }
  }
  for (const [, wayIds] of waterRels) {
    const rings = [];
    for (const wid of wayIds) {
      const w = wayById.get(wid);
      if (w && w.path.length >= 2) rings.push(w.path);
    }
    if (rings.length) {
      waters.push({ name: "", kind: "water", rings });
    }
  }
  return { waters, ways };
}
async function tryFetchOsmContext(center, radiusM) {
  try {
    return await fetchOsmContext(center, radiusM);
  } catch {
    return null;
  }
}
function closeRing(path3) {
  if (path3.length < 3) return [];
  const first = path3[0];
  const last = path3[path3.length - 1];
  if (Math.abs(first.lat - last.lat) > 1e-9 || Math.abs(first.lng - last.lng) > 1e-9) {
    return [...path3, first];
  }
  return path3;
}
function waterRingsForExclusion(waters) {
  const rings = [];
  for (const w of waters) {
    if (w.rings.length === 1) {
      const ring = closeRing(w.rings[0]);
      if (ring.length >= 4) rings.push(ring);
    } else {
      for (const r of w.rings) {
        const closed = closeRing(r);
        if (closed.length >= 4) rings.push(closed);
      }
    }
  }
  return rings;
}
function pointInWater(p, waterRings) {
  return waterRings.some((ring) => pointInPolygon(p, ring));
}

// backend/lib/analyze-circle.ts
var M_PER_DEG_LAT_LOCAL = M_PER_DEG_LAT2;
async function buildCircleDem(center, radiusM, targetCells) {
  const kx = mPerDegLng2(center.lat);
  const widthM = 2 * radiusM / 1;
  const heightM = 2 * radiusM * M_PER_DEG_LAT_LOCAL / M_PER_DEG_LAT_LOCAL;
  let cellM = Math.max(10, 2 * radiusM / targetCells);
  let w = Math.max(8, Math.round(widthM / cellM));
  let h = Math.max(8, Math.round(heightM / cellM));
  while (w * h > 1600) {
    cellM *= 1.25;
    w = Math.max(8, Math.round(widthM / cellM));
    h = Math.max(8, Math.round(heightM / cellM));
  }
  const points = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lat = center.lat + radiusM / M_PER_DEG_LAT_LOCAL - y * 2 * radiusM / (h - 1) / M_PER_DEG_LAT_LOCAL;
      const lng = center.lng - radiusM / kx + x * 2 * radiusM / (w - 1) / kx;
      points.push({ lat, lng });
    }
  }
  const { elevations, source: elevSource } = await fetchElevations(points);
  const elev = new Float32Array(w * h);
  const known = new Uint8Array(w * h);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const z = elevations[i];
    elev[i] = z;
    known[i] = 1;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const distToData = new Int32Array(w * h);
  const dem = {
    w,
    h,
    cell_m: 2 * radiusM / (w - 1),
    minLat: center.lat - radiusM / M_PER_DEG_LAT_LOCAL,
    maxLat: center.lat + radiusM / M_PER_DEG_LAT_LOCAL,
    minLng: center.lng - radiusM / kx,
    maxLng: center.lng + radiusM / kx,
    kx,
    elev,
    known,
    distToData
  };
  return { dem, source: elevSource };
}
function pickCandidates(dem, hydro, intervalHint, opts) {
  const { w, h } = dem;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const scored = [];
  const minCatchCells = opts.minCatchmentArea_m2 / (dem.cell_m * dem.cell_m);
  const maxCatchCells = 6e3 / (dem.cell_m * dem.cell_m);
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const acc = hydro.acc[i];
      if (acc < minCatchCells || acc > maxCatchCells) continue;
      const accScore = bandSizeScore(acc, minCatchCells, maxCatchCells);
      const slopeScore = clamp012(1 - hydro.slope[i] / (opts.maxSlopePct * 1.25));
      const concaveScore = clamp012(-hydro.relief[i] / (Math.max(0.4, intervalHint) * 1.2) + 0.35);
      const score = 0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * 1;
      scored.push({ i, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const minSepCells = Math.max(4, Math.round(Math.min(w, h) / 9));
  const picked = [];
  for (const s of scored) {
    const x = s.i % w;
    const y = s.i / w | 0;
    if (picked.some((p) => Math.hypot(p.i % w - x, (p.i / w | 0) - y) < minSepCells)) continue;
    picked.push(s);
    if (picked.length >= opts.maxCandidates) break;
  }
  return picked;
}
function clamp012(n) {
  return Math.max(0, Math.min(1, n));
}
async function analyzeCircle(center, radiusM, opts = {}) {
  const depth = opts.designDepth_m ?? 3;
  const coeff = opts.runoffCoefficient ?? 0.45;
  const maxSlope = opts.maxSlopePct ?? 8;
  const minCatch = opts.minCatchmentArea_m2 ?? 1e3;
  const wantCandidates = opts.maxCandidates ?? Math.round(Math.min(10, Math.max(5, 5 + (radiusM - 500) / 300)));
  const targetCellM = 20;
  const requested = Math.max(24, Math.ceil(2 * radiusM / targetCellM));
  const gridTarget = Math.min(64, requested);
  const [demRes, rainfallRes, osmRes] = await Promise.allSettled([
    buildCircleDem(center, radiusM, gridTarget),
    fetchRainfall(center.lat, center.lng),
    fetchOsmContext(center, radiusM)
  ]);
  if (demRes.status === "rejected") {
    throw demRes.reason instanceof Error ? demRes.reason : new Error("Terrain data unavailable.");
  }
  if (rainfallRes.status === "rejected") {
    console.warn("[analyze-circle] Rainfall fetch rejected unexpectedly; analysis continues without rainfall data.");
  }
  let osm = null;
  if (osmRes.status === "fulfilled") {
    osm = osmRes.value;
  } else {
    console.error("[analyze-circle] OSM unavailable:", osmRes.reason instanceof Error ? osmRes.reason.message : osmRes.reason);
  }
  const { dem, source: demSource } = demRes.value;
  const hydro = computeHydrology(dem);
  const rainfall = rainfallRes.status === "fulfilled" ? rainfallRes.value : {
    provider: "FAO CLIMWAT regional climatology (API unavailable)",
    period: "Long-term average (fallback)",
    annual_mm: 900,
    monthly: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => ({
      month: m,
      mm: [10, 8, 12, 18, 40, 130, 200, 180, 120, 70, 30, 12][i]
    }))
  };
  const waterRings = osm ? waterRingsForExclusion(osm.waters) : [];
  const buildingRings = [];
  const roadLines = [];
  const waterBodies = [];
  const waterWays = [];
  if (osm) {
    for (const w of osm.ways) {
      if (w.kind === "building" && w.path.length >= 3) buildingRings.push(w.path);
      else if (w.kind.startsWith("road:")) roadLines.push(w.path);
    }
    for (const w of osm.waters) {
      waterBodies.push({
        name: w.name,
        kind: w.kind,
        area_m2: Math.round(w.rings.reduce((s, r) => s + ringAreaM22(r), 0)),
        rings: w.rings
      });
    }
    for (const w of osm.ways) {
      if (w.kind.startsWith("road:") || w.kind === "building") continue;
      waterWays.push({
        name: w.name,
        kind: w.kind,
        length_m: Math.round(polylineLengthM(w.path)),
        path: w.path
      });
    }
  }
  const intervalHint = Math.max(0.4, (hydro.maxElev - hydro.minElev) / 12);
  const picked = pickCandidates(dem, hydro, intervalHint, {
    maxCandidates: wantCandidates * 2,
    // extra pool; exclusions may remove some
    maxSlopePct: maxSlope,
    minCatchmentArea_m2: minCatch
  });
  const cellArea = dem.cell_m * dem.cell_m;
  const minCatchCells = minCatch / cellArea;
  const maxCatchCells = 6e3 / cellArea;
  const candidates = [];
  for (const p of picked) {
    const i = p.i;
    const x = i % dem.w;
    const y = i / dem.w | 0;
    const location = cellToLatLng(dem, x, y);
    if (pointInWater(location, waterRings)) continue;
    const cells = upstreamCells(dem, hydro, i);
    let catchmentArea = cells.length * dem.cell_m * dem.cell_m;
    const maxPlausible = Math.PI * radiusM * radiusM * 1.62;
    if (catchmentArea > maxPlausible) {
      catchmentArea = Math.round(maxPlausible);
    }
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const c of cells) {
      const z = dem.elev[c];
      if (z < cMin) cMin = z;
      if (z > cMax) cMax = z;
    }
    const nearBuilding = buildingRings.some((r) => distanceToRingM(location, r) < 50);
    const nearRoad = roadLines.some((r) => distanceToRingM(location, r) < 30);
    const runoff = Math.round(rainfall.annual_mm / 1e3 * catchmentArea * coeff);
    const pool = pondForCatchment(dem, hydro, i, depth, runoff, cells.length);
    const footprint = maskOutline(dem, pool.cells);
    const footprintArea = pool.cells.length * dem.cell_m * dem.cell_m;
    const storage = Math.round(pool.volume);
    const catchment = maskOutline(dem, cells);
    const accScore = bandSizeScore(hydro.acc[i], minCatchCells, maxCatchCells);
    const slopeScore = clamp012(1 - hydro.slope[i] / (maxSlope * 1.25));
    const concaveScore = clamp012(-hydro.relief[i] / (intervalHint * 1.2) + 0.35);
    const support = "DIRECT";
    const dataScore = 1;
    const factors = [
      {
        key: "flow",
        label: "Flow convergence",
        weight: 0.36,
        value: accScore,
        detail: `${fmt(Math.round(hydro.acc[i]))} upstream cells drain through this point (${fmt(Math.round(catchmentArea))} m\xB2).`
      },
      {
        key: "slope",
        label: "Local slope",
        weight: 0.28,
        value: slopeScore,
        detail: `Slope ${hydro.slope[i].toFixed(2)}% against a ${maxSlope}% ceiling.`
      },
      {
        key: "concavity",
        label: "Natural depression",
        weight: 0.21,
        value: concaveScore,
        detail: `Site sits ${(-hydro.relief[i]).toFixed(2)} m below the neighbourhood mean.`
      },
      {
        key: "support",
        label: "Data support",
        weight: 0.15,
        value: dataScore,
        detail: "Elevation sampled directly from Copernicus DEM at 90 m resolution."
      }
    ];
    const reasons = [];
    const cautions = [];
    if (accScore > 0.6) reasons.push("Sits on a natural flow line where runoff from the upper slopes converges.");
    if (slopeScore > 0.7) reasons.push(`Gentle ${hydro.slope[i].toFixed(1)}% slope keeps excavation volumes low.`);
    if (concaveScore > 0.55) reasons.push("Contours close around the site \u2014 a natural depression.");
    if (storage > runoff * 0.3) reasons.push(`Terrain holds ${fmt(storage)} m\xB3 at ${depth} m depth.`);
    if (nearRoad) reasons.push("Reachable from an existing road \u2014 easy construction access.");
    if (nearBuilding) cautions.push("Within 50 m of a mapped building; check setback rules.");
    if (hydro.slope[i] > maxSlope) cautions.push(`Slope ${hydro.slope[i].toFixed(1)}% exceeds the ${maxSlope}% limit.`);
    if (catchmentArea < minCatch) cautions.push(`Catchment ${fmt(Math.round(catchmentArea))} m\xB2 is below the ${fmt(minCatch)} m\xB2 minimum.`);
    if (runoff < storage * 0.8) cautions.push("Annual runoff may not fill the basin; consider a shallower design depth.");
    const score = Math.round((0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore) * 1e3) / 10;
    const hardFail = hydro.slope[i] > maxSlope || catchmentArea < minCatch;
    const status = hardFail ? "REJECTED" : cautions.length === 0 && score >= 62 ? "RECOMMENDED" : "CONDITIONAL";
    const confidenceValue = clamp012(0.55 * 1 + 0.25 * slopeScore + 0.2 * 0.9);
    const confidence = confidenceValue >= 0.78 ? "HIGH" : confidenceValue >= 0.5 ? "MEDIUM" : "LOW";
    const explanation = status === "REJECTED" ? `Excluded by hard constraints: ${cautions[0] ?? "terrain unsuitable"}` : `Ranked ${candidates.length + 1} with a suitability score of ${score}. ${reasons[0] ?? "Terrain is workable."} The upstream catchment of ${fmt(Math.round(catchmentArea))} m\xB2 yields about ${fmt(runoff)} m\xB3 of runoff a year at ${rainfall.annual_mm} mm rainfall and a ${coeff} runoff coefficient, against a terrain-derived storage of ${fmt(storage)} m\xB3 at ${depth} m depth.${cautions.length ? ` Field team to resolve: ${cautions[0]}` : ""}`;
    candidates.push({
      id: `pond_${candidates.length + 1}`,
      code: `CS-${String(candidates.length + 1).padStart(2, "0")}`,
      rank: candidates.length + 1,
      status,
      confidence,
      score,
      location,
      elevation_m: Number(dem.elev[i].toFixed(2)),
      slope_pct: Number(hydro.slope[i].toFixed(2)),
      localRelief_m: Number(hydro.relief[i].toFixed(2)),
      flowAccumulationCells: Math.round(hydro.acc[i]),
      streamOrderProxy: hydro.order?.[i] ?? 1,
      catchmentArea_m2: Math.round(catchmentArea),
      catchmentRelief_m: Number((cMax - cMin).toFixed(2)),
      catchment,
      pondFootprint: footprint,
      pondFootprint_m2: Math.round(footprintArea),
      storage_m3: storage,
      designDepth_m: depth,
      meanDepth_m: Number((storage / Math.max(1, footprintArea)).toFixed(2)),
      annualRunoff_m3: runoff,
      fillRatio: Number((runoff / Math.max(1, storage)).toFixed(2)),
      edgeTruncated: false,
      demSupport: support,
      factors,
      reasons,
      cautions,
      explanation
    });
  }
  const finalCandidates = candidates.slice(0, wantCandidates);
  const demInfo = {
    source: demSource,
    cellSize_m: Number(dem.cell_m.toFixed(1)),
    columns: dem.w,
    rows: dem.h,
    minElevation_m: Number(hydro.minElev.toFixed(1)),
    maxElevation_m: Number(hydro.maxElev.toFixed(1)),
    meanSlope_pct: Number(hydro.meanSlope.toFixed(2)),
    sinksFilled: hydro.sinksFilled
  };
  const rainfallInfo = {
    provider: rainfall.provider,
    period: rainfall.period,
    annual_mm: rainfall.annual_mm,
    monthly: rainfall.monthly
  };
  const areaHa = Number((Math.PI * radiusM * radiusM / 1e4).toFixed(2));
  return {
    ok: true,
    center,
    radius_m: radiusM,
    areaHa,
    dem: demInfo,
    rainfall: rainfallInfo,
    waterBodies,
    waterWays,
    waterExclusion: {
      applied: osm !== null,
      note: osm ? "Candidates inside mapped OSM water were excluded." : "OSM water data was unreachable; water-body exclusion could not be applied to this result."
    },
    candidates: finalCandidates,
    computedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function polylineLengthM(path3) {
  const kx = mPerDegLng2(path3[0]?.lat ?? 0);
  let total = 0;
  for (let i = 1; i < path3.length; i++) {
    const a = path3[i - 1];
    const b = path3[i];
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * M_PER_DEG_LAT2;
    total += Math.hypot(dx, dy);
  }
  return total;
}

// backend/lib/analyze-contour-wrapper.ts
async function analyzeContourUpload(xml, meta, opts = {}) {
  const base = analyzeContourMap(xml, meta, {
    // Ask the engine for a larger pool, then the radius filter trims it and
    // the count is finally clamped to the radius-based 5–10 band below.
    maxCandidates: 14,
    ...opts.designDepth_m !== void 0 && { designDepth_m: opts.designDepth_m },
    ...opts.runoffCoefficient !== void 0 && { runoffCoefficient: opts.runoffCoefficient },
    ...opts.annualRainfall_mm !== void 0 && { annualRainfall_mm: opts.annualRainfall_mm },
    ...opts.maxSlopePct !== void 0 && { maxSlopePct: opts.maxSlopePct },
    ...opts.minCatchmentArea_m2 !== void 0 && { minCatchmentArea_m2: opts.minCatchmentArea_m2 }
  });
  const demInfo = { ...base.dem, source: `Contour raster: ${base.dem.method}` };
  if (!opts.center || !opts.radiusM) {
    return {
      ...base,
      dem: demInfo,
      radiusFilter: { applied: false, center: null, radius_m: null, candidatesBefore: base.candidates.length, candidatesAfter: base.candidates.length }
    };
  }
  const { center, radiusM } = opts;
  const osm = await tryFetchOsmContext(center, radiusM);
  const waterRings = osm ? waterRingsForExclusion(osm.waters) : [];
  const isInside = (p) => {
    const dxm = (p.lng - center.lng) * 111320 * Math.cos(center.lat * Math.PI / 180);
    const dym = (p.lat - center.lat) * 110574;
    return Math.hypot(dxm, dym) <= radiusM;
  };
  const before = base.candidates.length;
  const kept = [];
  for (const c of base.candidates) {
    if (!isInside(c.location)) continue;
    if (osm && pointInWater(c.location, waterRings)) continue;
    kept.push(c);
  }
  const cap = opts.maxCandidates ?? Math.round(Math.min(10, Math.max(5, 5 + (radiusM - 500) / 300)));
  const finalists = kept.slice(0, cap);
  const candidates = finalists.map((c, i) => ({
    ...c,
    rank: i + 1,
    code: `CS-${String(i + 1).padStart(2, "0")}`,
    id: `pond_${i + 1}`
  }));
  return {
    ...base,
    dem: demInfo,
    candidates,
    radiusFilter: {
      applied: true,
      center,
      radius_m: radiusM,
      candidatesBefore: before,
      candidatesAfter: candidates.length
    },
    waterExclusion: {
      applied: osm !== null,
      note: osm ? "Candidates inside mapped OSM water were excluded." : "OSM water data was unreachable; water-body exclusion could not be applied to this result."
    },
    computedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// backend/lib/history.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var DATA_DIR = path.join(__dirname, "..", "..", "data");
var DB_FILE = path.join(DATA_DIR, "history.json");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readStore() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function writeStore(entries) {
  const trimmed = entries.slice(-50);
  fs.writeFileSync(DB_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
}
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function guessRegion(lat, lng) {
  const regions = [
    { name: "Chhattisgarh, India", minLat: 17.7, maxLat: 24.1, minLng: 80.2, maxLng: 84.4 },
    { name: "Madhya Pradesh, India", minLat: 21, maxLat: 26.9, minLng: 74, maxLng: 82.8 },
    { name: "Maharashtra, India", minLat: 15.6, maxLat: 22.1, minLng: 72.6, maxLng: 80.9 },
    { name: "Odisha, India", minLat: 17.8, maxLat: 22.6, minLng: 81.4, maxLng: 87.5 },
    { name: "Rajasthan, India", minLat: 23, maxLat: 30.2, minLng: 69.5, maxLng: 78.3 },
    { name: "Uttar Pradesh, India", minLat: 23.8, maxLat: 30.4, minLng: 77.1, maxLng: 84.6 },
    { name: "Gujarat, India", minLat: 20.1, maxLat: 24.7, minLng: 68.2, maxLng: 74.5 },
    { name: "Karnataka, India", minLat: 11.6, maxLat: 18.5, minLng: 74, maxLng: 78.6 },
    { name: "Andhra Pradesh, India", minLat: 12.6, maxLat: 19.9, minLng: 77, maxLng: 84.8 },
    { name: "Tamil Nadu, India", minLat: 8.1, maxLat: 13.6, minLng: 76.2, maxLng: 80.3 },
    { name: "Telangana, India", minLat: 15.9, maxLat: 19.9, minLng: 77.2, maxLng: 81.4 },
    { name: "Punjab, India", minLat: 29.5, maxLat: 32.5, minLng: 73.9, maxLng: 76.9 },
    { name: "Haryana, India", minLat: 27.7, maxLat: 30.9, minLng: 74.5, maxLng: 77.6 },
    { name: "Jharkhand, India", minLat: 21.9, maxLat: 25.4, minLng: 83.3, maxLng: 87.9 },
    { name: "West Bengal, India", minLat: 21.5, maxLat: 27.2, minLng: 85.8, maxLng: 89.9 }
  ];
  const match = regions.find(
    (r) => lat >= r.minLat && lat <= r.maxLat && lng >= r.minLng && lng <= r.maxLng
  );
  return match?.name ?? `${lat.toFixed(3)}\xB0N, ${lng.toFixed(3)}\xB0E`;
}
function saveCircleAnalysis(result) {
  const entries = readStore();
  const top = result.candidates[0] ?? null;
  const entry = {
    id: generateId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: "circle",
    region: guessRegion(result.center.lat, result.center.lng),
    center: result.center,
    radiusM: result.radius_m,
    candidateCount: result.candidates.length,
    topScore: top ? top.score : null,
    topStatus: top ? top.status : null,
    rainfall_mm: result.rainfall?.annual_mm ?? null,
    result
  };
  entries.push(entry);
  writeStore(entries);
  return entry;
}
function saveContourAnalysis(result) {
  const entries = readStore();
  const top = result.candidates[0] ?? null;
  const center = result.extent.center;
  const entry = {
    id: generateId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: "contour",
    region: guessRegion(center.lat, center.lng),
    center,
    radiusM: result.radiusFilter.radius_m ?? 0,
    candidateCount: result.candidates.length,
    topScore: top ? top.score : null,
    topStatus: top ? top.status : null,
    rainfall_mm: null,
    result
  };
  entries.push(entry);
  writeStore(entries);
  return entry;
}
function getHistorySummaries() {
  return readStore().map(({ result: _result, ...summary }) => summary).reverse();
}
function getHistoryEntry(id) {
  return readStore().find((e) => e.id === id) ?? null;
}
function deleteHistoryEntry(id) {
  const entries = readStore();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  writeStore(entries);
  return true;
}

// backend/server.ts
var __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
var app = express();
var PORT = Number(process.env["PORT"] || 3001);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".kml") || name.endsWith(".kmz")) return cb(null, true);
    cb(new Error("Only .kml or .kmz files are accepted."));
  }
});
function readKml(file) {
  const lower = file.originalname.toLowerCase();
  if (lower.endsWith(".kmz")) {
    const files = unzipSync(new Uint8Array(file.buffer));
    const entry = Object.entries(files).find(([n]) => n.toLowerCase().endsWith(".kml"));
    if (!entry) throw new Error("The KMZ archive does not contain a KML file.");
    return strFromU8(entry[1]);
  }
  if (file.buffer[0] === 80 && file.buffer[1] === 75) {
    throw new Error("This looks like a KMZ archive but the file extension is not .kmz.");
  }
  return file.buffer.toString("utf-8");
}
function parseNumber(v) {
  if (v === void 0 || v === null || v === "") return void 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : void 0;
}
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "pondsite-api",
    version: "2.0.0",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    features: ["circle-analysis", "contour-analysis", "history", "load-balanced"]
  });
});
app.get("/api/history", (_req, res) => {
  try {
    const summaries = getHistorySummaries();
    res.json({ ok: true, entries: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to read history." });
  }
});
app.get("/api/history/:id", (req, res) => {
  try {
    const entry = getHistoryEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ ok: false, error: "History entry not found." });
      return;
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to read history entry." });
  }
});
app.delete("/api/history/:id", (req, res) => {
  try {
    const deleted = deleteHistoryEntry(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "History entry not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to delete history entry." });
  }
});
app.post("/api/analyze", async (req, res) => {
  try {
    const body = req.body ?? {};
    const lat = parseNumber(body.latitude);
    const lng = parseNumber(body.longitude);
    const radius = parseNumber(body.radius_m);
    if (lat === void 0 || lng === void 0 || radius === void 0) {
      res.status(400).json({ ok: false, error: "latitude, longitude and radius_m are required numbers." });
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ ok: false, error: "Invalid coordinates." });
      return;
    }
    if (radius < 100 || radius > 2e4) {
      res.status(400).json({ ok: false, error: "Radius must be between 100 and 20000 metres." });
      return;
    }
    const center = { lat, lng };
    const maxCandidates = parseNumber(body.maxCandidates);
    const runoffCoefficient = parseNumber(body.runoffCoefficient);
    const designDepth = parseNumber(body.designDepth_m);
    const maxSlope = parseNumber(body.maxSlopePct);
    const minCatch = parseNumber(body.minCatchmentArea_m2);
    const result = await analyzeCircle(center, radius, {
      ...maxCandidates !== void 0 && { maxCandidates },
      ...runoffCoefficient !== void 0 && { runoffCoefficient },
      ...designDepth !== void 0 && { designDepth_m: designDepth },
      ...maxSlope !== void 0 && { maxSlopePct: maxSlope },
      ...minCatch !== void 0 && { minCatchmentArea_m2: minCatch }
    });
    try {
      saveCircleAnalysis(result);
    } catch (histErr) {
      console.warn("[server] Could not save to history:", histErr);
    }
    res.json(result);
  } catch (err) {
    console.error("[analyze] failed:", err);
    const message = err instanceof Error ? err.message : "Analysis failed.";
    res.status(502).json({
      ok: false,
      error: message,
      details: "The analysis uses live Open-Meteo elevation/rainfall and OSM Overpass data \u2014 no fallback results are generated."
    });
  }
});
app.post("/api/analyzeContour", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ ok: false, error: "No file uploaded. Provide a KML/KMZ file in the 'file' field." });
      return;
    }
    let xml;
    try {
      xml = readKml(file);
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Could not read the uploaded file." });
      return;
    }
    const lat = parseNumber(req.body?.latitude);
    const lng = parseNumber(req.body?.longitude);
    const radius = parseNumber(req.body?.radius_m);
    const hasCircle = lat !== void 0 && lng !== void 0 && radius !== void 0;
    if (lat !== void 0 && (lat < -90 || lat > 90)) {
      res.status(400).json({ ok: false, error: "Invalid latitude." });
      return;
    }
    if (lng !== void 0 && (lng < -180 || lng > 180)) {
      res.status(400).json({ ok: false, error: "Invalid longitude." });
      return;
    }
    if (radius !== void 0 && (radius < 100 || radius > 2e4)) {
      res.status(400).json({ ok: false, error: "Radius must be between 100 and 20000 metres." });
      return;
    }
    const maxCandidates = parseNumber(req.body?.maxCandidates);
    const runoffCoefficient = parseNumber(req.body?.runoffCoefficient);
    const designDepth = parseNumber(req.body?.designDepth_m);
    const annualRain = parseNumber(req.body?.annualRainfall_mm);
    const maxSlope = parseNumber(req.body?.maxSlopePct);
    const minCatch = parseNumber(req.body?.minCatchmentArea_m2);
    const centerOpt = hasCircle ? { lat, lng } : null;
    const result = await analyzeContourUpload(
      xml,
      { filename: file.originalname, sizeBytes: file.size, format: file.originalname.toLowerCase().endsWith(".kmz") ? "KMZ" : "KML" },
      {
        ...centerOpt && { center: centerOpt },
        ...radius !== void 0 && { radiusM: radius },
        ...maxCandidates !== void 0 && { maxCandidates },
        ...runoffCoefficient !== void 0 && { runoffCoefficient },
        ...designDepth !== void 0 && { designDepth_m: designDepth },
        ...annualRain !== void 0 && { annualRainfall_mm: annualRain },
        ...maxSlope !== void 0 && { maxSlopePct: maxSlope },
        ...minCatch !== void 0 && { minCatchmentArea_m2: minCatch }
      }
    );
    try {
      saveContourAnalysis(result);
    } catch (histErr) {
      console.warn("[server] Could not save contour analysis to history:", histErr);
    }
    res.json(result);
  } catch (err) {
    console.error("[analyzeContour] failed:", err);
    const message = err instanceof Error ? err.message : "Contour analysis failed.";
    res.status(500).json({ ok: false, error: message });
  }
});
var distDir = path2.join(__dirname2, "..", "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path2.join(distDir, "index.html"));
});
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ ok: false, error: `Upload error: ${err.message}` });
    return;
  }
  console.error("[server] unhandled:", err);
  res.status(500).json({ ok: false, error: "Internal server error", details: err.message });
});
app.listen(PORT, () => {
  console.log(`PondSite API v2 listening on http://localhost:${PORT}`);
  console.log(`  History: GET /api/history`);
});
