import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, GaugeChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  BrushComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Solo las piezas de ECharts que se usan: el bundle queda mucho más liviano.
echarts.use([
  LineChart,
  BarChart,
  GaugeChart,
  ScatterChart,
  HeatmapChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  BrushComponent,
  ToolboxComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

// Los gráficos del mismo grupo comparten el cursor (tooltip sincronizado entre paneles).
const GROUP = "dashboard";
echarts.connect(GROUP);

export type EChartsOption = echarts.EChartsCoreOption;
export { echarts };

type MarkClick = { componentType: "markLine" | "markArea"; dataIndex: number };

/**
 * Contenedor genérico de ECharts.
 * onBrush: si se pasa, arrastrar sobre el gráfico selecciona un rango de tiempo (zoom).
 * onCtrlClick: Ctrl+clic dentro del área del gráfico -> tiempo (eje x) del punto clicado.
 * onMarkClick: clic sobre una línea/área marcada (anotaciones).
 */
export function EChart({
  option,
  onBrush,
  onCtrlClick,
  onMarkClick,
  grouped,
  className = "h-full w-full",
}: {
  option: EChartsOption;
  onBrush?: (start: number, end: number) => void;
  onCtrlClick?: (time: number) => void;
  onMarkClick?: (m: MarkClick) => void;
  grouped?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const cb = useRef({ onBrush, onCtrlClick, onMarkClick });
  cb.current = { onBrush, onCtrlClick, onMarkClick };

  useEffect(() => {
    const c = echarts.init(el.current!);
    chart.current = c;
    if (grouped) c.group = GROUP;
    c.on("brushEnd", (p: unknown) => {
      const range = (p as { areas?: { coordRange?: [number, number] }[] }).areas?.[0]?.coordRange;
      c.dispatchAction({ type: "brush", areas: [] });
      if (range && range[1] - range[0] > 1000) cb.current.onBrush?.(Math.round(range[0]), Math.round(range[1]));
    });
    c.getZr().on("click", (e) => {
      const ev = e.event as unknown as MouseEvent;
      const point = [e.offsetX, e.offsetY];
      if (!(ev.ctrlKey || ev.metaKey) || !cb.current.onCtrlClick || !c.containPixel("grid", point)) return;
      const [x] = c.convertFromPixel({ gridIndex: 0 }, point) as number[];
      cb.current.onCtrlClick(Math.round(x));
    });
    c.on("click", (p: unknown) => {
      const m = p as MarkClick;
      if (m.componentType === "markLine" || m.componentType === "markArea") cb.current.onMarkClick?.(m);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [grouped]);

  useEffect(() => {
    const c = chart.current!;
    c.setOption(option, { notMerge: true });
    if (onBrush)
      c.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } });
  }, [option, !!onBrush]);

  return <div ref={el} className={className} />;
}
