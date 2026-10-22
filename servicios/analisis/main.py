"""Análisis: detección de anomalías y pronóstico de series de tiempo (numpy, sin servicios externos).

POST /api/analysis
  {"series": [{"points": [[ms, valor | null], ...]}], "anomalies": true, "forecast": true,
   "sensitivity": 3.5, "horizon_ms": 3600000}
-> [{"anomalies": [[ms, valor, puntaje], ...], "forecast": [[ms, estimado, mínimo, máximo], ...]}, ...]

Es un cálculo puro: recibe los puntos que ya muestra el panel, no guarda nada ni lee la base.
nginx solo deja pasar peticiones con sesión válida (auth_request contra el back).
"""
import warnings

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

MIN_POINTS = 10
FIT_POINTS = 500  # el pronóstico se ajusta con los últimos N puntos (lo reciente es lo que importa)
SEASONAL_FIT_POINTS = 2000  # con ciclo diario hacen falta al menos 2 días dentro de esta ventana
MAX_STEPS = 500
DAY_MS = 86_400_000


def detect_anomalies(t: np.ndarray, y: np.ndarray, sensitivity: float) -> list[list[float]]:
    """[[ms, valor, puntaje], ...] de los puntos anómalos (ver _anomaly_scores)."""
    scores = _anomaly_scores(y, sensitivity)
    return [[float(t[i]), float(y[i]), round(float(scores[i]), 2)] for i in np.flatnonzero(scores)]


