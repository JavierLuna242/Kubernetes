# Laboratorio 6 — WordPress propio en el AKS de IoT Platform

**Café Altura** es el sitio de una cafetería y pastelería de demostración, hecho en WordPress desde cero: imagen propia, tema de bloques propio y su propia base MySQL. Corre en el mismo clúster AKS que IoT Platform (`Proyecto`, resource group `Javier`, `chilecentral`, Kubernetes 1.36.4). El visualizador de IoT Platform muestra el estado de sus pods como el dispositivo `aks-wordpress`. Informe: [informe.md](informe.md).

| Qué | Dónde |
|---|---|
| Sitio | **https://wordpress.javier.life** (Cloudflare Tunnel; no tiene IP pública propia ni comparte la de la plataforma) |
| Panel de WordPress | https://wordpress.javier.life/wp-admin · usuario `admin` |
| Monitoreo | IoT Platform → dashboard **WordPress en AKS** (dispositivo `aks-wordpress`) |

## El sitio

- **Páginas:** Inicio, Carta, Nosotros y Visítanos, más Novedades (el blog, con categorías Café, Pastelería y Eventos).
- **Estilo:** pasteles suaves (rosa, menta, durazno, lavanda y vainilla sobre crema), mucho espacio en blanco, Fraunces para los títulos y DM Sans para el texto. Las ilustraciones son SVG propios de línea fina.
- **Se gestiona desde el panel**, como cualquier WordPress:
  - Páginas y Entradas, con el editor de bloques.
  - Apariencia → Editor: encabezado, pie, plantillas, colores y tipografías, sin tocar código.
  - Medios: las fotos se guardan en un disco propio.

## Carpetas

```
laboratorio6/
├── README.md                     este archivo
├── informe.md                    informe de entrega
├── wordpress/                    imagen propia (la compila .\desplegar.ps1 wordpress con el BuildKit del clúster)
│   ├── Dockerfile                php:8.3-apache + gd/exif + WordPress 7.1.3 (verificado con sha1) + idioma es_CO + wp-cli + tipografías
│   ├── raiz/                     se copia a la raíz del sitio (/var/www/html)
│   │   ├── wp-config.php         todo desde variables de entorno; URL fija (no la decide el Host); sin instalar plugins desde el panel
│   │   ├── .htaccess             HTTP → HTTPS, bloqueo de ?author=, enlaces permanentes
│   │   └── favicon.ico           ícono de la taza
│   ├── tema/                     tema de bloques "Café Altura", sin PHP
│   │   ├── theme.json            paleta, tipografías, tamaños, espacios, estilos de botones y CSS propio
│   │   ├── templates/            front-page, home (Novedades), page, single, index (archivos y búsqueda), 404
│   │   ├── parts/                header y footer
│   │   ├── assets/               ilustraciones SVG (las tipografías se descargan al compilar)
│   │   └── style.css             solo la cabecera que identifica el tema
│   ├── seguridad/
│   │   ├── apache.conf           cabeceras, sin PHP en medios, sin XML-RPC, sin firma del servidor
│   │   ├── php.ini               PHP de producción: sin errores en pantalla ni versión
│   │   └── seguridad.php         mu-plugin: límite de intentos de login, errores genéricos, usuarios ocultos en la API
│   └── instalacion/
│       ├── configurar-sitio.sh   instala, activa el tema y crea páginas, menú, categorías y entradas (se puede repetir)
│       └── contenido/            páginas iniciales en bloques de WordPress (inicio, carta, nosotros, visitanos)
├── kubernetes/
│   ├── wordpress.yaml            namespace + MySQL (disco 5 GiB) + WordPress (disco de medios 5 GiB) + Services ClusterIP + permiso de lectura para IoT Platform
│   └── secretos.ejemplo.yaml     plantilla del Secret (copiar a secretos.yaml, que git ignora)
└── evidencias/
    ├── 01-portada.png, 02-portada-movil.png, 03-carta.png
    ├── 04-entrada-antes-del-reinicio.png, 05-entrada-despues-del-reinicio.png, reinicio.txt
    └── 06-iot-platform-dashboard.png
```

**¿Dónde hay PHP?** WordPress está escrito en PHP y lo necesita para funcionar, pero el tema no tiene PHP: la estructura son plantillas HTML con bloques y el diseño está en `theme.json`, así que todo lo visual se cambia desde el panel. El único PHP propio es la configuración (`wp-config.php`) y el plugin de seguridad, porque WordPress solo deja modificar el login y la API con código.

## Cómo lo ve IoT Platform

El backend de la plataforma ([servicios/backend/main.py](../servicios/backend/main.py), `k8s_loop`) consulta cada 15 s la API de Kubernetes y metrics-server en los namespaces que indica `K8S_DEVICES` ([kubernetes/backend.yaml](../kubernetes/backend.yaml): `wordpress=aks-wordpress`). Guarda las lecturas igual que la telemetría MQTT. Métricas:

| Métrica | Qué es |
|---|---|
| `pods_listos` | pods de WordPress y MySQL en estado Ready |
| `wordpress_cpu`, `wordpress_db_cpu` | milinúcleos |
| `wordpress_memoria`, `wordpress_db_memoria` | MiB |
| `wordpress_edad`, `wordpress_db_edad` | minutos desde que arrancó el pod: vuelve a 0 en cada reinicio |

El permiso es mínimo: el Role `lector-iot-platform` solo deja listar pods y su uso en el namespace `wordpress`, a la cuenta de servicio `iot/back`. Como son lecturas normales, también sirven para alertas por Telegram (por ejemplo, `pods_listos < 2`).

