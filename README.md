<div align="center">

# IoT Platform

**Plataforma IoT completa sobre Kubernetes (Azure AKS): ingesta MQTT, almacenamiento de series de tiempo, dashboards en vivo, alertas, control de dispositivos y análisis.**

Proyecto final · Internet de las Cosas · 6.º semestre

![Kubernetes](https://img.shields.io/badge/Kubernetes-AKS-326CE5?logo=kubernetes&logoColor=white)
![MQTT](https://img.shields.io/badge/MQTT-EMQX-660066?logo=mqtt&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)
![TimescaleDB](https://img.shields.io/badge/DB-TimescaleDB-FDB515?logo=timescale&logoColor=black)
![React](https://img.shields.io/badge/Frontend-React%20%2B%20ECharts-61DAFB?logo=react&logoColor=black)
![Cloudflare](https://img.shields.io/badge/HTTPS-Cloudflare%20Tunnel-F38020?logo=cloudflare&logoColor=white)

[**Visualizador en vivo**](https://iot.javier.life) · [**Laboratorio →**](laboratorio/README.md)

</div>

![Dashboard de IoT Platform: estadísticas, medidor, fórmula, anomalías y pronóstico, mapa GPS y control de un dispositivo](docs/capturas/dashboard.png)

---

## Contenido

- [¿Qué es?](#qué-es)
- [Capturas](#capturas)
- [Qué contiene este repositorio](#qué-contiene-este-repositorio)
- [Arquitectura](#arquitectura)
- [Tecnologías](#tecnologías)
- [Estructura](#estructura)
- [Acceso](#acceso)
- [Visualizador](#visualizador)
- [Alertas y reglas](#alertas-y-reglas-si-entonces)
- [Dispositivos](#dispositivos)
- [Almacenamiento](#almacenamiento-timescaledb)
- [Cambiar código y desplegar](#cambiar-código-y-desplegar)
- [Desplegar desde cero](#desplegar-desde-cero)
- [Límites de Azure for Students](#límites-de-azure-for-students-por-qué-está-armado-así)

## ¿Qué es?

**IoT Platform** es una plataforma propia, al estilo de Grafana + ThingsBoard, que recibe datos de sensores por MQTT, los guarda en una base de series de tiempo y los muestra en dashboards en tiempo real. Además permite **controlar** los dispositivos (comandos y gemelo digital), **alertar** por Telegram cuando algo se sale de rango y **analizar** las series (anomalías y pronóstico).

Todo corre como contenedores en un clúster **Azure Kubernetes Service** y se publica con HTTPS en https://iot.javier.life mediante un Cloudflare Tunnel, sin puertos abiertos para el dominio.

## Capturas

**Dispositivos**: registro con credencial propia, estado de conexión en tiempo real, gemelo digital y guía para conectar uno nuevo.

![Página de dispositivos](docs/capturas/dispositivos.png)

**Alertas y reglas**: condiciones con umbral y duración, detección de dispositivos sin datos, avisos por Telegram y reporte diario.

![Página de alertas y reglas](docs/capturas/alertas.png)

<table>
  <tr>
    <td width="300" valign="top"><img src="docs/capturas/movil.png" alt="Dashboard en un celular" width="280"></td>
    <td valign="top"><b>Adaptable a celular</b>: los dashboards se reorganizan en una sola columna y el menú pasa a la barra superior. El mismo dashboard sirve para proyectar en modo kiosco o rotar varios en pantalla completa.</td>
  </tr>
</table>

## Qué contiene este repositorio

| Parte | Qué es | Dónde |
|---|---|---|
| **Plataforma IoT** | Backend, análisis y visualizador web, cada uno en su contenedor | [`servicios/`](servicios/) |
| **Infraestructura** | Manifiestos de Kubernetes: base de datos, broker MQTT, servicios, túnel y compilador de imágenes | [`kubernetes/`](kubernetes/) |
| **Dispositivo de prueba** | Simulador en Python con temperatura, humedad, presión, encendido y GPS; obedece comandos | [`dispositivos/simulador.py`](dispositivos/simulador.py) |
| **Despliegue** | Script que compila una imagen dentro del clúster y la despliega (sin Docker en el PC) | [`desplegar.ps1`](desplegar.ps1) |
| **Laboratorio** (secundario) | Práctica aparte en el mismo clúster; tiene su propio README | [`laboratorio/`](laboratorio/README.md) |

## Arquitectura

Todo vive en el namespace `iot` del clúster AKS `Proyecto` (resource group `Javier`).

```mermaid
flowchart LR
    D["Dispositivos<br/>(sensores · simulador)"] -->|MQTT / WSS| B["Broker<br/>EMQX"]
    B -->|telemetría| BE["Backend<br/>FastAPI"]
    BE -->|comandos · gemelo digital| B
    BE --> DB[("TimescaleDB")]
    BE -->|alertas · reporte · costes| TG["Telegram"]
    FE["Frontend<br/>React + ECharts<br/>(nginx)"] -->|REST + WebSocket /api| BE
    FE -->|/api/analysis| AN["Análisis<br/>numpy"]
    U(["Usuario"]) -->|HTTPS| CF["Cloudflare Tunnel<br/>iot.javier.life"] --> FE
```

| Contenedor | Nombre en Kubernetes | Función |
|---|---|---|
| Broker MQTT | `broker` | EMQX; autentica cada dispositivo contra el backend y aplica ACL por tópico |
| Backend | `back` | MQTT → base de datos, REST + WebSocket, login, dashboards, alertas, reglas, gemelo digital |
| Análisis | `analysis` | Detección de anomalías y pronóstico, sin servicios externos |
| Frontend | `front` | Visualizador web servido por nginx; también enruta `/api` y `/mqtt` |
| Base de datos | `database` | TimescaleDB con resúmenes automáticos y retención |

## Tecnologías

| Capa | Tecnología |
|---|---|
| Orquestación | Azure Kubernetes Service, BuildKit, Azure Container Registry |
| Mensajería | MQTT con EMQX (TCP y WebSocket + TLS) |
| Backend | Python, FastAPI, asyncpg |
| Análisis | Python, FastAPI, numpy (Holt-Winters, mediana móvil + MAD) |
| Base de datos | PostgreSQL + TimescaleDB (*continuous aggregates*) |
| Frontend | React, Vite, TypeScript, Tailwind, ECharts, Leaflet, nginx |
| Exposición | Cloudflare Tunnel (HTTPS automático) |
| Notificaciones | Bot de Telegram |

## Estructura

```
Proyecto final/
├── README.md
├── desplegar.ps1              ← compila un servicio dentro del clúster y lo despliega
├── servicios/                 ← código de cada contenedor
│   ├── backend/               FastAPI: MQTT → base de datos, REST + WebSocket, login, dashboards, alertas, anotaciones, comandos
│   ├── analisis/              FastAPI + numpy: detección de anomalías y pronóstico (sin servicios externos)
│   └── frontend/              Visualizador web: React + Vite + TypeScript + ECharts + Leaflet + Tailwind, servido por nginx
│       ├── public/favicon.svg   logo de la pestaña (el ícono de pulso de la barra lateral)
│       └── src/
│           ├── pages/         Dashboards, Dashboard, Dispositivos, Alertas, Login
│           ├── components/    Panel, PanelEditor, Charts (gráficos), MapChart, DeviceControls, EChart, ui…
│           └── lib/           api, series, variables, expressions (fórmulas), time, format, hooks + tests.check.ts
├── kubernetes/                ← manifiestos (qué corre en el clúster y cómo)
│   ├── namespace.yaml
│   ├── base-de-datos.yaml     TimescaleDB, disco de 10 GiB
│   ├── broker-mqtt.yaml       EMQX con usuario y contraseña
│   ├── backend.yaml
│   ├── analisis.yaml
│   ├── frontend.yaml
│   ├── tunel-cloudflare.yaml      publica iot.javier.life con HTTPS (web + MQTT en /mqtt)
│   └── compilador-imagenes.yaml   BuildKit (compila las imágenes; no hace falta Docker en el PC)
├── dispositivos/
│   └── simulador.py           dispositivo de prueba: temperatura, humedad, presión, encendido 0/1, GPS; obedece comandos
└── laboratorio/               práctica secundaria → ver su propio README
```

Cada test vive junto a su código: `servicios/backend/test_backend.py`, `servicios/analisis/test_analisis.py` y `servicios/frontend/src/lib/tests.check.ts`.

Nombres dentro de Kubernetes (Deployments, Services e imágenes): `back`, `front`, `analysis`, `broker`, `database`. `desplegar.ps1` traduce la carpeta al nombre.

## Acceso

| Qué | Dirección | Usuario |
|---|---|---|
| Visualizador | **https://iot.javier.life** (o http://57.156.67.235, sin cifrar) | `admin` |
| MQTT cifrado (recomendado) | `wss://iot.javier.life/mqtt` (WebSocket + TLS, puerto 443) | el id de cada dispositivo |
| MQTT sin cifrar | `57.156.67.235:1883` | el id de cada dispositivo |

> El clúster se detiene cuando no se usa para ahorrar crédito; si el sitio responde con error 530, hay que iniciarlo (`az aks start -g Javier -n Proyecto`).

El dominio entra por un **Cloudflare Tunnel** (`kubernetes/tunel-cloudflare.yaml`, 2 conectores): `cloudflared` se conecta desde el clúster hacia Cloudflare, que pone el HTTPS con certificado automático y protege contra ataques. No hay puertos abiertos para el dominio. Las rutas están en el panel de Cloudflare (*Zero Trust → Networks → Tunnels → Kubernetes → Published applications*):

| Hostname | Service URL |
|---|---|
| `iot.javier.life` | `http://front.iot.svc.cluster.local:80` |

Una sola ruta: nginx (contenedor `front`) sirve la web, pasa `/api` al back y `/mqtt` al broker (Service interno `broker-ws`, MQTT sobre WebSocket). En `/mqtt` no se pide la sesión de la web; el broker exige su usuario y contraseña MQTT.

Por el dominio la cookie de sesión va marcada `Secure`. Cloudflare bloquea clientes que se identifican como bots (por ejemplo `Python-urllib`); los navegadores y los dispositivos MQTT no se ven afectados.

Contraseñas (están en Secrets del clúster, no en el código):

```powershell
function Get-Secret($s, $k) { kubectl -n iot get secret $s -o jsonpath="{.data.$k}" | % { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) } }
Get-Secret iot-secrets app-password      # visualizador
Get-Secret iot-secrets mqtt-password     # usuario MQTT "iot": solo lo usa el backend, no lo des a dispositivos
```

Cada dispositivo tiene su propio token (ver *Dispositivos* abajo); se obtiene al registrarlo y no se guarda en claro.

## Visualizador

- **Dashboards** guardados en la base: crear, renombrar, exportar/importar JSON, eliminar.
- **Paneles** que se arrastran y redimensionan (modo *Editar*): serie de tiempo (línea/área/barras), valor con mini-gráfica, medidor, barras, tabla, estado, mapa de calor, mapa y control.
- **Editor de panel** con vista previa en vivo: varias consultas por panel (dispositivo, métrica, agregación promedio/mín/máx/suma/conteo/último, nombre y color), unidad, decimales, mín/máx y **umbrales** de color.
- **Tiempo**: rangos rápidos o absolutos; arrastrar sobre una gráfica hace zoom a ese rango; botón para ampliar. Cursor sincronizado entre gráficas.
- **Actualización**: en vivo (WebSocket), cada N segundos o manual. Los cortes de un dispositivo se ven como huecos en la línea.
- **Estado**: línea de tiempo con valor → texto y color (ej. 0 = Apagado, 1 = Encendido). **Mapa de calor**: promedio por hora × día. **Mapa**: OpenStreetMap con la última posición y el recorrido (el dispositivo envía `lat` y `lon`).
- **Control**: interruptor, botón o deslizador que envía comandos al dispositivo por MQTT. Muestra el estado que el dispositivo reporta y espera su confirmación (10 s); si no confirma, avisa.
- **Comparar períodos** (series de tiempo → *Comparar*): superpone, punteado, el mismo rango de hace 1 hora, 1 día, 1 semana o 30 días.
- **Variables**: selector arriba del dashboard (dispositivos, métricas o lista propia); los paneles usan `$nombre` en dispositivo, métrica, nombre o título. Un dashboard sirve para todos los sensores.
- **Modo kiosco**: botón de pantalla (o `#/d/<id>/kiosk`): pantalla completa sin menús, para proyectar. `Esc` para salir.
- **Rotación en kiosco** (*Dashboards → Rotar en kiosco*): elige dashboards, orden e intervalo (15 s – 5 min); pantalla completa que cambia sola. `←` / `→` para cambiar, espacio para pausar, `Esc` para salir. Dirección para dejarla fija en una pantalla: `#/kiosk/<segundos>/<id1,id2,…>`.
- **Métricas calculadas** (editor de panel → *Agregar fórmula*): fórmulas sobre las consultas del panel, que se identifican con letras (A, B, C…). Ejemplos: `A * B` (potencia = voltaje × corriente), `sensacion_termica(A, B)` (índice de calor de la NOAA, °C), `punto_rocio(A, B)`, `A * 9 / 5 + 32`. Operadores `+ - * / ^ %`, funciones `sqrt abs round floor ceil exp log log10 pow min max`; decimales con punto. Se calculan al consultar, así que funcionan también con el historial. El ojo de cada consulta la oculta del gráfico (por ejemplo, voltaje y corriente si solo quieres ver la potencia). No aplican a los paneles de mapa ni de control.
- **Anotaciones**: Ctrl + clic sobre una serie de tiempo (o menú ⋮ → *Agregar anotación*). Un instante o un período, de un dashboard o de todos. Clic sobre el marcador para editarla. Los eventos de alertas aparecen solos (rojo = disparada, verde = resuelta).
- **Dispositivos**: registro con credencial propia, ficha (nombre, tipo, ubicación, etiquetas), conexión en tiempo real, gemelo digital, regenerar token y guía para conectar uno nuevo.
- Exportar CSV por panel, vista ampliada, tema claro/oscuro, Ctrl+S para guardar, adaptable a celular.

### Análisis (`servicios/analisis`)

En el editor de una serie de tiempo → *Análisis*:

- **Detección de anomalías**: compara cada punto con la mediana móvil (7 puntos) y marca los que se alejan más de N veces el ruido de la serie (MAD de las diferencias). Es iterativo (como el test ESD) para que un pico no esconda ni contamine a sus vecinos. Sensibilidad alta / media / baja = 2,5 / 3,5 / 5. Las subidas y bajadas lentas no son anomalías.
- **Pronóstico**: Holt-Winters aditivo con ciclo diario cuando hay ≥ 2 días de datos; si no, Holt con tendencia amortiguada. Parámetros por mínimo error a un paso, banda de confianza de ~95 % e ignora los picos anómalos para no repetirlos. Horizonte: 10–100 % del rango visible.

nginx solo deja pasar `/api/analysis` con sesión válida (`auth_request` contra el backend).

## Alertas y reglas ("si… entonces…")

Página *Alertas* o menú ⋮ de un panel → *Crear alerta*. Regla: dispositivo · métrica · condición (`>`, `<`, `>=`, `<=`) · umbral · durante. La condición **sin datos (dispositivo caído)** se dispara si el dispositivo (o una métrica) no envía nada durante más de N minutos y se resuelve sola cuando vuelve.

Se evalúan cada 15 s con el último dato de los últimos 5 min: **Normal → Pendiente** al cumplirse, **→ Disparada** si se sigue cumpliendo todo el "durante", y vuelve a Normal si deja de cumplirse. Una alerta disparada pone en rojo los paneles con esa métrica, muestra un contador en el menú y un aviso emergente.

**Motor de reglas** (sección *Entonces…* de la regla): además del aviso por Telegram (opcional), una regla puede **enviar comandos a dispositivos al dispararse y al resolverse**. Ejemplo: *si* `sensor-1 · temperatura > 30` durante 1 min, *entonces* `ventilador ← encendido = 1`; *al resolverse*, `ventilador ← encendido = 0`. Los comandos pasan al estado deseado del gemelo digital, así llegan aunque el dispositivo esté desconectado en ese momento. Las acciones ejecutadas quedan en el historial.

**Reporte diario** (*Alertas → Reporte diario*): todos los días a la hora elegida (zona `America/Bogota`, variable `REPORT_TZ` del backend) llega por Telegram el resumen del día anterior: mínimo, máximo y promedio de cada métrica, alertas disparadas y dispositivos que dejaron de enviar. *Enviar ahora* manda el de hoy hasta el momento o el de ayer completo. Está activo (hora configurable en esa misma tarjeta).

**Coste de Azure**: cada hora el backend consulta el coste del mes en curso (Cost Management, con la identidad de los nodos del AKS), lo guarda como lecturas del dispositivo `azure-costes` (total y por servicio, para graficarlo) y, si cambió desde el último aviso, lo manda por Telegram con la proyección a fin de mes. Necesita las variables `AZURE_SUBSCRIPTION` y `AZURE_CLIENT_ID` en `kubernetes/backend.yaml` y el rol *Cost Management Reader* para esa identidad.

**Avisos por Telegram** (configurado con el bot @Claudia_Monitor_bot). Para cambiar de bot o de chat:

1. En Telegram, habla con **@BotFather**, envía `/newbot` y copia el token.
2. Escríbele cualquier mensaje a tu bot.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número de `"chat":{"id"`.
4. ```powershell
   kubectl -n iot delete secret telegram
   kubectl -n iot create secret generic telegram --from-literal=token=<TOKEN> --from-literal=chat-id=<CHAT_ID>
   kubectl -n iot rollout restart deploy/back
   ```
5. En *Alertas* → *Enviar prueba*.

## Dispositivos

**1. Registro y credenciales.** En *Dispositivos → Registrar dispositivo* se elige su identificador (minúsculas, números, `-` y `_`), nombre, tipo, ubicación y etiquetas. La plataforma entrega su **usuario MQTT (= su identificador) y su token**, que se muestra una sola vez (en la base solo queda su hash SHA-256). Si se pierde o se filtra, *Regenerar token*: el anterior deja de servir y se cierran sus conexiones abiertas.

**2. Seguridad en el broker** (`kubernetes/broker-mqtt.yaml`). EMQX valida cada conexión preguntándole al backend (`/internal/mqtt/auth`, solo accesible dentro del clúster) y aplica una ACL: cada dispositivo **solo** puede publicar en `iot/<su id>/telemetry` y **solo** leer `iot/<su id>/cmd`; no puede espiar ni suplantar a otro. Lo que no está permitido se niega. El usuario `iot` es del backend.

**3. Telemetría.** El dispositivo publica en `iot/<id>/telemetry` un JSON con campos numéricos:

```json
{"temperatura": 22.5, "humedad": 60.1}
```

`"ts"` (ISO 8601) es opcional; si falta, se usa la hora de llegada. Sirve para enviar datos guardados mientras no hubo red.

**4. Gemelo digital.** Cada dispositivo registrado tiene un estado **deseado** (lo que piden los controles, las reglas o el propio gemelo) y uno **reportado** (el último valor de cada métrica). El deseado completo se publica como mensaje **retenido** en `iot/<id>/cmd`: el dispositivo lo recibe al conectarse aunque haya estado apagado cuando se pidió. Debe aplicarlo y reportarlo en su telemetría; entonces la propiedad queda *sincronizada* (si no, *pendiente*). Los botones del panel de control son acciones puntuales y no quedan en el estado deseado.

**5. Conexión.** El estado *Conectado / Desconectado* sale del propio broker (se consulta cada 15 s), no de cuándo llegó el último dato.

Probar con el simulador (aplica el estado deseado: `encendido`, `intervalo` en segundos y cualquier otro número):

```powershell
pip install paho-mqtt==2.1.0
python dispositivos/simulador.py --host wss://iot.javier.life/mqtt --device <id> --password <token>   # cifrado
python dispositivos/simulador.py --host 57.156.67.235 --device <id> --password <token>               # sin cifrar
# opcional: --interval 5  --lat 4.6584 --lon -74.0937 (posición inicial del GPS)
```


## Almacenamiento (TimescaleDB)

- **Resúmenes automáticos** (*continuous aggregates*) por minuto (`readings_1m`) y por hora (`readings_1h`) con suma, conteo, mín, máx y último. Las consultas con intervalos de ≥ 1 min o ≥ 1 h leen de ahí: rangos de semanas o meses responden al instante. Los datos en vivo se ven al momento; los que llegan con `"ts"` atrasado aparecen tras el siguiente refresco (≤ 5 min por minuto, ≤ 10 min por hora).
- **Retención**: datos crudos 30 días, resumen por minuto 1 año, resumen por hora para siempre. Así el disco no se llena.

## Cambiar código y desplegar

```powershell
.\desplegar.ps1 backend     # o:  .\desplegar.ps1 frontend   |   .\desplegar.ps1 analisis
```

Compila la imagen dentro del clúster, la sube al registro `iotproyectojavierbr.azurecr.io` y reinicia el servicio. No necesitas Docker.

**Desarrollo local del frontend:** `cd servicios/frontend; npm install; npm run dev`. Para tener datos, en otra terminal: `kubectl -n iot port-forward svc/back 8000:8000`.

**Chequeos:**

```powershell
py -m pytest servicios/backend     # parseo MQTT, sesión, alertas, resúmenes, reporte, costes, credenciales y gemelo digital
py -m pytest servicios/analisis    # anomalías y pronóstico (necesita numpy)
cd servicios/frontend; npx tsx src/lib/tests.check.ts   # cortes en las series, variables y fórmulas
```

> Si `npm install` falla con `Cannot read properties of null (reading 'edgesOut')`, es un bug de npm 10; usa `npx npm@11 install`.

## Desplegar desde cero

```powershell
az aks get-credentials --resource-group Javier --name Proyecto
kubectl apply -f kubernetes/namespace.yaml
# Secrets (solo la primera vez; cambia las contraseñas)
kubectl -n iot create secret generic iot-secrets --from-literal=db-password=<pw-db> --from-literal=mqtt-password=<pw-mqtt> "--from-literal=mqtt-users.csv=user_id,password,is_superuser`niot,<pw-mqtt>,false" --from-literal=app-password=<pw-visualizador> --from-literal=session-secret=<40+ caracteres aleatorios> --from-literal=emqx-api-key=iotback:<32+ caracteres aleatorios>
kubectl -n iot create secret generic telegram --from-literal=token=<TOKEN> --from-literal=chat-id=<CHAT_ID>   # opcional
kubectl -n iot create secret generic cloudflare-tunnel --from-literal=token=<token del túnel de Cloudflare>
kubectl apply -f kubernetes/base-de-datos.yaml -f kubernetes/broker-mqtt.yaml -f kubernetes/tunel-cloudflare.yaml
.\desplegar.ps1 backend
.\desplegar.ps1 analisis   # antes que el frontend: nginx necesita que exista el Service "analysis"
.\desplegar.ps1 frontend
```

## Límites de Azure for Students (por qué está armado así)

- **Máximo 3 IPs públicas por región**: el visualizador y el broker comparten la IP estática `iot-ip` (anotación `azure-pip-name`), cada uno en su puerto.
- **No permite ACR Tasks** (`az acr build`): por eso se compila con BuildKit dentro del clúster (`desplegar.ps1`).
- ACR Tasks tampoco existe en chilecentral, por eso el registro está en brazilsouth.
- Para ahorrar crédito: `az aks stop -g Javier -n Proyecto` / `az aks start -g Javier -n Proyecto`.

---

<div align="center">

Javier Luna · Proyecto final de Internet de las Cosas

</div>
