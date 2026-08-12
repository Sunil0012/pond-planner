import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Layers, Map, ScrollText, Sparkles } from "lucide-react";
import { Shell } from "@/components/pond/Shell";
import { VILLAGES } from "@/lib/pond/villages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PondSite — AI village pond planning system" },
      {
        name: "description",
        content:
          "Find and justify village pond sites with terrain, catchment, rainfall, parcel and accessibility evidence — every recommendation explained.",
      },
      { property: "og:title", content: "PondSite — AI village pond planning system" },
      {
        property: "og:description",
        content: "Explainable siting of village ponds from terrain, rainfall, land records and field review.",
      },
    ],
  }),
  component: Index,
});

const STEPS = [
  ["01", "Create study", "Search a village or draw a boundary, pick the CRS and processing buffer."],
  ["02", "Validate", "Check ring closure, CRS, area and tiling before any raster work starts."],
  ["03", "Collect evidence", "DEM, rainfall, OSM context and cadastral layers, each stamped with source and time."],
  ["04", "Terrain & drainage", "Sinks filled, slope, contours, flow direction, accumulation and stream extraction."],
  ["05", "Candidates & catchments", "Low points generated or placed by hand, each with an upstream catchment."],
  ["06", "Runoff & storage", "Rainfall-driven runoff and a trapezoidal storage envelope, reported as a range."],
  ["07", "Parcels", "Computed parcel area compared against the official land record, with an error percentage."],
  ["08", "Score & explain", "Hard constraints first, then a weighted score with factors, penalties and confidence."],
  ["09", "Field review", "Observations, photographs, GPS notes and an approval decision."],
  ["10", "Export", "PDF report, JSON and GeoJSON with assumptions and limitations attached."],
];

function Index() {
  return (
    <Shell>
      <section className="border-b border-border/70">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <p className="label-xs text-primary">Explainable geospatial decision support</p>
          <h1 className="mt-5 max-w-3xl text-4xl leading-[1.05] sm:text-6xl">
            Find where a village pond belongs — and show the evidence behind it.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
            PondSite combines elevation, drainage, rainfall, land records and accessibility into one repeatable
            workflow. It returns a ranked list of candidate sites, each with the facts that supported it and the
            questions still left for the field team.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/studies"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Create a village study <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/design"
              className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm transition-colors hover:bg-secondary"
            >
              Read the high-level design
            </Link>
          </div>

          <dl className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {[
              ["6", "demo villages"],
              ["8", "candidate sites each"],
              ["6", "weighted score factors"],
              ["3", "export formats"],
            ].map(([n, l]) => (
              <div key={l} className="bg-card px-5 py-6">
                <dt className="font-display text-3xl">{n}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-b border-border/70">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl">The end-to-end workflow</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Every stage runs in the browser against demo records, and every stage keeps its assumptions visible.
          </p>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
            {STEPS.map(([n, title, body]) => (
              <li key={n} className="bg-card px-5 py-5">
                <span className="font-mono text-xs text-primary">{n}</span>
                <h3 className="mt-1.5 text-base">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border/70">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-3">
          {[
            [Map, "Layered map workspace", "Satellite, topographic and street bases with elevation contours, slope classes, drainage lines, parcels, catchments and candidate points."],
            [Layers, "Configurable constraints", "Slope ceiling, minimum catchment, setbacks from dwellings and protected land, permitted land use and runoff coefficient."],
            [ScrollText, "Honest reporting", "Suitability and confidence are kept apart. A site can look good and still carry weak evidence — the report says so."],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Map;
            return (
              <div key={title as string}>
                <I className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-lg">{title as string}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-2xl">Demo village records</h2>
          </div>
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {VILLAGES.map((v) => (
              <Link
                key={v.id}
                to="/studies"
                className="group bg-card px-5 py-5 transition-colors hover:bg-secondary"
              >
                <h3 className="text-base">{v.name}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {v.district}, {v.state}
                </p>
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  {v.center.lat.toFixed(4)}, {v.center.lng.toFixed(4)} · {v.demDataset}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </Shell>
  );
}