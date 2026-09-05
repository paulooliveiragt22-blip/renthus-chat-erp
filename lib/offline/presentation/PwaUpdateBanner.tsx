"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * ADR-0008 P3.2 / Perf-A: SW waiting — usuário confirma update (evita reload mid-PDV).
 */
export function PwaUpdateBanner() {
    const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

        let cancelled = false;

        const onControllerChange = () => {
            // Novo SW assumiu — recarrega uma vez após o usuário aceitar skipWaiting
            if (sessionStorage.getItem("pwa_sw_refresh") === "1") {
                sessionStorage.removeItem("pwa_sw_refresh");
                window.location.reload();
            }
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        void navigator.serviceWorker.ready.then((reg) => {
            if (cancelled) return;
            if (reg.waiting) setWaiting(reg.waiting);

            reg.addEventListener("updatefound", () => {
                const installing = reg.installing;
                if (!installing) return;
                installing.addEventListener("statechange", () => {
                    if (
                        installing.state === "installed" &&
                        navigator.serviceWorker.controller &&
                        reg.waiting
                    ) {
                        setWaiting(reg.waiting);
                    }
                });
            });
        });

        return () => {
            cancelled = true;
            navigator.serviceWorker.removeEventListener(
                "controllerchange",
                onControllerChange
            );
        };
    }, []);

    if (!waiting) return null;

    return (
        <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/50 dark:text-sky-100"
        >
            <span className="font-medium">Nova versão do app disponível.</span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sky-700/80 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-900/40"
                    onClick={() => setWaiting(null)}
                >
                    Depois
                </button>
                <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 font-semibold text-white hover:bg-sky-700"
                    onClick={() => {
                        sessionStorage.setItem("pwa_sw_refresh", "1");
                        waiting.postMessage({ type: "SKIP_WAITING" });
                        setWaiting(null);
                    }}
                >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    Atualizar
                </button>
            </div>
        </div>
    );
}
