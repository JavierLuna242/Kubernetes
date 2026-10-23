# Laboratorio 6 — Sitio WordPress propio en el AKS de IoT Platform

Sitio público de IoT Platform hecho desde cero en WordPress: imagen y tema propios, con su propia base MySQL. Corre en el mismo clúster AKS que la plataforma (`Proyecto`, resource group `Javier`, `chilecentral`, Kubernetes 1.36.4). El visualizador de IoT Platform muestra el estado de sus pods como el dispositivo `aks-wordpress`. Informe: [informe.md](informe.md).

| Qué | Dónde |
|---|---|
| Sitio | **https://wordpress.javier.life** (Cloudflare Tunnel; no tiene IP pública propia ni comparte la de la plataforma) |
| Panel de WordPress | https://wordpress.javier.life/wp-admin · usuario `admin` |
| Monitoreo | IoT Platform → dashboard **WordPress en AKS** (dispositivo `aks-wordpress`) |

## Carpetas

```
laboratorio6/
├── wordpress/                 imagen propia (la compila desplegar.ps1 con el BuildKit del clúster)
│   ├── Dockerfile             php:8.3-apache + núcleo de WordPress 6.8.3 (verificado con sha1) + idioma es_CO + wp-cli
│   ├── wp-config.php          todo desde variables de entorno; HTTPS detrás de Cloudflare; sin instalar plugins desde el panel
│   ├── .htaccess              enlaces permanentes
│   ├── configurar-sitio.sh    instala, activa el tema y crea el contenido inicial (se puede repetir)
│   └── tema/                  tema "IoT Platform" escrito a mano: mismos colores y logo que el visualizador, modo oscuro
├── kubernetes/
│   ├── wordpress.yaml         namespace + MySQL (StatefulSet, disco 5 GiB) + WordPress + Services ClusterIP + permiso de lectura para IoT Platform
│   └── secretos.ejemplo.yaml  plantilla del Secret, sin valores reales
├── evidencias/                capturas antes y después del reinicio, portada, móvil, dashboard y reinicio.txt
├── informe.md
└── README.md
```

## Cómo lo ve IoT Platform

El backend de la plataforma ([servicios/backend/main.py](../servicios/backend/main.py), `k8s_loop`) consulta cada 15 s la API de Kubernetes y metrics-server de los namespaces que indica `K8S_DEVICES` ([kubernetes/backend.yaml](../kubernetes/backend.yaml): `wordpress=aks-wordpress`). Guarda las lecturas igual que la telemetría MQTT. Métricas:

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

# 3. Instalar el sitio
kubectl exec -n wordpress deploy/wordpress -- configurar-sitio

# 4. Que IoT Platform lo vea (si el backend aún no tiene K8S_DEVICES)
.\desplegar.ps1 backend
```

5. **Publicarlo**: en Cloudflare, Zero Trust → Networks → Tunnels → túnel `Kubernetes` → Public hostnames → Add: `wordpress.javier.life` → `HTTP` → `wordpress.wordpress.svc.cluster.local:80`.

Para verlo sin el dominio: `kubectl port-forward -n wordpress svc/wordpress 8080:80` → http://localhost:8080. La URL sale de cada petición, así que funciona igual.

Para cambiar el tema o la versión de WordPress, se edita `laboratorio6/wordpress` y se vuelve a ejecutar `.\desplegar.ps1 wordpress`. El panel no permite instalar plugins ni temas porque la imagen es inmutable.

## Prueba de persistencia

```powershell
kubectl rollout restart deployment/wordpress -n wordpress
```

Las páginas y entradas viven en MySQL, que tiene disco propio, así que siguen tras el reinicio (`evidencias/reinicio.txt`). En el dashboard, `wordpress_edad` vuelve a 0.

## Apagar

El clúster es compartido con IoT Platform, así que no se apaga ni se usa `azd down`. Para quitar solo el sitio (borra también su disco):

```powershell
kubectl delete namespace wordpress
```

Además hay que borrar la ruta `wordpress.javier.life` en Cloudflare y el dispositivo `aks-wordpress` en IoT Platform (Dispositivos → eliminar). Si `K8S_DEVICES` sigue configurado, el backend solo avisa una vez en su log que el namespace no existe.