## Desplegar

Requisitos: `az`, `kubectl` y acceso al clúster (`az aks get-credentials -g Javier -n Proyecto`). No hace falta Docker.

```powershell
# 1. Namespace y Secret (secretos.yaml está en .gitignore)
kubectl create namespace wordpress
copy laboratorio6\kubernetes\secretos.ejemplo.yaml laboratorio6\kubernetes\secretos.yaml   # y reemplazar cada CAMBIAR
kubectl apply -f laboratorio6\kubernetes\secretos.yaml

# 2. Compilar la imagen, subirla al ACR y desplegar (MySQL + WordPress)
.\desplegar.ps1 wordpress

# 3. Instalar el sitio. La contraseña del panel entra por stdin: no queda guardada en el pod.
#    (En un sitio ya instalado basta: kubectl exec -n wordpress deploy/wordpress -- configurar-sitio)
$c = kubectl get secret -n wordpress wordpress -o jsonpath='{.data.admin-password}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($c)) | kubectl exec -i -n wordpress deploy/wordpress -- configurar-sitio

# 4. Que IoT Platform lo vea (si el backend aún no tiene K8S_DEVICES)
.\desplegar.ps1 backend
```

5. **Publicarlo**: en Cloudflare, Zero Trust → Networks → Tunnels → túnel `Kubernetes` → Public hostnames → Add: `wordpress.javier.life` → `HTTP` → `wordpress.wordpress.svc.cluster.local:80`.

Para verlo sin el dominio: `kubectl port-forward -n wordpress svc/wordpress 8080:80` → http://localhost:8080. La URL sale de cada petición, así que funciona igual.

**Cambios:**
- **Textos, páginas, entradas, fotos, colores, encabezado y pie:** desde el panel; se guardan en la base.
- **Tema base o versión de WordPress:** se edita `laboratorio6/wordpress` y se ejecuta `.\desplegar.ps1 wordpress`. El panel no deja instalar plugins ni temas porque la imagen es inmutable.

Cloudflare guarda en caché los archivos estáticos (SVG, tipografías). Si se cambia uno conservando el nombre, hay que cambiar el `?v=` de su URL o purgar la caché en Cloudflare.

## Seguridad

Revisión del 2026-10-23. Todo se aplica desde la imagen y el manifiesto, sin plugins de terceros.

| Capa | Medida |
|---|---|
| WordPress | Versión 7.1.3 (estaba en 6.8.3, con 8 parches de seguridad pendientes). Al subir el ARG `WP_VERSION`, `configurar-sitio` actualiza la base |
| Login | Máximo 5 fallos por IP cada 15 min; un único mensaje de error que no dice si el usuario existe; sin XML-RPC ni contraseñas de aplicación |
| Usuarios ocultos | La API no lista usuarios sin sesión, `?author=N` responde 403 y el nombre público del autor es "Equipo Café Altura" (`/author/equipo/`), no el usuario `admin` |
| HTTPS | Toda petición http se redirige a https; HSTS de un año |
| Cabeceras | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y una CSP que impide incrustar el sitio en otro |
| Archivos | El código es de root y PHP solo puede leerlo; lo único escribible es la biblioteca de medios, donde PHP no se ejecuta |
| Sin pistas | No hay `readme.html` ni versión en el HTML; PHP no muestra errores ni `X-Powered-By`; Apache sin firma |
| Contenedores | WordPress: Apache con solo 4 capacidades (puerto 80 y cambio a www-data), sin escalar privilegios. MySQL: usuario 999, sin capacidades. Ninguno monta el token de Kubernetes. La contraseña del panel no está en el pod |
| Red | WordPress y MySQL solo tienen Services ClusterIP; el sitio sale únicamente por Cloudflare |

Para desbloquear una IP antes de los 15 minutos:

```powershell
kubectl exec -n wordpress deploy/wordpress -- sh -c "runuser -u www-data -- wp --path=/var/www/html transient delete --all"
```

**Pendiente, desde el panel de Cloudflare (no se puede hacer desde el clúster):**
- **Proteger el panel:** poner `/wp-admin` y `/wp-login.php` detrás de Cloudflare Access (Zero Trust → Access → Applications, gratis hasta 50 usuarios). Así el panel pide un código por correo antes de mostrarse, y el límite por IP deja de ser la única barrera ante ataques repartidos entre muchas IP.
- **Ajustes de la zona:** SSL/TLS → Edge Certificates → *Always Use HTTPS* y *Minimum TLS 1.2*; Security → *Bot Fight Mode*.

**No aplicado:** las NetworkPolicy, porque el clúster tiene `networkPolicy: none` y Kubernetes no las haría cumplir. Activarlas cambia la red de todo el clúster, incluido IoT Platform.

## Prueba de persistencia

```powershell
kubectl rollout restart deployment/wordpress -n wordpress
```

Las páginas, entradas y estilos viven en MySQL y las fotos en el disco de medios, así que todo sigue tras el reinicio (`evidencias/reinicio.txt`). En el dashboard, `wordpress_edad` vuelve a 0.

## Apagar

El clúster es compartido con IoT Platform, así que no se apaga ni se usa `azd down`. Para quitar solo el sitio (borra también sus dos discos):

```powershell
kubectl delete namespace wordpress
```

Además hay que borrar la ruta `wordpress.javier.life` en Cloudflare y el dispositivo `aks-wordpress` en IoT Platform (Dispositivos → eliminar). Si `K8S_DEVICES` sigue configurado, el backend solo avisa una vez en su log que el namespace no existe.
