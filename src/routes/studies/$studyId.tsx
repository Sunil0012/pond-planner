import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Shell } from "@/components/pond/Shell";
import { PondMap, type BaseKey, type LayerKey } from "@/components/pond/PondMap";
import { ConfidencePill, JobPill, Row, Stat, StatusPill } from "@/components/pond/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { evaluateStudy, LAND_LABEL, type Evaluation } from "@/lib/pond/engine";
import { fetchRainfall } from "@/lib/pond/rainfall";
import { buildGeoJSON, buildJSON, download, printReport } from "@/lib/pond/export";
import {
  collectSources,
  runCandidates,
  runTerrain,
  runValidation,
  saveReview,
  setConstraints,
  setRainfall,
  useStudy,
} from "@/lib/pond/store";
import type { Constraints, LandUse, StepId, Study } from "@/lib/pond/types";
import { fmt } from "@/lib/pond/geo";

export const Route = createFileRoute("/studies/$studyId")({
  head: () => ({
    meta: [
      { title: "Study workspace — PondSite" },
      {
        name: "description",
        content: "Run terrain, catchment, rainfall, parcel and scoring analysis for a village pond study.",
      },
      { property: "og:title", content: "Study workspace — PondSite" },
      { property: "og:description", content: "Terrain, rainfall, parcels, scoring and field review in one workspace." },
    ],
  }),
  component: Workspace,
});

const TABS = ["Workflow", "Layers", "Candidates", "Rainfall", "Parcels", "Constraints", "Review", "Export"] as const;
type Tab = (typeof TABS)[number];

const LAYER_LABELS: Record<LayerKey, string> = {
  boundary: "Study boundary",
  contours: "Elevation contours",
  slope: "Slope classes",
  drainage: "Drainage network",
  parcels: "Cadastral parcels",
  catchments: "Catchments",
  candidates: "Candidate sites",
};

