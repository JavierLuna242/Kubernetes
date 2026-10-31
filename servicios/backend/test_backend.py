"""Chequeos de parse(), de la sesión y de las alertas: py -m pytest servicios/backend"""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SESSION_SECRET", "test")

from main import build_cost, check_token, condition, make_token, next_state, parse, pick_source, REPORT_TZ, TELEGRAM_MAX, build_report, report_due, DEVICE_ID, RESERVED_IDS, hash_token, new_token, token_ok, twin_diff  # noqa: E402
import re  # noqa: E402

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
at = lambda s: T0 + timedelta(seconds=s)  # noqa: E731


def test_alert_states():
    # Con "durante 60 s": pending al cumplirse, firing a los 60 s, ok al dejar de cumplirse.
    assert next_state("ok", None, True, 60, at(0)) == ("pending", at(0))
    assert next_state("pending", at(0), True, 60, at(30)) == ("pending", at(0))
    assert next_state("pending", at(0), True, 60, at(60)) == ("firing", at(60))
    assert next_state("firing", at(60), True, 60, at(75)) == ("firing", at(60))
    assert next_state("firing", at(60), False, 60, at(90)) == ("ok", None)
    # Si deja de cumplirse estando pending, vuelve a ok sin disparar.
    assert next_state("pending", at(0), False, 60, at(15)) == ("ok", None)
    # Sin "durante": dispara de inmediato.
    assert next_state("ok", None, True, 0, at(0)) == ("firing", at(0))


def test_alert_conditions():
    now = at(1000)
    # Umbral: solo con un dato reciente (<= 5 min).
    assert condition(">", 30, 31, at(990), now)
    assert not condition(">", 30, 30, at(990), now)
    assert not condition(">", 30, 31, at(1000 - 301), now)  # dato viejo
    assert not condition("<", 10, None, None, now)  # nunca hubo datos
    # Sin datos: más de N minutos desde el último dato, o nunca envió.
    assert condition("nodata", 5, 22.0, at(1000 - 301), now)
    assert not condition("nodata", 5, 22.0, at(1000 - 299), now)
    assert condition("nodata", 5, None, None, now)


def test_pick_source():
    assert pick_source(10)[0] == "readings"
    assert pick_source(60)[0] == "readings_1m"
    assert pick_source(3599)[0] == "readings_1m"
    assert pick_source(3600)[0] == "readings_1h"
    assert set(pick_source(60)[2]) == set(pick_source(10)[2])  # mismas agregaciones disponibles


def test_parse():
    rows = parse("iot/sensor1/telemetry", b'{"temperatura": 22.5, "humedad": 60, "ok": true, "nombre": "x"}')
    assert [(d, m, v) for _, d, m, v in rows] == [("sensor1", "temperatura", 22.5), ("sensor1", "humedad", 60.0)]

    (ts, *_), = parse("iot/s/telemetry", b'{"ts": "2026-10-21T12:00:00", "t": 1}')
    assert ts.tzinfo == timezone.utc and ts.hour == 12

    for bad in (b"no json", b"[1, 2]", b'{"ts": "ayer", "t": 1}'):
        try:
            parse("iot/s/telemetry", bad)
            raise AssertionError(f"debió fallar: {bad}")
        except ValueError:
            pass


def test_token():
    tok = make_token("admin", now=1000)
    assert check_token(tok, now=1001) == "admin"
    assert check_token(tok, now=1000 + 8 * 86400) is None  # vencido
    assert check_token(tok.replace("admin", "otro"), now=1001) is None  # usuario alterado
    assert check_token(tok[:-1] + ("0" if tok[-1] != "0" else "1"), now=1001) is None  # firma alterada
    for bad in (None, "", "basura", "a:b"):
        assert check_token(bad) is None


def test_reporte():
    day = datetime(2026, 10, 20, tzinfo=REPORT_TZ)
    stats = [
        {"device": "sensor-1", "metric": "humedad", "avg": 60.123, "min": 55.0, "max": 70.5, "n": 144},
        {"device": "sensor-1", "metric": "temperatura", "avg": 21.0, "min": 15.25, "max": 27.0, "n": 144},
        {"device": "sensor-2", "metric": "voltaje", "avg": 220.0, "min": 219.0, "max": 221.0, "n": 10},
    ]
    events = [{"rule_name": "Temperatura alta", "device": "sensor-1", "metric": "temperatura", "times": 2}]
    text = build_report(day, stats, events, ["sensor-3"], partial=False)
    assert "martes 20/10/2026" in text
    assert "temperatura: mín 15,25 · máx 27 · prom 21 (144 lecturas)" in text
    assert "📟 sensor-2" in text and "Alertas disparadas: 2" in text and "2 veces" in text
    assert "Sin datos ese día: sensor-3" in text
    assert "ningún dispositivo" in build_report(day, [], [], [], partial=True)
    assert "Alertas disparadas: ninguna" in build_report(day, stats, [], [], partial=True)
    # Muchos dispositivos: se recorta por debajo del límite de Telegram.
    many = [{**stats[0], "device": f"sensor-{i:03}"} for i in range(300)]
    long = build_report(day, many, [], [], partial=False)
    assert len(long) <= TELEGRAM_MAX and long.endswith("ver el resto en el visualizador)")


