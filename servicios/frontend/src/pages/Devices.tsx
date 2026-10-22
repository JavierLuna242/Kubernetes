import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Check, Copy, Cpu, KeyRound, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { api, type Device, type DeviceCredentials, type DeviceInfo } from "../lib/api";
import { fmtValue } from "../lib/format";
import { toast } from "../lib/hooks";
import { timeAgo } from "../lib/time";
import { Button, cx, EmptyState, Field, inputCls, Modal, Spinner } from "../components/ui";

const DEVICE_ID = /^[a-z0-9][a-z0-9_-]{1,62}$/;

export function DevicesPage() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices, refetchInterval: 10_000 });
  const [form, setForm] = useState<{ id?: string; edit?: Device } | null>(null);
  const [creds, setCreds] = useState<{ c: DeviceCredentials; isNew: boolean } | null>(null);
  const [twin, setTwin] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: api.deleteDevice,
    onSuccess: (r, device) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["query"] });
      toast(`${device} eliminado (${r.deleted.toLocaleString("es")} lecturas)`);
    },
    onError: (e) => toast(e.message, "error"),
  });
  const rotate = useMutation({
    mutationFn: api.rotateToken,
    onSuccess: (c) => setCreds({ c, isNew: false }),
    onError: (e) => toast(e.message, "error"),
  });

  const list = devices.data ?? [];
  const registered = list.filter((d) => d.registered).length;
  const online = list.filter((d) => d.connected).length;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispositivos</h1>
          <p className="mt-1 text-sm text-muted">
            Cada dispositivo se registra y recibe su propia credencial: solo puede publicar su telemetría y leer sus
            comandos.{registered > 0 && ` ${online} de ${registered} conectados ahora.`}
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
          Registrar dispositivo
        </Button>
      </div>

      {devices.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : devices.isError ? (
        <p className="text-danger">Error: {devices.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="Aún no hay dispositivos"
          action={
            <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
              Registrar el primero
            </Button>
          }
        >
          Registra un dispositivo para obtener su usuario y token MQTT; aparecerá aquí con su estado de conexión y su
          gemelo digital.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                <th className="px-4 py-2.5 font-medium">Métricas</th>
                <th className="px-4 py-2.5 font-medium">Gemelo digital</th>
                <th className="px-4 py-2.5 font-medium">Última lectura</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const pending = Object.values(d.twin).filter((s) => s === "pendiente").length;
                return (
                  <tr key={d.device} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <Status d={d} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{d.name || d.device}</p>
                      <p className="text-xs text-muted">
                        <code>{d.device}</code>
                        {[d.type, d.location].filter(Boolean).map((x) => ` · ${x}`)}
                      </p>
                      {!!d.tags?.length && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.tags.map((t) => (
                            <span key={t} className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {d.metrics.map((m) => (
                          <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{m}</span>
                        ))}
                        {!d.metrics.length && <span className="text-xs text-muted">sin datos aún</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {!d.registered ? (
                        <span className="text-xs text-muted">—</span>
                      ) : !Object.keys(d.desired ?? {}).length ? (
                        <span className="text-xs text-muted">sin estado deseado</span>
                      ) : pending ? (
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
                          {pending} pendiente{pending > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="rounded bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">Sincronizado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted" title={d.last_seen ? new Date(d.last_seen).toLocaleString("es") : undefined}>
                      {d.last_seen ? timeAgo(d.last_seen) : "—"}
                    </td>
                    <td className="px-2">
                      <div className="flex justify-end">
                        {d.registered ? (
                          <>
                            <Button variant="ghost" icon={Boxes} aria-label="Gemelo digital" title="Gemelo digital" onClick={() => setTwin(d.device)} />
                            <Button variant="ghost" icon={Pencil} aria-label="Editar" title="Editar ficha" onClick={() => setForm({ edit: d })} />
                            <Button
                              variant="ghost"
                              icon={KeyRound}
                              aria-label="Regenerar token"
                              title="Regenerar token"
                              loading={rotate.isPending && rotate.variables === d.device}
                              onClick={() =>
                                confirm(`¿Generar un token nuevo para "${d.device}"? El actual deja de servir y el dispositivo se desconecta hasta que uses el nuevo.`) &&
                                rotate.mutate(d.device)
                              }
                            />
                          </>
                        ) : (
                          DEVICE_ID.test(d.device) && (
                            <Button icon={ShieldCheck} onClick={() => setForm({ id: d.device })} title="Darle credencial para que pueda volver a conectarse">
                              Registrar
                            </Button>
                          )
                        )}
                        <Button
                          variant="ghost"
                          icon={Trash2}
                          aria-label={`Eliminar ${d.device}`}
                          title="Eliminar dispositivo y sus datos"
                          loading={remove.isPending && remove.variables === d.device}
                          onClick={() =>
                            confirm(`¿Eliminar "${d.device}"? Se borran su credencial, su gemelo digital y TODAS sus lecturas. No se puede deshacer.`) &&
                            remove.mutate(d.device)
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Onboarding />

      {form && (
        <DeviceForm
          initialId={form.id}
          edit={form.edit}
          onClose={() => setForm(null)}
          onCreated={(c) => (setForm(null), setCreds({ c, isNew: true }))}
        />
      )}
      {creds && <CredentialsModal creds={creds.c} isNew={creds.isNew} onClose={() => setCreds(null)} />}
      {twin && list.find((d) => d.device === twin) && <TwinModal d={list.find((d) => d.device === twin)!} onClose={() => setTwin(null)} />}
    </div>
  );
}

function Status({ d }: { d: Device }) {
  if (!d.registered)
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-500" title="Tiene datos pero no credencial: no puede conectarse">
        <AlertTriangle className="size-3.5" /> Sin registrar
      </span>
    );
  return (
    <span
      className={cx("flex items-center gap-1.5 text-xs", d.connected ? "text-ok" : "text-muted")}
      title={d.connected_at ? `${d.connected ? "Conectado" : "Desconectado"} desde ${new Date(d.connected_at).toLocaleString("es")}` : undefined}
    >
      <span className={cx("size-2 rounded-full", d.connected ? "bg-ok" : "bg-muted/50")} />
      {d.connected ? "Conectado" : "Desconectado"}
    </span>
  );
}

function DeviceForm({
  initialId,
  edit,
  onClose,
  onCreated,
}: {
  initialId?: string;
  edit?: Device;
  onClose: () => void;
  onCreated: (c: DeviceCredentials) => void;
}) {
  const qc = useQueryClient();
  const [id, setId] = useState(edit?.device ?? initialId ?? "");
  const [info, setInfo] = useState<DeviceInfo>({
    name: edit?.name ?? "",
    type: edit?.type ?? "",
    location: edit?.location ?? "",
    tags: edit?.tags ?? [],
  });
  const [tags, setTags] = useState(info.tags.join(", "));
  const set = (p: Partial<DeviceInfo>) => setInfo((x) => ({ ...x, ...p }));
  const body = () => ({ ...info, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });

  const save = useMutation({
    mutationFn: async () => (edit ? (await api.updateDevice(edit.device, body()), null) : api.registerDevice({ id, ...body() })),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      if (c) onCreated(c);
      else (toast("Dispositivo actualizado"), onClose());
    },
    onError: (e) => toast(e.message, "error"),
  });

  const idOk = DEVICE_ID.test(id) && id !== "iot";
  return (
    <Modal
      open
      onClose={onClose}
      title={edit ? `Editar ${edit.device}` : "Registrar dispositivo"}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!idOk} loading={save.isPending} onClick={() => save.mutate()}>
            {edit ? "Guardar" : "Registrar y ver credencial"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (idOk) save.mutate();
        }}
      >
        <Field label="Identificador (usuario MQTT y nombre en los tópicos)">
          <input
            className={cx(inputCls, "font-mono", id && !idOk && "border-danger")}
            value={id}
            disabled={!!edit}
            autoFocus={!edit}
            placeholder="sensor-lab-01"
            onChange={(e) => setId(e.target.value.toLowerCase())}
          />
        </Field>
        {!edit && (
          <p className="-mt-2 text-xs text-muted">
            Minúsculas, números, guiones y guion bajo (2 a 63 caracteres). No se puede cambiar después.
            {id === "iot" && <span className="text-danger"> "iot" está reservado para la plataforma.</span>}
          </p>
        )}
        <Field label="Nombre visible">
          <input className={inputCls} value={info.name} placeholder="Sensor del laboratorio" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <input className={inputCls} list="device-types" value={info.type} placeholder="ESP32" onChange={(e) => set({ type: e.target.value })} />
            <datalist id="device-types">
              {["ESP32", "ESP8266", "Raspberry Pi", "Arduino", "Gateway", "Simulador"].map((t) => <option key={t} value={t} />)}
            </datalist>
          </Field>
          <Field label="Ubicación">
            <input className={inputCls} value={info.location} placeholder="Laboratorio 2" onChange={(e) => set({ location: e.target.value })} />
          </Field>
        </div>
        <Field label="Etiquetas (separadas por coma)">
          <input className={inputCls} value={tags} placeholder="clima, piso-2" onChange={(e) => setTags(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const canCopy = !!navigator.clipboard; // solo en HTTPS
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input readOnly className={cx(inputCls, "font-mono", secret && "text-amber-500")} value={value} onFocus={(e) => e.target.select()} />
        {canCopy && (
          <Button
            icon={copied ? Check : Copy}
            aria-label={`Copiar ${label}`}
            onClick={() => navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          />
        )}
      </div>
    </Field>
  );
}

function CredentialsModal({ creds, isNew, onClose }: { creds: DeviceCredentials; isNew: boolean; onClose: () => void }) {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const wss = cfg.data?.mqtt_wss ? new URL(cfg.data.mqtt_wss) : null;
  const [tcpHost, tcpPort] = (cfg.data?.mqtt_tcp || `${location.hostname}:1883`).split(":");
  const code = wss
    ? `import json, paho.mqtt.client as mqtt   # pip install paho-mqtt

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport="websockets")
c.ws_set_options(path="${wss.pathname}")
c.tls_set()
c.username_pw_set("${creds.username}", "${creds.token}")
c.on_connect = lambda cl, u, f, rc, p: cl.subscribe("iot/${creds.id}/cmd")   # comandos / estado deseado
c.on_message = lambda cl, u, m: print("estado deseado:", m.payload.decode())
c.connect("${wss.hostname}", 443)
c.loop_start()
c.publish("iot/${creds.id}/telemetry", json.dumps({"temperatura": 22.5}), qos=1).wait_for_publish()`
    : `import json, paho.mqtt.client as mqtt   # pip install paho-mqtt

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
c.username_pw_set("${creds.username}", "${creds.token}")
c.on_connect = lambda cl, u, f, rc, p: cl.subscribe("iot/${creds.id}/cmd")
c.connect("${tcpHost}", ${tcpPort})
c.loop_start()
c.publish("iot/${creds.id}/telemetry", json.dumps({"temperatura": 22.5}), qos=1).wait_for_publish()`;

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={isNew ? `Dispositivo ${creds.id} registrado` : `Token nuevo de ${creds.id}`}
      footer={
        <Button variant="primary" onClick={() => confirm("¿Ya guardaste el token? No se vuelve a mostrar.") && onClose()}>
          Listo, ya lo guardé
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            Guarda el token ahora: <b>no se vuelve a mostrar</b>. Si se pierde o se filtra, genera uno nuevo desde la lista
            de dispositivos (el anterior deja de funcionar).
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Usuario MQTT" value={creds.username} />
          <CopyField label="Contraseña MQTT (token)" value={creds.token} secret />
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-surface-2 p-3">
            <p className="font-medium">Publica su telemetría en</p>
            <code className="text-accent">iot/{creds.id}/telemetry</code>
          </div>
          <div className="rounded-md bg-surface-2 p-3">
            <p className="font-medium">Recibe comandos y estado deseado en</p>
            <code className="text-accent">iot/{creds.id}/cmd</code>
          </div>
        </div>
        {wss && <CopyField label="Probar con el simulador" value={`python dispositivos/simulador.py --host ${wss.href} --device ${creds.id} --password ${creds.token}`} />}
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Ejemplo en Python</p>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-4 text-xs leading-relaxed"><code>{code}</code></pre>
        </div>
      </div>
    </Modal>
  );
}

function TwinModal({ d, onClose }: { d: Device; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const desired = d.desired ?? {};
  const reported = d.reported ?? {};
  const keys = [...new Set([...Object.keys(desired), ...Object.keys(reported)])].sort((a, b) =>
    (a in desired ? 0 : 1) - (b in desired ? 0 : 1) || a.localeCompare(b),
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ["devices"] });
  const send = useMutation({
    mutationFn: () => api.command(d.device, name.trim(), Number(value)),
    onSuccess: () => (setName(""), setValue(""), refresh(), toast("Estado deseado actualizado")),
    onError: (e) => toast(e.message, "error"),
  });
  const clear = useMutation({ mutationFn: (k: string) => api.clearDesired(d.device, k), onSuccess: refresh, onError: (e) => toast(e.message, "error") });
  const valid = /^[A-Za-z0-9_-]+$/.test(name.trim()) && value.trim() !== "" && Number.isFinite(Number(value));

  return (
    <Modal open onClose={onClose} size="xl" title={`Gemelo digital · ${d.name || d.device}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm text-muted">
          <b className="text-fg">Deseado</b>: lo que la plataforma le pidió (controles, reglas o aquí). Se guarda como mensaje
          retenido en <code>iot/{d.device}/cmd</code>, así el dispositivo lo recibe aunque esté desconectado al momento del
          cambio. <b className="text-fg">Reportado</b>: el último valor que envió de cada métrica. Cuando coinciden, la
          propiedad está sincronizada.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-2">
            <Status d={d} />
          </span>
          <span className="text-muted">Último reporte: {d.reported_at ? timeAgo(d.reported_at) : "nunca"}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Propiedad</th>
                <th className="px-3 py-2 text-right font-medium">Deseado</th>
                <th className="px-3 py-2 text-right font-medium">Reportado</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono">{k}</td>
                  <td className="px-3 py-2 text-right">{k in desired ? fmtValue(desired[k]) : "—"}</td>
                  <td className="px-3 py-2 text-right">{k in reported ? fmtValue(reported[k]) : "—"}</td>
                  <td className="px-3 py-2">
                    {d.twin[k] === "sincronizado" ? (
                      <span className="rounded bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">Sincronizado</span>
                    ) : d.twin[k] === "pendiente" ? (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">Pendiente</span>
                    ) : (
                      <span className="text-xs text-muted">solo lectura</span>
                    )}
                  </td>
                  <td className="px-1">
                    {k in desired && (
                      <Button variant="ghost" icon={X} aria-label={`Quitar ${k} del estado deseado`} title="Quitar del estado deseado" onClick={() => clear.mutate(k)} />
                    )}
                  </td>
                </tr>
              ))}
              {!keys.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    Todavía no reportó datos ni tiene estado deseado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) send.mutate();
          }}
        >
          <Field label="Propiedad" className="flex-1">
            <input className={cx(inputCls, "font-mono")} list="twin-props" value={name} placeholder="encendido" onChange={(e) => setName(e.target.value)} />
            <datalist id="twin-props">{keys.map((k) => <option key={k} value={k} />)}</datalist>
          </Field>
          <Field label="Valor deseado" className="w-36">
            <input type="number" step="any" className={inputCls} value={value} placeholder="1" onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={!valid} loading={send.isPending}>
            Fijar valor deseado
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function Onboarding() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const wss = cfg.data?.mqtt_wss ? new URL(cfg.data.mqtt_wss) : null;
  const [tcpHost, tcpPort] = (cfg.data?.mqtt_tcp || `${location.hostname}:1883`).split(":");
  return (
    <section className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-semibold">Conectar un dispositivo</h2>
      <ol className="mt-4 grid gap-5 text-sm md:grid-cols-4">
        <li>
          <p className="mb-2 font-medium">1. Regístralo</p>
          <p className="text-muted">
            Con <b className="text-fg">Registrar dispositivo</b> obtienes su usuario (su identificador) y su token. Cada
            dispositivo tiene el suyo.
          </p>
        </li>
        <li>
          <p className="mb-2 font-medium">2. Conéctate al broker</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
            {wss && (
              <>
                <dt className="col-span-2 text-xs font-semibold text-ok">Cifrado (recomendado)</dt>
                <dd className="col-span-2 min-w-0 break-all"><code className="text-fg">{wss.href}</code></dd>
                <dt className="col-span-2 mt-1 text-xs font-semibold">Sin cifrar (sin TLS)</dt>
              </>
            )}
            <dd className="col-span-2"><code className="text-fg">{tcpHost}:{tcpPort}</code></dd>
          </dl>
        </li>
        <li>
          <p className="mb-2 font-medium">3. Publica su telemetría</p>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-2 text-xs"><code>iot/&lt;id&gt;/telemetry</code></pre>
          <p className="mt-2 text-muted">
            JSON con números, ej. <code className="text-fg">{'{"temperatura": 22.5}'}</code>. <code>"ts"</code> (ISO 8601) es
            opcional: sirve para enviar datos guardados mientras no hubo red.
          </p>
        </li>
        <li>
          <p className="mb-2 font-medium">4. Recibe comandos</p>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-2 text-xs"><code>iot/&lt;id&gt;/cmd</code></pre>
          <p className="mt-2 text-muted">
            Llega el estado deseado completo, ej. <code className="text-fg">{'{"encendido": 1}'}</code>, también al reconectarse.
            Aplícalo y repórtalo en la telemetría para quedar sincronizado.
          </p>
        </li>
      </ol>
      <p className="mt-5 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="size-4 shrink-0 text-ok" />
        Cada dispositivo solo puede publicar en sus propios tópicos: no puede leer ni suplantar a otro, y un token
        filtrado se invalida generando uno nuevo.
      </p>
    </section>
  );
}
