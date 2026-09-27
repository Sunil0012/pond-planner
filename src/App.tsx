import { useCallback, useEffect, useState } from "react";
import type { AnalyzeCircleResponse, AnalyzeContourResponse, PondCandidate } from "./lib/types";
import { Workspace } from "./pages/Workspace";
import { Report } from "./pages/Report";
import { History } from "./pages/History";

export default function App() {
  // ── Circle analysis — fully independent ──────────────────────────────────
  const [center, setCenter] = useState({ lat: 21.2591, lng: 81.300216 });
  const [radiusM, setRadiusM] = useState(500);
  const [result, setResult] = useState<AnalyzeCircleResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [circleError, setCircleError] = useState<string | null>(null);

  // ── KML contour analysis — fully independent ─────────────────────────────
  const [contour, setContour] = useState<AnalyzeContourResponse | null>(null);
  const [contourBusy, setContourBusy] = useState(false);
  const [contourError, setContourError] = useState<string | null>(null);
  const [kmlCenter, setKmlCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [kmlRadius, setKmlRadius] = useState<number>(1000);

  // ── Shared UI state ───────────────────────────────────────────────────────
  const [selectedCircle, setSelectedCircle] = useState<PondCandidate | null>(null);
  const [selectedKml, setSelectedKml] = useState<PondCandidate | null>(null);
  const [view, setView] = useState<"workspace" | "report" | "history">("workspace");
  const [apiOnline, setApiOnline] = useState(true);

  const RUNOFF_COEFFICIENT = 0.45;

  // ── Health check ──────────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setApiOnline(res.ok);
    } catch {
      setApiOnline(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 30_000);
    return () => clearInterval(t);
  }, [checkHealth]);

  // ── Circle analysis — uses lat/lng/radius, nothing else ───────────────────
  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setCircleError(null);
    setSelectedCircle(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: center.lat,
          longitude: center.lng,
          radius_m: radiusM,
          runoffCoefficient: RUNOFF_COEFFICIENT,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setApiOnline(true);
    } catch (e) {
      setCircleError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }, [center, radiusM]);

  // ── KML analysis — uses ONLY the uploaded file, no radius, no coords ──────
  const analyzeContour = useCallback(async (file: File) => {
    setContourBusy(true);
    setContourError(null);
    setSelectedKml(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Intentionally NO latitude / longitude / radius_m — full KML extent only
      const res = await fetch("/api/analyzeContour", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setContour(data);
      setApiOnline(true);
      // Set the KML map centre from the file's own geographic extent
      if (data.extent?.center) {
        setKmlCenter(data.extent.center);
        const ext = data.extent;
        const latSpanM = Math.abs(ext.maxLat - ext.minLat) * 110_574;
        const lngSpanM =
          Math.abs(ext.maxLng - ext.minLng) *
          111_320 *
          Math.cos((ext.center.lat * Math.PI) / 180);
        setKmlRadius(Math.max(200, Math.round(Math.max(latSpanM, lngSpanM) / 2)));
      }
    } catch (e) {
      setContourError(e instanceof Error ? e.message : "Contour analysis failed");
    } finally {
      setContourBusy(false);
    }
  }, []);

  const navItems: { key: typeof view; label: string; icon: string }[] = [
    { key: "workspace", label: "Study workspace", icon: "🗺" },
    { key: "report", label: "Report", icon: "📋" },
    { key: "history", label: "History", icon: "🕐" },
  ];

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#22301f]">
      <header className="flex items-center justify-between border-b border-[#e2ddd0] bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#0f766e]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" />
          </span>
          <span className="text-xl" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
            PondSite
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`flex items-center gap-1.5 transition ${
                view === item.key
                  ? "font-semibold text-[#0f766e]"
                  : "text-[#4a5548] hover:text-[#0f766e]"
              }`}
              onClick={() => setView(item.key)}
            >
              <span>{item.icon}</span>
              {item.label}
              {item.key === "history" && (
                <span className="rounded-full bg-[#e7f2ef] px-1.5 py-0.5 text-[10px] font-semibold text-[#0f766e]">
                  DB
                </span>
              )}
            </button>
          ))}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              apiOnline ? "bg-[#e7f2ef] text-[#0f766e]" : "bg-[#fbeeed] text-[#b3453b]"
            }`}
          >
            {apiOnline ? "● API online" : "● API offline"}
          </span>
        </div>
      </header>

      {view === "workspace" && (
        <Workspace
          // Circle analysis props
          center={center}
          setCenter={setCenter}
          radiusM={radiusM}
          setRadiusM={setRadiusM}
          result={result}
          running={running}
          circleError={circleError}
          selectedCircle={selectedCircle}
          setSelectedCircle={setSelectedCircle}
          onRun={runAnalysis}
          // KML analysis props — completely separate
          contour={contour}
          contourBusy={contourBusy}
          contourError={contourError}
          kmlCenter={kmlCenter}
          kmlRadius={kmlRadius}
          selectedKml={selectedKml}
          setSelectedKml={setSelectedKml}
          onContour={analyzeContour}
          onCheckHealth={checkHealth}
        />
      )}
      {view === "report" && (
        <Report
          result={result}
          contour={contour}
          center={center}
          radiusM={radiusM}
          kmlCenter={kmlCenter}
          selectedCircle={selectedCircle}
          setSelectedCircle={setSelectedCircle}
          selectedKml={selectedKml}
          setSelectedKml={setSelectedKml}
        />
      )}
      {view === "history" && <History />}
    </div>
  );
}
