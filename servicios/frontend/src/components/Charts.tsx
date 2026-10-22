// Visualizaciones de un panel. Reciben series ya procesadas (SeriesView) y las opciones del panel.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, Annotation, PanelOptions, ValueMapping } from "../lib/api";
import { chartColors, fmtValue, thresholdColor, type ChartColors } from "../lib/format";
import { useTheme } from "../lib/hooks";
import type { SeriesView } from "../lib/series";
import { EChart, type EChartsOption } from "./EChart";

function useColors() {
  const { theme } = useTheme();
  return useMemo(chartColors, [theme]);
}

const tooltipStyle = (c: ChartColors) => ({
  backgroundColor: c.surface,
  borderColor: c.border,
  textStyle: { color: c.fg, fontSize: 12 },
  extraCssText: "box-shadow: 0 8px 24px rgb(0 0 0 / .25); border-radius: 8px;",
});

const base = (o: PanelOptions, fallback: string) => o.baseColor || fallback;

// ---------- Serie de tiempo ----------

const ANOMALY = "#f2495c";
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function TimeSeriesViz({
  series,
  options: o,
  start,
  end,
  analysis,
  compare = [],
  annotations = [],
  onZoom,
  onAnnotate,
  onAnnotationClick,
}: {
  series: SeriesView[];
  options: PanelOptions;
  start: number;
  end: number;
  analysis?: AnalysisResult[];
  compare?: SeriesView[];
  annotations?: Annotation[];
  onZoom?: (start: number, end: number) => void;
  onAnnotate?: (time: number) => void;
  onAnnotationClick?: (a: Annotation) => void;
}) {
  const c = useColors();
  const points = annotations.filter((a) => !a.time_end);
  const ranges = annotations.filter((a) => a.time_end);

  const option = useMemo<EChartsOption>(() => {
    const fmt = (v: unknown) => fmtValue(v, o);
    const forecastEnd = Math.max(end, ...(analysis ?? []).map((a) => a.forecast.at(-1)?.[0] ?? 0));
    // Rango del pronóstico por serie y tiempo, para mostrarlo en el tooltip.
    const bands = new Map<string, Map<number, [number, number]>>();

    // Período anterior (comparar): misma serie, punteada y tenue.
    const past = compare.map((s) => ({
      name: s.name,
      type: "line",
      data: s.points,
      showSymbol: false,
      z: 1,
      lineStyle: { width: 1.5, type: [4, 3], color: s.color, opacity: 0.55 },
      itemStyle: { color: s.color, opacity: 0.55 },
    }));

    const extra = past.concat((analysis ?? []).flatMap((a, i) => {
      const s = series[i];
      if (!s) return [];
      const out: object[] = [];
      if (a.anomalies.length)
        out.push({
          name: `Anomalía · ${s.name}`,
          type: "scatter",
          data: a.anomalies.map(([t, v]) => [t, v]),
          symbolSize: 9,
          z: 5,
          itemStyle: { color: ANOMALY, borderColor: c.surface, borderWidth: 1.5 },
        });
      if (a.forecast.length) {
        const lastReal = [...s.points].reverse().find(([, v]) => v != null);
        const name = `Pronóstico · ${s.name}`;
        bands.set(name, new Map(a.forecast.map(([t, , lo, hi]) => [t, [lo, hi]])));
        const stack = `band-${i}`;
        out.push(
          {
            name,
            type: "line",
            data: [...(lastReal ? [lastReal] : []), ...a.forecast.map(([t, y]) => [t, y])],
            showSymbol: false,
            lineStyle: { width: 1.5, type: "dashed", color: s.color },
            itemStyle: { color: s.color },
          },
          // Banda de confianza: línea invisible en "mín" + área apilada de alto (máx - mín).
          { name: `__lo${i}`, type: "line", stack, data: a.forecast.map(([t, , lo]) => [t, lo]), showSymbol: false, lineStyle: { opacity: 0 }, silent: true },
          {
            name: `__band${i}`,
            type: "line",
            stack,
            data: a.forecast.map(([t, , lo, hi]) => [t, hi - lo]),
            showSymbol: false,
            lineStyle: { opacity: 0 },
            areaStyle: { color: `${s.color}2e` },
            silent: true,
          },
        );
      }
      return out as typeof past;
    }));

    const annSeries = annotations.length
      ? [
          {
            name: "__ann",
            type: "line",
            data: [],
            markLine: {
              symbol: ["none", "triangle"],
              symbolSize: 9,
              symbolRotate: 180,
              animation: false,
              label: { show: false },
              emphasis: {
                label: {
                  show: true,
                  position: "insideEndTop",
                  formatter: (p: { dataIndex: number }) => points[p.dataIndex]?.text ?? "",
                  color: c.fg,
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  borderWidth: 1,
                  padding: [4, 6],
                  borderRadius: 4,
                },
              },
              data: points.map((a) => ({
                xAxis: Date.parse(a.time),
                lineStyle: { color: a.color, type: "dashed", width: 1.5 },
                itemStyle: { color: a.color },
              })),
            },
            markArea: {
              label: { show: false },
              emphasis: { label: { show: true, color: c.fg, formatter: (p: { dataIndex: number }) => ranges[p.dataIndex]?.text ?? "" } },
              data: ranges.map((a) => [
                { xAxis: Date.parse(a.time), itemStyle: { color: `${a.color}22` } },
                { xAxis: Date.parse(a.time_end!) },
              ]),
            },
          },
        ]
      : [];

    type P = { seriesName: string; value: [number, number]; marker: string; axisValue: number };
    const tooltipFormatter = (params: P[]) => {
      if (!params.length) return "";
      const lines = params
        .filter((p) => !p.seriesName.startsWith("__") && p.value?.[1] != null)
        .map((p) => {
          const band = bands.get(p.seriesName)?.get(p.value[0]);
          const range = band ? ` <span style="opacity:.7">(${fmt(band[0])} – ${fmt(band[1])})</span>` : "";
          return `${p.marker}${esc(p.seriesName)} <b style="margin-left:8px">${fmt(p.value[1])}</b>${range}`;
        });
      const head = new Date(params[0].axisValue).toLocaleString("es", { dateStyle: "short", timeStyle: "medium" });
      return [`<div style="opacity:.7;margin-bottom:4px">${head}</div>`, ...lines].join("<br>");
    };

    return {
      animation: false,
      grid: { left: 4, right: 12, top: 10, bottom: o.legend === false ? 4 : 30, containLabel: true },
      tooltip: { trigger: "axis", ...tooltipStyle(c), formatter: tooltipFormatter, axisPointer: { lineStyle: { color: c.muted } } },
      legend: {
        show: o.legend !== false,
        data: [...series.map((s) => s.name), ...extra.map((e) => (e as { name: string }).name).filter((n) => !n.startsWith("__"))],
        bottom: 0,
        left: 0,
        type: "scroll",
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 4,
        textStyle: { color: c.muted, fontSize: 12 },
        pageTextStyle: { color: c.muted },
        pageIconColor: c.muted,
      },
      brush: { xAxisIndex: 0, brushStyle: { color: `${c.accent}26`, borderColor: c.accent, borderWidth: 1 } },
      toolbox: { show: false },
      xAxis: {
        type: "time",
        min: start,
        max: forecastEnd,
        axisLine: { lineStyle: { color: c.grid } },
        axisTick: { show: false },
        axisLabel: { color: c.axis, hideOverlap: true, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: o.min,
        max: o.max,
        scale: o.min == null,
        axisLabel: { color: c.axis, formatter: (v: number) => fmtValue(v, { unit: o.unit }), fontSize: 11 },
        splitLine: { lineStyle: { color: c.grid } },
      },
      series: series.map((s, i) => ({
        name: s.name,
        type: o.style === "bars" ? "bar" : "line",
        data: s.points,
        showSymbol: false,
        symbolSize: 4,
        lineStyle: { width: 1.5, color: s.color },
        itemStyle: { color: s.color },
        barMaxWidth: 10,
        areaStyle:
          o.style === "area"
            ? {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: `${s.color}66` },
                    { offset: 1, color: `${s.color}00` },
                  ],
                },
              }
            : undefined,
        markLine:
          i === 0 && o.thresholds.length
            ? {
                silent: true,
                symbol: "none",
                label: { show: false },
                data: o.thresholds.map((t) => ({ yAxis: t.value, lineStyle: { color: t.color, type: "dashed", width: 1 } })),
              }
            : undefined,
      })).concat(extra as never[], annSeries as never[]),
    };
  }, [series, o, start, end, c, analysis, compare, annotations]);

  return (
    <EChart
      option={option}
      onBrush={onZoom}
      grouped
      onCtrlClick={onAnnotate}
      onMarkClick={(m) => {
        const a = m.componentType === "markLine" ? points[m.dataIndex] : ranges[m.dataIndex];
        if (a) onAnnotationClick?.(a);
      }}
    />
  );
}

