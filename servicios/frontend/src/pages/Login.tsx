import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, LogIn } from "lucide-react";
import { api } from "../lib/api";
import { Button, Field, inputCls } from "../components/ui";

export function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-accent/15 p-2">
            <Activity className="size-6 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">IoT Platform</h1>
            <p className="text-sm text-muted">Inicia sesión para continuar</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Usuario">
            <input className={inputCls} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Contraseña">
            <input
              type="password"
              className={inputCls}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {login.isError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {login.error.message}
            </p>
          )}
          <Button type="submit" variant="primary" icon={LogIn} loading={login.isPending} className="mt-1 h-9">
            Entrar
          </Button>
        </div>
      </form>
    </div>
  );
}
