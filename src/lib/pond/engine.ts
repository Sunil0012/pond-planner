import { blob, hashSeed, mulberry32, offset, polygonAreaM2 } from "./geo";
import type {
  Candidate,
  Confidence,
  Constraints,
  LandUse,
  RecStatus,
  Study,
  TerrainAnalysis,
  Village,
} from "./types";

const LAND_USES: LandUse[] = ["government_waste", "gram_panchayat", "private_agri", "forest_edge"];
export const LAND_LABEL: Record<LandUse, string> = {
  government_waste: "Government waste land",
  gram_panchayat: "Gram panchayat land",
  private_agri: "Private agricultural",
  forest_edge: "Forest edge / protected",
};
const SOILS = ["Clay loam", "Sandy loam", "Silty clay", "Red lateritic", "Black cotton"];

export function analyseTerrain(village: Village): TerrainAnalysis {
  const t = villageTerrain(village);
  return {
    demSource: village.demDataset,
    resolution_m: Number(t.dem.cell_m.toFixed(1)),
    minElevation_m: Math.round(t.hyd.minElev),
    maxElevation_m: Math.round(t.hyd.maxElev),
    meanSlope_pct: Number(t.hyd.meanSlope.toFixed(2)),
    sinksFilled: t.hyd.sinksFilled,
    contourInterval_m: t.contourInterval_m,
    drainageLines: t.drainage.length,
    gapPct: 0,
  };
}

/**
 * Candidates are the confluences of the terrain's own flow paths — the points
 * where several small channels merge into a larger one. Their number depends on
 * the size of the study area, and their catchments are delineated upstream on
 * the D8 flow grid.
 */
export function generateCandidates(village: Village, terrain: TerrainAnalysis): Candidate[] {
  const t = villageTerrain(village);
  const outlets = candidateOutlets(t);
  const rand = mulberry32(hashSeed(village.id + ":attrs"));
  const out: Candidate[] = [];

  outlets.forEach((cellIndex, i) => {
    const loc = cellLatLng(t, cellIndex);
    const { cells, catchment, catchmentArea_m2 } = outletGeometry(t, cellIndex);
    const parcel = blob(loc, 55 + rand() * 45, 7, rand);
    const computed = Math.round(polygonAreaM2(parcel));
    const errPct = (rand() - 0.4) * 14;
    const official = Math.max(500, Math.round(computed / (1 + errPct / 100)));
    const landUse = LAND_USES[Math.floor(rand() * (rand() > 0.82 ? 4 : 3))]!;
    const edgeTruncated = cells.some((c) => {
      const cx = c % t.dem.w;
      const cy = (c / t.dem.w) | 0;
      return cx <= 1 || cy <= 1 || cx >= t.dem.w - 2 || cy >= t.dem.h - 2;
    });

    out.push({
      id: `${village.id}_c${i + 1}`,
      code: `CS-${String(i + 1).padStart(2, "0")}`,
      location: loc,
      elevation_m: Number(t.dem.elev[cellIndex]!.toFixed(1)),
      slope_pct: Number(t.hyd.slope[cellIndex]!.toFixed(2)),
      flowAccumulation: Math.round(t.hyd.acc[cellIndex]!),
      catchmentArea_m2,
      catchment,
      drainageOrder: Math.max(1, Math.min(4, junctionOrder(t, cellIndex))),
      landUse,
      parcelId: `${village.district.slice(0, 3).toUpperCase()}/${120 + i * 7}/${Math.floor(rand() * 9) + 1}`,
      parcel,
      officialArea_m2: official,
      computedArea_m2: computed,
      distanceToHouse_m: Math.round(25 + rand() * 420),
      distanceToRoad_m: Math.round(60 + rand() * 1300),
      distanceToProtected_m: Math.round(40 + rand() * 1600),
      soil: SOILS[Math.floor(rand() * SOILS.length)]!,
      infiltrationRate: rand() > 0.66 ? "HIGH" : rand() > 0.33 ? "MODERATE" : "LOW",
      edgeTruncated,
      demGapPct: Number((terrain.gapPct * rand()).toFixed(2)),
    });
  });

  return out;
}


export const parcelErrorPct = (c: Candidate) =>
  Math.abs(c.computedArea_m2 - c.officialArea_m2) / c.officialArea_m2 * 100;

