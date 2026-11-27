"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type GoogleStatus = {
    configured?: boolean;
    connected?: boolean;
    email?: string | null;
    link_status?: string | null;
};

const NOTICES: Record<string, string> = {
    conectado: "Agenda do Google conectada.",
    recusado: "A conexão foi cancelada.",
    sem_refresh: "O Google não devolveu a autorização permanente. Tente de novo.",
    sem_cliente: "O servidor ainda não tem o cliente do Google.",
    escopo: "A autorização não incluiu a agenda. Tente de novo e aceite os acessos pedidos.",
    login: "Entre de novo para conectar a agenda.",
    erro: "Não foi possível conectar o Google.",
};

export function GoogleCalendarConnect() {
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("google");
        if (code) setNotice(NOTICES[code] ?? NOTICES.erro);
        void fetch("/api/admin/google-calendar", { credentials: "include", cache: "no-store" })
            .then(async (res) => {
                if (!res.ok) {
                    setStatus({ configured: false, connected: false });
                    return;
                }
                setStatus((await res.json()) as GoogleStatus);
            })
            .catch(() => setStatus({ configured: false, connected: false }));
    }, []);

    async function disconnect() {
        setBusy(true);
        setNotice(null);
        try {
            const res = await fetch("/api/admin/google-calendar/disconnect", {
                method: "POST",
                credentials: "include",
            });
            if (!res.ok) {
                setNotice("Não foi possível desconectar.");
                return;
            }
            setStatus({ configured: status?.configured === true, connected: false, email: null, link_status: null });
            setNotice("Agenda do Google desconectada. Os horários já marcados continuam no sistema.");
        } finally {
            setBusy(false);
        }
    }

    const configured = status?.configured === true;
    const connected = status?.connected === true && Boolean(status.email);
    const revoked = status?.link_status === "revoked";

    return (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div>
                <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Agenda do Google</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    A conta conectada esconde horários já ocupados e recebe o horário confirmado. Sem essa conta, a agenda do sistema segue sozinha.
                </p>
            </div>
            {status === null ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
            ) : connected ? (
                <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">{status?.email}</p>
            ) : revoked ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">A autorização expirou. Conecte de novo.</p>
            ) : configured ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Nenhuma conta conectada.</p>
            ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">O servidor ainda não tem o cliente do Google.</p>
            )}
            {connected ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void disconnect()}>
                    Desconectar
                </Button>
            ) : configured ? (
                <Button asChild>
                    <a href="/api/admin/google-calendar/start">Conectar Google</a>
                </Button>
            ) : (
                <Button type="button" disabled>
                    Conectar Google
                </Button>
            )}
            {notice ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{notice}</p> : null}
        </section>
    );
}
