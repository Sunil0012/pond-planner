/** Shared frontend types mirroring the backend API responses. */

export interface LatLng {
  lat: number;
  lng: number;
}

export type CandidateStatus = "RECOMMENDED" | "CONDITIONAL" | "REJECTED";

export interface PondCandidate {
  id: string;
  code: string;
  rank: number;
  status: CandidateStatus;
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

export interface RainfallInfo {
  provider: string;
  period: string;
  annual_mm: number;
  monthly: { month: string; mm: number }[];
}

export interface DemInfo {
  source: string;
  cellSize_m: number;
  columns: number;
  rows: number;
  minElevation_m: number;
  maxElevation_m: number;
  meanSlope_pct: number;
  sinksFilled: number;
}

export interface AnalyzeCircleResponse {
  ok: true;
  center: LatLng;
  radius_m: number;
  areaHa: number;
  dem: DemInfo;
  rainfall: RainfallInfo;
  waterBodies: { name: string; kind: string; area_m2: number; rings: LatLng[][] }[];
  waterWays: { name: string; kind: string; length_m: number; path: LatLng[] }[];
  waterExclusion: {
    applied: boolean;
    note: string;
  };
  candidates: PondCandidate[];
  computedAt: string;
}

export interface AnalyzeContourResponse {
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
  extent: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
    center: LatLng;
    areaHa: number;
  };
  radiusFilter: {
    applied: boolean;
    center: LatLng | null;
    radius_m: number | null;
    candidatesBefore: number;
    candidatesAfter: number;
  };
  waterExclusion?: {
    applied: boolean;
    note: string;
  };
  dem: DemInfo;
  assumptions: string[];
  candidates: PondCandidate[];
  drainage: { order: number; path: LatLng[] }[];
  contourLines: { elevation: number; pts: LatLng[] }[];
  computedAt: string;
}
