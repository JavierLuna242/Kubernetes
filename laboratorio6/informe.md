# Informe — Laboratorio 6: multiplataforma en AKS (WordPress y PrestaShop)

**Autor:** Javier Luna · **Fecha:** 2026-10-23 · **Clúster:** AKS `Proyecto`, Kubernetes 1.36.4, Chile Central, 2 nodos Standard_DS2_v2, plano de control en nivel Free.

## 1. Qué se hizo

En un solo clúster AKS corren dos portales distintos de **Café Altura**, una cafetería y pastelería de demostración en Bucaramanga. Cada portal tiene su propio namespace, su propia base de datos, sus discos y su Secret:

| Portal | Imagen | Base de datos | Dirección |
|---|---|---|---|
| Sitio informativo | WordPress 7.1.3, imagen y tema propios | MySQL 8.4 (`wordpress-db`) | https://wordpress.javier.life |
| Tienda en línea | `prestashop/prestashop:9.1.5-apache` (oficial) | MariaDB 11.8 (`prestashop-db`) | https://prestashop.javier.life |

Diferencias con el enunciado:
- **Sin `azd`:** se reutilizó el clúster que ya hospeda IoT Platform, el caso "clúster compartido" de la guía.
- **IoT Platform en vez de Grafana:** el monitoreo lo hace la plataforma del proyecto, con autorización del profesor. Su backend lee el estado de los pods de Kubernetes y lo muestra como dispositivos.

**WordPress** usa una imagen propia en lugar de la de Docker Hub: PHP 8.3 con Apache, el núcleo oficial verificado por sha1, el idioma es_CO y wp-cli. Su tema de bloques no tiene PHP (`theme.json` y plantillas HTML), así que todo lo visual se edita desde el panel. **PrestaShop** usa la imagen oficial con instalación automática. Una post-instalación propia la deja como "Café Altura · Tienda": pesos colombianos, catálogo de café con fotos, paleta pastel sobre el tema hummingbird y solo español.

## 2. Arquitectura

```
 Internet ──HTTPS──► Cloudflare ── túnel cloudflared (sale desde el clúster) ──────────────┐
                     wordpress.javier.life · prestashop.javier.life                         │
 ┌─ AKS "Proyecto" ─────────────────────────────────────────────────────────────────────────┼─┐
 │ ns wordpress                                   ns prestashop                             ▼ │
 │  Service ClusterIP wordpress                    Service ClusterIP prestashop               │
 │   └► Deployment wordpress (imagen propia)        └► Deployment prestashop (imagen oficial)  │
 │        │ PVC 5 GiB medios · Secret wordpress          │ PVC 5 GiB archivos · Secret prestashop │
 │        ▼                                              │ ConfigMap prestashop-tienda         │
 │  Service ClusterIP wordpress-db                       ▼                                     │
 │   └► StatefulSet MySQL 8.4 ── PVC 5 GiB          Service ClusterIP prestashop-db           │
 │                                                   └► StatefulSet MariaDB 11.8 ── PVC 5 GiB  │
 │            ▲ Role lector-iot-platform                    ▲ Role lector-iot-platform        │
 │ ns iot     └──────────────┬───────────────────────────────┘                                │
 │  backend IoT Platform: cada 15 s, API de Kubernetes + metrics-server ─► TimescaleDB        │
 │  visualizador: dashboard "Portales en AKS"                                                 │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Separación:** WordPress solo conoce `wordpress-db` y PrestaShop solo `prestashop-db`. Son motores, namespaces, discos y credenciales distintos.
- **Exposición:** ningún Service es LoadBalancer. Los portales salen solo por el túnel de Cloudflare, con HTTPS, sin IP pública propia y sin usar la de IoT Platform (57.156.67.235). Las bases solo son accesibles dentro del clúster.
- **Credenciales:** en Secrets. El repositorio solo tiene `secretos.ejemplo.yaml`, con valores `CAMBIAR`. La carpeta del panel de PrestaShop también está en el Secret.
- **Seguridad:**
  - WordPress se actualizó de 6.8.3 a 7.1.3, con HTTPS obligatorio, cabeceras de seguridad, límite de intentos de login y código de solo lectura.
  - Las dos bases corren sin root ni capacidades y ningún pod monta el token de Kubernetes.
  - Detalle en el README.

## 3. Persistencia

| Portal | Cambio de prueba | Reinicio | Resultado |
|---|---|---|---|
| WordPress | Entrada "Chocolate caliente de temporada" e imagen en la biblioteca de medios | `rollout restart`: pod `…-692hp` → `…-zwrhp` | Siguen, las dos con HTTP 200 (capturas 04 y 05, `reinicio-wordpress.txt`) |
| PrestaShop | Producto "Granola de la casa 400 g", referencia `LAB6-PRUEBA` | `rollout restart`: pod `…-2n7v4` → `…-jr257` | Sigue en la tienda y en la base; el pod nuevo arranca con "PrestaShop Core already installed" (capturas 08 y 09, `reinicio-prestashop.txt`) |

Los dos portales guardan su contenido en su base, que tiene disco propio, pero difieren en los archivos:
- **WordPress:** el código viene en la imagen y solo las fotos subidas van a un disco.
- **PrestaShop:** escribe su configuración, módulos e imágenes en `/var/www/html`, así que necesita ese directorio en un disco. Sin él, cada reinicio reinstalaría la tienda.

Como los discos son ReadWriteOnce, los dos Deployments usan la estrategia `Recreate`, con unos segundos sin servicio en cada reinicio.

Hubo que resolver dos problemas de PrestaShop 9:
- **`lost+found`:** el instalador aborta al encontrar el `lost+found` del disco de Azure, que solo root puede leer. Un `initContainer` lo quita.
- **Carpeta del panel:** el instalador renombra `admin/` por su cuenta, así que la carpeta del panel se fija después, en la post-instalación.

## 4. Qué se ve en IoT Platform

El dashboard **Portales en AKS** (captura 10) distingue los dos portales por color:
- pods listos de cada portal;
- minutos desde el último reinicio de WordPress y de PrestaShop;
- CPU y memoria de los cuatro pods: WordPress, MySQL, PrestaShop y MariaDB;
- la edad de cada pod.

Los reinicios de la prueba se ven claramente: la edad del pod de cada portal cae a 0 (WordPress a las 17:21, PrestaShop a las 17:59) mientras la de su base sigue subiendo. Como son lecturas normales de la plataforma, también admiten alertas por Telegram, por ejemplo cuando `pods_listos` baje de 2.

## 5. Costo y decisión de apagado

- **Costo incremental:** 4 discos Standard SSD de 5 GiB, la base y los archivos de cada portal (tarifa E2, US$0,84/mes cada uno), en total **US$3,36/mes**.
- **Lo que no suma costo:**
  - no hay IP pública ni reglas de balanceador nuevas, y el túnel de Cloudflare es gratuito;
  - los nodos ya los paga el proyecto IoT: los portales reservan 0,25 vCPU y 1 GiB de su capacidad libre.

  Todo se carga a los créditos de Azure for Students.
- **Decisión:** el clúster no se apaga ni se usa `azd down`, porque ahí corre IoT Platform. Los portales quedan activos hasta la calificación. Después se retiran con `kubectl delete namespace wordpress prestashop`, que borra también sus discos, y quitando las dos rutas de Cloudflare.
