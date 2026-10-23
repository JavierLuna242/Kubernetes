# Laboratorio 6 — Multiplataforma en AKS: WordPress y PrestaShop

Dos portales distintos, cada uno con su propia base de datos, en el mismo clúster AKS que IoT Platform (`Proyecto`, resource group `Javier`, `chilecentral`, Kubernetes 1.36.4). Los dos son de **Café Altura**, una cafetería y pastelería de demostración en Bucaramanga: el sitio informativo en WordPress y la tienda en línea en PrestaShop. El monitoreo de los workloads lo hace IoT Platform, que reemplaza a Grafana con autorización del profesor. Informe: [informe.md](informe.md).

| Portal | Dirección | Base de datos | Panel |
|---|---|---|---|
| Sitio (WordPress 7.1.3, imagen y tema propios) | **https://wordpress.javier.life** | MySQL 8.4, namespace `wordpress` | `/wp-admin` · usuario `admin` |
| Tienda (PrestaShop 9.1.5, imagen oficial) | **https://prestashop.javier.life** | MariaDB 11.8, namespace `prestashop` | carpeta secreta (Secret `prestashop`, clave `admin-folder`) · usuario `admin@javier.life` |
| Monitoreo | IoT Platform → dashboard **Portales en AKS** | — | dispositivos `aks-wordpress` y `aks-prestashop` |

Los dos portales salen solo por Cloudflare Tunnel: no tienen IP pública ni comparten la de IoT Platform. Ninguna base de datos se expone fuera del clúster. Las contraseñas están en Secrets y en `laboratorio6/credenciales.local.txt`, que git ignora.

## Carpetas

```
laboratorio6/
├── README.md · informe.md
├── wordpress/                    imagen propia del sitio (la compila .\desplegar.ps1 wordpress con el BuildKit del clúster)
│   ├── Dockerfile                php:8.3-apache + gd/exif + WordPress 7.1.3 (verificado con sha1) + idioma es_CO + wp-cli + tipografías
│   ├── raiz/                     se copia a /var/www/html: wp-config.php, .htaccess (HTTPS, ?author=, enlaces), favicon.ico
│   ├── tema/                     tema de bloques "Café Altura", sin PHP: theme.json, templates/, parts/, assets/ (SVG), style.css
│   ├── seguridad/                apache.conf (cabeceras, sin PHP en medios, sin XML-RPC), php.ini (producción), seguridad.php (mu-plugin)
│   └── instalacion/              configurar-sitio.sh y contenido/ (páginas iniciales en bloques)
├── prestashop/                   configuración de la tienda (ConfigMap prestashop-tienda), aplicada al instalar
│   ├── instalar-tienda.sh        post-instalación: carpeta del panel, estilos, tipografías y tienda.php
│   ├── tienda.php                nombre, pesos colombianos, catálogo de café, sin bloques de demostración, solo español
│   ├── custom.css                paleta pastel y tipografías sobre el tema hummingbird
│   └── logo.png, cafe-*.png, taza.png   logo y fotos de producto (generadas desde las ilustraciones del sitio)
├── kubernetes/
│   ├── wordpress.yaml            MySQL (disco 5 GiB) + WordPress (disco de medios 5 GiB) + Services ClusterIP + permiso para IoT Platform
│   ├── prestashop.yaml           MariaDB (disco 5 GiB) + PrestaShop (disco de archivos 5 GiB) + Services ClusterIP + permiso para IoT Platform
│   └── secretos.ejemplo.yaml     plantilla de los dos Secrets (copiar a secretos.yaml, que git ignora)
└── evidencias/
    ├── 01–05                     WordPress: portada, móvil, carta, entrada antes y después del reinicio
    ├── 06–09                     PrestaShop: portada, móvil, producto antes y después del reinicio
    ├── 10-iot-platform-dashboard.png   pods de los dos portales
    └── checkpoints.txt, reinicio-wordpress.txt, reinicio-prestashop.txt
```

## Desplegar

Requisitos: `az`, `kubectl` y acceso al clúster (`az aks get-credentials -g Javier -n Proyecto`). No hace falta Docker.

