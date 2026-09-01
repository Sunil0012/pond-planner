import type { LatLng, Village } from "./types";

export interface WaterwayLine {
  id: number;
  kind: string;
  name?: string;
  intermittent: boolean;
  path: LatLng[];
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const KINDS = "river|stream|canal|ditch|drain|brook|tidal_channel";

function bboxOf(boundary: LatLng[], padDeg = 0.01) {
  const lats = boundary.map((p) => p.lat);
  const lngs = boundary.map((p) => p.lng);
  return [
    Math.min(...lats) - padDeg,
    Math.min(...lngs) - padDeg,
    Math.max(...lats) + padDeg,
    Math.max(...lngs) + padDeg,
  ] as [number, number, number, number];
}

const memory = new Map<string, WaterwayLine[]>();

/**
 * Real, surveyed water flow paths for the study area, straight from
 * OpenStreetMap via Overpass. Ways are digitised downstream, so the node order
 * is the direction water travels — that is what the map arrows follow.
 */
export async function fetchWaterways(village: Village, signal?: AbortSignal): Promise<WaterwayLine[]> {
  const [s, w, n, e] = bboxOf(village.boundary);
  const key = `osmwater:${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const cached = memory.get(key);
  if (cached) return cached;
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as WaterwayLine[];
        memory.set(key, parsed);
        return parsed;
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  const query = `[out:json][timeout:40];(way["waterway"~"^(${KINDS})$"](${s},${w},${n},${e});way["water"="canal"](${s},${w},${n},${e}););out geom;`;

  let lines: WaterwayLine[] | null = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        elements: {
          id: number;
          tags?: Record<string, string>;
          geometry?: { lat: number; lon: number }[];
        }[];
      };
      lines = (json.elements ?? [])
        .filter((el) => (el.geometry?.length ?? 0) > 1)
        .map((el) => ({
          id: el.id,
          kind: el.tags?.["waterway"] ?? el.tags?.["water"] ?? "stream",
          name: el.tags?.["name"],
          intermittent: el.tags?.["intermittent"] === "yes",
          path: el.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })),
        }));
      break;
    } catch {
      /* try the next mirror */
    }
  }

  if (!lines) throw new Error("OpenStreetMap waterway service unavailable");
  memory.set(key, lines);
  try {
    localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    /* quota — memory cache is enough */
  }
  return lines;
}

export const WATERWAY_STYLE: Record<string, { color: string; weight: number; label: string }> = {
  river: { color: "#1b5fa8", weight: 4, label: "River" },
  stream: { color: "#2f86c9", weight: 2.5, label: "Stream" },
  brook: { color: "#2f86c9", weight: 2.5, label: "Brook" },
  canal: { color: "#0f8a8a", weight: 3, label: "Irrigation canal" },
  ditch: { color: "#57a05a", weight: 1.8, label: "Field ditch" },
  drain: { color: "#8a6b2f", weight: 2.2, label: "Storm-water drain" },
  tidal_channel: { color: "#1b5fa8", weight: 3, label: "Tidal channel" },
};
