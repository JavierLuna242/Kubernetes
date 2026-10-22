// Variables de dashboard: "$dispositivo" o "${dispositivo}" en dispositivo, métrica, nombre o título del panel.
import type { Device, Panel, Variable } from "./api";

export const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const interpolate = (s: string, vals: Record<string, string>) =>
  s.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => vals[a ?? b] ?? m);

export function applyVars(p: Panel, vals: Record<string, string>): Panel {
  if (!Object.keys(vals).length) return p;
  return {
    ...p,
    title: interpolate(p.title, vals),
    targets: p.targets.map((t) => ({
      ...t,
      device: interpolate(t.device, vals),
      metric: interpolate(t.metric, vals),
      alias: t.alias && interpolate(t.alias, vals),
    })),
  };
}

/** Opciones del selector: dispositivos, métricas (de todos) o la lista escrita a mano. */
export function variableOptions(v: Variable, devices: Device[]): string[] {
  if (v.type === "device") return devices.map((d) => d.device);
  if (v.type === "metric") return [...new Set(devices.flatMap((d) => d.metrics))].sort();
  return (v.values ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
