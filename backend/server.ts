/**
 * PondSite API server.
 *  POST /api/analyze        — circle analysis (real DEM + rainfall + OSM)
 *  POST /api/analyzeContour — KML/KMZ contour-map analysis (radius-filterable)
 *  GET  /api/history        — list of past analyses (summaries)
 *  GET  /api/history/:id    — full result for a past analysis
 *  DELETE /api/history/:id  — delete a history entry
 *  GET  /api/health
 *  Serves the built SPA from dist/ in production.
 */

import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { analyzeCircle } from "./lib/analyze-circle.js";
import { analyzeContourUpload } from "./lib/analyze-contour-wrapper.js";
import { saveCircleAnalysis, saveContourAnalysis, getHistorySummaries, getHistoryEntry, deleteHistoryEntry } from "./lib/history.js";
import type { LatLng } from "./lib/geo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env["PORT"] || 3001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".kml") || name.endsWith(".kmz")) return cb(null, true);
    cb(new Error("Only .kml or .kmz files are accepted."));
  },
});

/** Extract inner KML text from an uploaded KMZ/KML buffer. */
function readKml(file: Express.Multer.File): string {
  const lower = file.originalname.toLowerCase();
  if (lower.endsWith(".kmz")) {
    const files = unzipSync(new Uint8Array(file.buffer));
    const entry = Object.entries(files).find(([n]) => n.toLowerCase().endsWith(".kml"));
    if (!entry) throw new Error("The KMZ archive does not contain a KML file.");
    return strFromU8(entry[1]);
  }
  if (file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) {
    throw new Error("This looks like a KMZ archive but the file extension is not .kmz.");
  }
  return file.buffer.toString("utf-8");
}

function parseNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "pondsite-api",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    features: ["circle-analysis", "contour-analysis", "history", "load-balanced"],
  });
});

// ---- History routes ----

app.get("/api/history", (_req, res) => {
  try {
    const summaries = getHistorySummaries();
    res.json({ ok: true, entries: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to read history." });
  }
});

app.get("/api/history/:id", (req, res) => {
  try {
    const entry = getHistoryEntry(req.params.id!);
    if (!entry) {
      res.status(404).json({ ok: false, error: "History entry not found." });
      return;
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to read history entry." });
  }
});

app.delete("/api/history/:id", (req, res) => {
  try {
    const deleted = deleteHistoryEntry(req.params.id!);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "History entry not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to delete history entry." });
  }
});

interface CircleBody {
  latitude?: unknown;
  longitude?: unknown;
  radius_m?: unknown;
  runoffCoefficient?: unknown;
  maxCandidates?: unknown;
  designDepth_m?: unknown;
  maxSlopePct?: unknown;
  minCatchmentArea_m2?: unknown;
}

app.post("/api/analyze", async (req, res) => {
  try {
    const body = (req.body ?? {}) as CircleBody;
    const lat = parseNumber(body.latitude);
    const lng = parseNumber(body.longitude);
    const radius = parseNumber(body.radius_m);
    if (lat === undefined || lng === undefined || radius === undefined) {
      res.status(400).json({ ok: false, error: "latitude, longitude and radius_m are required numbers." });
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ ok: false, error: "Invalid coordinates." });
      return;
    }
    if (radius < 100 || radius > 20000) {
      res.status(400).json({ ok: false, error: "Radius must be between 100 and 20000 metres." });
      return;
    }
    const center: LatLng = { lat, lng };
    const maxCandidates = parseNumber(body.maxCandidates);
    const runoffCoefficient = parseNumber(body.runoffCoefficient);
    const designDepth = parseNumber(body.designDepth_m);
    const maxSlope = parseNumber(body.maxSlopePct);
    const minCatch = parseNumber(body.minCatchmentArea_m2);
    const result = await analyzeCircle(center, radius, {
      ...(maxCandidates !== undefined && { maxCandidates }),
      ...(runoffCoefficient !== undefined && { runoffCoefficient }),
      ...(designDepth !== undefined && { designDepth_m: designDepth }),
      ...(maxSlope !== undefined && { maxSlopePct: maxSlope }),
      ...(minCatch !== undefined && { minCatchmentArea_m2: minCatch }),
    });

    // Save to history
    try {
      saveCircleAnalysis(result as Parameters<typeof saveCircleAnalysis>[0]);
    } catch (histErr) {
      console.warn("[server] Could not save to history:", histErr);
    }

    res.json(result);
  } catch (err) {
    console.error("[analyze] failed:", err);
    const message = err instanceof Error ? err.message : "Analysis failed.";
    res.status(502).json({
      ok: false,
      error: message,
    });
  }
});