```powershell
# 1. Namespaces y Secrets (secretos.yaml está en .gitignore)
kubectl create namespace wordpress; kubectl create namespace prestashop
copy laboratorio6\kubernetes\secretos.ejemplo.yaml laboratorio6\kubernetes\secretos.yaml   # y reemplazar cada CAMBIAR
kubectl apply -f laboratorio6\kubernetes\secretos.yaml

# 2. WordPress: compilar la imagen, subirla al ACR, desplegar e instalar el sitio.
#    La contraseña del panel entra por stdin y no queda guardada en el pod.
.\desplegar.ps1 wordpress
$c = kubectl get secret -n wordpress wordpress -o jsonpath='{.data.admin-password}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($c)) | kubectl exec -i -n wordpress deploy/wordpress -- configurar-sitio

# 3. PrestaShop: configuración de la tienda como ConfigMap y despliegue. La instalación es automática
#    (unos 3 minutos): kubectl logs -n prestashop deploy/prestashop -f  hasta "Tienda lista".
kubectl create configmap prestashop-tienda -n prestashop --from-file=laboratorio6\prestashop --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f laboratorio6\kubernetes\prestashop.yaml

# 4. Monitoreo en IoT Platform (K8S_DEVICES=wordpress=aks-wordpress,prestashop=aks-prestashop)
kubectl apply -f kubernetes\backend.yaml
```

5. **Publicar**: en Cloudflare, Zero Trust → Networks → Tunnels → túnel `Kubernetes` → Published application routes, una ruta por portal:
   - `wordpress.javier.life` → `http://wordpress.wordpress.svc.cluster.local:80`
   - `prestashop.javier.life` → `http://prestashop.prestashop.svc.cluster.local:80`

Para ver WordPress sin el dominio: `kubectl port-forward -n wordpress svc/wordpress 8080:80` → http://localhost:8080. PrestaShop siempre redirige a su dominio.

## WordPress: el sitio

- **Contenido:** Inicio, Carta, Nosotros, Visítanos y Novedades (blog con categorías). Todo se edita desde el panel: páginas y entradas con el editor de bloques, y encabezado, pie, colores y tipografías en Apariencia → Editor. Las fotos van a un disco propio.
- **¿Dónde hay PHP?** WordPress está escrito en PHP, pero el tema no tiene: son plantillas HTML de bloques más `theme.json`. El único PHP propio es `wp-config.php` y el plugin de seguridad, porque WordPress solo deja modificar el login y la API con código.
- **Cambios de código** (tema, versión de WordPress): editar `laboratorio6/wordpress` y ejecutar `.\desplegar.ps1 wordpress`. El panel no deja instalar plugins ni temas porque la imagen es inmutable.

## PrestaShop: la tienda

- **Imagen oficial** `prestashop/prestashop:9.1.5-apache`, como pide el enunciado. Se instala sola al arrancar con el disco vacío (`PS_INSTALL_AUTO=1`). Después, cada arranque detecta la instalación ("PrestaShop Core already installed") y no reinstala.
- **Post-instalación** (`prestashop/instalar-tienda.sh`, la ejecuta la imagen una sola vez): mueve el panel a la carpeta del Secret, instala estilos y tipografías, y ejecuta `tienda.php`, que deja:
  - nombre "Café Altura · Tienda" en Bucaramanga, logo propio, solo español;
  - pesos colombianos sin decimales;
  - categorías Café y Accesorios, con 4 productos y sus fotos;
  - sin el carrusel ni los bloques de demostración, y sin el correo en el pie.
- **Disco de archivos:** PrestaShop guarda su configuración (`app/config/parameters.php`), módulos e imágenes en `/var/www/html`. Sin ese disco, cada reinicio reinstalaría la tienda.
- **Tres detalles de PrestaShop 9:**
  - **`lost+found`:** el disco de Azure lo trae en la raíz y el instalador aborta al no poder leerlo. Un `initContainer` lo quita.
  - **Carpeta del panel:** el instalador renombra `admin/` por su cuenta, así que `PS_FOLDER_ADMIN` debe quedar en `admin`. El nombre definitivo lo pone la post-instalación con `CARPETA_PANEL`.
  - **Tema:** el tema por defecto es `hummingbird`, y el CSS propio va en su `assets/css/custom.css`.
- **Repetir la configuración** (rehace el catálogo inicial y borra los productos que haya):
  `kubectl exec -n prestashop deploy/prestashop -c prestashop -- /tmp/post-install-scripts/instalar-tienda.sh`

Cloudflare guarda en caché las imágenes y los CSS por su URL. Por eso el logo de la tienda lleva un hash en el nombre, y `tienda.php` regenera el CSS combinado con un nombre nuevo. En WordPress, al cambiar un SVG hay que subir el `?v=` de su URL.

