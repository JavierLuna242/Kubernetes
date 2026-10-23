# Informe — Laboratorio 6: WordPress en AKS

**Autor:** Javier Luna · **Fecha:** 2026-10-23 · **Clúster:** AKS `Proyecto`, Kubernetes 1.36.4, Chile Central, 2 nodos Standard_DS2_v2, plano de control en nivel Free.

## 1. Qué se hizo y en qué se aparta del enunciado

Se desplegó **Café Altura**, el sitio de una cafetería y pastelería de demostración, hecho en WordPress desde cero. Corre en el mismo clúster AKS que ya hospeda la plataforma IoT (el caso "clúster compartido" del enunciado). Hay tres decisiones distintas a lo que pide la guía:

- **Sin PrestaShop.** Basta un portal para demostrar el gestor de contenidos.
- **Sin Grafana.** La observación la hace IoT Platform, la propia plataforma del proyecto. Su backend lee el estado de los pods de Kubernetes y lo muestra como un dispositivo más.
- **Sin template `azd`.** El clúster ya existía.

El WordPress no usa la imagen `wordpress` de Docker Hub. Tiene una imagen propia: PHP 8.3 con Apache y las extensiones gd y exif para las fotos, el núcleo oficial de WordPress 6.8.3 verificado por suma sha1, el idioma español (Colombia) y wp-cli. La configuración (`wp-config.php`) toma todo de variables de entorno.

El tema "Café Altura" es un **tema de bloques sin PHP propio**. WordPress sí necesita PHP para funcionar, pero el tema solo tiene `theme.json` (paleta pastel, tipografías Fraunces y DM Sans, tamaños y espacios), plantillas HTML de bloques e ilustraciones SVG. Así, todo lo visual se puede editar desde el panel, en Apariencia → Editor. Se comprobó en el editor que las 6 plantillas y partes y los 7 contenidos iniciales cargan sin bloques inválidos. La imagen no trae temas ni plugins de fábrica y no permite instalarlos desde el panel: el tema base y el núcleo cambian con una imagen nueva, y el contenido y los estilos, desde el panel.

## 2. Arquitectura

```
 Internet ──HTTPS──► Cloudflare ──túnel (cloudflared, sale desde el clúster)──┐
                     wordpress.javier.life                                    │
 ┌─ AKS "Proyecto" ───────────────────────────────────────────────────────────┼──┐
 │ ns wordpress                                                               ▼  │
 │   Service ClusterIP wordpress ──► Deployment wordpress (imagen propia, ACR)    │
 │                                        │ PVC 5 GiB: biblioteca de medios       │
 │                                        │ Secret "wordpress"                    │
 │                                        ▼                                       │
 │   Service ClusterIP wordpress-db ─► StatefulSet MySQL 8.4 ── PVC 5 GiB         │
 │                       ▲ Role lector-iot-platform (listar pods y su uso)       │
 │ ns iot                │                                                        │
 │   backend IoT Platform ── cada 15 s: API de Kubernetes + metrics-server        │
 │        └─► TimescaleDB ─► visualizador: dashboard "WordPress en AKS"           │
 └─────────────────────────────────────────────────────────────────────────────────┘
```

- **Exposición:** ningún Service del sitio es LoadBalancer. El sitio sale solo por el túnel de Cloudflare, con HTTPS, y no comparte la IP pública de la plataforma (57.156.67.235). La base de datos solo es accesible dentro del clúster.
- **Credenciales:** contraseñas de MySQL, clave de sesiones y contraseña del panel en un Secret. El repositorio solo tiene `secretos.ejemplo.yaml`, con valores `CAMBIAR`.

## 3. Persistencia

| Cambio | Reinicio | Resultado |
|---|---|---|
| Entrada "Chocolate caliente de temporada" (`/chocolate-caliente-de-temporada/`) y una imagen en la biblioteca de medios | `kubectl rollout restart deployment/wordpress`: pod `…-f74s5` → `…-hhwjj` | La entrada y la imagen siguen, las dos con HTTP 200 (capturas 01 y 02, `evidencias/reinicio.txt`) |

Páginas, entradas, menú y estilos editados en el panel viven en MySQL, que tiene su propio disco. Las fotos subidas van a un segundo disco montado en `wp-content/uploads`. El resto del pod (núcleo, tema, tipografías) viene en la imagen, así que se puede reemplazar sin perder nada. Como el disco de medios es ReadWriteOnce, el Deployment usa la estrategia `Recreate`: el pod viejo suelta el disco antes de que arranque el nuevo, con unos segundos sin servicio en cada reinicio.

## 4. Qué se ve en IoT Platform

El dashboard "WordPress en AKS" (captura 05) muestra:

- los pods listos;
- los minutos desde el último reinicio de WordPress;
- la memoria de cada pod;
- CPU y memoria en el tiempo;
- la edad de los pods.

Cada reinicio se ve claramente porque la edad del pod de WordPress vuelve a 0, mientras la de MySQL sigue subiendo. Como son lecturas normales de la plataforma, también se les pueden poner alertas por Telegram, por ejemplo cuando `pods_listos` baje de 2.

## 5. Costo y decisión de apagado

- **Costo incremental:** dos discos Standard SSD de 5 GiB, la base y los medios (tarifa E2, US$0,84/mes cada uno, US$1,68/mes). No hay IP pública ni regla de balanceador nueva, y el túnel de Cloudflare es gratuito. Los nodos ya los paga el proyecto IoT; el sitio reserva 0,1 vCPU y 512 MiB de su capacidad libre. Todo se carga a los créditos de Azure for Students.
- **Decisión:** el clúster no se apaga ni se usa `azd down`, porque ahí corre IoT Platform. El sitio queda activo como parte del proyecto. Si hubiera que retirarlo, basta `kubectl delete namespace wordpress`, que borra también sus discos, y quitar la ruta de Cloudflare.
