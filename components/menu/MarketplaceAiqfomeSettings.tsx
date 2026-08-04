"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

type Connection = {
    merchantId: string;
    status: string;
    useMock: boolean;
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

export default function MarketplaceAiqfomeSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [merchantId, setMerchantId] = useState("");
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
            if (c) setMerchantId(c.merchantId);
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
                body: JSON.stringify({ merchantId, useMock: true }),
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
            <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Aiqfome — importar cardápio
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                    Mesmo fluxo do iFood (porta de catálogo). Por enquanto só mock até credenciais.
                </p>
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