## Cómo los ve IoT Platform

El backend de la plataforma ([servicios/backend/main.py](../servicios/backend/main.py), `k8s_loop`) consulta cada 15 s la API de Kubernetes y metrics-server en los namespaces de `K8S_DEVICES` ([kubernetes/backend.yaml](../kubernetes/backend.yaml)). Guarda las lecturas igual que la telemetría MQTT, una serie por etiqueta `app` del pod:

| Métrica (dispositivo `aks-wordpress` / `aks-prestashop`) | Qué es |
|---|---|
| `pods_listos` | pods del portal y su base en estado Ready |
| `wordpress_cpu`, `wordpress_db_cpu` / `prestashop_cpu`, `prestashop_db_cpu` | milinúcleos |
| `…_memoria` | MiB |
| `…_edad` | minutos desde que arrancó el pod: vuelve a 0 en cada reinicio |

El dashboard **Portales en AKS** muestra cada portal con su color (WordPress en azul, PrestaShop en frambuesa), y en "Edad de los pods" se ve cada reinicio. El permiso es mínimo: en cada namespace, el Role `lector-iot-platform` solo deja a la cuenta `iot/back` listar los pods y su uso. Como son lecturas normales, también sirven para alertas por Telegram (por ejemplo, `pods_listos < 2`).

## Seguridad

| Capa | WordPress | PrestaShop |
|---|---|---|
| Versión | 7.1.3 (estaba en 6.8.3, con 8 parches pendientes) | 9.1.5, la vigente |
| HTTPS | Redirección http → https y HSTS | Redirección http → https (SSL en todo el sitio) |
| Login | 5 fallos por IP cada 15 min, error genérico, sin XML-RPC | Carpeta del panel no adivinable, fuera del repo |
| Usuarios | Ocultos en la API y en `?author=` | El correo del administrador no se muestra en la tienda |
| Archivos | Código de root, solo lectura para PHP; sin PHP en medios | Imagen oficial (escribe sus propios archivos) |
| Cabeceras / pistas | HSTS, CSP, nosniff, anti-iframe; sin versión ni errores visibles | Las de PrestaShop |
| Contenedores | Apache con 4 capacidades; MySQL como usuario 999 sin capacidades | Arranque con 7 capacidades; MariaDB como usuario 999 sin capacidades |
| Ambos | Sin token de Kubernetes, seccomp `RuntimeDefault`, sin escalar privilegios, Services ClusterIP | |

Para desbloquear una IP en WordPress antes de los 15 minutos:
`kubectl exec -n wordpress deploy/wordpress -- sh -c "runuser -u www-data -- wp --path=/var/www/html transient delete --all"`

**Pendiente, en el panel de Cloudflare:**
- **Cloudflare Access para los paneles:** `/wp-admin`, `/wp-login.php` y la carpeta del panel de PrestaShop. Es gratis hasta 50 usuarios y frena los ataques desde muchas IP.
- **Ajustes de la zona:** *Always Use HTTPS*, *Minimum TLS 1.2* y *Bot Fight Mode*.

**No aplicado:** NetworkPolicy, porque el clúster tiene `networkPolicy: none` y activarlo cambia la red de todo el clúster, incluido IoT Platform.

## Prueba de persistencia

```powershell
kubectl rollout restart deployment/wordpress -n wordpress
kubectl rollout restart deployment/prestashop -n prestashop
```

La entrada de WordPress y el producto de prueba de PrestaShop ("Granola de la casa 400 g", referencia `LAB6-PRUEBA`) siguen tras reiniciar sus pods, porque viven en la base de cada portal. Detalle en `evidencias/reinicio-wordpress.txt` y `evidencias/reinicio-prestashop.txt`.

## Apagar

El clúster es compartido con IoT Platform, así que no se apaga ni se usa `azd down`. Para quitar los portales, lo que borra también sus cuatro discos:

```powershell
kubectl delete namespace wordpress prestashop
```

Además hay que:
- borrar las dos rutas en Cloudflare;
- borrar los dispositivos `aks-wordpress` y `aks-prestashop` en IoT Platform (Dispositivos → eliminar);
- quitar `K8S_DEVICES` de `kubernetes/backend.yaml`. Mientras siga configurado, el backend solo avisa una vez en su log que el namespace no existe.
