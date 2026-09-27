import { useMemo, useRef, useState } from "react";
import type {
  AnalyzeCircleResponse,
  AnalyzeContourResponse,
  PondCandidate,
  RainfallInfo,
} from "../lib/types";
import { PondMap, type BaseKey } from "../components/PondMap";

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

const STATUS_COLORS: Record<string, string> = {
  RECOMMENDED: "#0f766e",
  CONDITIONAL: "#c98a1e",
  REJECTED: "#b3453b",
};

export interface WorkspaceProps {
  // ── Circle analysis ───────────────────────────────────────────────────────
  center: { lat: number; lng: number };
  setCenter: (c: { lat: number; lng: number }) => void;
  radiusM: number;
  setRadiusM: (r: number) => void;
  result: AnalyzeCircleResponse | null;
  running: boolean;
  circleError: string | null;
  selectedCircle: PondCandidate | null;
  setSelectedCircle: (c: PondCandidate | null) => void;
  onRun: () => void;
  // ── KML analysis (fully independent) ─────────────────────────────────────
  contour: AnalyzeContourResponse | null;
  contourBusy: boolean;
  contourError: string | null;
  kmlCenter: { lat: number; lng: number } | null;
  kmlRadius: number;
  selectedKml: PondCandidate | null;
  setSelectedKml: (c: PondCandidate | null) => void;
  onContour: (f: File) => void;
  onCheckHealth: () => void;
}

