import type { Refresh, TimeRange } from "./api";

const UNIT_MS: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };

/** "now", "now-15m", "now-7d" o una fecha ISO -> Date */
export function parseTime(s: string, now = Date.now()): Date {
  if (s === "now") return new Date(now);
  const m = /^now-(\d+)([smhdw])$/.exec(s);
  if (m) return new Date(now - Number(m[1]) * UNIT_MS[m[2]]);
  return new Date(s);
}

export function resolveRange(r: TimeRange) {
  const now = Date.now();
  return { start: parseTime(r.from, now), end: parseTime(r.to, now) };
}

export const isRelative = (r: TimeRange) => r.to === "now";

export const QUICK_RANGES: [string, string][] = [
  ["now-5m", "Últimos 5 minutos"],
  ["now-15m", "Últimos 15 minutos"],
  ["now-30m", "Últimos 30 minutos"],
  ["now-1h", "Última hora"],
  ["now-3h", "Últimas 3 horas"],
  ["now-6h", "Últimas 6 horas"],
  ["now-12h", "Últimas 12 horas"],
  ["now-24h", "Últimas 24 horas"],
  ["now-2d", "Últimos 2 días"],
  ["now-3d", "Últimos 3 días"],
  ["now-7d", "Últimos 7 días"],
  ["now-30d", "Últimos 30 días"],
];

export const REFRESH_OPTIONS: [Refresh, string][] = [
  ["live", "En vivo"],
  ["off", "Manual"],
  ["5s", "Cada 5 s"],
  ["10s", "Cada 10 s"],
  ["30s", "Cada 30 s"],
  ["1m", "Cada 1 min"],
  ["5m", "Cada 5 min"],
];

const REFRESH_MS: Partial<Record<Refresh, number>> = { "5s": 5e3, "10s": 1e4, "30s": 3e4, "1m": 6e4, "5m": 3e5 };
export const refreshMs = (r: Refresh) => REFRESH_MS[r] ?? false;

export const fmtDate = (d: Date) => d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });

export function rangeLabel(r: TimeRange) {
  if (r.to === "now") {
    const q = QUICK_RANGES.find(([v]) => v === r.from);
    if (q) return q[1];
  }
  const { start, end } = resolveRange(r);
  return `${fmtDate(start)} → ${r.to === "now" ? "ahora" : fmtDate(end)}`;
}

/** Valor para <input type="datetime-local"> en hora local */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function timeAgo(iso: string, now = Date.now()) {
  // min(0): un desfase de reloj entre servidor y navegador no debe mostrar fechas "en el futuro".
  const s = Math.min(0, Math.round((new Date(iso).getTime() - now) / 1000));
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
