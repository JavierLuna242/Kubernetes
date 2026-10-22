// Panel de mapa: posición (latitud/longitud) de cada dispositivo y su recorrido en el rango de tiempo.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PanelOptions, SeriesResult, Target } from "../lib/api";
import { fmtValue, PALETTE, thresholdColor } from "../lib/format";

export type MapView = {
  name: string;
  color: string;
  track: [number, number][];
  last: [number, number] | null;
  time: number | null;
  value: number | null;
};

/** Consultas que necesita el mapa: por dispositivo, latitud y longitud (último valor) y la métrica opcional. */
export function mapQueries(targets: Target[], o: PanelOptions) {
  return targets.flatMap((t) => [
    { device: t.device, metric: o.latMetric || "lat", agg: "last" as const },
    { device: t.device, metric: o.lonMetric || "lon", agg: "last" as const },
    ...(t.metric ? [{ device: t.device, metric: t.metric, agg: t.agg }] : []),
  ]);
}

export function toMapViews(results: SeriesResult[], targets: Target[]): MapView[] {
  let k = 0;
  return targets.map((t, i) => {
    const [lat, lon] = [results[k++], results[k++]];
    const val = t.metric ? results[k++] : undefined;
    const lonAt = new Map(lon.points.map(([ts, v]) => [ts, v]));
    const fixes = lat.points.flatMap(([ts, la]) => {
      const lo = lonAt.get(ts);
      return la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [{ ts, pos: [la, lo] as [number, number] }] : [];
    });
    const lastFix = fixes.at(-1);
    return {
      name: t.alias || t.device,
      color: t.color || PALETTE[i % PALETTE.length],
      track: fixes.map((f) => f.pos),
      last: lastFix?.pos ?? null,
      time: lastFix ? Date.parse(lastFix.ts) : null,
      value: val?.points.filter(([, v]) => v != null).at(-1)?.[1] ?? null,
    };
  });
}

export function MapChart({ items, options: o }: { items: MapView[]; options: PanelOptions }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const m = L.map(el.current!, { scrollWheelZoom: false, attributionControl: true }).setView([0, 0], 2); // se encuadra con los datos
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  useEffect(() => {
    const g = layer.current!;
    g.clearLayers();
    const bounds: [number, number][] = [];
    for (const it of items) {
      if (!it.last) continue;
      if (it.track.length > 1) L.polyline(it.track, { color: it.color, weight: 3, opacity: 0.6 }).addTo(g);
      const fill = it.value != null && o.thresholds.length ? thresholdColor(it.value, o.thresholds, o.baseColor || it.color) : it.color;
      // Texto con textContent: los nombres vienen de los tópicos MQTT y no deben interpretarse como HTML.
      const tip = document.createElement("div");
      for (const line of [
        it.name,
        it.value != null ? fmtValue(it.value, o) : "",
        it.time ? new Date(it.time).toLocaleString("es", { dateStyle: "short", timeStyle: "medium" }) : "",
      ].filter(Boolean)) {
        const p = document.createElement("div");
        p.textContent = line;
        tip.appendChild(p);
      }
      L.circleMarker(it.last, { radius: 9, color: "#fff", weight: 2, fillColor: fill, fillOpacity: 1 })
        .bindTooltip(tip, { direction: "top", offset: [0, -8] })
        .addTo(g);
      bounds.push(...it.track, it.last);
    }
    // Encuadra la primera vez que hay posiciones; después respeta el zoom que elija el usuario.
    if (bounds.length && !fitted.current) {
      map.current!.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 16 });
      fitted.current = true;
    }
  }, [items, o]);

  return <div ref={el} className="h-full w-full overflow-hidden rounded-md" />;
}
