import type { Evaluation } from "./engine";
import { LAND_LABEL } from "./engine";
import { toGeoJSONPolygon } from "./geo";
import type { Study } from "./types";

export function buildJSON(study: Study, evals: Evaluation[]) {
  return {
    generated_at: new Date().toISOString(),
    study: {
      study_id: study.id,
      name: study.name,
      village: `${study.village.name}, ${study.village.district}, ${study.village.state}`,
      crs: study.crs,
      buffer_m: study.bufferM,
      created_at: study.createdAt,
      configuration_snapshot: study.constraints,
      validation: study.validation ?? null,
    },
    data_sources: study.sources,
    terrain: study.terrain ?? null,
    rainfall: study.rainfall ?? null,
    recommendations: evals.map((e) => ({
      recommendation_id: e.candidate.id,
      code: e.candidate.code,
      status: e.status,
      location: { latitude: Number(e.candidate.location.lat.toFixed(6)), longitude: Number(e.candidate.location.lng.toFixed(6)) },
      catchment_area_m2: e.candidate.catchmentArea_m2,
      rainfall: study.rainfall
        ? { annual_mm: study.rainfall.annual_mm, source: study.rainfall.provider, period: study.rainfall.period }
        : null,
      runoff_m3: e.runoff_m3,
      storage_range_m3: e.storage.storageRange,
      parcel: {
        parcel_id: e.candidate.parcelId,
        land_use: LAND_LABEL[e.candidate.landUse],
        official_area_m2: e.candidate.officialArea_m2,
        computed_area_m2: e.candidate.computedArea_m2,
        error_percent: Number(e.parcelErrorPct.toFixed(2)),
        status: e.parcelErrorPct > study.constraints.maxParcelErrorPct ? "REVIEW_REQUIRED" : "PASS",
      },
      score: e.score,
      confidence: e.confidence,
      factors: e.factors.map((f) => ({ factor: f.label, weight: f.weight, value: Number(f.value.toFixed(3)), detail: f.detail })),
      penalties: e.penalties,
      failed_constraints: e.failures,
      warnings: e.warnings,
      next_action: e.nextAction,
      field_review: study.reviews[e.candidate.id] ?? null,
    })),
    limitations: [
      "Planning support only — not a substitute for a cadastral survey or engineering approval.",
      "Storage volumes are preliminary envelopes based on a trapezoidal approximation.",
      "Parcel geometry is derived from demo cadastral imagery and must be verified in the field.",
    ],
  };
}

