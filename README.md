# PondSite — explainable village pond siting

Full-stack app: React (Vite) SPA + Node/Express backend that analyzes real terrain,
rainfall and OSM data to suggest village pond sites inside a study circle, or from an
uploaded KML/KMZ contour map.

## Run it

```bash
npm install
npm run dev          # API on :3001 + Vite dev server on :5173 (proxied /api)
```

Production:

```bash
npm run build        # bundles the SPA to dist/
npm start            # serves API + built SPA on :3001
```

## What it does

**Circle analysis** (`POST /api/analyze` — lat, lng, radius, runoff coefficient):

1. Samples a real DEM over the circle — Copernicus GLO-90 via Open-Meteo, falling back
   to SRTM 30 m via OpenTopoData (both live; the response reports the source used).
2. Fetches real rainfall from the Open-Meteo ERA5 archive (3-year monthly means).
3. Fetches OSM water bodies, waterways, roads and buildings via the Overpass API.
4. Runs sink-fill + D8 flow routing + flow accumulation on the DEM.
5. Ranks candidate pond sites by flow convergence, slope, depression shape and data
   support. Candidates inside mapped OSM water are **hard-excluded**.

**Contour analysis** (`POST /api/analyzeContour` — KML/KMZ upload, optional
lat/lng/radius): parses contour lines from the file, builds a DEM by Laplace
interpolation, and runs the same hydrology. When a circle is supplied, candidates
outside the radius are dropped. Water exclusion applies when OSM is reachable.

## No hardcoded results, no fallbacks

- Every candidate comes from live terrain analysis of the requested area.
- If the elevation or rainfall APIs fail, the API returns an honest error — it never
  invents climatology or synthetic terrain.
- If OSM (Overpass) is unreachable (e.g. blocked by your network), the result carries
  `waterExclusion: { applied: false, note: "…" }` instead of pretending water data exists.
  The water-body layer on the map will also be empty in that case.

## Map

Left panel: Leaflet map with **Street (OSM) / Terrain (OpenTopoMap) / Satellite (Esri)**
base maps, dashed study-radius circle, blue water bodies & waterways, contour lines from
uploaded KML, catchment polygons, and CS-XX candidate chips. Click a chip or polygon for
the full candidate breakdown. Right panel: study inputs, KML upload, JSON export,
rainfall chart and the selected site's scoring factors.

## Layout

```
backend/
  server.ts              Express API + static SPA serving
  lib/
    analyze-circle.ts    circle study pipeline (DEM → hydrology → scoring)
    analyze-contour-wrapper.ts  KML/KMZ pipeline + radius filter + water exclusion
    analyze-contour.ts   pure contour-map engine (parsing, DEM, hydrology, ranking)
    contour.ts           DEM/hydrology primitives (Laplace fill, D8, catchments)
    elevation.ts         live DEM providers (Open-Meteo, OpenTopoData)
    rainfall.ts          Open-Meteo ERA5 archive (no fallback)
    overpass.ts          OSM water/buildings/roads + exclusion helpers
    geo.ts, types.ts     shared geometry + API types
src/                     React SPA (workspace + report pages)
```

`contours_1m.kml` (repo root) is a sample 1 m contour file for testing the upload path.
