"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

type Connection = {
    merchantId: string;
    status: string;
    useMock: boolean;
    autoSyncEnabled: boolean;
    syncIntervalHours: number;
    lastSyncAt: string | null;
    lastError: string | null;
    lastSync: {
        created: number;
        updated: number;
        skipped: number;
        imagesDownloaded: number;
        errors: number;
    };
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                checked ? "bg-orange-600" : "bg-zinc-300 dark:bg-zinc-600"
            }`}
        >
            <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    checked ? "translate-x-5" : "translate-x-0"
                }`}
            />
        </button>
    );
}

export default function MarketplaceAiqfomeSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [merchantId, setMerchantId] = useState("");
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
    const [syncIntervalHours, setSyncIntervalHours] = useState(3);
    const [conn, setConn] = useState<Connection | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/marketplace/aiqfome", {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            const c = json.connection as Connection | null;
            setConn(c);
            if (c) {
                setMerchantId(c.merchantId);
                setAutoSyncEnabled(Boolean(c.autoSyncEnabled));
                setSyncIntervalHours(c.syncIntervalHours ?? 3);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/marketplace/aiqfome", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    merchantId,
                    useMock: true,
                    autoSyncEnabled: false,
                    syncIntervalHours,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error ?? "Erro ao salvar");
                return;
            }
            setConn(json.connection as Connection);
            setMsg("Conexão Aiqfome salva (mock).");
        } finally {
            setSaving(false);
        }
    }

    async function syncNow() {
        setSyncing(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/marketplace/aiqfome/sync", {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            const c = json.counters ?? {};
            setMsg(
                json.ok
                    ? `Sync Aiqfome: ${c.created ?? 0} criados, ${c.updated ?? 0} atualizados.`
                    : json.errorMessage ?? "Falha na sync"
            );
            await load();
        } finally {
            setSyncing(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando Aiqfome…
            </div>
        );
    }

    return (
        <div className="space-y-4 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        Aiqfome — importar cardápio
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                        Só mock nesta versão (sem API live). Sync automático desligado.
                    </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    Mock · v.next
                </span>
            </div>
            <label className="block text-sm">
                <span className="text-zinc-600">Merchant / loja ID</span>
                <input
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    value={merchantId}
                    onChange={(e) => setMerchantId(e.target.value)}
                    placeholder="ID da loja no Aiqfome"
                />
            </label>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Sync automático fica desligado enquanto o adapter for mock-only. Use sincronização
                manual para testar o fluxo.
            </p>
            {conn?.lastSyncAt ? (
                <p className="text-xs text-zinc-500">
                    Última sync: {new Date(conn.lastSyncAt).toLocaleString("pt-BR")} · criados{" "}
                    {conn.lastSync.created} · atualizados {conn.lastSync.updated}
                </p>
            ) : null}
            {msg ? <p className="text-sm text-zinc-700">{msg}</p> : null}
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar
                </button>
                <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void syncNow()}
                    className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {syncing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    Sincronizar
                </button>
            </div>
        </div>
    );
}