interface ContourBody extends CircleBody {
  latitude?: unknown;
  longitude?: unknown;
  radius_m?: unknown;
}

app.post("/api/analyzeContour", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ ok: false, error: "No file uploaded. Provide a KML/KMZ file in the 'file' field." });
      return;
    }
    let xml: string;
    try {
      xml = readKml(file);
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Could not read the uploaded file." });
      return;
    }

    const lat = parseNumber(req.body?.latitude);
    const lng = parseNumber(req.body?.longitude);
    const radius = parseNumber(req.body?.radius_m);
    const hasCircle = lat !== undefined && lng !== undefined && radius !== undefined;
    if (lat !== undefined && (lat < -90 || lat > 90)) {
      res.status(400).json({ ok: false, error: "Invalid latitude." });
      return;
    }
    if (lng !== undefined && (lng < -180 || lng > 180)) {
      res.status(400).json({ ok: false, error: "Invalid longitude." });
      return;
    }
    if (radius !== undefined && (radius < 100 || radius > 20000)) {
      res.status(400).json({ ok: false, error: "Radius must be between 100 and 20000 metres." });
      return;
    }

    const maxCandidates = parseNumber(req.body?.maxCandidates);
    const runoffCoefficient = parseNumber(req.body?.runoffCoefficient);
    const designDepth = parseNumber(req.body?.designDepth_m);
    const annualRain = parseNumber(req.body?.annualRainfall_mm);
    const maxSlope = parseNumber(req.body?.maxSlopePct);
    const minCatch = parseNumber(req.body?.minCatchmentArea_m2);
    const centerOpt = hasCircle ? { lat: lat!, lng: lng! } : null;
    const result = await analyzeContourUpload(
      xml,
      { filename: file.originalname, sizeBytes: file.size, format: file.originalname.toLowerCase().endsWith(".kmz") ? "KMZ" : "KML" },
      {
        ...(centerOpt && { center: centerOpt }),
        ...(radius !== undefined && { radiusM: radius }),
        ...(maxCandidates !== undefined && { maxCandidates }),
        ...(runoffCoefficient !== undefined && { runoffCoefficient }),
        ...(designDepth !== undefined && { designDepth_m: designDepth }),
        ...(annualRain !== undefined && { annualRainfall_mm: annualRain }),
        ...(maxSlope !== undefined && { maxSlopePct: maxSlope }),
        ...(minCatch !== undefined && { minCatchmentArea_m2: minCatch }),
      },
    );

    // Save to history
    try {
      saveContourAnalysis(result as Parameters<typeof saveContourAnalysis>[0]);
    } catch (histErr) {
      console.warn("[server] Could not save contour analysis to history:", histErr);
    }

    res.json(result);
  } catch (err) {
    console.error("[analyzeContour] failed:", err);
    const message = err instanceof Error ? err.message : "Contour analysis failed.";
    res.status(500).json({ ok: false, error: message });
  }
});

// ---- static SPA serving (production) ----
const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ ok: false, error: `Upload error: ${err.message}` });
    return;
  }
  console.error("[server] unhandled:", err);
  res.status(500).json({ ok: false, error: "Internal server error", details: err.message });
});

app.listen(PORT, () => {
  console.log(`PondSite API v2 listening on http://localhost:${PORT}`);
  console.log(`  History: GET /api/history`);
});
