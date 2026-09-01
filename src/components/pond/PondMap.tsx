import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import { contourRings, type Evaluation } from "@/lib/pond/engine";
import { fetchWaterways, WATERWAY_STYLE, type WaterwayLine } from "@/lib/pond/osmWater";
import type { Study } from "@/lib/pond/types";

export type LayerKey =
  | "boundary"
  | "contours"
  | "drainage"
  | "slope"
  | "parcels"
  | "catchments"
  | "candidates";

export type BaseKey = "satellite" | "terrain" | "street" | "cyclosm" | "humanitarian";

const BASES: Record<BaseKey, { url: string; attribution: string }> = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap (CC-BY-SA), SRTM elevation",
  },
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  cyclosm: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution: "&copy; CyclOSM, OpenStreetMap contributors",
  },
  humanitarian: {
    url: "https://tile-{s}.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: "&copy; Humanitarian OSM Team, OpenStreetMap contributors",
  },
};

const STATUS_COLOR: Record<string, string> = {
  RECOMMENDED: "#1a7f5a",
  CONDITIONAL: "#c98a1e",
  REJECTED: "#b3453b",
};


export function PondMap({
  study,
  evaluations,
  layers,
  base,
  selectedId,
  onSelect,
  onPickPoint,
  picking,
  className,
}: {
  study: Study;
  evaluations: Evaluation[];
  layers: Record<LayerKey, boolean>;
  base: BaseKey;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onPickPoint?: (lat: number, lng: number) => void;
  picking?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const baseLayer = useRef<ReturnType<typeof import("leaflet").tileLayer> | null>(null);
  const groups = useRef<Partial<Record<LayerKey, LayerGroup>>>({});
  const L = useRef<typeof import("leaflet") | null>(null);
  const pickRef = useRef(onPickPoint);
  pickRef.current = onPickPoint;
  const [waterways, setWaterways] = useState<WaterwayLine[] | null>(null);
  const [waterState, setWaterState] = useState<"loading" | "ready" | "error">("loading");
  const [zoom, setZoom] = useState(14);

  useEffect(() => {
    const ac = new AbortController();
    setWaterState("loading");
    setWaterways(null);
    fetchWaterways(study.village, ac.signal)
      .then((w) => {
        setWaterways(w);
        setWaterState("ready");
      })
      .catch(() => setWaterState("error"));
    return () => ac.abort();
  }, [study.village]);



  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(el.current, { zoomControl: true, attributionControl: true }).setView(
        [study.village.center.lat, study.village.center.lng],
        14,
      );
      map.current = m;
      baseLayer.current = leaflet.tileLayer(BASES[base].url, { attribution: BASES[base].attribution, maxZoom: 18 }).addTo(m);
      (["boundary", "contours", "drainage", "slope", "parcels", "catchments", "candidates"] as LayerKey[]).forEach(
        (k) => {
          groups.current[k] = leaflet.layerGroup().addTo(m);
        },
      );
      m.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        pickRef.current?.(e.latlng.lat, e.latlng.lng);
      });
      m.on("zoomend", () => setZoom(m.getZoom()));
      setZoom(m.getZoom());
      setTimeout(() => m.invalidateSize(), 120);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      groups.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study.id]);

  useEffect(() => {
    const leaflet = L.current;
    if (!leaflet || !map.current || !baseLayer.current) return;
    baseLayer.current.setUrl(BASES[base].url);
    baseLayer.current.options.attribution = BASES[base].attribution;
    map.current.attributionControl.addAttribution(BASES[base].attribution);
  }, [base]);


  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    if (!leaflet || !m) return;
    const g = groups.current;
    Object.values(g).forEach((layer) => layer?.clearLayers());

    const toLL = (p: { lat: number; lng: number }) => [p.lat, p.lng] as [number, number];

    if (layers.boundary && g.boundary) {
      leaflet
        .polygon(study.village.boundary.map(toLL), { color: "#0f766e", weight: 2, dashArray: "6 5", fill: false })
        .bindTooltip("Study boundary")
        .addTo(g.boundary);
    }

    if (study.terrain && layers.contours && g.contours) {
      contourRings(study.village, study.terrain).forEach((c) =>
        leaflet
          .polyline(c.ring.map(toLL), { color: "#8a6b2f", weight: 1, opacity: 0.75 })
          .bindTooltip(`${c.elevation} m contour`)
          .addTo(g.contours!),
      );
    }

    if (layers.slope && g.slope) {
      study.village.boundary.forEach((p, i) =>
        leaflet
          .circle(toLL(p), {
            radius: 190,
            color: "transparent",
            fillColor: i % 3 === 0 ? "#b3453b" : i % 3 === 1 ? "#c98a1e" : "#1a7f5a",
            fillOpacity: 0.22,
          })
          .bindTooltip(`Slope class ${i % 3 === 0 ? "> 8%" : i % 3 === 1 ? "3–8%" : "< 3%"}`)
          .addTo(g.slope!),
      );
    }

    if (layers.drainage && g.drainage) {
      drainageLines(study.village).forEach((d) =>
        leaflet
          .polyline(d.path.map(toLL), { color: "#2563a8", weight: d.order, opacity: 0.85 })
          .bindTooltip(`Drainage line — Strahler order ${d.order}`)
          .addTo(g.drainage!),
      );
    }

    evaluations.forEach((e) => {
      const c = e.candidate;
      const color = STATUS_COLOR[e.status] ?? "#555";
      const selected = selectedId === c.id;
      if (layers.catchments && g.catchments) {
        leaflet
          .polygon(c.catchment.map(toLL), {
            color,
            weight: selected ? 2 : 1,
            opacity: selected ? 0.95 : 0.5,
            fillOpacity: selected ? 0.18 : 0.06,
          })
          .bindTooltip(`${c.code} catchment — ${c.catchmentArea_m2.toLocaleString("en-IN")} m²`)
          .addTo(g.catchments!);
      }
      if (layers.parcels && g.parcels) {
        leaflet
          .polygon(c.parcel.map(toLL), { color: "#7c4dff", weight: 1, fillOpacity: 0.12 })
          .bindTooltip(`Parcel ${c.parcelId} — record ${c.officialArea_m2.toLocaleString("en-IN")} m²`)
          .addTo(g.parcels!);
      }
      if (layers.candidates && g.candidates) {
        leaflet
          .circleMarker(toLL(c.location), {
            radius: selected ? 10 : 7,
            color: "#ffffff",
            weight: 2,
            fillColor: color,
            fillOpacity: 1,
          })
          .bindTooltip(`${c.code} · ${e.status} · score ${e.score}`)
          .on("click", () => onSelect?.(c.id))
          .addTo(g.candidates!);
      }
    });

    const container = m.getContainer();
    container.style.cursor = picking ? "crosshair" : "";
  }, [study, evaluations, layers, selectedId, onSelect, picking]);

  useEffect(() => {
    const m = map.current;
    if (!m || !selectedId) return;
    const c = study.candidates.find((x) => x.id === selectedId);
    if (c) m.panTo([c.location.lat, c.location.lng]);
  }, [selectedId, study.candidates]);

  return <div ref={el} className={className} />;
}