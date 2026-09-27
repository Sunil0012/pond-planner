/**
 * OpenStreetMap context via the Overpass API: existing water bodies,
 * waterways, roads and buildings around a study circle.
 * Used to (a) draw water on the map and (b) hard-exclude pond candidates
 * that fall inside existing water.
 *
 * Mirrors are tried in order. If every mirror is unreachable the caller gets
 * an error (or null from tryFetchOsmContext) — never fabricated water data.
 */

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.map5.nl/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://github-actions.overpass-api.org/api/interpreter",
];

const OVERPASS_TIMEOUT = 60_000;

export interface OsmWater {
  name: string;
  kind: string;
  rings: LatLng[][];
}

export interface OsmWay {
  name: string;
  kind: string;
  path: LatLng[];
}

export interface OsmContext {
  waters: OsmWater[];
  ways: OsmWay[];
}

import type { LatLng } from "./geo.js";
import { pointInPolygon } from "./geo.js";

const WATER_KINDS: Record<string, string> = {
  water: "water",
  riverbank: "riverbank",
  pond: "pond",
  reservoir: "reservoir",
  basin: "basin",
  lake: "lake",
  tank: "tank",
};

const WAY_KINDS: Record<string, string> = {
  river: "river",
  stream: "stream",
  canal: "canal",
  drain: "drain",
  ditch: "ditch",
};

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  members?: { type: string; ref: number; role?: string }[];
  geometry?: { lat: number; lng: number }[];
  lat?: number;
  lon?: number;
}

/**
 * Race all mirrors simultaneously; the first to answer wins. Each mirror gets
 * a short timeout so a hung host can't stall the analysis (sequential trying
 * made requests take minutes when several mirrors were unreachable).
 */
async function runOverpass(query: string): Promise<OverpassElement[]> {
  const attempts = OVERPASS_URLS.map(async (url) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT),
    });
    if (!res.ok) throw new Error(`Overpass (${new URL(url).host}) returned HTTP ${res.status}`);
    const data = (await res.json()) as { elements?: OverpassElement[] };
    return data.elements ?? [];
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors : [e];
    const last = errs[errs.length - 1];
    throw new Error(
      `OSM water data unavailable: ${last instanceof Error ? last.message : "all Overpass mirrors failed"}`,
    );
  }
}

/** Fetch water polygons, waterways and roads within `radius` of the center. */
export async function fetchOsmContext(center: LatLng, radiusM: number): Promise<OsmContext> {
  const r = Math.max(300, Math.round(radiusM * 1.05)); // small buffer for geometry that straddles the edge
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

  const waters: OsmWater[] = [];
  const ways: OsmWay[] = [];
  const waterRels = new Map<number, number[]>(); // relation id -> member way ids

  for (const el of elements) {
    if (el.type === "way" && el.nodes && el.geometry) {
      const path: LatLng[] = el.geometry
        .filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lng))
        .map((g) => ({ lat: g.lat, lng: g.lng }));
      const tags: Record<string, string> = el.tags ?? {};
      const name = tags["name"] ?? "";
      if (tags["natural"] && WATER_KINDS[tags["natural"]!]) {
        waters.push({ name, kind: WATER_KINDS[tags["natural"]!]!, rings: [path] });
      } else if (tags["landuse"] === "basin") {
        waters.push({ name, kind: "basin", rings: [path] });
      } else if (tags["waterway"] && WAY_KINDS[tags["waterway"]!]) {
        ways.push({ name, kind: WAY_KINDS[tags["waterway"]!]!, path });
      } else if (tags["highway"]) {
        ways.push({ name, kind: `road:${tags["highway"]}`, path });
      } else if (tags["building"]) {
        ways.push({ name, kind: "building", path });
      }
    } else if (el.type === "relation" && el.members && el.tags?.["natural"]) {
      const wayIds = el.members.filter((m) => m.type === "way").map((m) => m.ref);
      waterRels.set(el.id, wayIds);
    }
  }

  // Assemble multipolygon relations (outer + inner rings) from member ways.
  const wayById = new Map<number, { path: LatLng[]; tags?: Record<string, string> }>();
  for (const el of elements) {
    if (el.type === "way" && el.geometry) {
      const p = (el.geometry ?? []).map((g) => ({ lat: g.lat, lng: g.lng }));
      if (el.tags === undefined) wayById.set(el.id, { path: p });
      else wayById.set(el.id, { path: p, tags: el.tags });
    }
  }
  for (const [, wayIds] of waterRels) {
    const rings: LatLng[][] = [];
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

/** Like fetchOsmContext but returns null when OSM is unreachable. */
export async function tryFetchOsmContext(center: LatLng, radiusM: number): Promise<OsmContext | null> {
  try {
    return await fetchOsmContext(center, radiusM);
  } catch {
    return null;
  }
}

/** Close a way into a ring if its ends nearly meet. */
function closeRing(path: LatLng[]): LatLng[] {
  if (path.length < 3) return [];
  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (Math.abs(first.lat - last.lat) > 1e-9 || Math.abs(first.lng - last.lng) > 1e-9) {
    return [...path, first];
  }
  return path;
}

/** Water polygons (rings closed) for drawing and exclusion. */
export function waterRingsForExclusion(waters: OsmWater[]): LatLng[][] {
  const rings: LatLng[][] = [];
  for (const w of waters) {
    if (w.rings.length === 1) {
      const ring = closeRing(w.rings[0]!);
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

/** True when the point is inside any existing water polygon. */
export function pointInWater(p: LatLng, waterRings: LatLng[][]): boolean {
  return waterRings.some((ring) => pointInPolygon(p, ring));
}

/** Optional label for drawing water names on the map. */
export function waterLabel(w: OsmWater): string {
  if (w.name) return w.name;
  return w.kind.charAt(0).toUpperCase() + w.kind.slice(1);
}