// ---------- Valor (stat) ----------

export function StatViz({ series, options: o }: { series: SeriesView[]; options: PanelOptions }) {
  const c = useColors();
  return (
    <div
      className="grid h-full gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gridAutoRows: "1fr" }}
    >
      {series.map((s) => {
        const color = thresholdColor(s.last, o.thresholds, o.thresholds.length || o.baseColor ? base(o, c.fg) : s.color);
        return (
          <div key={s.name} className="relative flex min-h-0 flex-col justify-center overflow-hidden" style={{ containerType: "size" }}>
            {series.length > 1 && <p className="z-10 truncate text-xs text-muted">{s.name}</p>}
            <p
              className="z-10 truncate leading-tight font-semibold tabular-nums"
              style={{ color, fontSize: "clamp(1.1rem, min(20cqw, 45cqh), 4.5rem)" }}
            >
              {fmtValue(s.last, o)}
            </p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5">
              <Sparkline points={s.points} color={color} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ points, color }: { points: SeriesView["points"]; color: string }) {
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: "time", show: false },
      yAxis: { type: "value", show: false, scale: true },
      series: [
        {
          type: "line",
          data: points,
          showSymbol: false,
          silent: true,
          lineStyle: { width: 1.5, color },
          areaStyle: { color: `${color}22` },
        },
      ],
    }),
    [points, color],
  );
  return <EChart option={option} />;
}

