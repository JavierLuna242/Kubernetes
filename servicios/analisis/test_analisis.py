"""Chequeos del análisis: py -m pytest servicios/analisis"""
import numpy as np

from main import detect_anomalies, forecast

T = np.arange(200) * 60_000.0  # un punto por minuto


def test_anomalies():
    rng = np.random.default_rng(1)
    y = 22 + 3 * np.sin(np.arange(200) / 20) + rng.normal(0, 0.1, 200)  # onda lenta + ruido
    assert detect_anomalies(T, y, 3.5) == []  # la onda lenta no es anomalía
    y[120] += 4  # salto brusco
    assert [int(a[0]) for a in detect_anomalies(T, y, 3.5)] == [int(T[120])]

    flat = np.full(200, 5.0)
    assert detect_anomalies(T, flat, 3.5) == []
    flat[50] = 9
    assert [int(a[0]) for a in detect_anomalies(T, flat, 3.5)] == [int(T[50])]


def test_forecast():
    y = 10 + 0.5 * np.arange(200)  # tendencia lineal
    f = forecast(T, y, horizon_ms=10 * 60_000)
    assert len(f) == 10
    assert f[0][0] == T[-1] + 60_000
    assert abs(f[0][1] - (y[-1] + 0.5)) < 0.1  # sigue la tendencia
    assert all(lo <= yhat <= hi for _, yhat, lo, hi in f)
    assert forecast(T, y, horizon_ms=0) == []


def test_forecast_daily_cycle():
    # 3 días cada 10 min de un ciclo diario: el pronóstico de las próximas 12 h debe seguir el ciclo, no la tendencia.
    rng = np.random.default_rng(2)
    step = 600_000.0
    t = np.arange(3 * 144) * step
    day = lambda tt: 21 + 6 * np.sin(tt / 86_400_000 * 2 * np.pi)  # noqa: E731
    y = day(t) + rng.normal(0, 0.25, len(t))
    y[300:302] += 9  # un pico anómalo: no debe repetirse en el pronóstico a la misma hora (sin limpiar, error > 1)
    t, y = np.delete(t, range(200, 215)), np.delete(y, range(200, 215))  # con un hueco en los datos
    f = np.array(forecast(t, y, horizon_ms=24 * 3_600_000))
    assert len(f) == 144
    assert np.max(np.abs(f[:, 1] - day(f[:, 0]))) < 0.5
