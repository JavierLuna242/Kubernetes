"""Back: escucha el broker MQTT, guarda en TimescaleDB y expone REST + WebSocket al front.

Tópico:  iot/<dispositivo>/telemetry
Payload: JSON con campos numéricos, ej. {"temperatura": 22.5, "humedad": 60}
         "ts" (ISO 8601) es opcional; si falta se usa la hora de llegada.
Cada campo numérico se guarda como una fila (time, device, metric, value).

Todo /api (salvo health/login/logout) exige la cookie de sesión que entrega /api/login.
"""
import asyncio
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

import aiomqtt
import asyncpg
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator

TOPIC = "iot/+/telemetry"
SESSION_DAYS = 7

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS readings (
    time   timestamptz      NOT NULL,
    device text             NOT NULL,
    metric text             NOT NULL,
    value  double precision NOT NULL
);
SELECT create_hypertable('readings', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS readings_device_time ON readings (device, time DESC);
CREATE TABLE IF NOT EXISTS dashboards (
    id         uuid        PRIMARY KEY,
    name       text        NOT NULL,
    spec       jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_rules (
    id         uuid             PRIMARY KEY,
    name       text             NOT NULL,
    device     text             NOT NULL,
    metric     text             NOT NULL,
    op         text             NOT NULL,
    threshold  double precision NOT NULL,
    for_s      int              NOT NULL DEFAULT 0,
    enabled    boolean          NOT NULL DEFAULT true,
    state      text             NOT NULL DEFAULT 'ok',
    since      timestamptz,
    last_value double precision
);
CREATE TABLE IF NOT EXISTS alert_events (
    time      timestamptz      NOT NULL DEFAULT now(),
    rule_id   uuid             NOT NULL,
    rule_name text             NOT NULL,
    device    text             NOT NULL,
    metric    text             NOT NULL,
    state     text             NOT NULL,
    value     double precision
);
CREATE INDEX IF NOT EXISTS alert_events_time ON alert_events (time DESC);
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS op text NOT NULL DEFAULT '>';
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS threshold double precision;
CREATE TABLE IF NOT EXISTS annotations (
    id           uuid        PRIMARY KEY,
    dashboard_id uuid,
    time         timestamptz NOT NULL,
    time_end     timestamptz,
    text         text        NOT NULL,
    color        text        NOT NULL DEFAULT '#b877d9'
);
CREATE TABLE IF NOT EXISTS settings (
    key   text  PRIMARY KEY,
    value jsonb NOT NULL
);
"""

# Funciones de agregación permitidas (lista blanca: nunca se interpola texto del usuario en el SQL).
AGG = {
    "avg": "avg(value)",
    "min": "min(value)",
    "max": "max(value)",
    "sum": "sum(value)",
    "count": "count(*)",
    "last": "last(value, time)",
}

clients: set[WebSocket] = set()
mqtt_client: aiomqtt.Client | None = None  # conexión activa al broker (para enviar comandos)

# Resúmenes automáticos de TimescaleDB (continuous aggregates). Las consultas con intervalos de >= 1 min / 1 h
# leen de aquí en vez de los datos crudos: rápidas aunque el rango sea de meses. Los datos en vivo se ven al
# instante (materialized_only = false); los que llegan con "ts" atrasado aparecen tras el siguiente refresco.
# (vista, intervalo, retraso del refresco, cada cuánto se refresca, retención)
ROLLUPS = [
    ("readings_1h", "1 hour", "1 hour", "10 minutes", None),
    ("readings_1m", "1 minute", "1 minute", "5 minutes", "365 days"),
]
RAW_RETENTION = "30 days"  # los datos crudos se borran después de esto; los resúmenes quedan
ROLLUP_AGG = {
    "avg": "sum(sum) / sum(count)",
    "min": "min(min)",
    "max": "max(max)",
    "sum": "sum(sum)",
    "count": "sum(count)",
    "last": "last(last, bucket)",
}


def pick_source(bucket_s: float) -> tuple[str, str, dict[str, str]]:
    """(tabla, columna de tiempo, agregaciones) según el intervalo pedido: resumen por hora, por minuto o crudo."""
    if bucket_s >= 3600:
        return "readings_1h", "bucket", ROLLUP_AGG
    if bucket_s >= 60:
        return "readings_1m", "bucket", ROLLUP_AGG
    return "readings", "time", AGG


async def setup_storage(pool: asyncpg.Pool) -> None:
    """Crea los resúmenes por minuto y por hora (con datos en tiempo real) y las políticas de retención."""
    for view, interval, end_offset, schedule, keep in ROLLUPS:
        if await pool.fetchval("SELECT to_regclass($1) IS NOT NULL", view):
            continue
        await pool.execute(
            f"CREATE MATERIALIZED VIEW {view} WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS "
            f"SELECT time_bucket('{interval}', time) AS bucket, device, metric, sum(value) AS sum, count(*) AS count, "
            "min(value) AS min, max(value) AS max, last(value, time) AS last "
            "FROM readings GROUP BY bucket, device, metric WITH NO DATA"
        )
        await pool.execute(f"CALL refresh_continuous_aggregate('{view}', NULL, now() - interval '{end_offset}')")
        # Refresca los últimos 7 días (datos que llegan con "ts" atrasado); siempre dentro de la retención cruda.
        await pool.execute(
            f"SELECT add_continuous_aggregate_policy('{view}', start_offset => interval '7 days', "
            f"end_offset => interval '{end_offset}', schedule_interval => interval '{schedule}')"
        )
        if keep:
            await pool.execute(f"SELECT add_retention_policy('{view}', interval '{keep}')")
    await pool.execute(f"SELECT add_retention_policy('readings', interval '{RAW_RETENTION}', if_not_exists => true)")


# ---------- MQTT -> base de datos ----------

def parse(topic: str, payload: bytes) -> list[tuple]:
    """Convierte un mensaje MQTT en filas (time, device, metric, value). Lanza ValueError si es inválido."""
    device = topic.split("/")[1]
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("el payload debe ser un objeto JSON")
    ts = datetime.fromisoformat(data["ts"]) if "ts" in data else datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return [
        (ts, device, k, float(v))
        for k, v in data.items()
        if k != "ts" and isinstance(v, (int, float)) and not isinstance(v, bool)
    ]


async def broadcast(rows: list[tuple]) -> None:
    msg = json.dumps([{"time": t.isoformat(), "device": d, "metric": m, "value": v} for t, d, m, v in rows])
    # ponytail: envío secuencial; un cliente lento frena al resto. Usar una cola por cliente si hay muchos.
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            clients.discard(ws)


async def mqtt_loop(pool: asyncpg.Pool) -> None:
    global mqtt_client
    while True:
        try:
            async with aiomqtt.Client(
                os.getenv("MQTT_HOST", "broker"),
                username=os.environ["MQTT_USER"],
                password=os.environ["MQTT_PASSWORD"],
            ) as client:
                mqtt_client = client
                await client.subscribe(TOPIC)
                print("MQTT conectado, escuchando", TOPIC, flush=True)
                async for msg in client.messages:
                    try:
                        rows = parse(str(msg.topic), msg.payload)
                    except (ValueError, KeyError, TypeError) as e:
                        print(f"mensaje inválido en {msg.topic}: {e}", flush=True)
                        continue
                    if rows:
                        await pool.executemany("INSERT INTO readings VALUES ($1, $2, $3, $4)", rows)
                        await broadcast(rows)
        except aiomqtt.MqttError as e:
            mqtt_client = None
            print(f"MQTT desconectado ({e}), reintento en 5 s", flush=True)
            await asyncio.sleep(5)


# ---------- Alertas ----------
# La condición se evalúa cada EVAL_S segundos sobre el último valor (de los últimos 5 min).
# ok -> pending cuando se cumple; pending -> firing si se sigue cumpliendo durante for_s; vuelve a ok si deja de cumplirse.
# op "nodata": se cumple si el dispositivo (o esa métrica) no envía nada hace más de `threshold` minutos.

EVAL_S = 15
FRESH_S = 300  # un valor más viejo que esto no cuenta para las condiciones de umbral
OPS = {">": lambda v, t: v > t, "<": lambda v, t: v < t, ">=": lambda v, t: v >= t, "<=": lambda v, t: v <= t}


def condition(op: str, threshold: float, value: float | None, last_time: datetime | None, now: datetime) -> bool:
    if op == "nodata":
        return last_time is None or (now - last_time).total_seconds() > threshold * 60
    fresh = last_time is not None and (now - last_time).total_seconds() <= FRESH_S
    return fresh and value is not None and OPS[op](value, threshold)


def next_state(state: str, since: datetime | None, cond: bool, for_s: int, now: datetime) -> tuple[str, datetime | None]:
    """Siguiente (estado, desde) según si la condición se cumple ahora."""
    if not cond:
        return "ok", None
    if state == "ok":
        state, since = "pending", now
    if state == "pending" and (now - since).total_seconds() >= for_s:
        return "firing", now
    return state, since


def notify(text: str) -> None:
    """Envía un mensaje por Telegram si TELEGRAM_TOKEN y TELEGRAM_CHAT_ID están configurados (bloqueante)."""
    token, chat = os.getenv("TELEGRAM_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=10)


async def send(text: str) -> None:
    try:
        await asyncio.to_thread(notify, text)
    except Exception as e:  # una notificación fallida no debe frenar la evaluación
        print(f"no se pudo notificar por Telegram: {e}", flush=True)


async def alert_loop(pool: asyncpg.Pool) -> None:
    while True:
        try:
            await evaluate_alerts(pool)
        except Exception as e:
            print(f"error evaluando alertas: {e}", flush=True)
        await asyncio.sleep(EVAL_S)


def describe(device: str, metric: str, op: str, threshold: float, value: float | None) -> str:
    """Texto de un evento de alerta, para Telegram y las anotaciones."""
    target = f"{device} · {metric}" if metric else device
    if op == "nodata":
        return f"{target}: {'nunca envió datos' if value is None else f'sin datos hace {round(value)} min'} (límite {threshold:g} min)"
    return f"{target} = {'sin datos' if value is None else round(value, 2)} (condición {op} {threshold:g})"


async def evaluate_alerts(pool: asyncpg.Pool) -> None:
    # Último dato de cada regla (métrica vacía = cualquier métrica del dispositivo).
    rules = await pool.fetch(
        "SELECT r.*, l.value, l.time FROM alert_rules r LEFT JOIN LATERAL ("
        "  SELECT value, time FROM readings WHERE device = r.device AND (r.metric = '' OR metric = r.metric)"
        "  ORDER BY time DESC LIMIT 1"
        ") l ON true WHERE r.enabled"
    )
    now = datetime.now(timezone.utc)
    for r in rules:
        cond = condition(r["op"], r["threshold"], r["value"], r["time"], now)
        state, since = next_state(r["state"], r["since"], cond, r["for_s"], now)
        # Para "sin datos" el valor que se muestra son los minutos desde el último dato.
        value = ((now - r["time"]).total_seconds() / 60 if r["time"] else None) if r["op"] == "nodata" else r["value"]
        await pool.execute(
            "UPDATE alert_rules SET state = $2, since = $3, last_value = $4 WHERE id = $1", r["id"], state, since, value
        )
        event = "firing" if state == "firing" != r["state"] else "resolved" if r["state"] == "firing" != state else None
        if event:
            await pool.execute(
                "INSERT INTO alert_events (rule_id, rule_name, device, metric, state, value, op, threshold) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                r["id"], r["name"], r["device"], r["metric"], event, value, r["op"], r["threshold"],
            )
            icon, verb = ("🔴", "DISPARADA") if event == "firing" else ("✅", "resuelta")
            await send(f"{icon} Alerta {verb}: {r['name']}\n{describe(r['device'], r['metric'], r['op'], r['threshold'], value)}")


# ---------- Reporte diario por Telegram ----------
# Cada día, a la hora configurada (zona REPORT_TZ), resume el día anterior: mín/máx/promedio por métrica,
# alertas disparadas y dispositivos que dejaron de enviar. Se configura desde la página Alertas.

REPORT_TZ = ZoneInfo(os.getenv("REPORT_TZ", "America/Bogota"))
REPORT_DEFAULT = {"enabled": False, "hour": 7, "last": None}
TELEGRAM_MAX = 4000  # Telegram admite 4096 caracteres por mensaje
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def num(v: float | None) -> str:
    """22.456 -> '22,46' (coma decimal, sin ceros de más)."""
    return "—" if v is None else f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def build_report(day: datetime, stats: list[dict], events: list[dict], silent: list[str], partial: bool) -> str:
    """Texto del reporte. stats: {device, metric, avg, min, max, n}; events: {rule_name, device, metric, times}."""
    title = f"📊 Reporte {'de hoy (hasta ahora)' if partial else 'diario'} · {WEEKDAYS[day.weekday()]} {day:%d/%m/%Y}"
    lines = [title, ""]
    if not stats:
        lines.append("No llegaron datos de ningún dispositivo.")
    device = None
    for s in stats:
        if s["device"] != device:
            device = s["device"]
            lines += ([""] if len(lines) > 2 else []) + [f"📟 {device}"]
        lines.append(f"  • {s['metric']}: mín {num(s['min'])} · máx {num(s['max'])} · prom {num(s['avg'])} ({s['n']} lecturas)")
    lines += ["", f"🔔 Alertas disparadas: {sum(e['times'] for e in events) or 'ninguna'}"]
    for e in events:
        target = f"{e['device']} · {e['metric']}" if e["metric"] else e["device"]
        lines.append(f"  • {e['rule_name']} ({target}): {e['times']} {'vez' if e['times'] == 1 else 'veces'}")
    if silent:
        lines += ["", f"⚠️ Sin datos ese día: {', '.join(silent)}"]
    text = "\n".join(lines)
    if len(text) > TELEGRAM_MAX:  # muchos dispositivos: se corta y se avisa
        text = text[: TELEGRAM_MAX - 60].rsplit("\n", 1)[0] + "\n… (reporte recortado: ver el resto en el visualizador)"
    return text


async def report_settings(pool: asyncpg.Pool) -> dict:
    v = await pool.fetchval("SELECT value FROM settings WHERE key = 'report'")
    return {**REPORT_DEFAULT, **(v or {})}


async def save_report_settings(pool: asyncpg.Pool, s: dict) -> None:
    await pool.execute(
        "INSERT INTO settings (key, value) VALUES ('report', $1) ON CONFLICT (key) DO UPDATE SET value = $1", s
    )


async def make_report(pool: asyncpg.Pool, day_start: datetime, partial: bool) -> str:
    """Reporte del día local que empieza en day_start (hasta ahora si partial)."""
    end = datetime.now(REPORT_TZ) if partial else day_start + timedelta(days=1)
    stats = await pool.fetch(
        "SELECT device, metric, sum(sum) / sum(count) AS avg, min(min) AS min, max(max) AS max, sum(count) AS n "
        "FROM readings_1h WHERE bucket >= $1 AND bucket < $2 GROUP BY device, metric ORDER BY device, metric",
        day_start, end,
    )
    events = await pool.fetch(
        "SELECT rule_name, device, metric, count(*) AS times FROM alert_events "
        "WHERE state = 'firing' AND time >= $1 AND time < $2 GROUP BY 1, 2, 3 ORDER BY times DESC, rule_name",
        day_start, end,
    )
    # Dispositivos que enviaron en la semana previa pero nada ese día.
    seen_before = await pool.fetch(
        "SELECT DISTINCT device FROM readings_1h WHERE bucket >= $1 AND bucket < $2", day_start - timedelta(days=7), day_start
    )
    today = {s["device"] for s in stats}
    silent = sorted(r["device"] for r in seen_before if r["device"] not in today)
    return build_report(day_start, [dict(s) for s in stats], [dict(e) for e in events], silent, partial)


def local_midnight(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def report_due(settings: dict, now: datetime) -> bool:
    """¿Toca enviar el reporte? (activo, ya pasó la hora y no se envió hoy). now en la zona REPORT_TZ."""
    return settings["enabled"] and now.hour >= settings["hour"] and settings["last"] != now.date().isoformat()


async def report_loop(pool: asyncpg.Pool) -> None:
    while True:
        try:
            s = await report_settings(pool)
            now = datetime.now(REPORT_TZ)
            if report_due(s, now):
                await send(await make_report(pool, local_midnight(now) - timedelta(days=1), partial=False))
                await save_report_settings(pool, {**s, "last": now.date().isoformat()})
        except Exception as e:
            print(f"error con el reporte diario: {e}", flush=True)
        await asyncio.sleep(60)


# ---------- Sesión (cookie firmada con HMAC) ----------

def _sig(payload: str) -> str:
    return hmac.new(os.environ["SESSION_SECRET"].encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(user: str, now: float | None = None) -> str:
    payload = f"{user}:{int((now or time.time()) + SESSION_DAYS * 86400)}"
    return f"{payload}:{_sig(payload)}"


def check_token(token: str | None, now: float | None = None) -> str | None:
    """Devuelve el usuario si el token es válido y no venció; si no, None."""
    try:
        user, exp, sig = (token or "").rsplit(":", 2)
        ok = hmac.compare_digest(sig, _sig(f"{user}:{exp}")) and int(exp) > (now or time.time())
        return user if ok else None
    except ValueError:
        return None


def auth(request: Request) -> str:
    user = check_token(request.cookies.get("session"))
    if not user:
        raise HTTPException(401, "No autenticado")
    return user


# ---------- App ----------

async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Si la base aún no está lista, esto falla y Kubernetes reinicia el pod: ese es el reintento.
    app.state.pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], init=_init_conn)
    await app.state.pool.execute(SCHEMA)
    await setup_storage(app.state.pool)
    tasks = [asyncio.create_task(f(app.state.pool)) for f in (mqtt_loop, alert_loop, report_loop)]
    yield
    for t in tasks:
        t.cancel()
    await app.state.pool.close()


app = FastAPI(title="IoT Platform · backend", lifespan=lifespan)
api = APIRouter(prefix="/api", dependencies=[Depends(auth)])


@app.get("/api/health")
async def health():
    await app.state.pool.fetchval("SELECT 1")
    return {"ok": True}


class Login(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(body: Login, request: Request, response: Response):
    ok_user = hmac.compare_digest(body.username, os.getenv("APP_USER", "admin"))
    ok_pass = hmac.compare_digest(body.password, os.environ["APP_PASSWORD"])
    if not (ok_user and ok_pass):
        await asyncio.sleep(1)  # frena intentos de fuerza bruta
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    # Por el dominio (Cloudflare) llega HTTPS: la cookie solo viaja cifrada. Por la IP sigue siendo HTTP.
    https = request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        "session", make_token(body.username), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=https
    )
    return {"user": body.username}


@api.get("/config")
async def config():
    """Datos públicos de conexión MQTT para la guía de dispositivos (vienen del manifiesto de Kubernetes)."""
    return {"mqtt_tcp": os.getenv("MQTT_PUBLIC_TCP", ""), "mqtt_wss": os.getenv("MQTT_PUBLIC_WSS", "")}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@api.get("/me")
async def me(user: str = Depends(auth)):
    return {"user": user}


# --- Dispositivos ---

@api.get("/devices")
async def devices():
    """Dispositivos con datos en los últimos 30 días, sus métricas y última lectura."""
    rows = await app.state.pool.fetch(
        "SELECT device, array_agg(DISTINCT metric ORDER BY metric) AS metrics, max(time) AS last_seen, "
        "count(*) AS readings FROM readings WHERE time > now() - interval '30 days' "
        "GROUP BY device ORDER BY device"
    )
    return [
        {"device": r["device"], "metrics": r["metrics"], "last_seen": r["last_seen"], "readings": r["readings"]}
        for r in rows
    ]


@api.delete("/devices/{device}")
async def delete_device(device: str):
    """Borra todas las lecturas de un dispositivo y recalcula los resúmenes de ese período."""
    pool = app.state.pool
    first, last = await pool.fetchrow("SELECT min(time), max(time) FROM readings WHERE device = $1", device)
    status = await pool.execute("DELETE FROM readings WHERE device = $1", device)
    if first:
        # Solo dentro de la retención cruda: refrescar donde ya no hay datos crudos borraría los resúmenes de todos.
        # ponytail: los resúmenes de este dispositivo más viejos que 29 días quedan; borrarlos exige tocar tablas internas.
        start = max(first, datetime.now(timezone.utc) - timedelta(days=29)).replace(minute=0, second=0, microsecond=0)
        end = last.replace(minute=0, second=0, microsecond=0) + timedelta(hours=2)
        if end > start:
            for view, *_ in ROLLUPS:  # CALL no admite parámetros preparados; las fechas vienen de la base
                await pool.execute(f"CALL refresh_continuous_aggregate('{view}', '{start.isoformat()}', '{end.isoformat()}')")
    return {"deleted": int(status.split()[-1])}


class Command(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    value: float


@api.post("/devices/{device}/command")
async def send_command(device: str, c: Command):
    """Publica {name: value} en iot/<dispositivo>/cmd. El dispositivo debe suscribirse a ese tópico y,
    para confirmar, reportar el nuevo estado en su telemetría."""
    if any(ch in device for ch in "/+#") or not device:
        raise HTTPException(422, "Nombre de dispositivo inválido")
    if mqtt_client is None:
        raise HTTPException(503, "El back no está conectado al broker MQTT")
    payload = json.dumps({c.name: c.value})
    await mqtt_client.publish(f"iot/{device}/cmd", payload, qos=1)
    return {"ok": True, "topic": f"iot/{device}/cmd", "payload": payload}


# --- Consultas ---

class Target(BaseModel):
    device: str
    metric: str
    agg: Literal["avg", "min", "max", "sum", "count", "last"] = "avg"


class Query(BaseModel):
    start: datetime
    end: datetime
    points: int = Field(300, ge=10, le=2000)
    bucket_s: int | None = Field(None, ge=1)  # intervalo exacto (ej. 3600 = por hora); si viene, manda sobre points
    targets: list[Target] = Field(max_length=20)


@api.post("/query")
async def query(q: Query):
    """Series agrupadas en ~points intervalos: [{device, metric, agg, points: [[iso, valor], ...]}]."""
    span = (q.end - q.start).total_seconds()
    if span <= 0:
        raise HTTPException(422, "end debe ser posterior a start")
    if q.bucket_s and span / q.bucket_s > 5000:
        raise HTTPException(422, "Rango demasiado grande para ese intervalo")
    bucket = q.bucket_s or max(1.0, span / q.points)
    # ponytail: con resúmenes, los intervalos que no son múltiplos de 1 min / 1 h quedan alineados al resumen
    table, tcol, aggs = pick_source(bucket)

    async def one(t: Target):
        rows = await app.state.pool.fetch(
            f"SELECT time_bucket(make_interval(secs => $3), {tcol}) AS t, {aggs[t.agg]} AS v FROM {table} "
            f"WHERE device = $1 AND metric = $2 AND {tcol} >= $4 AND {tcol} < $5 GROUP BY t ORDER BY t",
            t.device, t.metric, bucket, q.start, q.end,
        )
        return {**t.model_dump(), "points": [[r["t"].isoformat(), r["v"]] for r in rows]}

    return await asyncio.gather(*(one(t) for t in q.targets))


# --- Dashboards ---

class Dashboard(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    spec: dict[str, Any]


@api.get("/dashboards")
async def list_dashboards():
    rows = await app.state.pool.fetch(
        "SELECT id, name, updated_at, jsonb_array_length(coalesce(spec->'panels', '[]')) AS panels "
        "FROM dashboards ORDER BY name"
    )
    return [dict(r) for r in rows]


@api.post("/dashboards")
async def create_dashboard(d: Dashboard):
    new_id = uuid.uuid4()
    await app.state.pool.execute("INSERT INTO dashboards (id, name, spec) VALUES ($1, $2, $3)", new_id, d.name, d.spec)
    return {"id": new_id}


@api.get("/dashboards/{id}")
async def get_dashboard(id: uuid.UUID):
    r = await app.state.pool.fetchrow("SELECT id, name, spec, updated_at FROM dashboards WHERE id = $1", id)
    if not r:
        raise HTTPException(404, "Dashboard no encontrado")
    return dict(r)


@api.put("/dashboards/{id}")
async def update_dashboard(id: uuid.UUID, d: Dashboard):
    status = await app.state.pool.execute(
        "UPDATE dashboards SET name = $2, spec = $3, updated_at = now() WHERE id = $1", id, d.name, d.spec
    )
    if status.endswith(" 0"):
        raise HTTPException(404, "Dashboard no encontrado")
    return {"ok": True}


@api.delete("/dashboards/{id}")
async def delete_dashboard(id: uuid.UUID):
    await app.state.pool.execute("DELETE FROM dashboards WHERE id = $1", id)
    return {"ok": True}


# --- Alertas ---

class AlertRule(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    device: str = Field(min_length=1)
    metric: str = ""  # vacío solo con "nodata": cualquier métrica del dispositivo
    op: Literal[">", "<", ">=", "<=", "nodata"]
    threshold: float  # con "nodata": minutos sin datos
    for_s: int = Field(0, ge=0, le=86400)
    enabled: bool = True

    @model_validator(mode="after")
    def _check(self):
        if self.op != "nodata" and not self.metric:
            raise ValueError("La métrica es obligatoria salvo en alertas de 'sin datos'")
        if self.op == "nodata" and self.threshold <= 0:
            raise ValueError("Los minutos sin datos deben ser mayores que 0")
        return self


@api.get("/alerts")
async def list_alerts():
    rows = await app.state.pool.fetch("SELECT * FROM alert_rules ORDER BY name")
    return {
        "rules": [dict(r) for r in rows],
        "telegram": bool(os.getenv("TELEGRAM_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "eval_s": EVAL_S,
    }


@api.post("/alerts")
async def create_alert(a: AlertRule):
    new_id = uuid.uuid4()
    await app.state.pool.execute(
        "INSERT INTO alert_rules (id, name, device, metric, op, threshold, for_s, enabled) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        new_id, a.name, a.device, a.metric, a.op, a.threshold, a.for_s, a.enabled,
    )
    return {"id": new_id}


@api.put("/alerts/{id}")
async def update_alert(id: uuid.UUID, a: AlertRule):
    """Editar reinicia el estado: la regla se vuelve a evaluar desde cero."""
    status = await app.state.pool.execute(
        "UPDATE alert_rules SET name=$2, device=$3, metric=$4, op=$5, threshold=$6, for_s=$7, enabled=$8, "
        "state='ok', since=NULL WHERE id=$1",
        id, a.name, a.device, a.metric, a.op, a.threshold, a.for_s, a.enabled,
    )
    if status.endswith(" 0"):
        raise HTTPException(404, "Alerta no encontrada")
    return {"ok": True}


@api.delete("/alerts/{id}")
async def delete_alert(id: uuid.UUID):
    """Borra la regla y su historial (que dejaría de tener a qué referirse)."""
    await app.state.pool.execute("DELETE FROM alert_events WHERE rule_id = $1", id)
    await app.state.pool.execute("DELETE FROM alert_rules WHERE id = $1", id)
    return {"ok": True}


@api.get("/alerts/events")
async def alert_events(limit: int = 100):
    rows = await app.state.pool.fetch("SELECT * FROM alert_events ORDER BY time DESC LIMIT $1", min(limit, 500))
    return [dict(r) for r in rows]


@api.post("/alerts/test")
async def test_notification():
    if not (os.getenv("TELEGRAM_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")):
        raise HTTPException(400, "Telegram no está configurado")
    try:
        await asyncio.to_thread(notify, "🔔 Prueba de IoT Platform: las notificaciones funcionan.")
    except Exception as e:
        raise HTTPException(502, f"Telegram rechazó el mensaje: {e}")
    return {"ok": True}


# --- Reporte diario ---

class ReportSettings(BaseModel):
    enabled: bool
    hour: int = Field(ge=0, le=23)


@api.get("/report")
async def get_report():
    s = await report_settings(app.state.pool)
    return {**s, "tz": str(REPORT_TZ), "telegram": bool(os.getenv("TELEGRAM_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"))}


@api.put("/report")
async def put_report(r: ReportSettings):
    s = await report_settings(app.state.pool)
    now = datetime.now(REPORT_TZ)
    # Al activarlo después de la hora de hoy, el primero sale mañana (no de inmediato).
    last = now.date().isoformat() if r.enabled and not s["enabled"] and now.hour >= r.hour else s["last"]
    await save_report_settings(app.state.pool, {"enabled": r.enabled, "hour": r.hour, "last": last})
    return {"ok": True}


@api.post("/report/send")
async def send_report(day: Literal["yesterday", "today"] = "today"):
    """Envía el reporte ahora: el de ayer completo o el de hoy hasta este momento."""
    if not (os.getenv("TELEGRAM_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")):
        raise HTTPException(400, "Telegram no está configurado")
    midnight = local_midnight(datetime.now(REPORT_TZ))
    text = await make_report(app.state.pool, midnight - timedelta(days=1) if day == "yesterday" else midnight, partial=day == "today")
    try:
        await asyncio.to_thread(notify, text)
    except Exception as e:
        raise HTTPException(502, f"Telegram rechazó el mensaje: {e}")
    return {"text": text}


# --- Anotaciones ---

class Annotation(BaseModel):
    dashboard_id: uuid.UUID | None = None  # None = visible en todos los dashboards
    time: datetime
    time_end: datetime | None = None
    text: str = Field(min_length=1, max_length=500)
    color: str = Field("#b877d9", pattern=r"^#[0-9a-fA-F]{6}$")


@api.get("/annotations")
async def list_annotations(start: datetime, end: datetime, dashboard: uuid.UUID | None = None):
    """Anotaciones del dashboard (y globales) en el rango, más los eventos de alertas como anotaciones."""
    manual = await app.state.pool.fetch(
        "SELECT * FROM annotations WHERE (dashboard_id = $3 OR dashboard_id IS NULL) "
        "AND time <= $2 AND coalesce(time_end, time) >= $1 ORDER BY time",
        start, end, dashboard,
    )
    alerts = await app.state.pool.fetch(
        "SELECT * FROM alert_events WHERE time BETWEEN $1 AND $2 ORDER BY time", start, end
    )
    return [{**dict(r), "kind": "manual"} for r in manual] + [
        {
            "id": None,
            "kind": "alert",
            "time": r["time"],
            "time_end": None,
            "color": "#f2495c" if r["state"] == "firing" else "#73bf69",
            "text": f"{'Alerta disparada' if r['state'] == 'firing' else 'Alerta resuelta'}: {r['rule_name']} "
                    f"({describe(r['device'], r['metric'], r['op'], r['threshold'] or 0, r['value'])})",
        }
        for r in alerts
    ]


@api.post("/annotations")
async def create_annotation(a: Annotation):
    new_id = uuid.uuid4()
    await app.state.pool.execute(
        "INSERT INTO annotations (id, dashboard_id, time, time_end, text, color) VALUES ($1,$2,$3,$4,$5,$6)",
        new_id, a.dashboard_id, a.time, a.time_end, a.text, a.color,
    )
    return {"id": new_id}


@api.put("/annotations/{id}")
async def update_annotation(id: uuid.UUID, a: Annotation):
    status = await app.state.pool.execute(
        "UPDATE annotations SET dashboard_id=$2, time=$3, time_end=$4, text=$5, color=$6 WHERE id=$1",
        id, a.dashboard_id, a.time, a.time_end, a.text, a.color,
    )
    if status.endswith(" 0"):
        raise HTTPException(404, "Anotación no encontrada")
    return {"ok": True}


@api.delete("/annotations/{id}")
async def delete_annotation(id: uuid.UUID):
    await app.state.pool.execute("DELETE FROM annotations WHERE id = $1", id)
    return {"ok": True}


app.include_router(api)


@app.websocket("/api/ws")
async def ws(websocket: WebSocket):
    """Empuja cada lectura nueva en vivo: [{time, device, metric, value}, ...]."""
    if not check_token(websocket.cookies.get("session")):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        clients.discard(websocket)