// ---------- Medidor (gauge) ----------

export function GaugeViz({ series, options: o }: { series: SeriesView[]; options: PanelOptions }) {
  const c = useColors();
  return (
    <div className="flex h-full gap-2">
      {series.map((s) => (
        <Gauge key={s.name} s={s} o={o} c={c} showName={series.length > 1} />
      ))}
    </div>
  );
}

function Gauge({ s, o, c, showName }: { s: SeriesView; o: PanelOptions; c: ChartColors; showName: boolean }) {
  // El número escala con el tamaño del medidor.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(200);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize(Math.min(e.contentRect.width, e.contentRect.height)));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  const fontSize = Math.round(Math.max(13, Math.min(40, size * 0.13)));

  const option = useMemo<EChartsOption>(() => {
    const min = o.min ?? 0;
    const max = o.max ?? 100;
    const color = thresholdColor(s.last, o.thresholds, o.thresholds.length || o.baseColor ? base(o, c.ok) : s.color);
    // Anillo exterior con los colores de los umbrales.
    const stops: [number, string][] = [];
    const sorted = [...o.thresholds].sort((a, b) => a.value - b.value);
    let current = base(o, c.ok);
    for (const t of sorted) {
      const f = Math.min(1, Math.max(0, (t.value - min) / (max - min)));
      if (f > 0) stops.push([f, current]);
      current = t.color;
    }
    stops.push([1, current]);
    const common = { type: "gauge", min, max, startAngle: 215, endAngle: -35, splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, pointer: { show: false } };
    return {
      animation: false,
      series: [
        { ...common, radius: "92%", axisLine: { lineStyle: { width: 4, color: stops } }, detail: { show: false }, title: { show: false }, data: [] },
        {
          ...common,
          radius: "84%",
          progress: { show: true, width: 14, itemStyle: { color } },
          axisLine: { lineStyle: { width: 14, color: [[1, c.grid]] } },
          detail: {
            offsetCenter: [0, showName ? "-5%" : "5%"],
            formatter: () => fmtValue(s.last, o),
            color,
            fontSize,
            fontWeight: 600,
          },
          title: { show: showName, offsetCenter: [0, "35%"], color: c.muted, fontSize: 12 },
          data: [{ value: s.last ?? min, name: s.name }],
        },
      ],
    };
  }, [s, o, c, showName, fontSize]);
  return (
    <div ref={box} className="h-full min-w-0 flex-1">
      <EChart option={option} />
    </div>
  );
}

