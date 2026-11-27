"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

export function GoogleCalendarConnect({ onChange }: { onChange?: () => void }) {
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmOff, setConfirmOff] = useState(false);

    function reload() {
        void fetch("/api/admin/google-calendar", { credentials: "include", cache: "no-store" })
            .then(async (res) => {
                setStatus(res.ok ? ((await res.json()) as GoogleStatus) : { configured: false, connected: false });
            })
            .catch(() => setStatus({ configured: false, connected: false }));
    }

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("google");
        if (code) setNotice(NOTICES[code] ?? NOTICES.erro);
        reload();
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
            setConfirmOff(false);
            setStatus({ configured: status?.configured === true, connected: false, email: null, link_status: null });
            setNotice("Agenda do Google desconectada. Os horários do sistema continuam.");
            onChange?.();
        } finally {
            setBusy(false);
        }
    }

    const configured = status?.configured === true;
    const connected = status?.connected === true && Boolean(status.email);
    const label = connected ? "Sincronizado" : "Conectar Google";

    return (
        <div className="flex min-w-0 flex-col items-start gap-1">
            {connected ? (
                <Button
                    type="button"
                    className="max-w-full rounded-full bg-accent text-accent-foreground hover:bg-accent-dark"
                    disabled={busy}
                    onClick={() => setConfirmOff(true)}
                >
                    <span className="truncate">{label}</span>
                </Button>
            ) : configured ? (
                <Button asChild className="rounded-full bg-accent text-accent-foreground hover:bg-accent-dark">
                    <a href="/api/admin/google-calendar/start">{label}</a>
                </Button>
            ) : (
                <Button type="button" className="rounded-full" disabled>
                    {label}
                </Button>
            )}
            {connected && status?.email ? (
                <p className="max-w-48 truncate text-xs text-zinc-500 dark:text-zinc-400">{status.email}</p>
            ) : null}
            {notice ? <p className="max-w-64 text-xs text-zinc-600 dark:text-zinc-300">{notice}</p> : null}
            <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Desconectar o Google?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        A agenda deixa de carregar os horários dessa conta. Os horários já marcados no sistema continuam.
                    </p>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setConfirmOff(false)}>
                            Cancelar
                        </Button>
                        <Button type="button" disabled={busy} onClick={() => void disconnect()}>
                            Desconectar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
