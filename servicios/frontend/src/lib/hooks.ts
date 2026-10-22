import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { Reading } from "./api";

// ---------- Router por hash: #/dashboards/<id> -> ["dashboards", "<id>"] ----------

const subscribeHash = (cb: () => void) => {
  addEventListener("hashchange", cb);
  return () => removeEventListener("hashchange", cb);
};

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export const navigate = (path: string) => {
  location.hash = path;
};

// ---------- Tema claro/oscuro ----------

export type Theme = "light" | "dark";

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* almacenamiento bloqueado */
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// La clase se aplica de forma síncrona para que los gráficos lean los colores nuevos en el mismo render.
const applyTheme = (t: Theme) => document.documentElement.classList.toggle("dark", t === "dark");
applyTheme(storedTheme());

export function useThemeState() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* almacenamiento bloqueado */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

// ---------- Datos en vivo (WebSocket /api/ws) ----------

/** Bus de lecturas en vivo: el WebSocket publica aquí y cada panel escucha lo suyo. */
export const liveBus = new EventTarget();

/** Abre el WebSocket con reconexión automática; devuelve si está conectado. */
export function useLiveSocket(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket;
    let retry: number | undefined;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => liveBus.dispatchEvent(new CustomEvent<Reading[]>("readings", { detail: JSON.parse(e.data) }));
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, [enabled]);

  return connected;
}

/** Si el WebSocket en vivo está conectado (lo provee App). */
export const LiveContext = createContext(false);
export const useLiveContext = () => useContext(LiveContext);

/** Llama fn con cada lote de lecturas en vivo mientras enabled sea true. */
export function useLiveReadings(fn: (rows: Reading[]) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: Event) => fn((e as CustomEvent<Reading[]>).detail);
    liveBus.addEventListener("readings", h);
    return () => liveBus.removeEventListener("readings", h);
  });
}

// ---------- Toasts ----------

type Toast = { id: number; text: string; kind: "ok" | "error" };
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
const emitToasts = () => toastSubs.forEach((f) => f());

export function toast(text: string, kind: Toast["kind"] = "ok") {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, kind }];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, 4000);
}

export const useToasts = () =>
  useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toasts,
  );
