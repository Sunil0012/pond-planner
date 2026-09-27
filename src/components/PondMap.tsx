import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, TileLayer } from "leaflet";
import type { AnalyzeCircleResponse, AnalyzeContourResponse, LatLng, PondCandidate } from "../lib/types";

export type BaseKey = "satellite" | "terrain" | "street";

const BASES: Record<BaseKey, { name: string; url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
  terrain: {
    name: "Terrain",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap (CC-BY-SA), SRTM",
    maxZoom: 17,
  },
  street: {
    name: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
};

const STATUS_COLORS: Record<string, string> = {
  RECOMMENDED: "#0f766e",
  CONDITIONAL: "#c98a1e",
  REJECTED: "#b3453b",
};

const CONTOUR_COLOR = "#8a6b2f";

export interface PondMapProps {
  center: LatLng;
  radiusM: number;
  base: BaseKey;
  circleResult: AnalyzeCircleResponse | null;
  contourResult: AnalyzeContourResponse | null;
  selected: PondCandidate | null;
  onSelect: (c: PondCandidate) => void;
  onPickPoint?: (lat: number, lng: number) => void;
  picking?: boolean;
}

export function PondMap({
  center,
  radiusM,
  base,
  circleResult,
  contourResult,
  selected,
  onSelect,
  onPickPoint,
  picking,
}: PondMapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const baseLayer = useRef<TileLayer | null>(null);
  const dataLayer = useRef<LayerGroup | null>(null);
  const pickRef = useRef(onPickPoint);
  pickRef.current = onPickPoint;
  const [ready, setReady] = useState(false);

  /** Compute a bounds object for the study circle. */
  const boundsFor = useCallback(
    (c: LatLng, r: number) => {
      const kx = 111320 * Math.cos((c.lat * Math.PI) / 180);
      const dLat = r / 110574;
      const dLng = r / kx;
      return [
        [c.lat - dLat, c.lng - dLng],
        [c.lat + dLat, c.lng + dLng],
      ] as [[number, number], [number, number]];
    },
    [],
  );

  // ---- init map once ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(el.current, { zoomControl: true }).setView([center.lat, center.lng], 15);
      map.current = m;
      baseLayer.current = leaflet
        .tileLayer(BASES[base].url, { attribution: BASES[base].attribution, maxZoom: BASES[base].maxZoom })
        .addTo(m);
      dataLayer.current = leaflet.layerGroup().addTo(m);
      m.on("click", (e) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
      setTimeout(() => {
        m.invalidateSize();
        m.fitBounds(boundsFor(center, radiusM));
        setReady(true);
      }, 100);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- base map switching ----
  useEffect(() => {
    if (!ready || !baseLayer.current) return;
    baseLayer.current.setUrl(BASES[base].url);
    baseLayer.current.options.attribution = BASES[base].attribution;
  }, [base, ready]);

  // ---- re-fit when the user changes center/radius inputs ----
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.fitBounds(boundsFor(center, radiusM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center.lat, center.lng, radiusM]);

  // ---- draw data layers whenever results/selection change ----
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    const layer = dataLayer.current;
    if (!ready || !leaflet || !m || !layer) return;
    layer.clearLayers();
    const toLL = (p: LatLng) => [p.lat, p.lng] as [number, number];
    const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

    // --- study center marker + dashed radius circle ---
    leaflet
      .circle(toLL(center), {
        radius: radiusM,
        color: "#0f766e",
        weight: 2,
        dashArray: "6 6",
        fillColor: "#0f766e",
        fillOpacity: 0.04,
      })
      .bindTooltip("Study radius")
      .addTo(layer);
    leaflet
      .circleMarker(toLL(center), {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#22301f",
        fillOpacity: 1,
      })
      .bindTooltip("Study center")
      .addTo(layer);

    // --- water bodies & waterways from circle analysis (OSM) ---
    if (circleResult) {
      for (const wb of circleResult.waterBodies) {
        for (const ring of wb.rings) {
          if (ring.length < 3) continue;
          leaflet
            .polygon(ring.map(toLL), { color: "#2f86c9", weight: 1, fillColor: "#2f86c9", fillOpacity: 0.45 })
            .bindTooltip(wb.name ? `${wb.name} (${wb.kind})` : wb.kind)
            .addTo(layer);
        }
      }
      for (const ww of circleResult.waterWays) {
        if (ww.path.length < 2) continue;
        leaflet
          .polyline(ww.path.map(toLL), {
            color: "#2f86c9",
            weight: ww.kind === "river" ? 3 : 1.6,
            opacity: 0.85,
          })
          .bindTooltip(ww.name ? `${ww.name} (${ww.kind})` : ww.kind)
          .addTo(layer);
      }
    }

    // --- contour lines from KML analysis ---
    if (contourResult?.contourLines) {
      for (const line of contourResult.contourLines) {
        if (line.pts.length < 2) continue;
        leaflet
          .polyline(line.pts.map(toLL), { color: CONTOUR_COLOR, weight: 1, opacity: 0.75 })
          .bindTooltip(`${line.elevation} m`)
          .addTo(layer);
      }
    }

    // --- drainage lines from KML analysis ---
    if (contourResult?.drainage) {
      for (const d of contourResult.drainage) {
        if (d.path.length < 2) continue;
        leaflet
          .polyline(d.path.map(toLL), {
            color: "#2f86c9",
            weight: Math.max(1.2, d.order * 0.8),
            opacity: 0.8,
          })
          .addTo(layer);
      }
    }

    // --- catchment polygons + candidate chips + popups + labels ---
    const candidates = contourResult?.candidates ?? circleResult?.candidates ?? [];
    for (const c of candidates) {
      const color = STATUS_COLORS[c.status] ?? "#555";
      const isSel = selected?.id === c.id;
      const popup = `
        <div style="min-width:220px">
          <div style="font-size:10px;letter-spacing:.12em;color:#0f766e;font-weight:700">SUGGESTED POND LOCATION</div>
          <div style="font-size:14px;font-weight:700;margin:2px 0">${c.code} · ${c.status}</div>
          <div style="font-size:11px;color:#4a5548">Score <b>${c.score}</b> · ${c.confidence} confidence</div>
          <table style="font-size:11px;margin-top:6px;border-collapse:collapse">
            <tr><td style="padding-right:10px;color:#8a8676">Rank</td><td><b>#${c.rank}</b></td></tr>
            <tr><td style="padding-right:10px;color:#8a8676">Catchment</td><td><b>${fmt(c.catchmentArea_m2)} m²</b> (${(c.catchmentArea_m2 / 10000).toFixed(2)} ha)</td></tr>
            <tr><td style="color:#8a8676">Terrain</td><td>${c.elevation_m} m · ${c.slope_pct}% slope</td></tr>
            <tr><td style="color:#8a8676">Runoff / yr</td><td>${fmt(c.annualRunoff_m3)} m³</td></tr>
            <tr><td style="color:#8a8676">Storage</td><td>${fmt(c.storage_m3)} m³ @ ${c.designDepth_m} m depth</td></tr>
            <tr><td style="color:#8a8676">Coords</td><td>${c.location.lat.toFixed(6)}, ${c.location.lng.toFixed(6)}</td></tr>
          </table>
          <div style="font-size:11px;margin-top:6px;color:#4a5548">${c.explanation.slice(0, 220)}${c.explanation.length > 220 ? "…" : ""}</div>
        </div>`;

      // Catchment polygon with fill
      if (c.catchment?.length >= 3) {
        leaflet
          .polygon(c.catchment.map(toLL), {
            color,
            weight: isSel ? 2.5 : 1.5,
            opacity: isSel ? 1 : 0.7,
            fillColor: color,
            fillOpacity: isSel ? 0.3 : 0.16,
          })
          .bindPopup(popup, { maxWidth: 320, minWidth: 240, className: "pond-popup" })
          .on("click", () => onSelect(c))
          .addTo(layer);

        // Permanent label centroid — shows rank + code + score + catchment area
        // Compute a simple centroid of the catchment polygon
        const pts = c.catchment;
        let sumLat = 0, sumLng = 0;
        for (const pt of pts) { sumLat += pt.lat; sumLng += pt.lng; }
        const cLat = sumLat / pts.length;
        const cLng = sumLng / pts.length;

        const labelHtml = `
          <div class="catchment-label${isSel ? " selected" : ""}" style="border-color:${color}">
            <div class="cl-rank" style="background:${color}">#${c.rank}</div>
            <div class="cl-code">${c.code}</div>
            <div class="cl-score">${c.score}/100</div>
            <div class="cl-area">${fmt(c.catchmentArea_m2)} m²</div>
            <div class="cl-status" style="color:${color}">${c.status}</div>
          </div>`;

        const labelIcon = leaflet.divIcon({
          className: "catchment-label-wrap",
          html: labelHtml,
          iconSize: [90, 70] as [number, number],
          iconAnchor: [45, 35] as [number, number],
        });
        leaflet
          .marker([cLat, cLng], { icon: labelIcon, interactive: true, zIndexOffset: 100 })
          .bindPopup(popup, { maxWidth: 320, minWidth: 240, className: "pond-popup" })
          .on("click", () => onSelect(c))
          .addTo(layer);
      }

      // Candidate site chip marker (dot + code badge)
      const chip = leaflet.divIcon({
        className: "candidate-chip-wrap",
        html: `<div class="candidate-chip${isSel ? " selected" : ""}"><span class="dot" style="background:${color}"></span>${c.code}</div>`,
        iconSize: [60, 20] as [number, number],
        iconAnchor: [8, 10] as [number, number],
      });
      leaflet
        .marker(toLL(c.location), { icon: chip, riseOnHover: true })
        .bindPopup(popup, { maxWidth: 320, minWidth: 240, className: "pond-popup" })
        .on("click", () => onSelect(c))
        .addTo(layer);
    }
  }, [ready, center, radiusM, circleResult, contourResult, selected, onSelect]);

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      <div className="pointer-events-none absolute right-2 top-2 z-[500] rounded bg-white/90 px-2 py-0.5 text-[11px] text-[#4a5548]">
        {center.lat.toFixed(4)}, {center.lng.toFixed(4)} · {BASES[base].name}
      </div>
    </div>
  );
}
