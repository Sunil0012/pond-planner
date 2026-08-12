import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MapPin, Search, Trash2 } from "lucide-react";
import { Shell } from "@/components/pond/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createStudy, deleteStudy, useStudies } from "@/lib/pond/store";
import { searchVillages, VILLAGES } from "@/lib/pond/villages";
import { polygonAreaM2 } from "@/lib/pond/geo";
import type { Village } from "@/lib/pond/types";

export const Route = createFileRoute("/studies/")({
  head: () => ({
    meta: [
      { title: "Village studies — PondSite" },
      {
        name: "description",
        content: "Create a village pond study: search a village or enter a boundary, set the CRS and processing buffer.",
      },
      { property: "og:title", content: "Village studies — PondSite" },
      { property: "og:description", content: "Create and open village pond planning studies." },
    ],
  }),
  component: StudiesPage,
});

const CRS_OPTIONS = ["EPSG:32643 / UTM 43N", "EPSG:32644 / UTM 44N", "EPSG:32645 / UTM 45N", "EPSG:7755 / WGS84 India"];

function StudiesPage() {
  const studies = useStudies();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Village | null>(VILLAGES[0] ?? null);
  const [customLat, setCustomLat] = useState("");
  const [customLng, setCustomLng] = useState("");
  const [crs, setCrs] = useState(CRS_OPTIONS[1]!);
  const [buffer, setBuffer] = useState(250);
  const [name, setName] = useState("");

  const results = useMemo(() => searchVillages(q), [q]);

  const start = () => {
    let village = selected;
    const lat = Number(customLat);
    const lng = Number(customLng);
    if (customLat && customLng && Number.isFinite(lat) && Number.isFinite(lng) && village) {
      const dLat = lat - village.center.lat;
      const dLng = lng - village.center.lng;
      village = {
        ...village,
        id: `${village.id}_custom`,
        name: `${village.name} (custom extent)`,
        center: { lat, lng },
        boundary: village.boundary.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng })),
      };
    }
    if (!village) return;
    const study = createStudy(village, {
      name: name.trim() || `${village.name} pond study`,
      crs,
      bufferM: buffer,
    });
    navigate({ to: "/studies/$studyId", params: { studyId: study.id } });
  };

  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-5 py-12">
        <h1 className="text-3xl">Village studies</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Search a demo village or enter your own coordinates as the study centre, then validate the boundary and CRS
          in the workspace.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg">1 · Choose a village</h2>
            </div>
            <div className="px-5 py-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search village, district or state"
                  className="pl-9"
                />
              </div>
              <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border">
                {results.map((v) => {
                  const active = selected?.id.startsWith(v.id);
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(v)}
                        className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
                      >
                        <span>
                          <span className="block text-sm">{v.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {v.district}, {v.state} · {(polygonAreaM2(v.boundary) / 10000).toFixed(0)} ha ·{" "}
                            {v.demDataset}
                          </span>
                        </span>
                        <MapPin className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      </button>
                    </li>
                  );
                })}
                {results.length === 0 && (
                  <li className="px-4 py-6 text-sm text-muted-foreground">No village matched that search.</li>
                )}
              </ul>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg">2 · Study configuration</h2>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <Label htmlFor="name">Study name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected ? `${selected.name} pond study` : "Study name"}
                  className="mt-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lat">Boundary centre latitude</Label>
                  <Input id="lat" value={customLat} onChange={(e) => setCustomLat(e.target.value)} placeholder="optional" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="lng">Longitude</Label>
                  <Input id="lng" value={customLng} onChange={(e) => setCustomLng(e.target.value)} placeholder="optional" className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label htmlFor="crs">Projected CRS for analysis</Label>
                <select
                  id="crs"
                  value={crs}
                  onChange={(e) => setCrs(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CRS_OPTIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="buffer">Processing buffer — {buffer} m</Label>
                <input
                  id="buffer"
                  type="range"
                  min={0}
                  max={1000}
                  step={50}
                  value={buffer}
                  onChange={(e) => setBuffer(Number(e.target.value))}
                  className="mt-3 w-full accent-primary"
                />
              </div>
              <Button className="w-full" onClick={start} disabled={!selected}>
                Create village study
              </Button>
            </div>
          </section>
        </div>

        <section className="mt-14">
          <h2 className="text-xl">Saved studies</h2>
          {studies.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No studies yet. Create one above — studies are stored in this browser.
            </p>
          ) : (
            <ul className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {studies.map((s) => (
                <li key={s.id} className="bg-card">
                  <div className="flex items-start justify-between gap-3 px-5 py-4">
                    <Link to="/studies/$studyId" params={{ studyId: s.id }} className="min-w-0 flex-1">
                      <span className="block truncate text-base">{s.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {s.village.district}, {s.village.state} · {s.crs}
                      </span>
                      <span className="mt-2 block font-mono text-[11px] text-muted-foreground">
                        {s.candidates.length} candidates · created {new Date(s.createdAt).toLocaleDateString("en-IN")}
                      </span>
                    </Link>
                    <button
                      type="button"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => deleteStudy(s.id)}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}