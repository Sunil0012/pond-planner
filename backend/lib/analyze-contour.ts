/**
 * Turns a parsed contour map into ranked pond recommendations.
 * Everything is derived from the raster produced by the input contours —
 * no coordinates, elevations or results are hard-coded.
 */

import {
  buildDem,
  cellToLatLng,
  computeHydrology,
  maskOutline,
  parseKmlContours,
  ringAreaM2,
  simplify,
  upstreamCells,
  type Dem,
  type Hydrology,
  type LatLng,
} from "./contour.js";

export interface AnalyzeOptions {
  maxCandidates?: number;
  designDepth_m?: number;
  runoffCoefficient?: number;
  annualRainfall_mm?: number;
  maxSlopePct?: number;
  minCatchmentArea_m2?: number;
  gridTarget?: number;
}

export interface PondCandidate {
  id: string;
  code: string;
  rank: number;
  status: "RECOMMENDED" | "CONDITIONAL" | "REJECTED";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  location: LatLng;
  elevation_m: number;
  slope_pct: number;
  localRelief_m: number;
  flowAccumulationCells: number;
  streamOrderProxy: number;
  catchmentArea_m2: number;
  catchmentRelief_m: number;
  catchment: LatLng[];
  pondFootprint: LatLng[];
  pondFootprint_m2: number;
  storage_m3: number;
  designDepth_m: number;
  meanDepth_m: number;
  annualRunoff_m3: number;
  fillRatio: number;
  edgeTruncated: boolean;
  demSupport: "DIRECT" | "INTERPOLATED" | "EXTRAPOLATED";
  factors: { key: string; label: string; weight: number; value: number; detail: string }[];
  reasons: string[];
  cautions: string[];
  explanation: string;
}

