import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/pond/Shell";

export const Route = createFileRoute("/design")({
  head: () => ({
    meta: [
      { title: "High-level design — PondSite pond planning system" },
      {
        name: "description",
        content:
          "Architecture, algorithms, data model, API design and roadmap for the AI-based village pond planning system.",
      },
      { property: "og:title", content: "High-level design — PondSite" },
      { property: "og:description", content: "Architecture, algorithms, API design and roadmap for village pond siting." },
    ],
  }),
  component: DesignPage,
});

function H2({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mt-14 scroll-mt-20 border-b border-border pb-2 text-2xl first:mt-0">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface px-4 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top text-muted-foreground">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </Tag>
  );
}

const TOC = [
  ["problem", "Problem statement and objectives"],
  ["architecture", "Overall system architecture"],
  ["functional", "Functional requirements and workflow"],
  ["stack", "Proposed technology stack"],
  ["api", "API design"],
  ["algorithms", "Algorithms and methodology"],
  ["data", "Data model"],
  ["challenges", "Challenges and solutions"],
  ["quality", "Reliability, security and quality"],
  ["roadmap", "Roadmap"],
  ["success", "Success criteria"],
];

function DesignPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-5 py-12">
        <p className="label-xs text-primary">High-level design</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-tight">AI-based village pond planning system</h1>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The central design principle is simple: every recommendation should be explainable. A user should be able to
          see which terrain, rainfall, land and accessibility facts contributed to a result, and which assumptions
          still need field verification.
        </p>

        <div className="mt-12 grid gap-12 lg:grid-cols-[200px_1fr]">
          <nav className="hidden lg:block">
            <div className="sticky top-20 space-y-1.5 text-sm">
              {TOC.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="block text-muted-foreground transition-colors hover:text-foreground">
                  {label}
                </a>
              ))}
            </div>
          </nav>

          <article className="min-w-0">
            <H2 id="problem">1 · Problem statement and objectives</H2>
            <P>
              Selecting a village pond location manually is time-consuming and depends on disconnected sources. A
              low-lying area may still be unsuitable if its catchment is too small, the parcel is unavailable, the
              slope is unsafe, or it sits too close to houses, roads, utilities or protected land. This system combines
              spatial datasets and domain rules into one repeatable workflow and explains why each candidate is
              recommended, conditional or rejected.
            </P>
            <List
              items={[
                "Identify multiple possible pond locations for a selected village.",
                "Analyse elevation, slope, drainage, flow accumulation and catchment area.",
                "Estimate rainfall-driven runoff and preliminary storage capacity.",
                "Verify land parcels using official records and map imagery.",
                "Apply configurable safety and accessibility constraints.",
                "Rank candidates using an explainable suitability score.",
                "Show data sources, timestamps, assumptions, confidence and limitations.",
                "Export a field-verification report with coordinates and evidence.",
              ]}
            />
            <P>
              <strong className="text-foreground">Scope boundaries.</strong> Planning support and preliminary estimates
              only. No final structural design, no legal establishment of ownership, no replacement for a cadastral
              survey, no soil-strength certification and no construction approval.
            </P>

            <H2 id="architecture">2 · Overall system architecture</H2>
            <P>
              The architecture separates the interface, API layer, geospatial processing, decision engine and storage.
              Expensive raster and report operations run as background jobs so the web interface stays responsive.
            </P>
            <Pre>{`Planner / GIS operator ─┐
Field survey team ──────┴─▶ Web map interface ─▶ FastAPI backend
                                                   ├─ Auth & validation
                                                   └─ Job queue ─┬─▶ Terrain & catchment worker ─┐
                                                                 ├─▶ Rainfall worker ────────────┼─▶ Explainable
                                                                 └─▶ Parcel & land worker ───────┘   decision engine
                                                                                                       │
                                        PostgreSQL + PostGIS ◀───────────────────────────────────────┤
                                        Object storage       ◀───────────────────────────────────────┘
                                                   │
                                        PDF / GeoJSON / JSON reports ─▶ Web map interface`}</Pre>
            <Table
              head={["Component", "Responsibility"]}
              rows={[
                ["Web interface", "Map interaction, layer control, forms, candidate comparison, report access"],
                ["API backend", "Authentication, validation, orchestration, job status and API contracts"],
                ["Terrain worker", "DEM preparation, slope, contours, flow direction, accumulation and catchments"],
                ["Rainfall worker", "Provider integration, rainfall summaries, runoff estimates and caching"],
                ["Land worker", "Parcel lookup, WMS imagery, mask extraction and area comparison"],
                ["Decision engine", "Hard constraints, weighted score, confidence and explanation generation"],
                ["PostgreSQL / PostGIS", "Users, studies, geometries, scores, metadata and spatial queries"],
                ["Object storage", "DEMs, raster outputs, imagery, photographs and reports"],
                ["Job queue", "Reliable execution of long-running and retryable tasks"],
              ]}
            />
            <Pre>{`Browser ─▶ HTTPS / reverse proxy ─▶ Application container
                                        ├─▶ PostgreSQL + PostGIS
                                        └─▶ Redis ─▶ GIS and report workers
                                                       ├─▶ S3-compatible object storage
                                                       └─▶ External GIS and weather APIs`}</Pre>

            <H2 id="functional">3 · Functional requirements and workflow</H2>
            <List
              ordered
              items={[
                "Users can search for a village or enter a study boundary.",
                "Users can view satellite, elevation, slope, contour, drainage and parcel layers.",
                "The system can generate or accept candidate pond points.",
                "The system can delineate an upstream catchment for a candidate.",
                "Rainfall data can be fetched, cached and displayed with its source and period.",
                "Parcel area can be compared with official land-record information.",
                "Candidates can be filtered using configurable hard constraints.",
                "Candidates receive a suitability score and confidence level.",
                "Each score includes a human-readable explanation.",
                "Field reviewers can record observations, photographs and approval status.",
                "Users can export results as PDF, JSON and GeoJSON.",
              ]}
            />
            <Pre>{`Create village study
  ▶ Validate boundary and CRS
  ▶ Collect DEM, rainfall, parcel and constraint data
  ▶ Process terrain and drainage
  ▶ Generate candidate low points
  ▶ Delineate catchment for each candidate
  ▶ Estimate runoff and storage
  ▶ Verify parcel and land constraints
  ▶ Passes hard constraints?  ── no ─▶ Reject with reason
           │ yes
  ▶ Calculate suitability and confidence
  ▶ Rank and compare candidates
  ▶ Field verification
  ▶ Export planning report`}</Pre>

            <H2 id="stack">4 · Proposed technology stack</H2>
            <Table
              head={["Layer", "Technology", "Reason"]}
              rows={[
                ["Frontend", "React, TypeScript, HTML/CSS", "Component-based, maintainable interface"],
                ["Map", "Leaflet or OpenLayers", "Raster/vector layer display and interaction"],
                ["Charts", "Recharts or ECharts", "Rainfall, score and storage visualisation"],
                ["Backend", "Python, FastAPI, Pydantic", "Typed API contracts and automatic documentation"],
                ["Raster GIS", "GDAL, Rasterio, NumPy", "DEM clipping and raster calculations"],
                ["Vector GIS", "GeoPandas, Shapely, PyProj", "Geometry, buffering, overlays and CRS conversion"],
                ["Hydrology", "PySheds or WhiteboxTools", "Flow direction, accumulation, streams and catchments"],
                ["Computer vision", "OpenCV", "Parcel highlighting and WMS mask extraction"],
                ["Database", "PostgreSQL with PostGIS", "Spatial indexing and transactional storage"],
                ["Background jobs", "Redis with Celery or RQ", "Long-running analysis and retry handling"],
                ["File storage", "S3-compatible object storage", "Large rasters, photographs and reports"],
                ["Reports", "Jinja2 and WeasyPrint", "Reproducible HTML-to-PDF reporting"],
                ["Deployment", "Docker and Nginx", "Portable and repeatable deployment"],
                ["Testing", "Pytest, Playwright, GIS fixtures", "Unit, API, UI and spatial testing"],
              ]}
            />
            <P>
              External sources: Open-Meteo or NASA POWER for rainfall, OpenStreetMap for roads and buildings, official
              cadastral/Bhunaksha WMS or WFS for parcels, SRTM/ALOS/CartoDEM for elevation, and optional satellite
              tiles for visual inspection. All providers sit behind adapter classes so one outage does not require
              changes to the analysis engine.
            </P>

            <H2 id="api">5 · API design</H2>
            <Pre>{`GET  /api/v1/villages/search?q={name}
POST /api/v1/studies
GET  /api/v1/studies/{study_id}
GET  /api/v1/studies/{study_id}/layers/{layer_name}
POST /api/v1/studies/{study_id}/data/refresh

POST /api/v1/studies/{study_id}/terrain/analyze
POST /api/v1/studies/{study_id}/candidates/generate
POST /api/v1/studies/{study_id}/catchments/delineate
POST /api/v1/studies/{study_id}/rainfall/analyze
POST /api/v1/studies/{study_id}/parcels/verify
POST /api/v1/studies/{study_id}/recommendations/generate
GET  /api/v1/jobs/{job_id}

GET  /api/v1/recommendations/{id}
GET  /api/v1/recommendations/{id}/explanation
POST /api/v1/recommendations/{id}/field-review
GET  /api/v1/recommendations/{id}/report
GET  /api/v1/recommendations/{id}/export.geojson`}</Pre>
            <Pre>{`{
  "recommendation_id": "rec_001",
  "status": "CONDITIONAL",
  "location": {"latitude": 21.25, "longitude": 81.63},
  "catchment_area_m2": 125000,
  "rainfall": {"annual_mm": 1100, "source": "open-meteo"},
  "runoff_m3": 61000,
  "storage_range_m3": [55000, 70000],
  "parcel": {"status": "REVIEW_REQUIRED", "error_percent": 0.47},
  "score": 82.0,
  "confidence": "MEDIUM",
  "next_action": "Verify parcel boundary and soil condition in the field"
}`}</Pre>

            <H2 id="algorithms">6 · Algorithms and methodology</H2>
            <P>
              <strong className="text-foreground">Terrain and catchment.</strong> Load the DEM, validate CRS,
              resolution, extent and NoData, clip to the boundary plus buffer, fill sinks, derive slope and contours,
              compute flow direction and accumulation, extract drainage above a threshold, generate candidate low
              points and trace upstream cells into a catchment polygon.
            </P>
            <Pre>{`Runoff volume = rainfall (m) × catchment area (m²) × runoff coefficient`}</Pre>
            <Pre>{`pixel_width   = BBOX_width  / image_width
pixel_height  = BBOX_height / image_height
computed_area = selected_pixels × pixel_width × pixel_height
error_percent = |computed_area - official_area| / official_area × 100`}</Pre>
            <Pre>{`score =
    0.25 × terrain suitability
  + 0.20 × catchment adequacy
  + 0.15 × rainfall/runoff potential
  + 0.20 × land availability
  + 0.10 × accessibility
  + 0.10 × data confidence
  - constraint penalties`}</Pre>
            <Pre>{`Volume = depth / 3 × (bottom_area + top_area + √(bottom_area × top_area))`}</Pre>
            <P>
              Suitability and confidence are reported separately: a site may look suitable and still rest on weak
              evidence. Large parcel discrepancies, missing metadata or low-resolution imagery raise a review flag
              rather than an automatic approval.
            </P>

            <H2 id="data">7 · Data model</H2>
            <Pre>{`Study           study_id, village_id, boundary, configuration_snapshot, status, timestamps
DataSource      provider, dataset, version, URL, retrieval_time, CRS, response_hash
TerrainAnalysis study_id, DEM source, resolution, elevation statistics, slope statistics
Catchment       candidate_id, geometry, area_m2, flow statistics
RainfallRecord  study_id, provider, period, annual_mm, monthly_values, raw_payload_path
CandidateSite   study_id, location, constraint_status, score, confidence, explanation
PondDesign      candidate_id, footprint, depth_range, storage_range, assumptions
FieldReview     candidate_id, reviewer, observations, photographs, decision, reviewed_at`}</Pre>

            <H2 id="challenges">8 · Challenges and proposed solutions</H2>
            <Table
              head={["Challenge", "Proposed solution"]}
              rows={[
                ["Different datasets use different CRS values", "Validate CRS on ingestion and transform to one study CRS"],
                ["DEM has sinks, gaps or low resolution", "Quality checks, sink filling, uncertainty flags, preserved metadata"],
                ["Rainfall provider unavailable", "Timeouts, retries, cached responses and a visible fallback status"],
                ["Catchment unreliable near edges", "Buffered processing extent and edge-truncation flags"],
                ["WMS images carry labels and noise", "Controlled styles, mask extraction, morphology, confidence thresholds"],
                ["Official area differs from computed area", "Show the error and send the parcel to manual review"],
                ["Candidate score appears arbitrary", "Store weights and give a factor-by-factor explanation"],
                ["Large rasters make requests slow", "Async processing, cached outputs, rasters outside the database"],
                ["External APIs change format or limits", "Provider adapters, schema validation, rate limits, contract tests"],
                ["Field conditions differ from desktop data", "A field-review stage with GPS notes and photographs"],
                ["Sensitive land information exposed", "Role-based access, audit logs and controlled exports"],
              ]}
            />

            <H2 id="quality">9 · Reliability, security and quality</H2>
            <List
              items={[
                "Every job has a visible state: CREATED, RUNNING, COMPLETED, NEEDS_REVIEW or FAILED.",
                "Temporary provider errors are retryable and partial results are clearly labelled.",
                "Inputs, parameters and source versions are preserved for reproducibility.",
                "Role-based access for administrators, GIS operators, reviewers and viewers.",
                "API keys in environment variables or a secrets manager; validated inputs; rate-limited analysis endpoints.",
                "Audit log of user actions and report downloads.",
                "Map interaction stays fast; long operations return a job ID immediately; spatial indexes on all vector queries.",
              ]}
            />

            <H2 id="roadmap">10 · Roadmap</H2>
            <Table
              head={["Phase", "Content"]}
              rows={[
                ["1 · Foundation", "Repository, Docker, authentication, PostGIS schema, village search, basic map workspace"],
                ["2 · Terrain MVP", "DEM processing, slope, contours, flow accumulation, catchments, candidate generation"],
                ["3 · Hydrology and land", "Rainfall adapters, runoff, parcel verification, WMS processing, review flags"],
                ["4 · Decision and reporting", "Constraints, explainable scoring, confidence, comparison, PDF and GeoJSON export"],
                ["5 · Field validation", "Mobile review forms, photographs, GPS observations, acceptance testing, pilot"],
              ]}
            />

            <H2 id="success">11 · Success criteria</H2>
            <List
              ordered
              items={[
                "Create a study for a village.",
                "View the relevant map layers.",
                "Generate at least one candidate catchment.",
                "See rainfall data with its source and time period.",
                "Compare official and computed parcel areas.",
                "View runoff, storage, score and confidence assumptions.",
                "Understand why a candidate passed or failed.",
                "Record field verification results.",
                "Export a reproducible planning report.",
              ]}
            />
            <blockquote className="mt-10 border-l-2 border-primary bg-surface px-5 py-4 text-sm italic leading-relaxed">
              A good recommendation is useful, explainable, reproducible, and honest about what still needs to be
              verified.
            </blockquote>
          </article>
        </div>
      </div>
    </Shell>
  );
}