export function runoffM3(c: Candidate, annualMm: number, coeff: number) {
  return Math.round((annualMm / 1000) * c.catchmentArea_m2 * coeff);
}

/** Trapezoidal basin envelope. */
export function storageEnvelope(c: Candidate, depth: number) {
  const top = Math.min(c.computedArea_m2, 12000);
  const bottom = top * 0.55;
  const v = (depth / 3) * (bottom + top + Math.sqrt(bottom * top));
  return {
    footprint_m2: Math.round(top),
    bottom_m2: Math.round(bottom),
    depthRange: [Number((depth * 0.8).toFixed(1)), Number((depth * 1.2).toFixed(1))] as [number, number],
    storage_m3: Math.round(v),
    storageRange: [Math.round(v * 0.85), Math.round(v * 1.15)] as [number, number],
    freeboard_m: 0.5,
    sideSlope: "1V : 2H",
  };
}

export interface Factor {
  key: string;
  label: string;
  weight: number;
  value: number; // 0..1
  detail: string;
}

export interface Evaluation {
  candidate: Candidate;
  status: RecStatus;
  score: number;
  confidence: Confidence;
  factors: Factor[];
  penalties: { label: string; points: number }[];
  failures: string[];
  warnings: string[];
  positives: string[];
  runoff_m3: number;
  storage: ReturnType<typeof storageEnvelope>;
  parcelErrorPct: number;
  nextAction: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function evaluate(c: Candidate, k: Constraints, annualMm: number, dataConfidenceBase: number): Evaluation {
  const failures: string[] = [];
  const warnings: string[] = [];
  const positives: string[] = [];

  if (c.slope_pct > k.maxSlopePct)
    failures.push(`Slope ${c.slope_pct}% exceeds the maximum allowed ${k.maxSlopePct}%.`);
  if (c.catchmentArea_m2 < k.minCatchmentArea_m2)
    failures.push(
      `Catchment ${Math.round(c.catchmentArea_m2 / 1000)} k m² is below the minimum ${Math.round(k.minCatchmentArea_m2 / 1000)} k m².`,
    );
  if (c.distanceToHouse_m < k.minDistanceToHouse_m)
    failures.push(`Only ${c.distanceToHouse_m} m from the nearest dwelling (minimum ${k.minDistanceToHouse_m} m).`);
  if (c.distanceToProtected_m < k.minDistanceToProtected_m)
    failures.push(`Within ${c.distanceToProtected_m} m of protected land (minimum ${k.minDistanceToProtected_m} m).`);
  if (!k.allowedLandUse.includes(c.landUse))
    failures.push(`Land use "${LAND_LABEL[c.landUse]}" is excluded by the study configuration.`);

  if (c.distanceToRoad_m > k.maxDistanceToRoad_m)
    warnings.push(`Access road is ${c.distanceToRoad_m} m away, beyond the ${k.maxDistanceToRoad_m} m preference.`);
  const errPct = parcelErrorPct(c);
  if (errPct > k.maxParcelErrorPct)
    warnings.push(
      `Computed parcel area differs from the land record by ${errPct.toFixed(2)}% — manual verification required.`,
    );
  if (c.edgeTruncated) warnings.push("Catchment touches the processing extent and may be truncated.");
  if (c.demGapPct > 1.5) warnings.push(`DEM has ${c.demGapPct}% missing cells inside the catchment.`);
  if (c.infiltrationRate === "HIGH")
    warnings.push(`${c.soil} shows high infiltration; lining or a percolation design may be needed.`);

  const terrainScore = clamp01(1 - c.slope_pct / (k.maxSlopePct * 1.4));
  const catchmentScore = clamp01(c.catchmentArea_m2 / (k.minCatchmentArea_m2 * 3));
  const rainScore = clamp01((annualMm - 300) / 1200);
  const landScore =
    c.landUse === "government_waste" ? 1 : c.landUse === "gram_panchayat" ? 0.85 : c.landUse === "private_agri" ? 0.45 : 0.1;
  const accessScore = clamp01(1 - c.distanceToRoad_m / (k.maxDistanceToRoad_m * 1.6));
  const dataScore = clamp01(
    dataConfidenceBase - c.demGapPct / 10 - (c.edgeTruncated ? 0.15 : 0) - Math.min(0.3, errPct / 40),
  );

  const factors: Factor[] = [
    { key: "terrain", label: "Terrain suitability", weight: 0.25, value: terrainScore, detail: `Slope ${c.slope_pct}% against a ${k.maxSlopePct}% ceiling; elevation ${c.elevation_m} m.` },
    { key: "catchment", label: "Catchment adequacy", weight: 0.2, value: catchmentScore, detail: `${Math.round(c.catchmentArea_m2).toLocaleString("en-IN")} m² upstream, flow accumulation ${c.flowAccumulation} cells (order ${c.drainageOrder}).` },
    { key: "rain", label: "Rainfall / runoff potential", weight: 0.15, value: rainScore, detail: `${Math.round(annualMm)} mm annual rainfall at a ${k.runoffCoefficient} runoff coefficient.` },
    { key: "land", label: "Land availability", weight: 0.2, value: landScore, detail: `${LAND_LABEL[c.landUse]}, parcel ${c.parcelId}, record mismatch ${errPct.toFixed(2)}%.` },
    { key: "access", label: "Accessibility", weight: 0.1, value: accessScore, detail: `${c.distanceToRoad_m} m to the nearest road, ${c.distanceToHouse_m} m to the nearest dwelling.` },
    { key: "data", label: "Data confidence", weight: 0.1, value: dataScore, detail: `DEM gaps ${c.demGapPct}%, ${c.edgeTruncated ? "edge-truncated catchment" : "catchment fully inside extent"}.` },
  ];

  const penalties: { label: string; points: number }[] = [];
  if (errPct > k.maxParcelErrorPct) penalties.push({ label: "Parcel area mismatch", points: 5 });
  if (c.edgeTruncated) penalties.push({ label: "Edge-truncated catchment", points: 4 });
  if (c.distanceToRoad_m > k.maxDistanceToRoad_m) penalties.push({ label: "Access beyond preference", points: 3 });
  if (c.infiltrationRate === "HIGH") penalties.push({ label: "High infiltration soil", points: 3 });

  const weighted = factors.reduce((s, f) => s + f.weight * f.value, 0) * 100;
  const penaltyTotal = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, Math.round((weighted - penaltyTotal) * 10) / 10);