def test_reporte_cuando():
    s = {"enabled": True, "hour": 7, "last": "2026-10-20"}
    at = lambda d, h: datetime(2026, 10, d, h, tzinfo=REPORT_TZ)
    assert not report_due(s, at(20, 9))  # ya se envió hoy
    assert not report_due(s, at(21, 6))  # aún no es la hora
    assert report_due(s, at(21, 7))
    assert not report_due({**s, "enabled": False}, at(21, 9))


def test_aviso_de_coste():
    now = datetime(2026, 10, 10, tzinfo=timezone.utc)
    costs = {"Virtual Machines": 50.95, "Storage": 9.66, "Load Balancer": 0.0}
    text = build_cost(costs, None, now)
    assert "octubre 2026" in text and "US$ 60,61" in text and "desde el último aviso" not in text
    assert "a fin de mes: US$ 187,89" in text  # 60,61 / 10 días * 31
    assert text.index("Virtual Machines") < text.index("Storage") and "Load Balancer" not in text
    assert build_cost(costs, {"month": "2026-10", "total": 60.61}, now) is None  # no cambió
    assert "(+1,61 desde el último aviso)" in build_cost(costs, {"month": "2026-10", "total": 59.0}, now)
    assert "desde el último aviso" not in build_cost(costs, {"month": "2026-09", "total": 90.0}, now)  # mes nuevo


def test_credenciales_dispositivo():
    t = new_token()
    assert len(t) >= 24 and new_token() != t
    h = hash_token(t)
    assert t not in h  # nunca se guarda el token
    assert token_ok(h, t) and not token_ok(h, t + "x") and not token_ok(None, t) and not token_ok(h, "")
    for ok in ("sensor-1", "nodo_02", "ab"):
        assert re.fullmatch(DEVICE_ID, ok), ok
    for bad in ("a", "Sensor", "con espacio", "a/b", "+", "#", "-x", "x" * 64):
        assert not re.fullmatch(DEVICE_ID, bad), bad
    assert "iot" in RESERVED_IDS


def test_gemelo_digital():
    assert twin_diff({"encendido": 1, "velocidad": 42}, {"encendido": 1.0, "velocidad": 10, "temperatura": 22}) == {
        "encendido": "sincronizado", "velocidad": "pendiente"}
    assert twin_diff({"encendido": 0}, {}) == {"encendido": "pendiente"}
    assert twin_diff({}, {"temperatura": 1}) == {}


def test_k8s_unidades():
    from main import cpu_m, mem_mib
    assert cpu_m("12500000n") == 12.5 and cpu_m("250u") == 0.25 and cpu_m("15m") == 15 and cpu_m("1") == 1000
    assert mem_mib("2048Ki") == 2 and mem_mib("100Mi") == 100 and mem_mib("1Gi") == 1024 and mem_mib(str(3 * 2**20)) == 3


def test_k8s_pod_metrics_durante_un_reinicio():
    from main import pod_metrics

    def pod(name, app, start, ready=True, deleting=False):
        meta = {"name": name, "labels": {"app": app} if app else {}}
        if deleting:
            meta["deletionTimestamp"] = start
        return {"metadata": meta, "status": {"startTime": start, "conditions": [{"type": "Ready", "status": str(ready)}]}}

    def use(name, cpu, mem):
        return {"metadata": {"name": name}, "containers": [{"usage": {"cpu": cpu, "memory": mem}}]}

    pods = [
        pod("wp-viejo", "wordpress", "2026-10-23T10:00:00Z"),
        pod("wp-nuevo", "wordpress", "2026-10-23T11:58:00Z"),
        pod("wp-saliendo", "wordpress", "2026-10-23T09:00:00Z", deleting=True),  # no cuenta
        pod("db-0", "wordpress-db", "2026-10-23T11:00:00Z"),
        pod("db-arrancando", "wordpress-db", "2026-10-23T11:59:00Z", ready=False),  # no cuenta
        pod("suelto", None, "2026-10-23T09:00:00Z"),  # sin etiqueta app: no cuenta
    ]
    usage = [use("wp-viejo", "10m", "100Mi"), use("wp-nuevo", "5m", "50Mi"), use("db-0", "3000000n", "400Mi")]
    assert pod_metrics(pods, usage, datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)) == {
        "pods_listos": 3,
        "wordpress_cpu": 15, "wordpress_memoria": 150, "wordpress_edad": 2,
        "wordpress_db_cpu": 3, "wordpress_db_memoria": 400, "wordpress_db_edad": 60,
    }
