import type { AnalyzeCircleResponse, AnalyzeContourResponse, PondCandidate } from "../lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

export function Report({
  result,
  contour,
  center,
  radiusM,
  kmlCenter,
  selectedCircle,
  setSelectedCircle,
  selectedKml,
  setSelectedKml,
}: {
  result: AnalyzeCircleResponse | null;
  contour: AnalyzeContourResponse | null;
  center: { lat: number; lng: number };
  radiusM: number;
  kmlCenter: { lat: number; lng: number } | null;
  selectedCircle: PondCandidate | null;
  setSelectedCircle: (c: PondCandidate | null) => void;
  selectedKml: PondCandidate | null;
  setSelectedKml: (c: PondCandidate | null) => void;
}) {
  const neitherReady = !result && !contour;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-3xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
        Analysis Report
      </h1>
      <p className="mt-1 text-sm text-[#8a8676]">
        The two analyses are fully independent. Run either or both from the workspace.
      </p>

      {neitherReady && (
        <p className="mt-10 rounded-lg border border-dashed border-[#d7d2c4] bg-white p-8 text-center text-sm text-[#8a8676]">
          Run an analysis in the workspace to populate this report.
        </p>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — Circle Analysis
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="mt-8">
        {/* Section header */}
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e7f2ef] text-lg text-[#0f766e]">⊙</span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#0f766e]">Analysis 1</p>
            <h2 className="text-xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
              Circle Analysis — Coordinate-based
            </h2>
          </div>
        </div>

        {!result ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#d7d2c4] bg-white p-6 text-sm text-[#8a8676]">
            No circle analysis yet. Go to <strong>Workspace → Circle Analysis</strong> tab and click "Run circle analysis".
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#8a8676]">
              Study centre: {center.lat.toFixed(4)}, {center.lng.toFixed(4)} · Radius: {fmt(radiusM)} m ·
              Area: {result.areaHa} ha
            </p>

            {/* Summary tiles */}
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Info label="Annual Rainfall" value={`${result.rainfall.annual_mm} mm`} accent="#0f766e" />
              <Info label="Rainfall Source" value={result.rainfall.provider} accent="#0f766e" />
              <Info label="DEM Source" value={result.dem.source} accent="#0f766e" />
              <Info label="Elevation Range" value={`${result.dem.minElevation_m}–${result.dem.maxElevation_m} m`} accent="#0f766e" />
              <Info label="Mean Slope" value={`${result.dem.meanSlope_pct}%`} accent="#0f766e" />
              <Info label="Water Bodies" value={String(result.waterBodies.length)} accent="#0f766e" />
              <Info label="Candidates Found" value={String(result.candidates.length)} accent="#0f766e" />
              <Info label="Computed At" value={new Date(result.computedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })} accent="#0f766e" />
            </div>

            {/* Monthly Rainfall chart */}
            {result.rainfall.monthly && (
              <div className="mt-4 rounded-lg border border-[#e2ddd0] bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f766e]">Monthly Rainfall Distribution</p>
                <div className="mt-3 flex h-20 items-end gap-1">
                  {result.rainfall.monthly.map((m) => {
                    const max = Math.max(...result.rainfall.monthly.map((x) => x.mm), 1);
                    return (
                      <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
                        <span className="text-[9px] text-[#8a8676]">{m.mm}</span>
                        <div className="w-full rounded-t bg-[#0f766e]/80"
                          style={{ height: `${Math.max(4, (m.mm / max) * 100)}%` }}
                          title={`${m.month}: ${m.mm} mm`} />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-[#8a8676]">
                  {result.rainfall.monthly.map((m) => <span key={m.month}>{m.month.slice(0, 3)}</span>)}
                </div>
                <p className="mt-2 text-[10px] text-[#8a8676]">{result.rainfall.period} · {result.rainfall.provider}</p>
              </div>
            )}

            {/* Candidates table */}
            <div className="mt-4 overflow-x-auto rounded-lg border border-[#e2ddd0] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f4f1ea] text-[10px] uppercase tracking-wide text-[#8a8676]">
                  <tr>
                    <th className="px-3 py-2">Rank</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Latitude</th>
                    <th className="px-3 py-2">Longitude</th>
                    <th className="px-3 py-2">Catchment m²</th>
                    <th className="px-3 py-2">Runoff m³/yr</th>
                    <th className="px-3 py-2">Storage m³</th>
                    <th className="px-3 py-2">Slope %</th>
                    <th className="px-3 py-2">Elev m</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((c) => (
                    <tr key={c.id} onClick={() => setSelectedCircle(c)}
                      className={`cursor-pointer border-t border-[#f0ece1] hover:bg-[#f7f5ee] ${selectedCircle?.id === c.id ? "bg-[#e7f2ef]" : ""}`}>
                      <td className="px-3 py-1.5 font-bold text-[#0f766e]">#{c.rank}</td>
                      <td className="px-3 py-1.5 font-semibold">{c.code}</td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-1.5 font-semibold">{c.score}</td>
                      <td className="px-3 py-1.5">{c.confidence}</td>
                      <td className="px-3 py-1.5">{c.location.lat.toFixed(6)}</td>
                      <td className="px-3 py-1.5">{c.location.lng.toFixed(6)}</td>
                      <td className="px-3 py-1.5">{fmt(c.catchmentArea_m2)}</td>
                      <td className="px-3 py-1.5">{fmt(c.annualRunoff_m3)}</td>
                      <td className="px-3 py-1.5">{fmt(c.storage_m3)}</td>
                      <td className="px-3 py-1.5">{c.slope_pct}%</td>
                      <td className="px-3 py-1.5">{c.elevation_m} m</td>
                    </tr>
                  ))}
                  {result.candidates.length === 0 && (
                    <tr><td colSpan={12} className="px-3 py-4 text-center text-[#8a8676]">No suitable sites found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Divider */}
      <div className="my-10 flex items-center gap-4">
        <div className="h-px flex-1 bg-[#e2ddd0]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-[#8a8676]">Independent Analysis</span>
        <div className="h-px flex-1 bg-[#e2ddd0]" />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — KML Contour Analysis
      ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0ede4] text-lg text-[#8a6b2f]">⛰</span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8a6b2f]">Analysis 2</p>
            <h2 className="text-xl font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
              KML / Contour Analysis — File-based
            </h2>
          </div>
        </div>

        {!contour ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#d7d2c4] bg-white p-6 text-sm text-[#8a8676]">
            No KML analysis yet. Go to <strong>Workspace → KML / Contour Analysis</strong> tab and upload a file.
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#8a8676]">
              File: <strong>{contour.source.filename}</strong> ·
              Centre: {(kmlCenter ?? contour.extent.center).lat.toFixed(4)}, {(kmlCenter ?? contour.extent.center).lng.toFixed(4)} ·
              Area: {contour.extent.areaHa} ha
            </p>

            {/* Summary tiles */}
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Info label="Contour Lines" value={String(contour.contours.lines)} accent="#8a6b2f" />
              <Info label="Interval" value={`${contour.contours.interval_m} m`} accent="#8a6b2f" />
              <Info label="Elevation Range" value={`${contour.contours.minElevation_m}–${contour.contours.maxElevation_m} m`} accent="#8a6b2f" />
              <Info label="Cell Size" value={`${contour.dem.cellSize_m} m`} accent="#8a6b2f" />
              <Info label="Drainage Lines" value={String(contour.drainage.length)} accent="#8a6b2f" />
              <Info label="Candidates Found" value={String(contour.candidates.length)} accent="#8a6b2f" />
              <Info label="File Size" value={`${(contour.source.sizeBytes / 1024).toFixed(0)} KB`} accent="#8a6b2f" />
              <Info label="Computed At" value={new Date(contour.computedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })} accent="#8a6b2f" />
            </div>

            {/* Candidates table */}
            <div className="mt-4 overflow-x-auto rounded-lg border border-[#e2ddd0] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f7f3ec] text-[10px] uppercase tracking-wide text-[#8a8676]">
                  <tr>
                    <th className="px-3 py-2">Rank</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Latitude</th>
                    <th className="px-3 py-2">Longitude</th>
                    <th className="px-3 py-2">Catchment m²</th>
                    <th className="px-3 py-2">Runoff m³/yr</th>
                    <th className="px-3 py-2">Storage m³</th>
                    <th className="px-3 py-2">Slope %</th>
                    <th className="px-3 py-2">Elev m</th>
                  </tr>
                </thead>
                <tbody>
                  {contour.candidates.map((c) => (
                    <tr key={c.id} onClick={() => setSelectedKml(c)}
                      className={`cursor-pointer border-t border-[#f0ece1] hover:bg-[#faf6ee] ${selectedKml?.id === c.id ? "bg-[#f4ede2]" : ""}`}>
                      <td className="px-3 py-1.5 font-bold text-[#8a6b2f]">#{c.rank}</td>
                      <td className="px-3 py-1.5 font-semibold">{c.code}</td>
                      <td className="px-3 py-1.5"><StatusBadge status={c.status} /></td>
                      <td className="px-3 py-1.5 font-semibold">{c.score}</td>
                      <td className="px-3 py-1.5">{c.confidence}</td>
                      <td className="px-3 py-1.5">{c.location.lat.toFixed(6)}</td>
                      <td className="px-3 py-1.5">{c.location.lng.toFixed(6)}</td>
                      <td className="px-3 py-1.5">{fmt(c.catchmentArea_m2)}</td>
                      <td className="px-3 py-1.5">{fmt(c.annualRunoff_m3)}</td>
                      <td className="px-3 py-1.5">{fmt(c.storage_m3)}</td>
                      <td className="px-3 py-1.5">{c.slope_pct}%</td>
                      <td className="px-3 py-1.5">{c.elevation_m} m</td>
                    </tr>
                  ))}
                  {contour.candidates.length === 0 && (
                    <tr><td colSpan={12} className="px-3 py-4 text-center text-[#8a8676]">No candidate sites found in this KML file.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Assumptions */}
            {contour.assumptions?.length > 0 && (
              <div className="mt-4 rounded-lg border border-[#e8e4da] bg-[#faf6ee] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a6b2f]">Analysis Assumptions</p>
                <ul className="mt-2 space-y-1 text-[11px] text-[#4a5548]">
                  {contour.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const bg = status === "RECOMMENDED" ? "#0f766e" : status === "CONDITIONAL" ? "#c98a1e" : "#b3453b";
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: bg }}>
      {status}
    </span>
  );
}

function Info({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-[#e2ddd0] bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[#8a8676]">{label}</p>
      <p className="text-sm font-medium" style={{ color: accent }}>{value}</p>
    </div>
  );
}