  if (terrainScore > 0.7) positives.push("Gentle slope suited to a shallow excavated basin.");
  if (catchmentScore > 0.6) positives.push("Upstream catchment comfortably exceeds the minimum.");
  if (landScore >= 0.85) positives.push("Public land — no private acquisition expected.");
  if (accessScore > 0.6) positives.push("Reachable by existing road for machinery and desilting.");
  if (errPct <= k.maxParcelErrorPct) positives.push("Computed parcel area agrees with the land record.");

  const confidence: Confidence = dataScore > 0.78 && warnings.length <= 1 ? "HIGH" : dataScore > 0.55 ? "MEDIUM" : "LOW";
  const status: RecStatus =
    failures.length > 0 ? "REJECTED" : warnings.length === 0 && score >= 70 ? "RECOMMENDED" : "CONDITIONAL";

  const nextAction =
    status === "REJECTED"
      ? `Excluded by hard constraints: ${failures[0]}`
      : warnings.length > 0
        ? `Field team to resolve: ${warnings[0]}`
        : "Field team to confirm soil strength and mark the boundary with GPS.";

  return {
    candidate: c,
    status,
    score,
    confidence,
    factors,
    penalties,
    failures,
    warnings,
    positives,
    runoff_m3: runoffM3(c, annualMm, k.runoffCoefficient),
    storage: storageEnvelope(c, k.designDepth_m),
    parcelErrorPct: errPct,
    nextAction,
  };
}

export function evaluateStudy(study: Study): Evaluation[] {
  const annual = study.rainfall?.annual_mm ?? 900;
  const base = study.rainfall ? (study.rainfall.fallback ? 0.72 : 0.92) : 0.6;
  return study.candidates
    .map((c) => evaluate(c, study.constraints, annual, base))
    .sort((a, b) =>
      a.status === b.status
        ? b.score - a.score
        : a.status === "REJECTED"
          ? 1
          : b.status === "REJECTED"
            ? -1
            : b.score - a.score,
    );
}

/** Contour lines traced from the village elevation surface (marching squares). */
export function contourRings(village: Village, _terrain: TerrainAnalysis) {
  void _terrain;
  return villageTerrain(village).contours;
}

/** Drainage network traced downstream on the D8 flow grid. */
export function drainageLines(village: Village) {
  return villageTerrain(village).drainage;
}
