# Informe — Laboratorio 6: WordPress en AKS

**Autor:** Javier Luna · **Fecha:** 2026-10-23 · **Clúster:** AKS `Proyecto`, Kubernetes 1.36.4, Chile Central, 2 nodos Standard_DS2_v2, plano de control en nivel Free.

## 1. Qué se hizo y en qué se aparta del enunciado

Se desplegó el sitio público de IoT Platform, hecho en WordPress desde cero, en el mismo clúster AKS que ya hospeda la plataforma IoT (el caso "clúster compartido" del enunciado). Hay tres decisiones distintas a lo que pide la guía:

- **Sin PrestaShop.** El proyecto solo necesita un portal: el sitio de la plataforma.
- **Sin Grafana.** La observación la hace IoT Platform, la propia plataforma del proyecto. Su backend lee el estado de los pods de Kubernetes y lo muestra como un dispositivo más.
- **Sin template `azd`.** El clúster ya existía.

El WordPress no usa la imagen `wordpress` de Docker Hub. Tiene una imagen propia: PHP 8.3 con Apache, el núcleo oficial de WordPress 6.8.3 verificado por suma sha1, el idioma español (Colombia) y wp-cli. La configuración (`wp-config.php`) toma todo de variables de entorno, y el tema "IoT Platform" está escrito a mano con los colores y el logo del visualizador. La imagen no trae temas ni plugins de fábrica y no permite instalarlos desde el panel: cualquier cambio entra con una imagen nueva.

## 2. Arquitectura

```
 Internet ──HTTPS──► Cloudflare ──túnel (cloudflared, sale desde el clúster)──┐
                     wordpress.javier.life                                    │
 ┌─ AKS "Proyecto" ───────────────────────────────────────────────────────────┼──┐
 │ ns wordpress                                                               ▼  │
 │   Service ClusterIP wordpress ──► Deployment wordpress (imagen propia, ACR)    │
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
| Entrada "Este sitio corre en Kubernetes" (`/este-sitio-corre-en-kubernetes/`) | `kubectl rollout restart deployment/wordpress`: pod `…-mbwx9` → `…-4f5zj` | La entrada sigue (capturas 01 y 02, `evidencias/reinicio.txt`) |

El pod de WordPress no tiene disco. Todo el contenido vive en MySQL, que sí lo tiene, por eso el pod se puede reemplazar sin perder nada. Hay un límite: los archivos subidos a la biblioteca de medios se guardan en el contenedor y se pierden al reiniciar. Si el sitio los necesita, hay que añadir un PVC en `wp-content/uploads`.

## 4. Qué se ve en IoT Platform

El dashboard "WordPress en AKS" (captura 05) muestra:

- los pods listos;
- los minutos desde el último reinicio de WordPress;
- la memoria de cada pod;
- CPU y memoria en el tiempo;
- la edad de los pods.

El reinicio de la prueba se ve claramente: la edad del pod de WordPress cae a 0 a las 11:27. Como son lecturas normales de la plataforma, también se les pueden poner alertas por Telegram, por ejemplo cuando `pods_listos` baje de 2.

## 5. Costo y decisión de apagado

- **Costo incremental:** un disco Standard SSD de 5 GiB (tarifa E2, US$0,84/mes). No hay IP pública ni regla de balanceador nueva, y el túnel de Cloudflare es gratuito. Los nodos ya los paga el proyecto IoT; el sitio reserva 0,1 vCPU y 512 MiB de su capacidad libre. Todo se carga a los créditos de Azure for Students.
- **Decisión:** el clúster no se apaga ni se usa `azd down`, porque ahí corre IoT Platform. El sitio queda activo como parte del proyecto. Si hubiera que retirarlo, basta `kubectl delete namespace wordpress`, que borra también su disco, y quitar la ruta de Cloudflare.
