import type { RainfallData } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cache = new Map<string, RainfallData>();

function fallback(lat: number, lng: number): RainfallData {
  const monsoon = [8, 10, 14, 22, 38, 168, 312, 289, 190, 74, 18, 9];
  const scale = 0.8 + ((Math.abs(lat) % 5) / 5) * 0.6;
  const monthly = monsoon.map((mm, i) => ({ month: MONTHS[i]!, mm: Math.round(mm * scale) }));
  return {
    provider: "Built-in climatology (offline fallback)",
    period: "Typical year",
    annual_mm: monthly.reduce((s, m) => s + m.mm, 0),
    monthly,
    retrievedAt: new Date().toISOString(),
    cached: false,
    fallback: true,
    latitude: lat,
    longitude: lng,
  };
}

export async function fetchRainfall(lat: number, lng: number): Promise<RainfallData> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const end = new Date();
  end.setDate(end.getDate() - 5);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${iso(start)}&end_date=${iso(end)}&daily=precipitation_sum&timezone=auto`;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { daily?: { time: string[]; precipitation_sum: (number | null)[] } };
    const time = json.daily?.time ?? [];
    const sums = json.daily?.precipitation_sum ?? [];
    if (!time.length) throw new Error("empty response");
    const buckets = new Array(12).fill(0) as number[];
    time.forEach((d, i) => {
      const m = Number(d.slice(5, 7)) - 1;
      buckets[m] = (buckets[m] ?? 0) + (sums[i] ?? 0);
    });
    const monthly = buckets.map((mm, i) => ({ month: MONTHS[i]!, mm: Math.round(mm) }));
    const data: RainfallData = {
      provider: "Open-Meteo ERA5 archive",
      period: `${iso(start)} to ${iso(end)}`,
      annual_mm: monthly.reduce((s, m) => s + m.mm, 0),
      monthly,
      retrievedAt: new Date().toISOString(),
      cached: false,
      fallback: false,
      latitude: lat,
      longitude: lng,
    };
    cache.set(key, data);
    return data;
  } catch {
    const data = fallback(lat, lng);
    cache.set(key, data);
    return data;
  }
}