export function Workspace(props: WorkspaceProps) {
  const {
    center, setCenter, radiusM, setRadiusM,
    result, running, circleError, selectedCircle, setSelectedCircle, onRun,
    contour, contourBusy, contourError, kmlCenter, kmlRadius,
    selectedKml, setSelectedKml, onContour,
  } = props;

  const [activeTab, setActiveTab] = useState<"circle" | "kml">("circle");
  const [circleBase, setCircleBase] = useState<BaseKey>("street");
  const [kmlBase, setKmlBase] = useState<BaseKey>("street");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const rainfall: RainfallInfo | null = result?.rainfall ?? null;

  const exportJson = (payload: AnalyzeCircleResponse | AnalyzeContourResponse | null, name: string) => {
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const BASES: BaseKey[] = ["street", "terrain", "satellite"];
  const baseLabel = (k: BaseKey) => k === "street" ? "Street" : k === "terrain" ? "Terrain" : "Satellite";

  // Effective KML map center — fall back to circle center if KML not yet analysed
  const effectiveKmlCenter = kmlCenter ?? center;
  const effectiveKmlRadius = kmlCenter ? kmlRadius : radiusM;

  return (
    <main className="flex h-[calc(100vh-57px)] flex-col">
      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-[#e2ddd0] bg-white px-4">
        <button
          onClick={() => setActiveTab("circle")}
          className={`relative px-5 py-3 text-sm font-medium transition ${
            activeTab === "circle"
              ? "text-[#0f766e] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#0f766e]"
              : "text-[#4a5548] hover:text-[#0f766e]"
          }`}
        >
          ⊙ Circle Analysis
          {result && (
            <span className="ml-2 rounded-full bg-[#e7f2ef] px-2 py-0.5 text-[10px] font-semibold text-[#0f766e]">
              {result.candidates.length} sites
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("kml")}
          className={`relative px-5 py-3 text-sm font-medium transition ${
            activeTab === "kml"
              ? "text-[#8a6b2f] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#8a6b2f]"
              : "text-[#4a5548] hover:text-[#8a6b2f]"
          }`}
        >
          ⛰ KML / Contour Analysis
          {contour && (
            <span className="ml-2 rounded-full bg-[#f4ede2] px-2 py-0.5 text-[10px] font-semibold text-[#8a6b2f]">
              {contour.candidates.length} sites
            </span>
          )}
        </button>
      </div>

      {/* ── Circle Analysis tab ─────────────────────────────────────────── */}
      {activeTab === "circle" && (
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          {/* Map */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#e2ddd0] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#e2ddd0] px-4 py-2">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">CIRCLE ANALYSIS MAP</p>
                <h2 className="text-lg font-semibold leading-tight">Coordinate-based candidate map</h2>
              </div>
              <div className="flex gap-2">
                {BASES.map((k) => (
                  <button key={k} onClick={() => setCircleBase(k)}
                    className={`rounded border px-2.5 py-1 text-xs transition ${circleBase === k ? "border-[#0f766e] bg-[#0f766e] text-white" : "border-[#e2ddd0] text-[#4a5548] hover:border-[#0f766e]"}`}>
                    {baseLabel(k)}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <PondMap center={center} radiusM={radiusM} base={circleBase}
                circleResult={result} contourResult={null}
                selected={selectedCircle} onSelect={setSelectedCircle} />
            </div>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 border-t border-[#e2ddd0] bg-white px-4 py-2 text-xs text-[#4a5548]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#22301f]" /> Study center</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" /> Recommended</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c98a1e]" /> Conditional</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#b3453b]" /> Rejected</span>
              <span className="ml-auto text-[11px] text-[#8a8676]">
                {result ? `${result.candidates.length} site(s) found` : "No analysis yet"}
              </span>
            </div>
          </section>

          {/* Right sidebar */}
          <aside className="flex w-[360px] flex-none flex-col gap-4 overflow-y-auto pr-1">
            {/* Input card */}
            <div className="rounded-lg border border-[#e2ddd0] bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">STUDY INPUT</p>
              <h3 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Define your circle</h3>
              <p className="mt-1 text-xs text-[#8a8676]">Screen live elevation, catchment, rainfall and OSM evidence inside this radius.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-[#4a5548]">
                  Latitude
                  <input type="number" step="0.000001" value={center.lat}
                    onChange={(e) => setCenter({ ...center, lat: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-[#d7d2c4] px-2.5 py-2 text-sm font-semibold" />
                </label>
                <label className="text-xs font-medium text-[#4a5548]">
                  Longitude
                  <input type="number" step="0.000001" value={center.lng}
                    onChange={(e) => setCenter({ ...center, lng: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-[#d7d2c4] px-2.5 py-2 text-sm font-semibold" />
                </label>
                <label className="text-xs font-medium text-[#4a5548]">
                  Radius (m)
                  <input type="number" step="50" value={radiusM}
                    onChange={(e) => setRadiusM(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-[#d7d2c4] px-2.5 py-2 text-sm font-semibold" />
                </label>
              </div>
              <button onClick={onRun} disabled={running}
                className="mt-4 w-full rounded bg-[#0f766e] py-2.5 text-sm font-semibold text-white transition hover:bg-[#0d655e] disabled:opacity-60">
                {running ? "Analyzing…" : "Run circle analysis →"}
              </button>
              {circleError && <p className="mt-3 rounded bg-[#fbeeed] px-3 py-2 text-xs text-[#b3453b]">{circleError}</p>}
            </div>

            {/* Export */}
            <div className="rounded-lg border border-[#e2ddd0] bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">EXPORT</p>
              <button onClick={() => exportJson(result, "circle-analysis.json")} disabled={!result}
                className="mt-3 w-full rounded border border-[#0f766e] py-2 text-sm font-semibold text-[#0f766e] transition hover:bg-[#e7f2ef] disabled:opacity-60">
                Download circle JSON
              </button>
            </div>

            {/* Selected candidate */}
            {selectedCircle && <CandidateCard c={selectedCircle} onClose={() => setSelectedCircle(null)} />}

            {/* Rainfall */}
            {rainfall && (
              <div className="rounded-lg border border-[#e2ddd0] bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">RAINFALL</p>
                <h3 className="mt-1 text-xl font-semibold">{rainfall.annual_mm} mm / year</h3>
                <p className="mt-1 text-[11px] text-[#8a8676]">{rainfall.provider} · {rainfall.period}</p>
                <div className="mt-3 flex h-16 items-end gap-1">
                  {rainfall.monthly.map((m) => {
                    const max = Math.max(...rainfall.monthly.map((x) => x.mm), 1);
                    return (
                      <div key={m.month} className="flex-1 rounded-t bg-[#0f766e]/80"
                        style={{ height: `${(m.mm / max) * 100}%` }} title={`${m.month}: ${m.mm} mm`} />
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-[#8a8676]">
                  {rainfall.monthly.map((m) => <span key={m.month}>{m.month[0]}</span>)}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ── KML Analysis tab ─────────────────────────────────────────────── */}
      {activeTab === "kml" && (
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          {/* Map */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#8a6b2f]/30 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#e2ddd0] px-4 py-2">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a6b2f]">KML ANALYSIS MAP</p>
                <h2 className="text-lg font-semibold leading-tight">Full contour extent map</h2>
              </div>
              <div className="flex gap-2">
                {BASES.map((k) => (
                  <button key={k} onClick={() => setKmlBase(k)}
                    className={`rounded border px-2.5 py-1 text-xs transition ${kmlBase === k ? "border-[#8a6b2f] bg-[#8a6b2f] text-white" : "border-[#e2ddd0] text-[#4a5548] hover:border-[#8a6b2f]"}`}>
                    {baseLabel(k)}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <PondMap center={effectiveKmlCenter} radiusM={effectiveKmlRadius}
                base={kmlBase} circleResult={null} contourResult={contour}
                selected={selectedKml} onSelect={setSelectedKml} />
            </div>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 border-t border-[#e2ddd0] bg-white px-4 py-2 text-xs text-[#4a5548]">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-6 rounded bg-[#8a6b2f]" /> Contour lines</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-6 rounded bg-[#2f86c9]" /> Drainage</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" /> Recommended</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c98a1e]" /> Conditional</span>
              <span className="ml-auto text-[11px] text-[#8a8676]">
                {contour ? `${contour.candidates.length} site(s) · ${contour.source.filename}` : "No KML uploaded yet"}
              </span>
            </div>
          </section>

          {/* Right sidebar */}
          <aside className="flex w-[360px] flex-none flex-col gap-4 overflow-y-auto pr-1">
            {/* Upload card */}
            <div className="rounded-lg border border-[#8a6b2f]/30 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a6b2f]">KML / KMZ UPLOAD</p>
              <h3 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Contour analysis</h3>
              <p className="mt-1 text-xs text-[#8a8676]">
                Upload a KML/KMZ contour file. Pond sites are identified across the <strong>entire file extent</strong> — completely independent of the circle analysis.
              </p>
              <div className="mt-4 rounded-lg border border-[#e8e4da] bg-[#f9f7f2] p-3 text-[11px] text-[#8a8676]">
                📁 No coordinates required — the file's own geographic extent is used automatically.
              </div>
              <div className="mt-3">
                <input type="file" accept=".kml,.kmz" ref={fileRef}
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                  className="block w-full text-xs text-[#4a5548] file:mr-2 file:rounded file:border-0 file:bg-[#f0ede4] file:px-3 file:py-1.5 file:text-xs file:font-medium" />
                <button
                  onClick={() => { const f = fileRef.current?.files?.[0]; if (f) onContour(f); }}
                  disabled={contourBusy || !fileName}
                  className="mt-3 w-full rounded bg-[#8a6b2f] py-2.5 text-sm font-semibold text-white transition hover:bg-[#7a5d28] disabled:opacity-60">
                  {contourBusy ? "Analyzing…" : "Analyze full KML →"}
                </button>
                {contourError && <p className="mt-3 rounded bg-[#fbeeed] px-3 py-2 text-xs text-[#b3453b]">{contourError}</p>}
                {contour && (
                  <div className="mt-3 rounded-lg bg-[#f4f1ea] px-3 py-2 text-[11px] text-[#4a5548]">
                    <p><span className="font-medium">{contour.source.filename}</span> ({(contour.source.sizeBytes / 1024).toFixed(0)} KB)</p>
                    <p className="mt-0.5">
                      <span className="font-semibold text-[#8a6b2f]">{contour.candidates.length} candidate site(s)</span> across full extent
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#8a8676]">
                      {contour.contours.lines} contour lines · {contour.contours.interval_m}m interval ·{" "}
                      {contour.contours.minElevation_m}–{contour.contours.maxElevation_m}m elevation
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Export */}
            <div className="rounded-lg border border-[#e2ddd0] bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a6b2f]">EXPORT</p>
              <button onClick={() => exportJson(contour, "kml-analysis.json")} disabled={!contour}
                className="mt-3 w-full rounded border border-[#8a6b2f] py-2 text-sm font-semibold text-[#8a6b2f] transition hover:bg-[#f4ede2] disabled:opacity-60">
                Download KML JSON
              </button>
            </div>

            {/* Selected KML candidate */}
            {selectedKml && <CandidateCard c={selectedKml} onClose={() => setSelectedKml(null)} accentColor="#8a6b2f" />}
          </aside>
        </div>
      )}
    </main>
  );
}

function CandidateCard({ c, onClose, accentColor = "#0f766e" }: { c: PondCandidate; onClose: () => void; accentColor?: string }) {
  const color = STATUS_COLORS[c.status] ?? accentColor;
  return (
    <div className="rounded-lg border border-[#e2ddd0] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em]" style={{ color: accentColor }}>SUGGESTED SITE</p>
          <h3 className="mt-0.5 text-2xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
            {c.code} · {c.status}
          </h3>
          <p className="mt-0.5 text-xs text-[#8a8676]">{c.location.lat.toFixed(6)}, {c.location.lng.toFixed(6)}</p>
        </div>
        <button onClick={onClose} className="text-xs text-[#8a8676] hover:text-[#22301f]">✕</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Score" value={`${c.score}/100`} />
        <Stat label="Rank" value={`#${c.rank}`} />
        <Stat label="Confidence" value={c.confidence} />
        <Stat label="Catchment" value={`${fmt(c.catchmentArea_m2)} m²`} />
        <Stat label="Storage" value={`${fmt(c.storage_m3)} m³`} />
        <Stat label="Runoff/yr" value={`${fmt(c.annualRunoff_m3)} m³`} />
        <Stat label="Elevation" value={`${c.elevation_m} m`} />
        <Stat label="Slope" value={`${c.slope_pct}%`} />
      </div>
      <div className="mt-3 space-y-1.5">
        {c.factors.map((f) => (
          <div key={f.key}>
            <div className="flex justify-between text-[11px] text-[#4a5548]">
              <span>{f.label} <span className="text-[#8a8676]">×{f.weight}</span></span>
              <span>{Math.round(f.value * 100)}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-[#eef0ea]">
              <div className="h-1.5 rounded" style={{ width: `${f.value * 100}%`, backgroundColor: color }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded bg-[#f4f1ea] px-3 py-2 text-[11px] leading-relaxed text-[#4a5548]">{c.explanation}</p>
      {c.reasons.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-[11px] text-[#0f766e]">
          {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {c.cautions.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-[#c98a1e]">
          {c.cautions.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[#f4f1ea] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-[#8a8676]">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