def _anomaly_scores(y: np.ndarray, sensitivity: float) -> np.ndarray:
    """Puntaje de cada punto anómalo (0 = normal): se aleja de la mediana móvil más de `sensitivity` veces
    el ruido típico de la serie.

    La mediana móvil (ventana corta) sigue las subidas y bajadas lentas; el ruido se estima con la MAD de las
    diferencias entre puntos consecutivos, que no depende de la tendencia. Solo se marcan los saltos bruscos.
    Iterativo (como el test ESD): se marca el peor punto, se excluye de las ventanas y se recalcula, para que
    un salto grande no sesgue la mediana de sus vecinos.
    """
    w = 7  # ponytail: ventana fija; aguanta hasta 3 puntos anómalos seguidos, ampliarla si hay rachas más largas
    d = np.diff(y)
    noise = 1.4826 * np.median(np.abs(d - np.median(d))) / 2**0.5  # MAD ≈ desviación estándar si es normal
    if noise == 0:  # serie casi constante: usar la desviación media
        noise = 1.2533 * np.mean(np.abs(d)) / 2**0.5
    noise = max(noise, 1e-6 * max(1.0, float(np.max(np.abs(y)))))  # evita marcar ruido de redondeo

    mask = np.zeros(len(y), bool)
    scores = np.zeros(len(y))
    for _ in range(min(100, len(y) // 10)):
        windows = np.lib.stride_tricks.sliding_window_view(np.pad(np.where(mask, np.nan, y), w // 2, mode="edge"), w)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # ventana toda excluida -> NaN -> no se marca
            score = np.abs(y - np.nanmedian(windows, axis=1)) / noise
        score[mask] = -1
        i = int(np.nanargmax(np.nan_to_num(score, nan=-1)))
        if score[i] <= sensitivity:
            break
        mask[i], scores[i] = True, score[i]
    return scores


def _fit(y: np.ndarray, pos: np.ndarray, season: np.ndarray | None, alpha: float, beta: float, gamma: float,
         phi: float) -> tuple[float, float, np.ndarray | None, float]:
    """Holt-Winters aditivo con tendencia amortiguada; sin estacionalidad si season es None (Holt).

    pos[i] = posición de y[i] dentro del día. Devuelve (nivel, tendencia, estacionalidad, error cuadrático a un paso).
    """
    s = None if season is None else season.copy()
    level, trend, sse = y[0] - (s[pos[0]] if s is not None else 0.0), 0.0, 0.0
    for i in range(1, len(y)):
        si = s[pos[i]] if s is not None else 0.0
        sse += (y[i] - (level + phi * trend + si)) ** 2
        new = alpha * (y[i] - si) + (1 - alpha) * (level + phi * trend)
        trend = beta * (new - level) + (1 - beta) * phi * trend
        if s is not None:
            s[pos[i]] = gamma * (y[i] - new) + (1 - gamma) * si
        level = new
    return level, trend, s, sse


def forecast(t: np.ndarray, y: np.ndarray, horizon_ms: float) -> list[list[float]]:
    """Pronóstico con intervalo de ~95 %. Parámetros elegidos por mínimo error a un paso.

    Con 2 días o más de datos usa Holt-Winters con ciclo diario (temperatura, consumo… repiten el día);
    si no, Holt con tendencia amortiguada.
    """
    step = float(np.median(np.diff(t)))
    steps = int(min(MAX_STEPS, round(horizon_ms / step))) if step > 0 else 0
    if steps < 1:
        return []
    m = round(DAY_MS / step)  # puntos por día
    seasonal = 2 <= m and t[-1] - t[-min(len(t), SEASONAL_FIT_POINTS)] >= 2 * DAY_MS
    n = SEASONAL_FIT_POINTS if seasonal else FIT_POINTS
    t, y = t[-n:], y[-n:].astype(float)
    # Los picos anómalos no deben aprenderse como parte del patrón: se reemplazan interpolando entre vecinos.
    if (bad := _anomaly_scores(y, 3.5) > 0).any() and not bad.all():
        y[bad] = np.interp(t[bad], t[~bad], y[~bad])
    pos = np.round((t - t[0]) / step).astype(int) % max(m, 1)  # por tiempo: soporta huecos en los datos
    season = None
    if seasonal:  # estacionalidad inicial: promedio por posición del día, centrado
        sums = np.bincount(pos, weights=y - y.mean(), minlength=m)
        season = sums / np.maximum(np.bincount(pos, minlength=m), 1)
    grid = ((a, b, g, p) for a in (0.1, 0.3, 0.6) for b in (0.01, 0.1) for g in ((0.1, 0.3) if seasonal else (0,)) for p in (0.9, 0.98)) \
        if seasonal else ((a, b, 0, p) for a in (0.1, 0.2, 0.3, 0.5, 0.7, 0.9) for b in (0.01, 0.05, 0.1, 0.3) for p in (0.9, 0.98))
    (alpha, _, _, phi), (level, trend, s, sse) = min(
        ((params, _fit(y, pos, season, *params)) for params in grid), key=lambda r: r[1][-1]
    )
    sigma = (sse / max(1, len(y) - 1)) ** 0.5
    if s is not None and (k := (m // 24) | 1) > 1:  # suaviza el patrón diario con una media móvil circular de ~1 h
        s = np.convolve(np.concatenate([s[-(k // 2):], s, s[: k // 2]]), np.ones(k) / k, "valid")
    out, damp = [], 0.0
    for h in range(1, steps + 1):
        damp += phi**h
        th = t[-1] + h * step
        yhat = level + damp * trend + (s[round((th - t[0]) / step) % m] if s is not None else 0.0)
        # ponytail: ancho del intervalo con la fórmula de suavizado simple; la exacta suma términos de tendencia/estación
        width = 1.96 * sigma * (1 + (h - 1) * alpha**2) ** 0.5
        out.append([float(th), float(yhat), float(yhat - width), float(yhat + width)])
    return out


class Series(BaseModel):
    points: list[tuple[float, float | None]] = Field(max_length=5000)


class Request(BaseModel):
    series: list[Series] = Field(max_length=20)
    anomalies: bool = True
    forecast: bool = False
    sensitivity: float = Field(3.5, ge=1, le=20)
    horizon_ms: float = Field(0, ge=0)


app = FastAPI(title="IoT analysis")


@app.get("/api/analysis/health")
def health():
    return {"ok": True}


@app.post("/api/analysis")
def analyze(r: Request):  # def (no async): FastAPI lo corre en un hilo, numpy no bloquea el servidor
    out = []
    for s in r.series:
        pts = [(ts, v) for ts, v in s.points if v is not None]
        if len(pts) < MIN_POINTS:
            out.append({"anomalies": [], "forecast": []})
            continue
        t, y = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
        out.append({
            "anomalies": detect_anomalies(t, y, r.sensitivity) if r.anomalies else [],
            "forecast": forecast(t, y, r.horizon_ms) if r.forecast else [],
        })
    return out