export function buildGeoJSON(study: Study, evals: Evaluation[]) {
  const features: unknown[] = [
    {
      type: "Feature",
      properties: { kind: "study_boundary", study_id: study.id, village: study.village.name, crs: study.crs },
      geometry: toGeoJSONPolygon(study.village.boundary),
    },
  ];
  for (const e of evals) {
    const c = e.candidate;
    features.push({
      type: "Feature",
      properties: {
        kind: "candidate_site",
        code: c.code,
        status: e.status,
        score: e.score,
        confidence: e.confidence,
        catchment_area_m2: c.catchmentArea_m2,
        runoff_m3: e.runoff_m3,
        land_use: LAND_LABEL[c.landUse],
        parcel_id: c.parcelId,
        next_action: e.nextAction,
      },
      geometry: { type: "Point", coordinates: [Number(c.location.lng.toFixed(6)), Number(c.location.lat.toFixed(6))] },
    });
    features.push({
      type: "Feature",
      properties: { kind: "catchment", code: c.code, area_m2: c.catchmentArea_m2, edge_truncated: c.edgeTruncated },
      geometry: toGeoJSONPolygon(c.catchment),
    });
    features.push({
      type: "Feature",
      properties: { kind: "parcel", code: c.code, parcel_id: c.parcelId, official_area_m2: c.officialArea_m2, computed_area_m2: c.computedArea_m2 },
      geometry: toGeoJSONPolygon(c.parcel),
    });
  }
  return { type: "FeatureCollection", name: `${study.name} — pond planning`, features };
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function printReport(study: Study, evals: Evaluation[]) {
  const rows = evals
    .map(
      (e) => `<tr>
      <td><b>${e.candidate.code}</b></td>
      <td>${e.candidate.location.lat.toFixed(5)}, ${e.candidate.location.lng.toFixed(5)}</td>
      <td>${e.status}</td><td>${e.score}</td><td>${e.confidence}</td>
      <td>${e.candidate.catchmentArea_m2.toLocaleString("en-IN")}</td>
      <td>${e.runoff_m3.toLocaleString("en-IN")}</td>
      <td>${e.storage.storageRange[0].toLocaleString("en-IN")}–${e.storage.storageRange[1].toLocaleString("en-IN")}</td>
      <td>${e.parcelErrorPct.toFixed(2)}%</td>
    </tr>`,
    )
    .join("");

  const detail = evals
    .map(
      (e) => `<section class="card">
      <h3>${e.candidate.code} — ${e.status} · score ${e.score} · confidence ${e.confidence}</h3>
      <p class="mono">${e.candidate.location.lat.toFixed(6)}, ${e.candidate.location.lng.toFixed(6)} · parcel ${e.candidate.parcelId} · ${LAND_LABEL[e.candidate.landUse]} · ${e.candidate.soil}</p>
      <ul>${e.factors.map((f) => `<li><b>${f.label}</b> (weight ${f.weight}, value ${(f.value * 100).toFixed(0)}%) — ${f.detail}</li>`).join("")}</ul>
      ${e.penalties.length ? `<p><b>Penalties:</b> ${e.penalties.map((p) => `${p.label} (−${p.points})`).join(", ")}</p>` : ""}
      ${e.failures.length ? `<p><b>Failed hard constraints:</b> ${e.failures.join(" ")}</p>` : ""}
      ${e.warnings.length ? `<p><b>Needs verification:</b> ${e.warnings.join(" ")}</p>` : ""}
      <p><b>Next action:</b> ${e.nextAction}</p>
      ${
        study.reviews[e.candidate.id]
          ? `<p><b>Field review:</b> ${study.reviews[e.candidate.id]!.decision} by ${study.reviews[e.candidate.id]!.reviewer} — ${study.reviews[e.candidate.id]!.observations}</p>`
          : ""
      }
    </section>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${study.name} — field verification report</title>
  <style>
    body{font:12px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a2e;margin:32px;}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
    h3{font-size:13px;margin:0 0 6px}
    table{width:100%;border-collapse:collapse;font-size:11px} th,td{border:1px solid #d8dcd9;padding:5px 6px;text-align:left}
    th{background:#f2f4f2} .mono{font-family:ui-monospace,monospace;color:#5a6a6d}
    .card{border:1px solid #e0e4e1;border-radius:6px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}
    ul{margin:6px 0 6px 16px;padding:0} .muted{color:#66767a}
  </style></head><body>
  <h1>${study.name}</h1>
  <p class="muted">${study.village.name}, ${study.village.district}, ${study.village.state} · CRS ${study.crs} · buffer ${study.bufferM} m · generated ${new Date().toLocaleString("en-IN")}</p>
  <h2>Rainfall</h2>
  <p>${study.rainfall ? `${study.rainfall.annual_mm} mm over ${study.rainfall.period}, source: ${study.rainfall.provider} (retrieved ${new Date(study.rainfall.retrievedAt).toLocaleString("en-IN")})` : "Not fetched."}</p>
  <h2>Terrain</h2>
  <p>${study.terrain ? `${study.terrain.demSource} at ${study.terrain.resolution_m} m · elevation ${study.terrain.minElevation_m}–${study.terrain.maxElevation_m} m · mean slope ${study.terrain.meanSlope_pct}% · ${study.terrain.sinksFilled} sinks filled · ${study.terrain.drainageLines} drainage lines` : "Not analysed."}</p>
  <h2>Candidate summary</h2>
  <table><thead><tr><th>Site</th><th>Coordinates</th><th>Status</th><th>Score</th><th>Confidence</th><th>Catchment m²</th><th>Runoff m³</th><th>Storage m³</th><th>Parcel error</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Explanations</h2>${detail}
  <h2>Limitations</h2>
  <p class="muted">Planning support only. This report does not certify ownership, soil strength, or structural design, and does not constitute construction approval. All coordinates require field verification.</p>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}