import type { PanelOptions, Threshold } from "./api";

export const PALETTE = ["#5b8def", "#73bf69", "#f2cc0c", "#ff9830", "#f2495c", "#b877d9", "#56d2c4", "#8ab8ff"];

export const UNITS = ["°C", "°F", "%", "hPa", "Pa", "V", "A", "W", "kW", "kWh", "lux", "ppm", "m/s", "km/h", "dB", "rpm", "L", "m³"];

const TIGHT_UNITS = new Set(["%", "°C", "°F"]);

/** Formatea un valor con decimales y unidad (es: coma decimal). */
export function fmtValue(v: unknown, o: Pick<PanelOptions, "unit" | "decimals"> = {}) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const n = v.toLocaleString("es", {
    maximumFractionDigits: o.decimals ?? (Math.abs(v) >= 100 ? 1 : 2),
    minimumFractionDigits: o.decimals ?? 0,
  });
  if (!o.unit) return n;
  return TIGHT_UNITS.has(o.unit) ? `${n}${o.unit}` : `${n} ${o.unit}`;
}

/** Color según umbrales (el mayor umbral <= valor), o el color base. */
export function thresholdColor(v: number | null | undefined, thresholds: Threshold[], base: string) {
  if (v == null) return base;
  let color = base;
  for (const t of [...thresholds].sort((a, b) => a.value - b.value)) if (v >= t.value) color = t.color;
  return color;
}

/** Colores del tema actual para ECharts (leídos de las variables CSS). */
export function chartColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    fg: v("--fg"),
    muted: v("--muted"),
    axis: v("--axis"),
    grid: v("--grid"),
    surface: v("--surface"),
    surface2: v("--surface-2"),
    border: v("--border"),
    accent: v("--accent"),
    ok: v("--ok"),
  };
}
export type ChartColors = ReturnType<typeof chartColors>;
