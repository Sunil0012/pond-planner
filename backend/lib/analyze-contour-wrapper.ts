/**
 * Contour (KML/KMZ) analysis with optional radius filtering and the same
 * hard exclusion of existing water bodies as the circle analysis.
 * Wraps the pure contour engine in `contour.ts`.
 */

import { analyzeContourMap } from "./analyze-contour.js";
import type { ContourAnalysis, PondCandidate } from "./analyze-contour.js";
import { pointInWater, waterRingsForExclusion, tryFetchOsmContext } from "./overpass.js";
import type { LatLng } from "./geo.js";
import { ringAreaM2 } from "./geo.js";
import type { AnalyzeContourResponse } from "./types.js";

export interface ContourAnalysisOptions {
  center?: LatLng;
  radiusM?: number;
  maxCandidates?: number;
  designDepth_m?: number;
  runoffCoefficient?: number;
  annualRainfall_mm?: number;
  maxSlopePct?: number;
  minCatchmentArea_m2?: number;
}

/**
 * Analyze an uploaded contour map. When a study circle is supplied, only
 * candidates inside the circle are kept (water exclusion still applies).
 */
export async function analyzeContourUpload(
  xml: string,
  meta: { filename: string; sizeBytes: number; format: "KML" | "KMZ" },
  opts: ContourAnalysisOptions = {},
): Promise<AnalyzeContourResponse> {
  const base: ContourAnalysis = analyzeContourMap(xml, meta, {
    // Ask the engine for a larger pool, then the radius filter trims it and
    // the count is finally clamped to the radius-based 5–10 band below.
    maxCandidates: 14,
    ...(opts.designDepth_m !== undefined && { designDepth_m: opts.designDepth_m }),
    ...(opts.runoffCoefficient !== undefined && { runoffCoefficient: opts.runoffCoefficient }),
    ...(opts.annualRainfall_mm !== undefined && { annualRainfall_mm: opts.annualRainfall_mm }),
    ...(opts.maxSlopePct !== undefined && { maxSlopePct: opts.maxSlopePct }),
    ...(opts.minCatchmentArea_m2 !== undefined && { minCatchmentArea_m2: opts.minCatchmentArea_m2 }),
  });

  // Normalize the dem block to the shared DemInfo shape.
  const demInfo = { ...base.dem, source: `Contour raster: ${base.dem.method}` };

  // Full-file mode: no circle supplied → return the engine result unchanged.
  if (!opts.center || !opts.radiusM) {
    return {
      ...base,
      dem: demInfo,
      radiusFilter: { applied: false, center: null, radius_m: null, candidatesBefore: base.candidates.length, candidatesAfter: base.candidates.length },
    };
  }

  const { center, radiusM } = opts;

  // OSM water for the exclusion rule. When OSM is unreachable we proceed
  // WITHOUT the water check and say so in `waterExclusion` — we never invent data.
  const osm = await tryFetchOsmContext(center, radiusM);
  const waterRings = osm ? waterRingsForExclusion(osm.waters) : [];

  const isInside = (p: LatLng) => {
    const dxm = (p.lng - center.lng) * 111320 * Math.cos((center.lat * Math.PI) / 180);
    const dym = (p.lat - center.lat) * 110574;
    return Math.hypot(dxm, dym) <= radiusM;
  };

  const before = base.candidates.length;
  const kept: PondCandidate[] = [];
  for (const c of base.candidates) {
    if (!isInside(c.location)) continue;
    if (osm && pointInWater(c.location, waterRings)) continue;
    kept.push(c);
  }
  // Cap at the same radius-based band as the circle analysis (5–10).
  const cap = opts.maxCandidates ?? Math.round(Math.min(10, Math.max(5, 5 + (radiusM - 500) / 300)));
  const finalists = kept.slice(0, cap);
  // Re-rank from 1 after filtering.
  const candidates = finalists.map((c, i) => ({
    ...c,
    rank: i + 1,
    code: `CS-${String(i + 1).padStart(2, "0")}`,
    id: `pond_${i + 1}`,
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
      candidatesAfter: candidates.length,
    },
    waterExclusion: {
      applied: osm !== null,
      note: osm
        ? "Candidates inside mapped OSM water were excluded."
        : "OSM water data was unreachable; water-body exclusion could not be applied to this result.",
    },
    computedAt: new Date().toISOString(),
  };
}

/** Contour lines trimmed to the study circle for map drawing. */
export function clipContoursToRadius(
  lines: { elevation: number; pts: LatLng[] }[],
  center: LatLng,
  radiusM: number,
): { elevation: number; pts: LatLng[] }[] {
  const kx = 111320 * Math.cos((center.lat * Math.PI) / 180);
  return lines
    .map((l) => ({
      elevation: l.elevation,
      pts: l.pts.filter((p) => {
        const dx = (p.lng - center.lng) * kx;
        const dy = (p.lat - center.lat) * 110574;
        return Math.hypot(dx, dy) <= radiusM * 1.02;
      }),
    }))
    .filter((l) => l.pts.length > 1);
}

export type { ContourAnalysis, PondCandidate };
export { ringAreaM2 };
