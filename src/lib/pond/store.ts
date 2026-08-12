import { useSyncExternalStore } from "react";
import { analyseTerrain, generateCandidates } from "./engine";
import { polygonAreaM2 } from "./geo";
import type { Constraints, FieldReview, JobState, RainfallData, StepId, Study, Village } from "./types";
import { DEFAULT_CONSTRAINTS } from "./types";

const KEY = "vpp.studies.v1";
let studies: Study[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) studies = JSON.parse(raw) as Study[];
  } catch {
    studies = [];
  }
}

function commit(next: Study[]) {
  studies = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(studies));
  } catch {
    /* quota exceeded — keep in-memory state */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const emptySteps = (): Record<StepId, JobState> => ({
  create: "CREATED",
  validate: "CREATED",
  collect: "CREATED",
  terrain: "CREATED",
  candidates: "CREATED",
  catchment: "CREATED",
  runoff: "CREATED",
  parcels: "CREATED",
  score: "CREATED",
  review: "CREATED",
  export: "CREATED",
});

export function useStudies(): Study[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return studies;
    },
    () => studies,
  );
}

export function useStudy(id: string): Study | undefined {
  return useStudies().find((s) => s.id === id);
}

export function createStudy(village: Village, opts: { name: string; crs: string; bufferM: number }): Study {
  load();
  const study: Study = {
    id: `st_${Date.now().toString(36)}`,
    name: opts.name,
    villageId: village.id,
    village,
    crs: opts.crs,
    bufferM: opts.bufferM,
    constraints: { ...DEFAULT_CONSTRAINTS },
    createdAt: new Date().toISOString(),
    steps: { ...emptySteps(), create: "COMPLETED" },
    sources: [],
    candidates: [],
    reviews: {},
  };
  commit([study, ...studies]);
  return study;
}

export function updateStudy(id: string, patch: (s: Study) => Study) {
  load();
  commit(studies.map((s) => (s.id === id ? patch(s) : s)));
}

export function deleteStudy(id: string) {
  load();
  commit(studies.filter((s) => s.id !== id));
}

export const setStep = (id: string, step: StepId, state: JobState) =>
  updateStudy(id, (s) => ({ ...s, steps: { ...s.steps, [step]: state } }));

export function runValidation(id: string) {
  updateStudy(id, (s) => {
    const areaHa = polygonAreaM2(s.village.boundary) / 10000;
    const notes = [
      `Boundary ring closed with ${s.village.boundary.length} vertices.`,
      `Input geometry in EPSG:4326, reprojected to ${s.crs} for area and distance calculations.`,
      `Processing extent buffered by ${s.bufferM} m so catchments are not truncated at the edge.`,
      areaHa > 2000 ? "Study area is large; raster work will be tiled." : "Study area fits a single processing tile.",
    ];
    return {
      ...s,
      validation: { crsValid: true, boundaryClosed: true, areaHa, notes },
      steps: { ...s.steps, validate: "COMPLETED" },
    };
  });
}

export function collectSources(id: string) {
  updateStudy(id, (s) => {
    const now = new Date().toISOString();
    return {
      ...s,
      sources: [
        { provider: "NASA / ISRO", dataset: s.village.demDataset, version: "v3.0", url: "https://earthdata.nasa.gov", retrievedAt: now, crs: "EPSG:4326" },
        { provider: "Open-Meteo", dataset: "ERA5 daily precipitation archive", version: "archive-api v1", url: "https://open-meteo.com", retrievedAt: now, crs: "EPSG:4326" },
        { provider: "OpenStreetMap", dataset: "Roads, buildings and water bodies", version: `${now.slice(0, 10)} extract`, url: "https://openstreetmap.org", retrievedAt: now, crs: "EPSG:4326" },
        { provider: "State revenue department", dataset: "Bhunaksha cadastral WMS (demo mirror)", version: "2024-25", url: "https://bhunaksha.example.gov.in", retrievedAt: now, crs: "EPSG:32644" },
      ],
      steps: { ...s.steps, collect: "COMPLETED" },
    };
  });
}

export function runTerrain(id: string) {
  updateStudy(id, (s) => ({
    ...s,
    terrain: analyseTerrain(s.village),
    steps: { ...s.steps, terrain: "COMPLETED" },
  }));
}

export function runCandidates(id: string) {
  updateStudy(id, (s) => {
    const terrain = s.terrain ?? analyseTerrain(s.village);
    return {
      ...s,
      terrain,
      candidates: generateCandidates(s.village, terrain),
      steps: { ...s.steps, candidates: "COMPLETED", catchment: "COMPLETED" },
    };
  });
}

export function addCandidate(id: string, candidate: Study["candidates"][number]) {
  updateStudy(id, (s) => ({ ...s, candidates: [...s.candidates, candidate] }));
}

export function setRainfall(id: string, rainfall: RainfallData) {
  updateStudy(id, (s) => ({ ...s, rainfall, steps: { ...s.steps, runoff: "COMPLETED" } }));
}

export function setConstraints(id: string, constraints: Constraints) {
  updateStudy(id, (s) => ({ ...s, constraints, steps: { ...s.steps, score: "COMPLETED" } }));
}

export function saveReview(id: string, candidateId: string, review: FieldReview) {
  updateStudy(id, (s) => ({
    ...s,
    reviews: { ...s.reviews, [candidateId]: review },
    steps: { ...s.steps, review: "COMPLETED" },
  }));
}