"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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
    const [connectOpen, setConnectOpen] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const watchRef = useRef<number | null>(null);

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
        return () => {
            if (watchRef.current != null) window.clearInterval(watchRef.current);
        };
    }, []);

    useEffect(() => {
        function onMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { type?: unknown; google?: unknown } | null;
            if (!data || data.type !== "renthus-google-calendar" || typeof data.google !== "string") return;
            setNotice(NOTICES[data.google] ?? NOTICES.erro);
            setConnectOpen(false);
            setWaiting(false);
            reload();
            if (data.google === "conectado") onChange?.();
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [onChange]);

    function openGoogle() {
        const popup = window.open(
            "/api/admin/google-calendar/start",
            "renthus_google_calendar",
            "popup=yes,width=480,height=720,scrollbars=yes,resizable=yes"
        );
        if (!popup) {
            setNotice("O navegador bloqueou a janela do Google. Permita pop-ups neste site e tente de novo.");
            return;
        }
        setWaiting(true);
        if (watchRef.current != null) window.clearInterval(watchRef.current);
        watchRef.current = window.setInterval(() => {
            if (!popup.closed) return;
            if (watchRef.current != null) window.clearInterval(watchRef.current);
            watchRef.current = null;
            setWaiting(false);
            setConnectOpen(false);
            reload();
            onChange?.();
        }, 700);
    }

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
                    variant="ghost"
                    className="h-8 max-w-64 gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                    disabled={busy}
                    onClick={() => setConfirmOff(true)}
                >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />
                    <span className="truncate font-mono tabular-nums">{status?.email}</span>
                </Button>
            ) : (
                <Button
                    type="button"
                    className="rounded-full bg-accent text-accent-foreground hover:bg-accent-dark"
                    disabled={!configured || waiting}
                    onClick={() => setConnectOpen(true)}
                >
                    {label}
                </Button>
            )}
            {notice ? <p className="max-w-64 text-xs text-zinc-600 dark:text-zinc-300">{notice}</p> : null}
            <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Conectar o Google</DialogTitle>
                        <DialogDescription>
                            {waiting
                                ? "Conclua a autorização na janela do Google. Esta Agenda continua aberta."
                                : "A Agenda continua nesta tela. O Google abre numa janela para autorizar a leitura e a marcação dos horários."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setConnectOpen(false)}>
                            Fechar
                        </Button>
                        <Button type="button" disabled={waiting} onClick={openGoogle}>
                            Continuar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Desconectar o Google?</DialogTitle>
                        <DialogDescription>
                            A agenda deixa de carregar os horários dessa conta. Os horários já marcados no sistema continuam.
                        </DialogDescription>
                    </DialogHeader>
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
