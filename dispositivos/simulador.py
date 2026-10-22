"""Simulador de dispositivo: publica por MQTT cada N segundos temperatura, humedad, presión, un estado
encendido/apagado (0/1) y una posición GPS (lat/lon), y obedece los comandos que le envía el visualizador.

Uso:
    pip install paho-mqtt==2.1.0
    python simulador.py --host wss://iot.javier.life/mqtt --password <contraseña MQTT>   (cifrado, recomendado)
    python simulador.py --host <IP del broker> --password <contraseña MQTT>               (sin cifrar, puerto 1883)
        opcionales: [--device sensor-1] [--interval 2] [--lat 4.6584 --lon -74.0937]

Formato (sirve igual para un dispositivo real):
    telemetría  iot/<dispositivo>/telemetry   {"temperatura": 22.5, "humedad": 60.1, ...}   ("ts" ISO 8601 opcional)
    comandos    iot/<dispositivo>/cmd         {"encendido": 1}  o  {"intervalo": 5}  o  {"<nombre>": <número>}
Al recibir un comando, el dispositivo aplica el valor y lo reporta en su telemetría: así el panel de control
confirma que se cumplió.
"""
import argparse
import json
import math
import random
import threading
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

p = argparse.ArgumentParser()
p.add_argument("--host", required=True, help="IP/host (MQTT en 1883) o URL wss://host/mqtt")
p.add_argument("--port", type=int, default=1883)
p.add_argument("--user", default="iot")
p.add_argument("--password", required=True)
p.add_argument("--device", default="sensor-1")
p.add_argument("--interval", type=float, default=2.0)
p.add_argument("--lat", type=float, default=4.6584)  # posición inicial del GPS simulado
p.add_argument("--lon", type=float, default=-74.0937)
args = p.parse_args()

telemetry, cmd_topic = f"iot/{args.device}/telemetry", f"iot/{args.device}/cmd"
state = {"encendido": 1.0}  # valores que controla el visualizador (se reportan en cada envío)
wake = threading.Event()  # despierta el bucle para confirmar un comando de inmediato


def on_connect(client, userdata, flags, reason, props):
    client.subscribe(cmd_topic, qos=1)  # al reconectar también se vuelve a suscribir


def on_message(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        for k, v in cmd.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                if k == "intervalo":
                    args.interval = max(0.5, float(v))
                state[k] = float(v)
        print("comando recibido:", cmd)
        wake.set()
    except (ValueError, AttributeError) as e:
        print("comando inválido:", msg.payload, e)


url = urlparse(args.host)
if url.scheme in ("ws", "wss"):  # MQTT sobre WebSocket (por el dominio, con TLS si es wss)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport="websockets")
    client.ws_set_options(path=url.path or "/mqtt")
    if url.scheme == "wss":
        client.tls_set()
    host, port = url.hostname, url.port or (443 if url.scheme == "wss" else 80)
else:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    host, port = args.host, args.port
client.username_pw_set(args.user, args.password)
client.on_connect = on_connect
client.on_message = on_message
client.connect(host, port)
client.loop_start()

print(f"Publicando en {telemetry} cada {args.interval} s y escuchando comandos en {cmd_topic} (Ctrl+C para salir)")
t0 = time.time()
lat, lon = args.lat + random.uniform(-0.003, 0.003), args.lon + random.uniform(-0.003, 0.003)
while True:
    t = (time.time() - t0) / 60  # minutos
    lat += random.gauss(0, 0.00015)
    lon += random.gauss(0, 0.00015)
    data = {
        "temperatura": round(22 + 3 * math.sin(t) + random.gauss(0, 0.2), 2),
        "humedad": round(55 + 10 * math.cos(t / 2) + random.gauss(0, 0.5), 2),
        "presion": round(1013 + 2 * math.sin(t / 3) + random.gauss(0, 0.1), 2),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        **state,
    }
    client.publish(telemetry, json.dumps(data), qos=1).wait_for_publish()
    print(data)
    wake.wait(args.interval)
    wake.clear()
