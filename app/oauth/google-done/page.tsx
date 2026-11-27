"use client";

import { useEffect } from "react";

const CODES = new Set(["conectado", "recusado", "sem_refresh", "sem_cliente", "escopo", "login", "erro"]);

export type GoogleCalendarDoneMessage = {
    type: "renthus-google-calendar";
    google: string;
};

export default function GoogleCalendarDonePage() {
    useEffect(() => {
        const raw = new URLSearchParams(window.location.search).get("google") ?? "erro";
        const payload: GoogleCalendarDoneMessage = {
            type: "renthus-google-calendar",
            google: CODES.has(raw) ? raw : "erro",
        };

        if (window.opener && !window.opener.closed) {
            try {
                window.opener.postMessage(payload, window.location.origin);
            } catch {
                /* a janela de origem já fechou */
            }
            window.close();
        }
    }, []);

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-sm text-zinc-600">
            Conexão concluída. Pode voltar para a Agenda.
        </main>
    );
}
