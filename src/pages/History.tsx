import { useEffect, useState, useCallback } from "react";
import type { AnalyzeCircleResponse, AnalyzeContourResponse, PondCandidate } from "../lib/types";
import { PondMap } from "../components/PondMap";
import type { BaseKey } from "../components/PondMap";

interface HistorySummary {
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

const STATUS_COLORS: Record<string, string> = {
  RECOMMENDED: "#0f766e",
  CONDITIONAL: "#c98a1e",
  REJECTED: "#b3453b",
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function History() {
  const [entries, setEntries] = useState<HistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view state
  const [detail, setDetail] = useState<{
    circleResult: AnalyzeCircleResponse | null;
    contourResult: AnalyzeContourResponse | null;
    center: { lat: number; lng: number };
    radiusM: number;
    selected: PondCandidate | null;
    base: BaseKey;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history");
      const data = await res.json() as { ok: boolean; entries: HistorySummary[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load history");
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const openDetail = useCallback(async (id: string, type: "circle" | "contour", center: { lat: number; lng: number }, radiusM: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/history/${id}`);
      const data = await res.json() as { ok: boolean; entry: { result: unknown }; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load detail");
      const result = data.entry.result as AnalyzeCircleResponse | AnalyzeContourResponse;
      if (type === "circle") {
        setDetail({ circleResult: result as AnalyzeCircleResponse, contourResult: null, center, radiusM, selected: null, base: "street" });
      } else {
        const cr = result as AnalyzeContourResponse;
        setDetail({ circleResult: null, contourResult: cr, center: cr.extent.center, radiusM: cr.radiusFilter.radius_m ?? 1000, selected: null, base: "street" });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const deleteEntry = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this history entry?")) return;
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      const data = await res.json() as { ok: boolean };
      if (data.ok) {
        setEntries((prev) => prev.filter((x) => x.id !== id));
        if (detail) setDetail(null);
      }
    } catch {
      alert("Failed to delete entry");
    }
  }, [detail]);

  if (detail) {
    const candidates = detail.contourResult?.candidates ?? detail.circleResult?.candidates ?? [];
    return (
      <div className="flex h-[calc(100vh-57px)] flex-col">
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-[#e2ddd0] bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDetail(null)}
              className="flex items-center gap-1.5 rounded border border-[#e2ddd0] px-3 py-1.5 text-xs font-medium text-[#4a5548] hover:border-[#0f766e] hover:text-[#0f766e]"
            >
              ← Back to History
            </button>
            <span className="text-sm font-semibold text-[#22301f]">Analysis Replay</span>
          </div>
          <div className="flex gap-2">
            {(["street", "terrain", "satellite"] as BaseKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setDetail((d) => d ? { ...d, base: k } : d)}
                className={`rounded border px-2.5 py-1 text-xs transition ${
                  detail.base === k
                    ? "border-[#0f766e] bg-[#0f766e] text-white"
                    : "border-[#e2ddd0] bg-white text-[#4a5548] hover:border-[#0f766e]"
                }`}
              >
                {k === "street" ? "Street" : k === "terrain" ? "Terrain" : "Satellite"}
              </button>
            ))}
          </div>
        </div>

        {/* Map + sidebar */}
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <PondMap
              center={detail.center}
              radiusM={detail.radiusM}
              base={detail.base}
              circleResult={detail.circleResult}
              contourResult={detail.contourResult}
              selected={detail.selected}
              onSelect={(c) => setDetail((d) => d ? { ...d, selected: c } : d)}
            />
          </div>

          {/* Right sidebar */}
          <aside className="flex w-[340px] flex-none flex-col gap-3 overflow-y-auto border-l border-[#e2ddd0] bg-white p-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">ANALYSIS RESULTS</p>
              <p className="mt-0.5 text-lg font-semibold">{candidates.length} candidate site{candidates.length !== 1 ? "s" : ""}</p>
            </div>

            {/* Ranked candidates list */}
            <div className="space-y-2">
              {candidates.map((c) => {
                const color = STATUS_COLORS[c.status] ?? "#555";
                const isSel = detail.selected?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setDetail((d) => d ? { ...d, selected: c } : d)}
                    className={`cursor-pointer rounded-lg border p-3 transition ${
                      isSel ? "border-[#0f766e] bg-[#e7f2ef]" : "border-[#e2ddd0] hover:border-[#0f766e]/50 hover:bg-[#f7f5ee]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: color }}>
                          {c.rank}
                        </span>
                        <span className="font-semibold">{c.code}</span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: color }}>
                          {c.status}
                        </span>
                      </div>
                      <span className="text-sm font-bold" style={{ color }}>{c.score}/100</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-[#4a5548]">
                      <span>Catchment: <b>{fmt(c.catchmentArea_m2)} m²</b></span>
                      <span>Storage: <b>{fmt(c.storage_m3)} m³</b></span>
                      <span>Runoff/yr: <b>{fmt(c.annualRunoff_m3)} m³</b></span>
                      <span>Slope: <b>{c.slope_pct}%</b></span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected candidate detail */}
            {detail.selected && (
              <div className="rounded-lg border border-[#e2ddd0] bg-[#f4f1ea] p-3">
                <p className="text-[10px] font-semibold tracking-[0.12em] text-[#0f766e]">SELECTED SITE</p>
                <p className="mt-0.5 font-semibold">{detail.selected.code} · {detail.selected.confidence} confidence</p>
                <p className="mt-2 text-[11px] leading-relaxed text-[#4a5548]">{detail.selected.explanation}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif-display text-3xl" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Analysis History</h1>
          <p className="mt-1 text-sm text-[#8a8676]">
            Past analyses are saved automatically. Click any entry to replay the full map and results.
          </p>
        </div>
        <button
          onClick={loadHistory}
          className="rounded border border-[#e2ddd0] px-3 py-1.5 text-xs font-medium text-[#4a5548] hover:border-[#0f766e] hover:text-[#0f766e]"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <div className="mt-10 text-center text-sm text-[#8a8676]">Loading history…</div>
      )}
      {error && (
        <div className="mt-6 rounded-lg border border-[#fbc4bc] bg-[#fbeeed] p-4 text-sm text-[#b3453b]">{error}</div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-[#d7d2c4] bg-white p-10 text-center">
          <p className="text-4xl">🗺️</p>
          <p className="mt-3 text-sm font-medium text-[#22301f]">No history yet</p>
          <p className="mt-1 text-xs text-[#8a8676]">Run an analysis in the workspace — it will appear here automatically.</p>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="mt-6 space-y-3">
          {entries.map((entry) => {
            const statusColor = entry.topStatus ? (STATUS_COLORS[entry.topStatus] ?? "#555") : "#8a8676";
            return (
              <div
                key={entry.id}
                onClick={() => openDetail(entry.id, entry.type, entry.center, entry.radiusM)}
                className="group cursor-pointer rounded-xl border border-[#e2ddd0] bg-white p-5 shadow-sm transition hover:border-[#0f766e] hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                      entry.type === "circle" ? "bg-[#e7f2ef] text-[#0f766e]" : "bg-[#f0eade] text-[#8a6b2f]"
                    }`}>
                      {entry.type === "circle" ? "⊙" : "⛰"}
                    </div>
                    <div>
                      <p className="font-semibold text-[#22301f]">{entry.region}</p>
                      <p className="text-xs text-[#8a8676]">
                        {entry.type === "circle" ? "Circle analysis" : "Contour analysis"} ·{" "}
                        {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                        <span className="text-[#0f766e]">{timeAgo(entry.timestamp)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {entry.topScore !== null && (
                      <div className="text-right">
                        <p className="text-xs text-[#8a8676]">Top score</p>
                        <p className="font-bold" style={{ color: statusColor }}>{entry.topScore}/100</p>
                      </div>
                    )}
                    <button
                      onClick={(e) => deleteEntry(entry.id, e)}
                      title="Delete"
                      className="rounded p-1 text-[#d7d2c4] opacity-0 transition hover:text-[#b3453b] group-hover:opacity-100"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#4a5548]">
                  <span className="flex items-center gap-1">
                    <span className="font-medium">{entry.candidateCount}</span> site{entry.candidateCount !== 1 ? "s" : ""}
                  </span>
                  {entry.topStatus && (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: statusColor }} />
                      <span style={{ color: statusColor }} className="font-medium">{entry.topStatus}</span>
                    </span>
                  )}
                  {entry.rainfall_mm !== null && (
                    <span>
                      🌧 <span className="font-medium">{entry.rainfall_mm} mm</span>/yr
                    </span>
                  )}
                  <span>
                    📍 {entry.center.lat.toFixed(4)}, {entry.center.lng.toFixed(4)}
                  </span>
                  {entry.radiusM > 0 && (
                    <span>
                      ⭕ {fmt(entry.radiusM)} m radius
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1 text-xs font-medium text-[#0f766e] opacity-0 transition group-hover:opacity-100">
                  View full map & results →
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="rounded-xl bg-white p-6 shadow-xl">
            <p className="text-sm text-[#22301f]">Loading analysis…</p>
          </div>
        </div>
      )}
    </main>
  );
}
