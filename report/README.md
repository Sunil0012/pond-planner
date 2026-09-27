# PondSite Pro — 5-Minute Video Script

## VIDEO STRUCTURE (Total ~5 minutes)

| Segment | Duration | Topic |
|---------|----------|-------|
| 1 | 0:00-0:45 | Problem statement & introduction |
| 2 | 0:45-1:30 | System architecture deep-dive |
| 3 | 1:30-2:30 | Live demo — Circle analysis |
| 4 | 2:30-3:30 | Live demo — Contour analysis + map labels |
| 5 | 3:30-4:15 | History, database & load balancer |
| 6 | 4:15-5:00 | Report, infrastructure & conclusion |

---

## NARRATION SCRIPT

### SEGMENT 1 — Problem Statement (0:00-0:45)
> Show: title slide / project poster / KML map of a rural area

"Water scarcity in rural India affects over 600 million people. Traditional pond site selection
relies on manual surveys — expensive, slow, and prone to human error. Our project, PondSite Pro,
automates this process using real-time geospatial data, terrain analysis, and a weighted scoring
algorithm — all accessible from a web browser.

In 5 minutes I'll show you how the system works, what technology powers it, and how it identifies
the best pond location in a 500-metre radius in under 30 seconds."

---

### SEGMENT 2 — Architecture (0:45-1:30)
> Show: architecture diagram (draw on whiteboard or show the diagram in this file)

"The architecture has three layers.

At the bottom are Data Sources. We pull real terrain elevation from Copernicus DEM via the
Open-Meteo elevation API, rainfall from the ERA5 archive with automatic fallback to live forecast
and regional climatology if the archive is unavailable, and water body and road data from
OpenStreetMap's Overpass API.

In the middle is the Backend — a Node.js and TypeScript Express server that:
  1. Builds a Digital Elevation Model grid over the study area
  2. Runs D8 flow-direction hydrology to compute catchments
  3. Scores candidates on 4 weighted factors
  4. Applies hard exclusions for water bodies and steep slopes
  5. Saves every result to a persistent JSON database

At the top is the Frontend — a React single-page app with interactive Leaflet maps, catchment
polygon labels, monthly rainfall charts, and the History feature.

For production, we run 4 identical backend instances managed by PM2, with a custom Go load
balancer on port 3000 — one Node.js instance per SSH port (2205 through 2208)."

---

### SEGMENT 3 — Circle Analysis Demo (1:30-2:30)
> Show: the app, enter coordinates, set radius to 500m, click Run

"Let me demonstrate. I enter GPS coordinates for our study area in Chhattisgarh and set a
500-metre analysis radius. I click Run Analysis.

[Wait for results — about 20 seconds]

The system fetched live elevation data, ERA5 rainfall showing roughly 900 mm annually, and
OpenStreetMap water features. It found several candidate pond sites, ranked by suitability.

Look at the map. Each catchment polygon is now labelled directly — you can see the rank number,
the site code, the score out of 100, the catchment area in square metres, and the status badge.
This gives a field engineer everything they need at a glance.

The top site is RECOMMENDED with HIGH confidence. Its upstream catchment yields annual runoff
matched against a terrain-derived storage volume at 3 metres depth."

---

### SEGMENT 4 — Contour Analysis + Labels (2:30-3:30)
> Show: upload contours_1m.kml in the Contour Analysis card

"For more precise analysis, engineers can upload a KML contour map from a local survey.
I upload our 1-metre interval contour file.

[Upload and wait]

The contour analysis reads elevation directly from the KML, builds a finer DEM, traces drainage
lines using stream ordering, and identifies catchments with sub-metre accuracy.

The map shows brown contour lines, blue drainage networks, and coloured catchment polygons
— each labelled with rank, score, catchment area, and status. Clicking any polygon opens a
popup with the full data table: catchment in hectares, annual runoff, storage volume, slope,
elevation, and a plain-English explanation of why this site was chosen."

---

### SEGMENT 5 — History & Load Balancer (3:30-4:15)
> Show: click "History" in the nav bar

"Every analysis is automatically saved to our database — a lightweight JSON store requiring
no external database server. The History tab shows all past analyses with timestamps, the
inferred region name, rainfall, top score, and candidate count.

Clicking any entry replays the full map and results — teams can compare analyses across dates
and locations without re-running the computation.

[Show architecture diagram highlighting nginx and PM2]

On the server, we run 4 Node.js instances on ports 3001 to 3004 managed by PM2. Even if a
terminal closes or the server reboots, PM2 restarts all processes automatically. Nginx on port
3000 distributes requests round-robin with automatic failover — if one instance goes down,
traffic shifts to the remaining three."

---

### SEGMENT 6 — Report & Conclusion (4:15-5:00)
> Show: click "Report" in nav, scroll through the table

"The Report page presents the full candidate table — ranked, with status badges, confidence
levels, catchment area, runoff, storage, slope, and elevation — ready to include in a
project submission. Below is the monthly rainfall chart showing which months drive monsoon
runoff, pulled from ERA5 historical data.

To summarise: PondSite Pro replaces weeks of manual survey with a 30-second automated analysis.
It combines real terrain data, live rainfall records, and satellite water features. It runs on
load-balanced infrastructure with persistent history. And it delivers a professional ranked
report with geo-referenced candidates — ready for field verification.

This is PondSite Pro — intelligent water conservation planning for rural India."

---

## ARCHITECTURE DIAGRAM

```
+---------------------------------------------------------+
|                      CLIENTS                            |
|           Browser (React + Vite + Leaflet)              |
+-------------------------+-------------------------------+
                          | HTTP :3000
+-------------------------v-------------------------------+
|       Go LOAD BALANCER (port 3000) [custom pondlb]      |
|      Round-robin + health-check + static SPA serving    |
+----+----------+----------+----------+------------------+
     |:3001     |:3002     |:3003     |:3004
  +--v---+   +--v---+   +--v---+   +--v---+
  |Node  |   |Node  |   |Node  |   |Node  |
  |PM2-1 |   |PM2-2 |   |PM2-3 |   |PM2-4 |
  |:3001 |   |:3002 |   |:3003 |   |:3004 |
  +--+---+   +--+---+   +--+---+   +--+---+
     +----------+-----------+----------+
                |
     +----------+-----------+
     |          |            |
+----v----+ +---v----+  +----v----+
|Open-Meteo| |OSM     |  |JSON DB  |
|Elevation | |Overpass|  |history  |
|+ Rainfall| |water + |  |(persist)|
|ERA5 arch | |roads   |  |         |
+----------+ +--------+  +---------+
```

## SCORING ALGORITHM

```
Score = 0.36 x Flow Convergence   (upstream catchment size)
      + 0.28 x Slope Score        (lower slope = higher score)
      + 0.21 x Concavity          (natural depression depth)
      + 0.15 x Data Quality       (DEM sampling confidence)

Hard exclusions:
  - Slope > 8%
  - Catchment < 1000 m2
  - Inside existing water body

Classification:
  Score >= 62 AND no cautions  ->  RECOMMENDED
  Score <  62 OR has cautions  ->  CONDITIONAL
  Fails any hard constraint    ->  REJECTED
```

## TIPS FOR RECORDING

1. Screen record at 1920x1080 with Chrome
2. Use satellite base map for the demo — looks impressive on video
3. Pre-run one analysis so History tab has data before recording
4. Upload contours_1m.kml for the contour demo (file is in the parent folder)
5. Narrate at ~130 words/minute for a 5-minute result
6. B-roll ideas: zoom into catchment label, click a popup, switch map layers, show History replay
