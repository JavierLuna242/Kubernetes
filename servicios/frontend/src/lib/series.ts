import type { SeriesResult, Target } from "./api";
import { PALETTE } from "./format";

export type SeriesView = {
  name: string;
  color: string;
  points: [number, number | null][];
  last: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
};

/**
 * Une resultados del back con la config de cada consulta. Inserta null donde el dispositivo dejó de enviar,
 * para que el corte se vea: hueco > intervalo de agrupación y > 3 veces su frecuencia típica (mediana).
 */
export function toSeriesViews(results: SeriesResult[], targets: Target[], bucketMs: number): SeriesView[] {
  bucketMs = Math.max(1000, bucketMs); // el back agrupa en mínimo 1 s
  return results.map((r, i) => {
    const t = targets[i];
    const times = r.points.map(([ts]) => Date.parse(ts));
    const deltas = times.slice(1).map((ms, j) => ms - times[j]).sort((a, b) => a - b);
    const gap = Math.max(bucketMs * 2.5, (deltas[deltas.length >> 1] ?? 0) * 3);
    const points: [number, number | null][] = [];
    r.points.forEach(([, v], j) => {
      if (j > 0 && times[j] - times[j - 1] > gap) points.push([times[j - 1] + 1, null]);
      points.push([times[j], v]);
    });
    const vals = r.points.map(([, v]) => v).filter((v): v is number => v != null);
    return {
      name: t?.alias || `${r.device} · ${r.metric}`,
      color: t?.color || PALETTE[i % PALETTE.length],
      points,
      last: vals.at(-1) ?? null,
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    };
  });
}
