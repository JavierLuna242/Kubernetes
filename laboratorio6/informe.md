# Informe — Laboratorio 6: multiplataforma en AKS

**Autor:** Javier Luna · **Fecha:** 2026-10-23 · **Clúster:** AKS `Proyecto`, Kubernetes 1.36.4, región Chile Central, 2 nodos Standard_DS2_v2, plano de control en nivel Free.

## 1. Arquitectura

No se ejecutó `azd provision` con el template: se reutilizó el clúster AKS que ya hospeda el proyecto final IoT (el caso "clúster compartido" del laboratorio). Grafana es un Deployment propio con Prometheus, en lugar de Managed Grafana. Cada portal vive en su propio namespace y tiene su propia base de datos.

```
                                 Internet
                                    │  IP pública 57.156.67.235 (compartida)
                     :8080 ─────────┼───────── :8081
                       │                          │
 ┌─ AKS "Proyecto" ────┼──────────────────────────┼──────────────────────────────┐
 │ ns wordpress        ▼              ns prestashop ▼                            │
 │  Service LoadBalancer               Service LoadBalancer                      │
 │  Deployment wordpress               Deployment prestashop ── PVC 5 GiB        │
 │        │ (Secret wordpress-db)             │ (Secret prestashop-db)  (archivos)│
 │        ▼                                    ▼                                  │
 │  Service ClusterIP wordpress-db      Service ClusterIP prestashop-db           │
 │  StatefulSet MySQL 8.4 ── PVC 5 GiB   StatefulSet MariaDB 10.11 ── PVC 5 GiB   │
 │                                                                                │
 │ ns monitoreo:  Prometheus ──lee cAdvisor de cada nodo vía API server──┐       │
 │                Grafana (ClusterIP, port-forward) ◄── consulta ─────────┘       │
 │ ns iot: plataforma del proyecto final (no se toca)                             │
 └────────────────────────────────────────────────────────────────────────────────┘
```

- **Aislamiento:** WordPress solo conoce `wordpress-db` y PrestaShop solo `prestashop-db`. Cada uno usa un motor distinto (MySQL y MariaDB), con su propio Secret y su propio disco.
- **Exposición:** solo los dos portales tienen Service LoadBalancer. Las bases de datos y Grafana son ClusterIP. Los portales reutilizan la IP pública del proyecto en otros puertos, así que no hubo que pagar otra IP.
- **Credenciales:** en Secrets creados aparte. El repositorio solo trae `secretos.ejemplo.yaml`, con valores `CAMBIAR`.

## 2. Persistencia

| Portal | Cambio de prueba | Reinicio | Resultado |
|---|---|---|---|
| WordPress | Página "Página de prueba Lab 6" (`/prueba-lab6/`) | `kubectl rollout restart`: pod `…-2p8lc` → `…-plvtr` | La página sigue (capturas 01 y 03) |
| PrestaShop | Producto "Producto de prueba Lab 6", ref. LAB6-001, id 20 | `kubectl rollout restart`: pod `…-xbgqd` → `…-htjlj` | El producto sigue (capturas 02 y 04); el log muestra "PrestaShop Core already installed" |

El detalle está en `evidencias/reinicios.txt`. Hubo una diferencia entre los dos portales. WordPress guarda las páginas en MySQL y su pod es desechable. PrestaShop, en cambio, escribe su configuración en sus propios archivos: sin el PVC en `/var/www/html`, el pod nuevo habría vuelto a instalar la tienda sobre la base existente.

## 3. Qué se ve en Grafana

El panel "Portales en AKS: WordPress y PrestaShop" (captura 05) se carga solo al desplegar e incluye:

- contenedores en ejecución por portal (2 y 2: la app y su base de datos);
- una tabla con cada pod vivo, su portal y su memoria;
- CPU, memoria y tráfico de red recibido por pod, con leyendas `namespace / pod`.

En las series se ve el reinicio: las líneas de los pods viejos se cortan y empiezan las de los nuevos. También se ve el pico de CPU y de red de PrestaShop durante su instalación automática.

Durante la prueba apareció un detalle: cAdvisor sigue publicando durante varios minutos los cgroups de los pods ya borrados. El panel los descarta y solo cuenta contenedores con CPU mayor que cero en los últimos 2 minutos. Con kube-state-metrics se filtraría por el estado real del pod.

## 4. Costo y decisión de apagado

- **Costo incremental del laboratorio:** 3 discos Standard SSD de 5 GiB (tarifa E2: US$0,84/mes cada uno), unos **US$2,5/mes**. La IP pública y el balanceador ya existían; el balanceador queda con 4 reglas, dentro de las 5 incluidas en su tarifa base. El plano de control está en nivel Free. Los dos nodos ya estaban pagados por el proyecto IoT: el laboratorio reserva 0,35 vCPU y 1,25 GiB (suma de sus *requests*) de su capacidad libre. Todo se carga a los créditos de Azure for Students.
- **Decisión:** **no** se ejecuta `azd down` ni se detiene el clúster, porque también corre el proyecto final IoT. Los recursos del laboratorio quedan activos hasta la calificación y después se eliminan con `kubectl delete namespace wordpress prestashop monitoreo` y `kubectl delete clusterrole,clusterrolebinding prometheus-lab6`. Al borrar los namespaces se borran también sus discos, que tienen `reclaimPolicy: Delete`.