function Workspace() {
  const { studyId } = Route.useParams();
  const study = useStudy(studyId);
  const [tab, setTab] = useState<Tab>("Workflow");
  const [base, setBase] = useState<BaseKey>("satellite");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    boundary: true,
    contours: false,
    slope: false,
    drainage: true,
    parcels: false,
    catchments: true,
    candidates: true,
  });

  const evals = useMemo(() => (study ? evaluateStudy(study) : []), [study]);

  if (!study) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h1 className="text-2xl">Study not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">It may have been deleted from this browser.</p>
          <Link to="/studies" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
            Back to studies
          </Link>
        </div>
      </Shell>
    );
  }

  const runRainfall = async () => {
    setBusy("rain");
    const data = await fetchRainfall(study.village.center.lat, study.village.center.lng);
    setRainfall(study.id, data);
    setBusy(null);
  };

  const runAll = async () => {
    setBusy("all");
    runValidation(study.id);
    collectSources(study.id);
    runTerrain(study.id);
    runCandidates(study.id);
    const data = await fetchRainfall(study.village.center.lat, study.village.center.lng);
    setRainfall(study.id, data);
    setConstraints(study.id, study.constraints);
    setBusy(null);
    setTab("Candidates");
  };

  const sel = evals.find((e) => e.candidate.id === selected) ?? null;

  return (
    <Shell>
      <div className="border-b border-border/70 bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="text-2xl leading-tight">{study.name}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {study.village.name}, {study.village.district}, {study.village.state} · {study.crs} · buffer{" "}
              {study.bufferM} m · {study.candidates.length} candidates
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTab("Export")}>
              Export
            </Button>
            <Button size="sm" onClick={runAll} disabled={busy !== null}>
              {busy === "all" ? "Running pipeline…" : "Run full analysis"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 lg:grid-cols-[1fr_460px]">
        <div className="h-[420px] overflow-hidden rounded-lg border border-border lg:sticky lg:top-20 lg:h-[calc(100vh-7.5rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
            <div className="flex gap-1">
              {(["satellite", "terrain", "street"] as BaseKey[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBase(b)}
                  className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${base === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                >
                  {b}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {study.village.center.lat.toFixed(4)}, {study.village.center.lng.toFixed(4)}
            </span>
          </div>
          <div className="h-[calc(100%-2.4rem)]">
            <PondMap
              study={study}
              evaluations={evals}
              layers={layers}
              base={base}
              selectedId={selected}
              onSelect={(id) => {
                setSelected(id);
                setTab("Candidates");
              }}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-xs transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-4">
            {tab === "Workflow" && <WorkflowTab study={study} busy={busy} onRainfall={runRainfall} />}
            {tab === "Layers" && <LayersTab study={study} layers={layers} setLayers={setLayers} />}
            {tab === "Candidates" && (
              <CandidatesTab evals={evals} selected={selected} onSelect={setSelected} sel={sel} study={study} />
            )}
            {tab === "Rainfall" && <RainfallTab study={study} busy={busy} onFetch={runRainfall} />}
            {tab === "Parcels" && <ParcelsTab study={study} evals={evals} />}
            {tab === "Constraints" && <ConstraintsTab study={study} />}
            {tab === "Review" && <ReviewTab study={study} evals={evals} />}
            {tab === "Export" && <ExportTab study={study} evals={evals} />}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

const STEP_META: { id: StepId; label: string; hint: string }[] = [
  { id: "create", label: "Create village study", hint: "Village, CRS and buffer captured." },
  { id: "validate", label: "Validate boundary and CRS", hint: "Ring closure, projection and area checks." },
  { id: "collect", label: "Collect DEM, rainfall, parcel data", hint: "Provenance recorded for every dataset." },
  { id: "terrain", label: "Process terrain and drainage", hint: "Sinks, slope, contours, flow accumulation." },
  { id: "candidates", label: "Generate candidate low points", hint: "Filtered against drainage paths." },
  { id: "catchment", label: "Delineate catchments", hint: "Upstream trace per candidate." },
  { id: "runoff", label: "Estimate runoff and storage", hint: "Rainfall × area × coefficient." },
  { id: "parcels", label: "Verify parcels and land constraints", hint: "Computed vs official area." },
  { id: "score", label: "Score, rank and explain", hint: "Hard constraints then weighted score." },
  { id: "review", label: "Field verification", hint: "Observations, photographs, decision." },
  { id: "export", label: "Export planning report", hint: "PDF, JSON and GeoJSON." },
];

function WorkflowTab({ study, busy, onRainfall }: { study: Study; busy: string | null; onRainfall: () => void }) {
  const act: Partial<Record<StepId, () => void>> = {
    validate: () => runValidation(study.id),
    collect: () => collectSources(study.id),
    terrain: () => runTerrain(study.id),
    candidates: () => runCandidates(study.id),
    runoff: onRainfall,
    score: () => setConstraints(study.id, study.constraints),
  };
  return (
    <>
      <Card title="Pipeline">
        <ol className="space-y-1">
          {STEP_META.map((s, i) => (
            <li key={s.id} className="flex items-start gap-3 border-b border-border/60 py-2 last:border-0">
              <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{s.label}</span>
                <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <JobPill state={study.steps[s.id]} />
                {act[s.id] && (
                  <button
                    onClick={act[s.id]}
                    disabled={busy !== null}
                    className="rounded border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    Run
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {study.validation && (
        <Card title="Boundary and CRS validation">
          <Row k="Ring closed" v={study.validation.boundaryClosed ? "Yes" : "No"} />
          <Row k="CRS valid" v={`${study.crs} — ${study.validation.crsValid ? "accepted" : "rejected"}`} />
          <Row k="Study area" v={`${fmt(study.validation.areaHa, 1)} ha`} />
          <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            {study.validation.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        </Card>
      )}

      {study.terrain && (
        <Card title="Terrain analysis">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="DEM source" value={study.terrain.demSource} hint={`${study.terrain.resolution_m} m cells`} />
            <Stat label="Elevation" value={`${study.terrain.minElevation_m}–${study.terrain.maxElevation_m} m`} />
            <Stat label="Mean slope" value={`${study.terrain.meanSlope_pct}%`} />
            <Stat label="Sinks filled" value={fmt(study.terrain.sinksFilled)} hint={`${study.terrain.gapPct}% NoData`} />
            <Stat label="Drainage lines" value={fmt(study.terrain.drainageLines)} />
            <Stat label="Contour interval" value={`${study.terrain.contourInterval_m} m`} />
          </div>
        </Card>
      )}

      {study.sources.length > 0 && (
        <Card title="Data sources and provenance">
          {study.sources.map((s) => (
            <div key={s.dataset} className="border-b border-border/60 py-2 last:border-0">
              <div className="text-xs">{s.dataset}</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {s.provider} · {s.version} · {s.crs} · retrieved {new Date(s.retrievedAt).toLocaleString("en-IN")}
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function LayersTab({
  study,
  layers,
  setLayers,
}: {
  study: Study;
  layers: Record<LayerKey, boolean>;
  setLayers: (l: Record<LayerKey, boolean>) => void;
}) {
  return (
    <Card title="Map layers">
      <ul className="space-y-1">
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
          <li key={k} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
            <span className="text-sm">{LAYER_LABELS[k]}</span>
            <button
              onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
              className={`h-5 w-9 rounded-full transition-colors ${layers[k] ? "bg-primary" : "bg-border"}`}
              aria-label={`Toggle ${LAYER_LABELS[k]}`}
            >
              <span className={`block h-4 w-4 rounded-full bg-card transition-transform ${layers[k] ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Contour, slope and drainage layers are derived from {study.terrain?.demSource ?? "the DEM"} once terrain
        analysis has run. Satellite imagery is Esri World Imagery; the topographic base carries SRTM relief shading.
      </p>
    </Card>
  );
}

function CandidatesTab({
  evals,
  selected,
  onSelect,
  sel,
  study,
}: {
  evals: Evaluation[];
  selected: string | null;
  onSelect: (id: string) => void;
  sel: Evaluation | null;
  study: Study;
}) {
  if (evals.length === 0)
    return (
      <Card title="Candidate sites">
        <p className="text-sm text-muted-foreground">
          No candidates yet — run “Generate candidate low points” from the Workflow tab.
        </p>
      </Card>
    );

  return (
    <>
      <Card title={`Ranked candidates (${evals.length})`}>
        <ul className="space-y-1">
          {evals.map((e) => (
            <li key={e.candidate.id}>
              <button
                onClick={() => onSelect(e.candidate.id)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${selected === e.candidate.id ? "border-primary bg-secondary" : "border-border hover:bg-secondary/60"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{e.candidate.code}</span>
                  <span className="flex items-center gap-1.5">
                    <StatusPill status={e.status} />
                    <span className="font-display text-lg leading-none">{e.score}</span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {fmt(e.candidate.catchmentArea_m2)} m² catchment · {e.candidate.slope_pct}% slope ·{" "}
                  {LAND_LABEL[e.candidate.landUse]}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {sel && <ExplanationCard e={sel} study={study} />}
    </>
  );
}

function ExplanationCard({ e, study }: { e: Evaluation; study: Study }) {
  return (
    <Card
      title={`${e.candidate.code} — explanation`}
      action={
        <span className="flex items-center gap-1.5">
          <StatusPill status={e.status} />
          <ConfidencePill confidence={e.confidence} />
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Coordinates" value={`${e.candidate.location.lat.toFixed(5)}, ${e.candidate.location.lng.toFixed(5)}`} />
        <Stat label="Score" value={`${e.score} / 100`} />
        <Stat label="Catchment" value={`${fmt(e.candidate.catchmentArea_m2)} m²`} hint={`order ${e.candidate.drainageOrder}`} />
        <Stat label="Runoff" value={`${fmt(e.runoff_m3)} m³`} hint={`coefficient ${study.constraints.runoffCoefficient}`} />
        <Stat
          label="Storage envelope"
          value={`${fmt(e.storage.storageRange[0])}–${fmt(e.storage.storageRange[1])} m³`}
          hint={`depth ${e.storage.depthRange[0]}–${e.storage.depthRange[1]} m, ${e.storage.sideSlope}`}
        />
        <Stat label="Soil" value={e.candidate.soil} hint={`${e.candidate.infiltrationRate.toLowerCase()} infiltration`} />
      </div>

      <h3 className="mt-4 text-xs font-medium">Weighted factors</h3>
      <div className="mt-2 space-y-2">
        {e.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-[11px]">
              <span>
                {f.label} <span className="text-muted-foreground">· weight {f.weight}</span>
              </span>
              <span className="font-mono">{(f.value * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${f.value * 100}%` }} />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{f.detail}</p>
          </div>
        ))}
      </div>

      {e.penalties.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="text-foreground">Penalties:</span>{" "}
          {e.penalties.map((p) => `${p.label} (−${p.points})`).join(", ")}
        </p>
      )}
      {e.positives.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-success">
          {e.positives.map((p) => (
            <li key={p}>+ {p}</li>
          ))}
        </ul>
      )}
      {e.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-warning-foreground">
          {e.warnings.map((w) => (
            <li key={w}>! {w}</li>
          ))}
        </ul>
      )}
      {e.failures.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-destructive">
          {e.failures.map((f) => (
            <li key={f}>× {f}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed">
        <span className="font-medium">Next action —</span> {e.nextAction}
      </p>
    </Card>
  );
}

function RainfallTab({ study, busy, onFetch }: { study: Study; busy: string | null; onFetch: () => void }) {
  const r = study.rainfall;
  return (
    <Card
      title="Rainfall"
      action={
        <Button size="sm" variant="outline" onClick={onFetch} disabled={busy !== null}>
          {busy === "rain" ? "Fetching…" : r ? "Refresh" : "Fetch rainfall"}
        </Button>
      }
    >
      {!r ? (
        <p className="text-sm text-muted-foreground">
          Fetch daily precipitation for the study centre from the Open-Meteo ERA5 archive. Responses are cached per
          location; if the provider is unreachable, a labelled climatology fallback is used.
        </p>
      ) : (
        <>
          <Row k="Provider" v={r.provider} />
          <Row k="Period" v={r.period} />
          <Row k="Annual total" v={`${fmt(r.annual_mm)} mm`} />
          <Row k="Retrieved" v={new Date(r.retrievedAt).toLocaleString("en-IN")} />
          <Row k="Cache / fallback" v={`${r.cached ? "cached" : "live"} · ${r.fallback ? "fallback data" : "provider data"}`} />
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.monthly} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="2 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid var(--color-border)" }}
                  formatter={(v: number) => [`${v} mm`, "Rainfall"]}
                />
                <Bar dataKey="mm" fill="var(--color-primary)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

function ParcelsTab({ study, evals }: { study: Study; evals: Evaluation[] }) {
  return (
    <Card title="Parcel verification">
      {evals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Generate candidates first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5">Site</th>
                <th>Parcel</th>
                <th className="text-right">Official m²</th>
                <th className="text-right">Computed m²</th>
                <th className="text-right">Error</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {evals.map((e) => {
                const flag = e.parcelErrorPct > study.constraints.maxParcelErrorPct;
                return (
                  <tr key={e.candidate.id}>
                    <td className="py-1.5 font-mono">{e.candidate.code}</td>
                    <td className="font-mono">{e.candidate.parcelId}</td>
                    <td className="text-right">{fmt(e.candidate.officialArea_m2)}</td>
                    <td className="text-right">{fmt(e.candidate.computedArea_m2)}</td>
                    <td className="text-right">{e.parcelErrorPct.toFixed(2)}%</td>
                    <td className={`text-right ${flag ? "text-warning-foreground" : "text-success"}`}>
                      {flag ? "REVIEW" : "PASS"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Computed areas come from the cadastral WMS mask (pixel size × selected pixels). Anything above the{" "}
            {study.constraints.maxParcelErrorPct}% tolerance is flagged for manual review instead of auto-approval.
          </p>
        </div>
      )}
    </Card>
  );
}

const LAND_KEYS: LandUse[] = ["government_waste", "gram_panchayat", "private_agri", "forest_edge"];

function ConstraintsTab({ study }: { study: Study }) {
  const [k, setK] = useState<Constraints>(study.constraints);
  const num = (key: keyof Constraints, label: string, step = 1) => (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        step={step}
        value={String(k[key] as number)}
        onChange={(e) => setK({ ...k, [key]: Number(e.target.value) })}
        className="mt-1 h-8 text-xs"
      />
    </div>
  );
  return (
    <Card
      title="Hard constraints and weights"
      action={
        <Button size="sm" onClick={() => setConstraints(study.id, k)}>
          Apply
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {num("maxSlopePct", "Max slope (%)", 0.5)}
        {num("minCatchmentArea_m2", "Min catchment (m²)", 5000)}
        {num("minDistanceToHouse_m", "Min distance to dwelling (m)", 5)}
        {num("maxDistanceToRoad_m", "Max distance to road (m)", 50)}
        {num("minDistanceToProtected_m", "Min distance to protected land (m)", 10)}
        {num("maxParcelErrorPct", "Max parcel area error (%)", 0.5)}
        {num("runoffCoefficient", "Runoff coefficient", 0.05)}
        {num("designDepth_m", "Design depth (m)", 0.5)}
      </div>
      <div className="mt-4">
        <Label className="text-[11px]">Permitted land use</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LAND_KEYS.map((l) => {
            const on = k.allowedLandUse.includes(l);
            return (
              <button
                key={l}
                onClick={() =>
                  setK({ ...k, allowedLandUse: on ? k.allowedLandUse.filter((x) => x !== l) : [...k.allowedLandUse, l] })
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
              >
                {LAND_LABEL[l]}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Weights are fixed by policy: terrain 0.25, catchment 0.20, rainfall 0.15, land 0.20, accessibility 0.10, data
        confidence 0.10, minus penalties. Changing constraints re-runs scoring immediately.
      </p>
    </Card>
  );
}

function ReviewTab({ study, evals }: { study: Study; evals: Evaluation[] }) {
  const [candidateId, setCandidateId] = useState(evals[0]?.candidate.id ?? "");
  const existing = study.reviews[candidateId];
  const [reviewer, setReviewer] = useState(existing?.reviewer ?? "");
  const [observations, setObservations] = useState(existing?.observations ?? "");
  const [gps, setGps] = useState(existing?.gps ?? "");
  const [decision, setDecision] = useState(existing?.decision ?? "APPROVED");
  const [photos, setPhotos] = useState(existing?.photos ?? []);

  if (evals.length === 0)
    return (
      <Card title="Field verification">
        <p className="text-sm text-muted-foreground">Generate candidates first.</p>
      </Card>
    );

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files)
      .slice(0, 3)
      .forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => setPhotos((p) => [...p, { name: f.name, dataUrl: String(reader.result) }].slice(0, 4));
        reader.readAsDataURL(f);
      });
  };

  return (
    <Card title="Field verification">
      <Label className="text-[11px]">Candidate</Label>
      <select
        value={candidateId}
        onChange={(e) => setCandidateId(e.target.value)}
        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        {evals.map((e) => (
          <option key={e.candidate.id} value={e.candidate.id}>
            {e.candidate.code} — {e.status} ({e.score})
          </option>
        ))}
      </select>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px]">Reviewer</Label>
          <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="mt-1 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[11px]">GPS reading</Label>
          <Input value={gps} onChange={(e) => setGps(e.target.value)} placeholder="21.2510, 81.6300" className="mt-1 h-8 text-xs" />
        </div>
      </div>

      <div className="mt-3">
        <Label className="text-[11px]">Observations</Label>
        <Textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={4}
          className="mt-1 text-xs"
          placeholder="Soil condition, existing use, community feedback, access…"
        />
      </div>

      <div className="mt-3">
        <Label className="text-[11px]">Photographs</Label>
        <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} className="mt-1 block w-full text-[11px]" />
        {photos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((p) => (
              <img key={p.name} src={p.dataUrl} alt={p.name} className="h-16 w-16 rounded border border-border object-cover" />
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["APPROVED", "NEEDS_MORE_DATA", "REJECTED"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDecision(d)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${decision === d ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            {d.replace("_", " ").toLowerCase()}
          </button>
        ))}
      </div>

      <Button
        className="mt-4 w-full"
        size="sm"
        onClick={() =>
          saveReview(study.id, candidateId, {
            reviewer: reviewer || "Unnamed reviewer",
            observations,
            photos,
            decision,
            gps,
            reviewedAt: new Date().toISOString(),
          })
        }
      >
        Save field review
      </Button>

      {Object.keys(study.reviews).length > 0 && (
        <div className="mt-4 space-y-2">
          {Object.entries(study.reviews).map(([id, r]) => {
            const c = study.candidates.find((x) => x.id === id);
            return (
              <div key={id} className="rounded-md border border-border px-3 py-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="font-mono">{c?.code ?? id}</span>
                  <span className="text-muted-foreground">{r.decision}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {r.reviewer} · {new Date(r.reviewedAt).toLocaleString("en-IN")} · {r.photos.length} photo(s)
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ExportTab({ study, evals }: { study: Study; evals: Evaluation[] }) {
  const slug = study.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <Card title="Export">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Exports carry the study configuration, data-source provenance, factor-by-factor explanations, field reviews and
        the stated limitations.
      </p>
      <div className="mt-3 grid gap-2">
        <Button size="sm" onClick={() => printReport(study, evals)} disabled={evals.length === 0}>
          Field verification report (PDF)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => download(`${slug}.json`, JSON.stringify(buildJSON(study, evals), null, 2), "application/json")}
        >
          Full result set (JSON)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(`${slug}.geojson`, JSON.stringify(buildGeoJSON(study, evals), null, 2), "application/geo+json")
          }
        >
          Sites, catchments and parcels (GeoJSON)
        </Button>
      </div>
      <p className="mt-4 rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Planning support only. This output does not certify ownership, soil strength or structural design, and is not a
        construction approval.
      </p>
    </Card>
  );
}