# Laboratorio 6 — WordPress y PrestaShop en el mismo AKS, con Grafana

Dos portales independientes, cada uno con su base de datos, en el clúster AKS `Proyecto` (resource group `Javier`, región `chilecentral`, Kubernetes 1.36.4, 2 nodos Standard_DS2_v2). Grafana observa el clúster aparte. Informe: [informe.md](informe.md).

| Namespace | Qué corre | Base de datos | Acceso |
|---|---|---|---|
| `wordpress` | `wordpress:6.8-apache` (Deployment) | `mysql:8.4` (StatefulSet + disco de 5 GiB, ClusterIP) | http://57.156.67.235:8080 |
| `prestashop` | `prestashop/prestashop:8.2-apache` (Deployment + disco de 5 GiB para sus archivos) | `mariadb:10.11` (StatefulSet + disco de 5 GiB, ClusterIP) | http://57.156.67.235:8081 (admin en `/admin-lab`) |
| `monitoreo` | Grafana 12.1 + Prometheus 3.5 | ninguna de los portales | `kubectl port-forward -n monitoreo svc/grafana 3000:80` → http://localhost:3000 |

Los dos portales comparten la IP pública del proyecto IoT (`iot-ip`) en puertos distintos, así que no se paga otra IP. Las bases de datos solo tienen Service ClusterIP: no salen a Internet.

## Archivos

```
laboratorio6/
├── kubernetes/
│   ├── wordpress.yaml          namespace + MySQL + WordPress + Services
│   ├── prestashop.yaml         namespace + MariaDB + disco de archivos + PrestaShop + Services
│   ├── monitoreo.yaml          namespace + Prometheus (lee cAdvisor) + Grafana con el panel "portales" ya cargado
│   └── secretos.ejemplo.yaml   plantilla de los Secrets, sin valores reales
├── evidencias/                 capturas de los dos sitios antes y después del reinicio, Grafana y reinicios.txt
└── informe.md
```

## Desplegar

Requisitos: `az`, `kubectl` y acceso al clúster (`az aks get-credentials -g Javier -n Proyecto`). No hace falta Docker: todas las imágenes son públicas.

```powershell
cd laboratorio6/kubernetes

# 1. Namespaces y Secrets (secretos.yaml está en .gitignore; usar solo letras y números)
kubectl create namespace wordpress; kubectl create namespace prestashop; kubectl create namespace monitoreo
copy secretos.ejemplo.yaml secretos.yaml   # y reemplazar cada CAMBIAR
kubectl apply -f secretos.yaml

# 2. Todo lo demás
kubectl apply -f wordpress.yaml -f prestashop.yaml -f monitoreo.yaml
kubectl get pods,pvc -n wordpress; kubectl get pods,pvc -n prestashop   # BD Running, volúmenes Bound
```

- **PrestaShop** se instala solo en el primer arranque (`PS_INSTALL_AUTO=1`, unos 3 minutos; `kubectl logs -n prestashop deploy/prestashop -f`). `PS_DOMAIN` lleva la IP y el puerto públicos: si cambia la IP hay que cambiarlo antes del primer arranque.
- **WordPress**: completar el asistente en http://57.156.67.235:8080 (o con wp-cli dentro del pod, como se hizo aquí).

## Prueba de persistencia

```powershell
kubectl rollout restart deployment/wordpress -n wordpress
kubectl rollout restart deployment/prestashop -n prestashop
```

La página http://57.156.67.235:8080/prueba-lab6/ y el producto http://57.156.67.235:8081/es/inicio/20-producto-prueba-lab6.html siguen tras el reinicio (ver `evidencias/reinicios.txt`).

- WordPress guarda todo en MySQL, así que su pod no necesita disco.
- PrestaShop escribe su configuración (`app/config/parameters.php`) en sus propios archivos. Por eso tiene el PVC `prestashop-files` y estrategia `Recreate`. Sin ese disco, cada reinicio volvería a instalar la tienda.

## Apagar

El clúster es compartido con el proyecto final IoT, así que **no** se usa `azd down`. Para quitar solo el laboratorio (borra también sus 3 discos):

```powershell
kubectl delete namespace wordpress prestashop monitoreo
kubectl delete clusterrole,clusterrolebinding prometheus-lab6
```
