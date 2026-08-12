import { blob, hashSeed, mulberry32 } from "./geo";
import type { Village } from "./types";

const RAW = [
  { id: "v_dhamtari", name: "Kurud", district: "Dhamtari", state: "Chhattisgarh", lat: 20.8291, lng: 81.7136, pop: 4120, dem: "SRTM 30 m (NASA)" },
  { id: "v_wardha", name: "Selsura", district: "Wardha", state: "Maharashtra", lat: 20.6981, lng: 78.6234, pop: 2870, dem: "ALOS PALSAR 12.5 m" },
  { id: "v_anantapur", name: "Rapthadu", district: "Anantapur", state: "Andhra Pradesh", lat: 14.6421, lng: 77.5389, pop: 6310, dem: "SRTM 30 m (NASA)" },
  { id: "v_barmer", name: "Sindhari", district: "Barmer", state: "Rajasthan", lat: 25.7042, lng: 72.0263, pop: 3480, dem: "CartoDEM 30 m (ISRO)" },
  { id: "v_bankura", name: "Chhatna", district: "Bankura", state: "West Bengal", lat: 23.3195, lng: 86.9012, pop: 5240, dem: "ALOS PALSAR 12.5 m" },
  { id: "v_kolar", name: "Vokkaleri", district: "Kolar", state: "Karnataka", lat: 13.0512, lng: 78.0891, pop: 2190, dem: "CartoDEM 30 m (ISRO)" },
];

export const VILLAGES: Village[] = RAW.map((v) => {
  const rand = mulberry32(hashSeed(v.id));
  return {
    id: v.id,
    name: v.name,
    district: v.district,
    state: v.state,
    center: { lat: v.lat, lng: v.lng },
    populationEstimate: v.pop,
    demDataset: v.dem,
    boundary: blob({ lat: v.lat, lng: v.lng }, 1500, 14, rand),
  };
});

export function searchVillages(q: string): Village[] {
  const s = q.trim().toLowerCase();
  if (!s) return VILLAGES;
  return VILLAGES.filter((v) =>
    [v.name, v.district, v.state].some((f) => f.toLowerCase().includes(s)),
  );
}

export const getVillage = (id: string) => VILLAGES.find((v) => v.id === id);