export type LandUse = "government_waste" | "gram_panchayat" | "private_agri" | "forest_edge";

export type ConstraintStatus = "PASS" | "REVIEW_REQUIRED" | "REJECTED";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type RecStatus = "RECOMMENDED" | "CONDITIONAL" | "REJECTED";

export type LatLng = { lat: number; lng: number };

export interface Village {
  id: string;
  name: string;
  district: string;
  state: string;
  center: LatLng;
  populationEstimate: number;
  demDataset: string;
  boundary: LatLng[];
}

export interface Candidate {
  id: string;
  code: string;
  location: LatLng;
  elevation_m: number;
  slope_pct: number;
  flowAccumulation: number;
  catchmentArea_m2: number;
  catchment: LatLng[];
  drainageOrder: number;
  landUse: LandUse;
  parcelId: string;
  parcel: LatLng[];
  officialArea_m2: number;
  computedArea_m2: number;
  distanceToHouse_m: number;
  distanceToRoad_m: number;
  distanceToProtected_m: number;
  soil: string;
  infiltrationRate: "LOW" | "MODERATE" | "HIGH";
  edgeTruncated: boolean;
  demGapPct: number;
}

export interface Constraints {
  maxSlopePct: number;
  minCatchmentArea_m2: number;
  minDistanceToHouse_m: number;
  maxDistanceToRoad_m: number;
  minDistanceToProtected_m: number;
  allowedLandUse: LandUse[];
  runoffCoefficient: number;
  maxParcelErrorPct: number;
  designDepth_m: number;
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxSlopePct: 8,
  minCatchmentArea_m2: 40000,
  minDistanceToHouse_m: 60,
  maxDistanceToRoad_m: 900,
  minDistanceToProtected_m: 100,
  allowedLandUse: ["government_waste", "gram_panchayat", "private_agri"],
  runoffCoefficient: 0.45,
  maxParcelErrorPct: 5,
  designDepth_m: 3,
};

export interface RainfallData {
  provider: string;
  period: string;
  annual_mm: number;
  monthly: { month: string; mm: number }[];
  retrievedAt: string;
  cached: boolean;
  fallback: boolean;
  latitude: number;
  longitude: number;
}

export interface FieldReview {
  reviewer: string;
  observations: string;
  photos: { name: string; dataUrl: string }[];
  decision: "APPROVED" | "REJECTED" | "NEEDS_MORE_DATA";
  gps: string;
  reviewedAt: string;
}

export type StepId =
  | "create"
  | "validate"
  | "collect"
  | "terrain"
  | "candidates"
  | "catchment"
  | "runoff"
  | "parcels"
  | "score"
  | "review"
  | "export";

export type JobState = "CREATED" | "RUNNING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";

export interface DataSourceRecord {
  provider: string;
  dataset: string;
  version: string;
  url: string;
  retrievedAt: string;
  crs: string;
}

export interface TerrainAnalysis {
  demSource: string;
  resolution_m: number;
  minElevation_m: number;
  maxElevation_m: number;
  meanSlope_pct: number;
  sinksFilled: number;
  contourInterval_m: number;
  drainageLines: number;
  gapPct: number;
}

export interface Study {
  id: string;
  name: string;
  villageId: string;
  village: Village;
  crs: string;
  bufferM: number;
  constraints: Constraints;
  createdAt: string;
  steps: Record<StepId, JobState>;
  validation?: { crsValid: boolean; boundaryClosed: boolean; areaHa: number; notes: string[] };
  sources: DataSourceRecord[];
  terrain?: TerrainAnalysis;
  candidates: Candidate[];
  rainfall?: RainfallData;
  reviews: Record<string, FieldReview>;
}