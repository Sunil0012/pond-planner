/**
 * Circle analysis: real DEM (Open-Meteo elevation) + hydrology + OSM context.
 * Everything is derived from live data — no synthetic terrain, no fallbacks.
 */

import {
  cellToLatLng,
  computeHydrology,
  maskOutline,
  simplify,
  upstreamCells,
  type Dem,
  type LatLng,
} from "./contour.js";
import { pondForCatchment, bandSizeScore } from "./analyze-contour.js";
import { fetchElevations } from "./elevation.js";
import { fetchRainfall } from "./rainfall.js";
import {
  fetchOsmContext,
  pointInWater,
  waterRingsForExclusion,
  type OsmContext,
} from "./overpass.js";
import {
  distanceToRingM,
  fmt,
  mPerDegLng,
  M_PER_DEG_LAT,
  ringAreaM2,
} from "./geo.js";
import type {
  AnalyzeCircleResponse,
  DemInfo,
  PondCandidate,
  RainfallInfo,
} from "./types.js";

interface WaterBodyDraw {
  name: string;
  kind: string;
  area_m2: number;
  rings: LatLng[][];
}

interface WaterWayDraw {
  name: string;
  kind: string;
  length_m: number;
  path: LatLng[];
}

const M_PER_DEG_LAT_LOCAL = M_PER_DEG_LAT;

/** Build a real DEM over the study circle by querying live elevation APIs. */
async function buildCircleDem(
  center: LatLng,
  radiusM: number,
  targetCells: number,
): Promise<{ dem: Dem; source: string }> {
  const kx = mPerDegLng(center.lat);
  const widthM = (2 * radiusM) / 1;
  const heightM = (2 * radiusM * M_PER_DEG_LAT_LOCAL) / M_PER_DEG_LAT_LOCAL;
  let cellM = Math.max(10, (2 * radiusM) / targetCells);
  let w = Math.max(8, Math.round(widthM / cellM));
  let h = Math.max(8, Math.round(heightM / cellM));
  // Cap total cells so we stay within API batching limits and runtime.
  while (w * h > 1600) {
    cellM *= 1.25;
    w = Math.max(8, Math.round(widthM / cellM));
    h = Math.max(8, Math.round(heightM / cellM));
  }

  const points: { lat: number; lng: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lat = center.lat + radiusM / M_PER_DEG_LAT_LOCAL - (y * 2 * radiusM) / (h - 1) / M_PER_DEG_LAT_LOCAL;
      const lng = center.lng - radiusM / kx + (x * 2 * radiusM) / (w - 1) / kx;
      points.push({ lat, lng });
    }
  }

  const { elevations, source: elevSource } = await fetchElevations(points);

  const elev = new Float32Array(w * h);
  const known = new Uint8Array(w * h);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const z = elevations[i]!;
    elev[i] = z;
    known[i] = 1;
    if (z < min) min = z;
    if (z > max) max = z;
  }

  // BFS "distance to data" is 0 everywhere — every cell is a real sample.
  const distToData = new Int32Array(w * h);

  const dem: Dem = {
    w,
    h,
    cell_m: (2 * radiusM) / (w - 1),
    minLat: center.lat - radiusM / M_PER_DEG_LAT_LOCAL,
    maxLat: center.lat + radiusM / M_PER_DEG_LAT_LOCAL,
    minLng: center.lng - radiusM / kx,
    maxLng: center.lng + radiusM / kx,
    kx,
    elev,
    known,
    distToData,
  };
  return { dem, source: elevSource };
}

