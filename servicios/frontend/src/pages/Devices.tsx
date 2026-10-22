import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "../lib/hooks";
import { timeAgo } from "../lib/time";
import { Button, EmptyState, Spinner } from "../components/ui";

const ONLINE_MS = 2 * 60_000;

export function DevicesPage() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices, refetchInterval: 10_000 });

  const remove = useMutation({
    mutationFn: api.deleteDevice,
    onSuccess: (r, device) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["query"] });
      toast(`${device}: ${r.deleted.toLocaleString("es")} lecturas eliminadas`);
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dispositivos</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Aparecen solos cuando publican su primer dato por MQTT. Se consideran en línea si enviaron algo en los últimos 2 minutos.
      </p>

      {devices.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : devices.isError ? (
        <p className="text-danger">Error: {devices.error.message}</p>
      ) : devices.data.length === 0 ? (
        <EmptyState icon={Cpu} title="Aún no hay dispositivos">
          Conecta tu primer dispositivo siguiendo los pasos de abajo. Aparecerá aquí en cuanto envíe datos.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                <th className="px-4 py-2.5 font-medium">Métricas</th>
                <th className="px-4 py-2.5 text-right font-medium">Lecturas (30 días)</th>
                <th className="px-4 py-2.5 font-medium">Última lectura</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {devices.data.map((d) => {
                const online = Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;
                return (
                  <tr key={d.device} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className={`size-2 rounded-full ${online ? "bg-ok" : "bg-muted/50"}`}
                          title={online ? "En línea" : "Sin datos recientes"}
                        />
                        {d.device}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {d.metrics.map((m) => (
                          <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{m}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.readings.toLocaleString("es")}</td>
                    <td className="px-4 py-3 text-muted" title={new Date(d.last_seen).toLocaleString("es")}>
                      {timeAgo(d.last_seen)}
                    </td>
                    <td className="px-2">
                      <Button
                        variant="ghost"
                        icon={Trash2}
                        aria-label={`Eliminar datos de ${d.device}`}
                        loading={remove.isPending && remove.variables === d.device}
                        onClick={() =>
                          confirm(`¿Eliminar TODAS las lecturas de "${d.device}"? No se puede deshacer.`) && remove.mutate(d.device)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Onboarding />
    </div>
  );
}

function Onboarding() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const wss = cfg.data?.mqtt_wss ? new URL(cfg.data.mqtt_wss) : null;
  const [tcpHost, tcpPort] = (cfg.data?.mqtt_tcp || `${location.hostname}:1883`).split(":");
  return (
    <section className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-semibold">Conectar un dispositivo</h2>
      <ol className="mt-4 grid gap-5 text-sm md:grid-cols-3">
        <li>
          <p className="mb-2 font-medium">1. Conéctate al broker MQTT</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
            {wss && (
              <>
                <dt className="col-span-2 mt-1 text-xs font-semibold text-ok">Cifrado (recomendado)</dt>
                <dt>URL</dt>
                <dd className="min-w-0 break-all"><code className="text-fg">{wss.href}</code></dd>
                <dt>Transporte</dt>
                <dd>WebSocket + TLS, puerto 443</dd>
                <dt className="col-span-2 mt-2 text-xs font-semibold">Sin cifrar (dispositivos sin TLS)</dt>
              </>
            )}
            <dt>Host</dt>
            <dd><code className="text-fg">{tcpHost}</code></dd>
            <dt>Puerto</dt>
            <dd><code className="text-fg">{tcpPort}</code></dd>
            <dt className={wss ? "mt-2" : ""}>Usuario</dt>
            <dd className={wss ? "mt-2" : ""}><code className="text-fg">iot</code></dd>
            <dt>Contraseña</dt>
            <dd>la del Secret <code className="text-fg">mqtt-password</code> (ver README)</dd>
          </dl>
        </li>
        <li>
          <p className="mb-2 font-medium">2. Publica en el tópico</p>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-xs"><code>iot/&lt;dispositivo&gt;/telemetry</code></pre>
          <p className="mt-2 text-muted">El nombre del dispositivo es el que aparecerá en el visualizador.</p>
        </li>
        <li>
          <p className="mb-2 font-medium">3. Envía un JSON con números</p>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-xs"><code>{'{"temperatura": 22.5, "humedad": 60}'}</code></pre>
          <p className="mt-2 text-muted">
            Cada campo es una métrica. <code>"ts"</code> (ISO 8601) es opcional. Para el panel de mapa, envía{" "}
            <code>"lat"</code> y <code>"lon"</code>; para estados, 0/1.
          </p>
        </li>
      </ol>
      <p className="mt-5 text-sm text-muted">
        <b className="text-fg">Recibir comandos</b> (paneles de control): suscríbete a{" "}
        <code className="text-fg">iot/&lt;dispositivo&gt;/cmd</code>. Llegan como{" "}
        <code className="text-fg">{'{"encendido": 1}'}</code>; aplica el valor y repórtalo en tu telemetría para que el panel
        confirme el cambio.
      </p>
      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-medium text-accent">Ejemplo en Python</summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-surface-2 p-4 text-xs leading-relaxed"><code>{wss
          ? `import json, paho.mqtt.client as mqtt   # pip install paho-mqtt

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport="websockets")
c.ws_set_options(path="${wss.pathname}")
c.tls_set()  # cifrado
c.username_pw_set("iot", "<contraseña MQTT>")
c.connect("${wss.hostname}", 443)
c.loop_start()
c.publish("iot/sensor-1/telemetry", json.dumps({"temperatura": 22.5}), qos=1).wait_for_publish()`
          : `import json, paho.mqtt.client as mqtt   # pip install paho-mqtt

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
c.username_pw_set("iot", "<contraseña MQTT>")
c.connect("${tcpHost}", ${tcpPort})
c.loop_start()
c.publish("iot/sensor-1/telemetry", json.dumps({"temperatura": 22.5}), qos=1).wait_for_publish()`}</code></pre>
      </details>
    </section>
  );
}