export interface ContourAnalysis {
  ok: true;
  source: { filename: string; sizeBytes: number; format: "KML" | "KMZ" };
  contours: {
    lines: number;
    vertices: number;
    interval_m: number;
    minElevation_m: number;
    maxElevation_m: number;
    levels: number[];
  };
  extent: { minLat: number; minLng: number; maxLat: number; maxLng: number; center: LatLng; areaHa: number };
  dem: {
    method: string;
    cellSize_m: number;
    columns: number;
    rows: number;
    coveragePct: number;
    sinksFilled: number;
    meanSlope_pct: number;
    minElevation_m: number;
    maxElevation_m: number;
    crs: string;
  };
  assumptions: string[];
  candidates: PondCandidate[];
  drainage: { order: number; path: LatLng[] }[];
  contourLines: { elevation: number; pts: LatLng[] }[];
  computedAt: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Size score within the village-pond catchment band (1,000–6,000 m²).
 * Peaks at mid-band (~3,500 m²) so most sites land near the requested average
 * while every outlet inside the band stays eligible.
 */
export function bandSizeScore(accCells: number, minCells: number, maxCells: number): number {
  const pos = clamp01((accCells - minCells) / Math.max(1e-9, maxCells - minCells));
  return clamp01(0.4 + 0.6 * (1 - Math.abs(pos - 0.5) * 2));
}

function medianInterval(levels: number[]) {
  const diffs: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    const d = Math.round((levels[i]! - levels[i - 1]!) * 1000) / 1000;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

/** Depression / pond footprint around a cell, flooded to `depth` above the site. */
function pondPool(dem: Dem, hyd: Hydrology, outlet: number, depth: number, maxCells: number) {
  const level = hyd.filled[outlet]! + depth;
  const { w, h } = dem;
  const visited = new Uint8Array(w * h);
  const cells: number[] = [];
  const stack = [outlet];
  visited[outlet] = 1;
  let volume = 0;
  while (stack.length && cells.length < maxCells) {
    const i = stack.pop()!;
    const z = dem.elev[i]!;
    if (z > level) continue;
    cells.push(i);
    volume += (level - z) * dem.cell_m * dem.cell_m;
    const x = i % w;
    const y = (i / w) | 0;
    const push = (nx: number, ny: number) => {
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

/**
 * Flood the pool in concentric rings around the outlet until either the pool
 * holds at least `targetFillRatio × annualRunoff` or we hit the hard cap on
 * pool area. This replaces the old "cap at 12% of catchment" heuristic, which
 * made every site look the same regardless of how much water it had to store.
 */
export function pondForCatchment(
  dem: Dem,
  hyd: Hydrology,
  outlet: number,
  depth: number,
  annualRunoff: number,
  catchmentCells: number,
) {
  // Pool is bounded relative to the catchment so a small village-pond
  // catchment can't produce a huge footprint.
  const minCells = Math.max(3, Math.round(catchmentCells * 0.15));
  const maxCells = Math.max(minCells, Math.min(30000, Math.round(catchmentCells * 0.4)));
  const targetVolume = Math.max(1, annualRunoff) * 0.6; // 60% fill is "viable"
  // Step 1: try a small pool; if it already holds the target, stop early.
  let best = pondPool(dem, hyd, outlet, depth, minCells);
  if (best.volume >= targetVolume) return best;
  // Step 2: expand in concentric batches until we either hit the cap or the
  // pool starts to spill over (volume plateaus or drops).
  let prevVolume = best.volume;
  let prevCells = best.cells.length;
  for (let next = minCells * 4; next <= maxCells; next = Math.round(next * 1.7)) {
    const candidate = pondPool(dem, hyd, outlet, depth, next);
    if (candidate.volume >= targetVolume) return candidate;
    // Diminishing returns: stop if the volume barely grew over the last step.
    if (candidate.volume - prevVolume < prevVolume * 0.05 && candidate.cells.length - prevCells > 50) {
      return best;
    }
    best = candidate;
    prevVolume = best.volume;
    prevCells = best.cells.length;
  }
  return best;
}

function extractDrainage(dem: Dem, hyd: Hydrology, threshold: number, limit = 60) {
  const { w, h } = dem;
  const n = w * h;
  const stream = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (hyd.acc[i]! >= threshold) stream[i] = 1;

  const inflow = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!stream[i]) continue;
    const k = hyd.dir[i]!;
    if (k < 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const nx = x + (k === 0 || k === 1 || k === 7 ? 1 : k === 3 || k === 4 || k === 5 ? -1 : 0);
    const ny = y + (k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (stream[ny * w + nx]) inflow[ny * w + nx]!++;
  }

  const paths: { order: number; path: LatLng[] }[] = [];
  const visited = new Uint8Array(n);
  const heads: number[] = [];
  for (let i = 0; i < n; i++) if (stream[i] && inflow[i] === 0) heads.push(i);
  heads.sort((a, b) => hyd.acc[b]! - hyd.acc[a]!);

  for (const head of heads.slice(0, limit)) {
    let i = head;
    const pts: LatLng[] = [];
    let maxAcc = 0;
    let guard = 0;
    while (guard++ < n) {
      pts.push(cellToLatLng(dem, i % w, (i / w) | 0));
      maxAcc = Math.max(maxAcc, hyd.acc[i]!);
      if (visited[i] && pts.length > 2) break;
      visited[i] = 1;
      const k = hyd.dir[i]!;
      if (k < 0) break;
      const x = i % w;
      const y = (i / w) | 0;
      const nx = x + (k === 0 || k === 1 || k === 7 ? 1 : k === 3 || k === 4 || k === 5 ? -1 : 0);
      const ny = y + (k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
      i = ny * w + nx;
      if (!stream[i]) break;
    }
    if (pts.length > 3)
      paths.push({
        order: maxAcc > threshold * 12 ? 3 : maxAcc > threshold * 4 ? 2 : 1,
        path: simplify(pts, dem.cell_m * 0.8),
      });
  }
  return paths;
}

export function analyzeContourMap(
  xml: string,
  meta: { filename: string; sizeBytes: number; format: "KML" | "KMZ" },
  opts: AnalyzeOptions = {},
): ContourAnalysis {
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

  const minCatchCells = (opts.minCatchmentArea_m2 ?? 1000) / cellArea;
  const maxCatchCells = 6000 / cellArea;

  // ---- score every interior cell as a potential pond site
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const scored: { i: number; score: number }[] = [];
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const acc = hyd.acc[i]!;
      // Village-pond band: only outlets whose upstream catchment is between
      // 1,000 and 6,000 m² (flow accumulation = upstream cell count).
      if (acc < minCatchCells || acc > maxCatchCells) continue;
      const accScore = bandSizeScore(acc, minCatchCells, maxCatchCells);
      const slopeScore = clamp01(1 - hyd.slope[i]! / (maxSlope * 1.25));
      const concaveScore = clamp01(-hyd.relief[i]! / (Math.max(0.4, interval || 1) * 1.2) + 0.35);
      const dataScore = clamp01(1 - dem.distToData[i]! / 10);
      const score = 0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore;
      scored.push({ i, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // ---- non-maximum suppression so sites are spread across the terrain
  const minSepCells = Math.max(4, Math.round(Math.min(w, h) / 9));
  const picked: { i: number; score: number }[] = [];
  for (const s of scored) {
    const x = s.i % w;
    const y = (s.i / w) | 0;
    if (picked.some((p) => Math.hypot((p.i % w) - x, ((p.i / w) | 0) - y) < minSepCells)) continue;
    picked.push(s);
    if (picked.length >= wantCandidates) break;
  }

  const candidates: PondCandidate[] = picked.map((p, idx) => {
    const i = p.i;
    const x = i % w;
    const y = (i / w) | 0;
    const location = cellToLatLng(dem, x, y);
    const cells = upstreamCells(dem, hyd, i);
    const catchmentArea = cells.length * cellArea;
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const c of cells) {
      const z = dem.elev[c]!;
      if (z < cMin) cMin = z;
      if (z > cMax) cMax = z;
    }
    const catchment = maskOutline(dem, cells);
    const runoff = Math.round((rain / 1000) * catchmentArea * coeff);
    const pool = pondForCatchment(dem, hyd, i, depth, runoff, cells.length);
    const footprint = maskOutline(dem, pool.cells);
    const footprintArea = pool.cells.length * cellArea;
    const storage = Math.round(pool.volume);
    const meanDepth = storage / Math.max(1, footprintArea);

    const edgeTruncated = cells.some((c) => {
      const cx = c % w;
      const cy = (c / w) | 0;
      return cx <= 1 || cy <= 1 || cx >= w - 2 || cy >= h - 2;
    });
    const support = dem.distToData[i]! <= 1 ? "DIRECT" : dem.distToData[i]! <= 6 ? "INTERPOLATED" : "EXTRAPOLATED";
    const strahler = Math.max(1, Math.min(8, hyd.order[i] ?? 1));

    const accScore = bandSizeScore(hyd.acc[i]!, minCatchCells, maxCatchCells);
    const slopeScore = clamp01(1 - hyd.slope[i]! / (maxSlope * 1.25));
    const concaveScore = clamp01(-hyd.relief[i]! / (Math.max(0.4, interval || 1) * 1.2) + 0.35);
    const dataScore = clamp01(1 - dem.distToData[i]! / 10);
    const storageScore = clamp01(storage / Math.max(1, runoff * 0.35));

    const factors = [
      {
        key: "flow",
        label: "Flow convergence",
        weight: 0.36,
        value: accScore,
        detail: `Upstream catchment of ${Math.round(catchmentArea).toLocaleString("en-IN")} m² — inside the 1,000–6,000 m² village-pond band.`,
      },
      {
        key: "slope",
        label: "Local slope",
        weight: 0.28,
        value: slopeScore,
        detail: `Contour-derived slope ${hyd.slope[i]!.toFixed(2)}% against a ${maxSlope}% ceiling.`,
      },
      {
        key: "concavity",
        label: "Natural depression",
        weight: 0.21,
        value: concaveScore,
        detail: `Site sits ${(-hyd.relief[i]!).toFixed(2)} m below the surrounding ${(dem.cell_m * 7).toFixed(0)} m neighbourhood.`,
      },
      {
        key: "support",
        label: "Contour support",
        weight: 0.15,
        value: dataScore,
        detail: `${(dem.distToData[i]! * dem.cell_m).toFixed(0)} m from the nearest mapped contour line (${support.toLowerCase()}).`,
      },
    ];

    const reasons: string[] = [];
    const cautions: string[] = [];
    if (accScore > 0.6) reasons.push("Sits on a natural flow line where runoff from the upper slopes converges.");
    if (slopeScore > 0.7) reasons.push(`Gentle ${hyd.slope[i]!.toFixed(1)}% slope keeps excavation and embankment volumes low.`);
    if (concaveScore > 0.55) reasons.push("Contours close around the site, so it is already a natural depression.");
    if (storageScore > 0.6)
      reasons.push(`Terrain holds ${storage.toLocaleString("en-IN")} m³ at ${depth} m depth without a large bund.`);
    if (support === "DIRECT") reasons.push("Elevation is read directly from a mapped contour, not interpolated.");

    if (hyd.slope[i]! > maxSlope) cautions.push(`Slope ${hyd.slope[i]!.toFixed(1)}% exceeds the ${maxSlope}% limit.`);
    if (catchmentArea < (opts.minCatchmentArea_m2 ?? 1000))
      cautions.push(`Catchment ${Math.round(catchmentArea).toLocaleString("en-IN")} m² is below the configured minimum.`);
    if (edgeTruncated) cautions.push("Catchment reaches the edge of the contour sheet and may be truncated.");
    if (support === "EXTRAPOLATED") cautions.push("Elevation here is extrapolated — no contour line nearby.");
    if (runoff < storage * 0.8)
      cautions.push("Estimated annual runoff may not fill the basin; consider a shallower design depth.");

    const score = Math.round(
      (0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore) * 1000,
    ) / 10;
    const hardFail = hyd.slope[i]! > maxSlope || catchmentArea < (opts.minCatchmentArea_m2 ?? 1000);
    const status = hardFail ? "REJECTED" : cautions.length === 0 && score >= 62 ? "RECOMMENDED" : "CONDITIONAL";
    // Confidence is real evidence: data support + slope plausibility + edge
    // truncation, not just one ternary.
    const supportScore = support === "DIRECT" ? 1 : support === "INTERPOLATED" ? 0.6 : 0.25;
    const confidenceValue = clamp01(
      0.55 * supportScore + 0.25 * slopeScore + 0.20 * (edgeTruncated ? 0.3 : 0.9),
    );
    const confidence: "HIGH" | "MEDIUM" | "LOW" =
      confidenceValue >= 0.78 ? "HIGH" : confidenceValue >= 0.5 ? "MEDIUM" : "LOW";

    const explanation =
      status === "REJECTED"
        ? `Excluded by the hard constraints: ${cautions[0]}`
        : `Ranked ${idx + 1} with a suitability score of ${score}. ${reasons[0] ?? "Terrain is workable."} The upstream catchment of ${Math.round(catchmentArea).toLocaleString("en-IN")} m² yields about ${runoff.toLocaleString("en-IN")} m³ of runoff a year at ${rain} mm rainfall and a ${coeff} runoff coefficient, against a terrain-derived storage of ${storage.toLocaleString("en-IN")} m³ at ${depth} m depth.${cautions.length ? ` Field team to resolve: ${cautions[0]}` : ""}`;

    return {
      id: `pond_${idx + 1}`,
      code: `CS-${String(idx + 1).padStart(2, "0")}`,
      rank: idx + 1,
      status,
      confidence,
      score,
      location,
      elevation_m: Number(dem.elev[i]!.toFixed(2)),
      slope_pct: Number(hyd.slope[i]!.toFixed(2)),
      localRelief_m: Number(hyd.relief[i]!.toFixed(2)),
      flowAccumulationCells: Math.round(hyd.acc[i]!),
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
      explanation,
    };
  });

  const drainage = extractDrainage(dem, hyd, Math.max(12, minCatchCells * 0.35));

  // Contour lines for display: keep every line but simplify heavily.
  const displayLines = parsed.lines
    .filter((l) => l.pts.length > 2)
    .map((l) => ({ elevation: l.elevation, pts: simplify(l.pts, dem.cell_m * 0.7) }))
    .filter((l) => l.pts.length > 1)
    .slice(0, 2500);

  let knownCells = 0;
  for (let i = 0; i < n; i++) if (dem.known[i]) knownCells++;

  const extentRing: LatLng[] = [
    { lat: dem.maxLat, lng: dem.minLng },
    { lat: dem.maxLat, lng: dem.maxLng },
    { lat: dem.minLat, lng: dem.maxLng },
    { lat: dem.minLat, lng: dem.minLng },
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
      levels,
    },
    extent: {
      minLat: dem.minLat,
      minLng: dem.minLng,
      maxLat: dem.maxLat,
      maxLng: dem.maxLng,
      center: { lat: (dem.minLat + dem.maxLat) / 2, lng: (dem.minLng + dem.maxLng) / 2 },
      areaHa: Number((ringAreaM2(extentRing) / 10000).toFixed(2)),
    },
    dem: {
      method: "Laplace interpolation between contour lines, Planchon–Darboux sink fill, D8 flow routing",
      cellSize_m: Number(dem.cell_m.toFixed(2)),
      columns: w,
      rows: h,
      coveragePct: Number(((knownCells / n) * 100).toFixed(2)),
      sinksFilled: hyd.sinksFilled,
      meanSlope_pct: Number(hyd.meanSlope.toFixed(2)),
      minElevation_m: Number(hyd.minElev.toFixed(2)),
      maxElevation_m: Number(hyd.maxElev.toFixed(2)),
      crs: "EPSG:4326 input, local metric plane for analysis",
    },
    assumptions: [
      `Runoff coefficient ${coeff} applied uniformly; annual rainfall ${rain} mm.`,
      `Design depth ${depth} m with storage integrated from the interpolated surface.`,
      "Elevations between contour lines are interpolated, not surveyed.",
      "Land ownership, soil strength and utilities are not represented in a contour map and must be verified in the field.",
    ],
    candidates,
    drainage,
    contourLines: displayLines,
    computedAt: new Date().toISOString(),
  };
}
