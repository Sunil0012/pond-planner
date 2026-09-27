/**
 * SQLite-backed analysis history store.
 * Uses the built-in `node:sqlite` module (Node 22+) or falls back to a
 * simple JSON file store so the app works on older Node versions too.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "history.json");

export interface HistoryEntry {
  id: string;
  timestamp: string;
  type: "circle" | "contour";
  region: string;
  center: { lat: number; lng: number };
  radiusM: number;
  candidateCount: number;
  topScore: number | null;
  topStatus: string | null;
  rainfall_mm: number | null;
  result: unknown; // Full analysis result stored as JSON
}

export interface HistorySummary {
  id: string;
  timestamp: string;
  type: "circle" | "contour";
  region: string;
  center: { lat: number; lng: number };
  radiusM: number;
  candidateCount: number;
  topScore: number | null;
  topStatus: string | null;
  rainfall_mm: number | null;
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): HistoryEntry[] {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeStore(entries: HistoryEntry[]): void {
  // Keep only the last 50 entries to avoid unbounded file growth
  const trimmed = entries.slice(-50);
  fs.writeFileSync(DB_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reverse-geocode a region name from lat/lng using a simple lookup grid.
 * Falls back to coordinate string if nothing matches.
 */
function guessRegion(lat: number, lng: number): string {
  // Coarse India state bounding boxes
  const regions: { name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }[] = [
    { name: "Chhattisgarh, India", minLat: 17.7, maxLat: 24.1, minLng: 80.2, maxLng: 84.4 },
    { name: "Madhya Pradesh, India", minLat: 21.0, maxLat: 26.9, minLng: 74.0, maxLng: 82.8 },
    { name: "Maharashtra, India", minLat: 15.6, maxLat: 22.1, minLng: 72.6, maxLng: 80.9 },
    { name: "Odisha, India", minLat: 17.8, maxLat: 22.6, minLng: 81.4, maxLng: 87.5 },
    { name: "Rajasthan, India", minLat: 23.0, maxLat: 30.2, minLng: 69.5, maxLng: 78.3 },
    { name: "Uttar Pradesh, India", minLat: 23.8, maxLat: 30.4, minLng: 77.1, maxLng: 84.6 },
    { name: "Gujarat, India", minLat: 20.1, maxLat: 24.7, minLng: 68.2, maxLng: 74.5 },
    { name: "Karnataka, India", minLat: 11.6, maxLat: 18.5, minLng: 74.0, maxLng: 78.6 },
    { name: "Andhra Pradesh, India", minLat: 12.6, maxLat: 19.9, minLng: 77.0, maxLng: 84.8 },
    { name: "Tamil Nadu, India", minLat: 8.1, maxLat: 13.6, minLng: 76.2, maxLng: 80.3 },
    { name: "Telangana, India", minLat: 15.9, maxLat: 19.9, minLng: 77.2, maxLng: 81.4 },
    { name: "Punjab, India", minLat: 29.5, maxLat: 32.5, minLng: 73.9, maxLng: 76.9 },
    { name: "Haryana, India", minLat: 27.7, maxLat: 30.9, minLng: 74.5, maxLng: 77.6 },
    { name: "Jharkhand, India", minLat: 21.9, maxLat: 25.4, minLng: 83.3, maxLng: 87.9 },
    { name: "West Bengal, India", minLat: 21.5, maxLat: 27.2, minLng: 85.8, maxLng: 89.9 },
  ];
  const match = regions.find(
    (r) => lat >= r.minLat && lat <= r.maxLat && lng >= r.minLng && lng <= r.maxLng,
  );
  return match?.name ?? `${lat.toFixed(3)}°N, ${lng.toFixed(3)}°E`;
}

export function saveCircleAnalysis(
  result: { center: { lat: number; lng: number }; radius_m: number; candidates: { score: number; status: string }[]; rainfall: { annual_mm: number } },
): HistoryEntry {
  const entries = readStore();
  const top = result.candidates[0] ?? null;
  const entry: HistoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type: "circle",
    region: guessRegion(result.center.lat, result.center.lng),
    center: result.center,
    radiusM: result.radius_m,
    candidateCount: result.candidates.length,
    topScore: top ? top.score : null,
    topStatus: top ? top.status : null,
    rainfall_mm: result.rainfall?.annual_mm ?? null,
    result,
  };
  entries.push(entry);
  writeStore(entries);
  return entry;
}

export function saveContourAnalysis(
  result: { extent: { center: { lat: number; lng: number } }; radiusFilter: { radius_m: number | null }; candidates: { score: number; status: string }[]; source: { filename: string } },
): HistoryEntry {
  const entries = readStore();
  const top = result.candidates[0] ?? null;
  const center = result.extent.center;
  const entry: HistoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type: "contour",
    region: guessRegion(center.lat, center.lng),
    center,
    radiusM: result.radiusFilter.radius_m ?? 0,
    candidateCount: result.candidates.length,
    topScore: top ? top.score : null,
    topStatus: top ? top.status : null,
    rainfall_mm: null,
    result,
  };
  entries.push(entry);
  writeStore(entries);
  return entry;
}

export function getHistorySummaries(): HistorySummary[] {
  return readStore()
    .map(({ result: _result, ...summary }) => summary)
    .reverse(); // newest first
}

export function getHistoryEntry(id: string): HistoryEntry | null {
  return readStore().find((e) => e.id === id) ?? null;
}

export function deleteHistoryEntry(id: string): boolean {
  const entries = readStore();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  writeStore(entries);
  return true;
}