// ---------- Barras (último valor por serie) ----------

export function BarViz({ series, options: o }: { series: SeriesView[]; options: PanelOptions }) {
  const c = useColors();
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: "item", ...tooltipStyle(c), valueFormatter: (v: unknown) => fmtValue(v, o) },
      xAxis: {
        type: "value",
        min: o.min,
        max: o.max,
        axisLabel: { color: c.axis, formatter: (v: number) => fmtValue(v, { unit: o.unit }), fontSize: 11 },
        splitLine: { lineStyle: { color: c.grid } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: series.map((s) => s.name),
        axisLabel: { color: c.fg, fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 28,
          data: series.map((s) => ({
            value: s.last,
            itemStyle: {
              color: o.thresholds.length ? thresholdColor(s.last, o.thresholds, base(o, c.ok)) : s.color,
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: "right", color: c.fg, formatter: (p: { value: number }) => fmtValue(p.value, o) },
        },
      ],
    }),
    [series, o, c],
  );
  return <EChart option={option} />;
}

// ---------- Tabla ----------

export function TableViz({ series, options: o }: { series: SeriesView[]; options: PanelOptions }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Serie</th>
            <th className="px-3 py-2 text-right font-medium">Último</th>
            <th className="px-3 py-2 text-right font-medium">Mín</th>
            <th className="px-3 py-2 text-right font-medium">Máx</th>
            <th className="py-2 pl-3 text-right font-medium">Promedio</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.name} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              <td className="py-2 pr-3">
                <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </td>
              <td className="px-3 py-2 text-right font-semibold" style={{ color: o.thresholds.length ? thresholdColor(s.last, o.thresholds, base(o, "inherit")) : undefined }}>
                {fmtValue(s.last, o)}
              </td>
              <td className="px-3 py-2 text-right text-muted">{fmtValue(s.min, o)}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtValue(s.max, o)}</td>
              <td className="py-2 pl-3 text-right text-muted">{fmtValue(s.avg, o)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Estado (línea de tiempo de estados: Encendido / Apagado...) ----------

/** Texto negro o blanco según el color de fondo. */
const readable = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#111317" : "#ffffff";
};

/** Valor -> {texto, color}: primero las asignaciones exactas, luego los umbrales, luego el color de la serie. */
function stateOf(v: number | null, o: PanelOptions, fallback: string) {
  if (v == null) return null;
  const m = o.mappings?.find((m: ValueMapping) => Math.abs(m.value - v) < 1e-9);
  if (m) return { text: m.text, color: m.color };
  return { text: fmtValue(v, o), color: o.thresholds.length ? thresholdColor(v, o.thresholds, base(o, fallback)) : fallback };
}

