"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import {
    getSyncStatusSnapshot,
    setSyncOnline,
    subscribeSyncStatus,
    type SyncStatusSnapshot,
} from "../syncStatusStore";
import { cn } from "@/lib/utils";

function getServerSnapshot(): SyncStatusSnapshot {
    return {
        online: true,
        pendingCount: 0,
        syncing: false,
        lastError: null,
        catalogStale: false,
    };
}

/**
 * Indicador global de fila offline (ADR-0008 P0.8).
 * Esconde-se quando online e sem pendências.
 */
export function SyncStatusBar({ className }: { className?: string }) {
    const status = useSyncExternalStore(
        subscribeSyncStatus,
        getSyncStatusSnapshot,
        getServerSnapshot
    );

    useEffect(() => {
        const onOnline = () => setSyncOnline(true);
        const onOffline = () => setSyncOnline(false);
        setSyncOnline(navigator.onLine);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    const label = useMemo(() => {
        if (!status.online) {
            if (status.pendingCount > 0) {
                return `Sem conexão · ${status.pendingCount} pendente(s) na fila`;
            }
            return "Sem conexão · alterações serão sincronizadas depois";
        }
        if (status.syncing) {
            return `Sincronizando${status.pendingCount ? ` · ${status.pendingCount} pendente(s)` : "…"}`;
        }
        if (status.pendingCount > 0) {
            return `${status.pendingCount} pendente(s) · aguardando sync`;
        }
        if (status.catalogStale) {
            return "Catálogo pode estar desatualizado";
        }
        if (status.lastError) {
            return `Falha no sync: ${status.lastError}`;
        }
        return null;
    }, [status]);

    const visible =
        !status.online ||
        status.pendingCount > 0 ||
        status.syncing ||
        status.catalogStale ||
        Boolean(status.lastError);

    if (!visible || !label) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className={cn(
                "flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium",
                !status.online
                    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
                    : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
                className
            )}
        >
            {!status.online ? (
                <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
                <RefreshCw
                    className={cn("h-3.5 w-3.5 shrink-0", status.syncing && "animate-spin")}
                    aria-hidden
                />
            )}
            <span className="truncate">{label}</span>
        </div>
    );
}