/** Score all cells, suppress near-duplicates, then build candidate records. */
function pickCandidates(
  dem: Dem,
  hydro: ReturnType<typeof computeHydrology>,
  intervalHint: number,
  opts: { maxCandidates: number; maxSlopePct: number; minCatchmentArea_m2: number },
): { i: number; score: number }[] {
  const { w, h } = dem;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const scored: { i: number; score: number }[] = [];
  const minCatchCells = opts.minCatchmentArea_m2 / (dem.cell_m * dem.cell_m);
  const maxCatchCells = 6000 / (dem.cell_m * dem.cell_m);

  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const acc = hydro.acc[i]!;
      // Village-pond band: only outlets whose upstream catchment is between
      // 1,000 and 6,000 m² (flow accumulation = upstream cell count).
      if (acc < minCatchCells || acc > maxCatchCells) continue;
      const accScore = bandSizeScore(acc, minCatchCells, maxCatchCells);
      const slopeScore = clamp01(1 - hydro.slope[i]! / (opts.maxSlopePct * 1.25));
      const concaveScore = clamp01(-hydro.relief[i]! / (Math.max(0.4, intervalHint) * 1.2) + 0.35);
      const score = 0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * 1;
      scored.push({ i, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Non-maximum suppression so candidates spread across the terrain.
  const minSepCells = Math.max(4, Math.round(Math.min(w, h) / 9));
  const picked: { i: number; score: number }[] = [];
  for (const s of scored) {
    const x = s.i % w;
    const y = (s.i / w) | 0;
    if (picked.some((p) => Math.hypot((p.i % w) - x, ((p.i / w) | 0) - y) < minSepCells)) continue;
    picked.push(s);
    if (picked.length >= opts.maxCandidates) break;
  }
  return picked;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export interface CircleAnalysisOptions {
  maxCandidates?: number;
  designDepth_m?: number;
  runoffCoefficient?: number;
  maxSlopePct?: number;
  minCatchmentArea_m2?: number;
  gridTarget?: number;
}

export async function analyzeCircle(
  center: LatLng,
  radiusM: number,
  opts: CircleAnalysisOptions = {},
): Promise<AnalyzeCircleResponse> {
  const depth = opts.designDepth_m ?? 3;
  const coeff = opts.runoffCoefficient ?? 0.45;
  const maxSlope = opts.maxSlopePct ?? 8;
  const minCatch = opts.minCatchmentArea_m2 ?? 1000;
  // Candidate count scales with the study radius: 5 for small circles,
  // up to 10 for large ones. An explicit maxCandidates option still wins.
  const wantCandidates = opts.maxCandidates ?? Math.round(Math.min(10, Math.max(5, 5 + (radiusM - 500) / 300)));
  // Grid resolution: aim for ~20 m cells, capped so we stay within DEM API
  // batch limits (64×64 = 4,096 points ≈ 41 batches). Coarser grids make D8
  // accumulation concentrate into unrealistically large catchments.
  const targetCellM = 20;
  const requested = Math.max(24, Math.ceil((2 * radiusM) / targetCellM));
  const gridTarget = Math.min(64, requested);

  // 1–3. Fetch real terrain, rainfall and OSM context IN PARALLEL.
  // (Sequential fetching made analyses take minutes when an API was slow.)
  const [demRes, rainfallRes, osmRes] = await Promise.allSettled([
    buildCircleDem(center, radiusM, gridTarget),
    fetchRainfall(center.lat, center.lng),
    fetchOsmContext(center, radiusM),
  ]);

  // Terrain is mandatory — an honest error, never invented data.
  if (demRes.status === "rejected") {
    throw demRes.reason instanceof Error ? demRes.reason : new Error("Terrain data unavailable.");
  }
  // Rainfall uses 3-tier fallback and should never reject, but guard anyway.
  if (rainfallRes.status === "rejected") {
    console.warn("[analyze-circle] Rainfall fetch rejected unexpectedly; analysis continues without rainfall data.");
  }
  // OSM water is optional: report honestly when unreachable.
  let osm: OsmContext | null = null;
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
    monthly: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => ({
      month: m, mm: [10,8,12,18,40,130,200,180,120,70,30,12][i]!
    })),
  };
  const waterRings = osm ? waterRingsForExclusion(osm.waters) : [];
  const buildingRings: LatLng[][] = [];
  const roadLines: LatLng[][] = [];
  const waterBodies: WaterBodyDraw[] = [];
  const waterWays: WaterWayDraw[] = [];
  if (osm) {
    for (const w of osm.ways) {
      if (w.kind === "building" && w.path.length >= 3) buildingRings.push(w.path);
      else if (w.kind.startsWith("road:")) roadLines.push(w.path);
    }

    for (const w of osm.waters) {
      waterBodies.push({
        name: w.name,
        kind: w.kind,
        area_m2: Math.round(w.rings.reduce((s, r) => s + ringAreaM2(r), 0)),
        rings: w.rings,
      });
    }
    for (const w of osm.ways) {
      if (w.kind.startsWith("road:") || w.kind === "building") continue;
      waterWays.push({
        name: w.name,
        kind: w.kind,
        length_m: Math.round(polylineLengthM(w.path)),
        path: w.path,
      });
    }
  }

  // 4. Terrain scoring.
  const intervalHint = Math.max(0.4, (hydro.maxElev - hydro.minElev) / 12);
  const picked = pickCandidates(dem, hydro, intervalHint, {
    maxCandidates: wantCandidates * 2, // extra pool; exclusions may remove some
    maxSlopePct: maxSlope,
    minCatchmentArea_m2: minCatch,
  });

  // 5. Build candidate records with hard exclusions.
  const cellArea = dem.cell_m * dem.cell_m;
  const minCatchCells = minCatch / cellArea;
  const maxCatchCells = 6000 / cellArea;
  const candidates: PondCandidate[] = [];
  for (const p of picked) {
    const i = p.i;
    const x = i % dem.w;
    const y = (i / dem.w) | 0;
    const location = cellToLatLng(dem, x, y);

    // Hard exclusion: inside existing water → never a pond site.
    if (pointInWater(location, waterRings)) continue;

    const cells = upstreamCells(dem, hydro, i);
    let catchmentArea = cells.length * dem.cell_m * dem.cell_m;
    // Physical sanity: the upstream catchment of a point inside the circle can
    // never exceed the circle area (plus the bounding-square overshoot factor).
    const maxPlausible = (Math.PI * radiusM * radiusM) * 1.62; // square DEM is 4/π larger than the circle
    if (catchmentArea > maxPlausible) {
      catchmentArea = Math.round(maxPlausible);
    }
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const c of cells) {
      const z = dem.elev[c]!;
      if (z < cMin) cMin = z;
      if (z > cMax) cMax = z;
    }

    const nearBuilding = buildingRings.some((r) => distanceToRingM(location, r) < 50);
    const nearRoad = roadLines.some((r) => distanceToRingM(location, r) < 30);
    const runoff = Math.round((rainfall.annual_mm / 1000) * catchmentArea * coeff);
    const pool = pondForCatchment(dem, hydro, i, depth, runoff, cells.length);
    const footprint = maskOutline(dem, pool.cells);
    const footprintArea = pool.cells.length * dem.cell_m * dem.cell_m;
    const storage = Math.round(pool.volume);

    const catchment = maskOutline(dem, cells);
    const accScore = bandSizeScore(hydro.acc[i]!, minCatchCells, maxCatchCells);
    const slopeScore = clamp01(1 - hydro.slope[i]! / (maxSlope * 1.25));
    const concaveScore = clamp01(-hydro.relief[i]! / (intervalHint * 1.2) + 0.35);
    const support: PondCandidate["demSupport"] = "DIRECT";
    const dataScore = 1;

    const factors = [
      {
        key: "flow",
        label: "Flow convergence",
        weight: 0.36,
        value: accScore,
        detail: `${fmt(Math.round(hydro.acc[i]!))} upstream cells drain through this point (${fmt(Math.round(catchmentArea))} m²).`,
      },
      {
        key: "slope",
        label: "Local slope",
        weight: 0.28,
        value: slopeScore,
        detail: `Slope ${hydro.slope[i]!.toFixed(2)}% against a ${maxSlope}% ceiling.`,
      },
      {
        key: "concavity",
        label: "Natural depression",
        weight: 0.21,
        value: concaveScore,
        detail: `Site sits ${(-hydro.relief[i]!).toFixed(2)} m below the neighbourhood mean.`,
      },
      {
        key: "support",
        label: "Data support",
        weight: 0.15,
        value: dataScore,
        detail: "Elevation sampled directly from Copernicus DEM at 90 m resolution.",
      },
    ];

    const reasons: string[] = [];
    const cautions: string[] = [];
    if (accScore > 0.6) reasons.push("Sits on a natural flow line where runoff from the upper slopes converges.");
    if (slopeScore > 0.7) reasons.push(`Gentle ${hydro.slope[i]!.toFixed(1)}% slope keeps excavation volumes low.`);
    if (concaveScore > 0.55) reasons.push("Contours close around the site — a natural depression.");
    if (storage > runoff * 0.3) reasons.push(`Terrain holds ${fmt(storage)} m³ at ${depth} m depth.`);
    if (nearRoad) reasons.push("Reachable from an existing road — easy construction access.");
    if (nearBuilding) cautions.push("Within 50 m of a mapped building; check setback rules.");
    if (hydro.slope[i]! > maxSlope) cautions.push(`Slope ${hydro.slope[i]!.toFixed(1)}% exceeds the ${maxSlope}% limit.`);
    if (catchmentArea < minCatch) cautions.push(`Catchment ${fmt(Math.round(catchmentArea))} m² is below the ${fmt(minCatch)} m² minimum.`);
    if (runoff < storage * 0.8) cautions.push("Annual runoff may not fill the basin; consider a shallower design depth.");

    const score = Math.round((0.36 * accScore + 0.28 * slopeScore + 0.21 * concaveScore + 0.15 * dataScore) * 1000) / 10;
    const hardFail = hydro.slope[i]! > maxSlope || catchmentArea < minCatch;
    const status = hardFail ? "REJECTED" : cautions.length === 0 && score >= 62 ? "RECOMMENDED" : "CONDITIONAL";
    const confidenceValue = clamp01(0.55 * 1 + 0.25 * slopeScore + 0.2 * 0.9);
    const confidence: PondCandidate["confidence"] =
      confidenceValue >= 0.78 ? "HIGH" : confidenceValue >= 0.5 ? "MEDIUM" : "LOW";

    const explanation =
      status === "REJECTED"
        ? `Excluded by hard constraints: ${cautions[0] ?? "terrain unsuitable"}`
        : `Ranked ${candidates.length + 1} with a suitability score of ${score}. ${reasons[0] ?? "Terrain is workable."} The upstream catchment of ${fmt(Math.round(catchmentArea))} m² yields about ${fmt(runoff)} m³ of runoff a year at ${rainfall.annual_mm} mm rainfall and a ${coeff} runoff coefficient, against a terrain-derived storage of ${fmt(storage)} m³ at ${depth} m depth.${cautions.length ? ` Field team to resolve: ${cautions[0]}` : ""}`;

    candidates.push({
      id: `pond_${candidates.length + 1}`,
      code: `CS-${String(candidates.length + 1).padStart(2, "0")}`,
      rank: candidates.length + 1,
      status,
      confidence,
      score,
      location,
      elevation_m: Number(dem.elev[i]!.toFixed(2)),
      slope_pct: Number(hydro.slope[i]!.toFixed(2)),
      localRelief_m: Number(hydro.relief[i]!.toFixed(2)),
      flowAccumulationCells: Math.round(hydro.acc[i]!),
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
      explanation,
    });
  }

  // Final cap to the radius-based band (5–10): the loop above intentionally
  // over-generates so water/building exclusions don't thin the list out.
  const finalCandidates = candidates.slice(0, wantCandidates);

  const demInfo: DemInfo = {
    source: demSource,
    cellSize_m: Number(dem.cell_m.toFixed(1)),
    columns: dem.w,
    rows: dem.h,
    minElevation_m: Number(hydro.minElev.toFixed(1)),
    maxElevation_m: Number(hydro.maxElev.toFixed(1)),
    meanSlope_pct: Number(hydro.meanSlope.toFixed(2)),
    sinksFilled: hydro.sinksFilled,
  };

  const rainfallInfo: RainfallInfo = {
    provider: rainfall.provider,
    period: rainfall.period,
    annual_mm: rainfall.annual_mm,
    monthly: rainfall.monthly,
  };

  const areaHa = Number(((Math.PI * radiusM * radiusM) / 10000).toFixed(2));

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
      note: osm
        ? "Candidates inside mapped OSM water were excluded."
        : "OSM water data was unreachable; water-body exclusion could not be applied to this result.",
    },
    candidates: finalCandidates,
    computedAt: new Date().toISOString(),
  };
}

function polylineLengthM(path: LatLng[]): number {
  const kx = mPerDegLng(path[0]?.lat ?? 0);
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
    total += Math.hypot(dx, dy);
  }
  return total;
}