export function StateViz({ series, options: o, start, end }: { series: SeriesView[]; options: PanelOptions; start: number; end: number }) {
  const c = useColors();
  const option = useMemo<EChartsOption>(() => {
    type Seg = { cat: number; start: number; end: number; text: string; color: string };
    const segs: Seg[] = [];
    series.forEach((s, cat) => {
      const times = s.points.filter(([, v]) => v != null).map(([t]) => t);
      const steps = times.slice(1).map((t, j) => t - times[j]).sort((a, b) => a - b);
      const step = steps[steps.length >> 1] ?? 60_000;
      let cur: Seg | null = null;
      for (const [t, v] of s.points) {
        const st = stateOf(v, o, s.color);
        if (cur && (!st || st.text !== cur.text || st.color !== cur.color)) {
          segs.push({ ...cur, end: t });
          cur = null;
        }
        if (st && !cur) cur = { cat, start: t, end: t, ...st };
      }
      if (cur) segs.push({ ...cur, end: Math.min(end, (times.at(-1) ?? cur.start) + step) });
    });
    const fmtT = (t: number) => new Date(t).toLocaleString("es", { dateStyle: "short", timeStyle: "medium" });

    return {
      animation: false,
      grid: { left: 4, right: 12, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        ...tooltipStyle(c),
        formatter: (p: { dataIndex: number }) => {
          const s = segs[p.dataIndex];
          return `${esc(series[s.cat].name)}<br><b>${esc(s.text)}</b><br><span style="opacity:.7">${fmtT(s.start)} → ${fmtT(s.end)}</span>`;
        },
      },
      xAxis: {
        type: "time",
        min: start,
        max: end,
        axisLine: { lineStyle: { color: c.grid } },
        axisTick: { show: false },
        axisLabel: { color: c.axis, hideOverlap: true, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: series.map((s) => s.name),
        axisLabel: { color: c.fg, fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "custom",
          encode: { x: [1, 2], y: 0 },
          data: segs.map((s) => [s.cat, s.start, s.end]),
          renderItem: (params: { dataIndex: number; coordSys: unknown }, api: { coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
            const s = segs[params.dataIndex];
            const cs = params.coordSys as { x: number; width: number };
            const a = api.coord([s.start, s.cat]);
            const b = api.coord([s.end, s.cat]);
            const x0 = Math.max(a[0], cs.x);
            const x1 = Math.min(b[0], cs.x + cs.width);
            if (x1 <= x0) return null;
            const h = Math.min(36, api.size([0, 1])[1] * 0.72);
            const w = x1 - x0;
            return {
              type: "group",
              children: [
                { type: "rect", shape: { x: x0, y: a[1] - h / 2, width: Math.max(1, w - 1), height: h, r: 3 }, style: { fill: s.color } },
                ...(w > 34
                  ? [{
                      type: "text",
                      style: { text: s.text, x: x0 + 7, y: a[1], verticalAlign: "middle", fill: readable(s.color), font: "500 11px Inter, system-ui, sans-serif", width: w - 12, overflow: "truncate" },
                    }]
                  : []),
              ],
            };
          },
        },
      ],
    };
  }, [series, o, start, end, c]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => {
          const st = stateOf(s.last, o, s.color);
          return (
            <span key={s.name} className="flex min-w-0 items-center gap-2 text-sm">
              {series.length > 1 && <span className="truncate text-muted">{s.name}</span>}
              <span className="rounded px-2 py-0.5 text-xs font-semibold" style={st ? { background: st.color, color: readable(st.color) } : undefined}>
                {st?.text ?? "—"}
              </span>
            </span>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        <EChart option={option} grouped />
      </div>
    </div>
  );
}

// ---------- Mapa de calor (día × hora) ----------

export function HeatmapViz({ series, options: o, start, end }: { series: SeriesView[]; options: PanelOptions; start: number; end: number }) {
  const c = useColors();
  const option = useMemo<EChartsOption>(() => {
    const s = series[0];
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const days: Date[] = [];
    for (const d = new Date(start); d.getTime() <= end; d.setDate(d.getDate() + 1)) {
      d.setHours(0, 0, 0, 0);
      days.push(new Date(d));
    }
    const index = new Map(days.map((d, i) => [dayKey(d), i]));
    const data = s.points
      .filter(([, v]) => v != null)
      .map(([t, v]) => {
        const d = new Date(t);
        return [index.get(dayKey(d)) ?? -1, d.getHours(), v];
      })
      .filter(([i]) => (i as number) >= 0);
    const vals = data.map((d) => d[2] as number);
    const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    const fmtDay = (d: Date) => d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "numeric" });

    return {
      animation: false,
      grid: { left: 4, right: 12, top: 4, bottom: 58, containLabel: true },
      tooltip: {
        trigger: "item",
        ...tooltipStyle(c),
        formatter: (p: { value: [number, number, number] }) =>
          `${fmtDay(days[p.value[0]])} · ${hours[p.value[1]]}<br><b>${fmtValue(p.value[2], o)}</b>`,
      },
      xAxis: {
        type: "category",
        data: days.map(fmtDay),
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.axis, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: "category",
        data: hours,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.axis, fontSize: 10, interval: 2 },
      },
      visualMap: {
        min: o.min ?? (vals.length ? Math.min(...vals) : 0),
        max: o.max ?? (vals.length ? Math.max(...vals) : 1),
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemHeight: 160,
        itemWidth: 10,
        calculable: true,
        precision: o.decimals ?? 1,
        textStyle: { color: c.muted, fontSize: 11 },
        inRange: { color: [c.surface2, s.color] },
      },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: c.surface, borderWidth: 1, borderRadius: 2 } }],
    };
  }, [series, o, start, end, c]);
  return <EChart option={option} />;
}
