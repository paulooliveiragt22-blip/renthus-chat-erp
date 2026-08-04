"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus, RefreshCw, Save } from "lucide-react";

type Connection = {
    merchantId: string;
    status: string;
    useMock: boolean;
    hasAccessToken: boolean;
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
                checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"
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

export default function MarketplaceIfoodSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [polling, setPolling] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [merchantId, setMerchantId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [useMock, setUseMock] = useState(true);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
    const [syncIntervalHours, setSyncIntervalHours] = useState(3);
    const [conn, setConn] = useState<Connection | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/marketplace/ifood", {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            const c = json.connection as Connection | null;
            setConn(c);
            if (c) {
                setMerchantId(c.merchantId);
                setUseMock(c.useMock);
                setAutoSyncEnabled(Boolean(c.autoSyncEnabled));
                setSyncIntervalHours(c.syncIntervalHours ?? 3);
            }
        } catch {
            setMsg("Falha ao carregar conexão iFood.");
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
            const body: Record<string, unknown> = {
                merchantId,
                useMock,
                status: "connected",
                autoSyncEnabled,
                syncIntervalHours,
            };
            if (accessToken.trim()) body.accessToken = accessToken.trim();
            const res = await fetch("/api/admin/marketplace/ifood", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error ?? "Erro ao salvar");
                return;
            }
            setAccessToken("");
            setConn(json.connection as Connection);
            setMsg("Conexão salva.");
        } catch {
            setMsg("Falha ao salvar.");
        } finally {
            setSaving(false);
        }
    }

    async function syncNow() {
        setSyncing(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/marketplace/ifood/sync", {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok && !json.counters) {
                setMsg(json.errorMessage ?? json.error ?? "Falha na sincronização");
                return;
            }
            const c = json.counters ?? {};
            setMsg(
                json.ok
                    ? `Sync ok: ${c.created ?? 0} criados, ${c.updated ?? 0} atualizados, ${c.imagesDownloaded ?? 0} fotos, ${c.errors ?? 0} erros.`
                    : json.errorMessage ?? "Sync com erros."
            );
            await load();
        } catch {
            setMsg("Falha na sincronização.");
        } finally {
            setSyncing(false);
        }
    }

    async function pollOrders() {
        setPolling(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/marketplace/ifood/orders/poll", {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            setMsg(
                json.message ??
                    (json.ok
                        ? `Pedidos: ${json.imported ?? 0} importados.`
                        : json.error ?? "Falha ao buscar pedidos")
            );
        } catch {
            setMsg("Falha ao buscar pedidos iFood.");
        } finally {
            setPolling(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
        );
    }

    return (
        <div className="space-y-5 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
            <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    iFood — importar cardápio
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                    Sincronização manual para o cadastro Renthus (produtos + embalagem UN). Option
                    groups/complementos viram acompanhamentos (até 2 no chatbot). Sem consulta live no
                    WhatsApp. Homologação iFood (F1.8) é ops fora do código.
                </p>
            </div>

            <label className="block text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Merchant ID</span>
                <input
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    value={merchantId}
                    onChange={(e) => setMerchantId(e.target.value)}
                    placeholder="UUID do merchant no iFood"
                />
            </label>

            <label className="block text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                    Access token {conn?.hasAccessToken ? "(já salvo — deixe vazio para manter)" : ""}
                </span>
                <input
                    type="password"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Bearer token (cifrado no servidor)"
                    autoComplete="off"
                />
            </label>

            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Usar catálogo mock
                    </p>
                    <p className="text-xs text-zinc-500">
                        Ative até ter credenciais iFood. Importa 3 itens de exemplo.
                    </p>
                </div>
                <Toggle checked={useMock} onChange={setUseMock} />
            </div>

            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Sync automático
                    </p>
                    <p className="text-xs text-zinc-500">
                        Cron horário no servidor; respeita o intervalo abaixo (1–6 h).
                    </p>
                </div>
                <Toggle checked={autoSyncEnabled} onChange={setAutoSyncEnabled} />
            </div>

            <label className="block text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Intervalo (horas)</span>
                <select
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    value={syncIntervalHours}
                    onChange={(e) => setSyncIntervalHours(Number(e.target.value))}
                    disabled={!autoSyncEnabled}
                >
                    {[1, 2, 3, 4, 5, 6].map((h) => (
                        <option key={h} value={h}>
                            A cada {h}h
                        </option>
                    ))}
                </select>
            </label>

            {conn?.lastSyncAt ? (
                <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <p>
                        Última sync:{" "}
                        <strong>
                            {new Date(conn.lastSyncAt).toLocaleString("pt-BR")}
                        </strong>{" "}
                        · status: {conn.status}
                    </p>
                    <p className="mt-1">
                        Criados {conn.lastSync.created} · atualizados {conn.lastSync.updated} ·
                        fotos {conn.lastSync.imagesDownloaded} · erros {conn.lastSync.errors}
                    </p>
                    {conn.lastError ? (
                        <p className="mt-1 text-red-600">{conn.lastError}</p>
                    ) : null}
                </div>
            ) : null}

            {msg ? (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{msg}</p>
            ) : null}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar conexão
                </button>
                <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void syncNow()}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {syncing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    Importar / Sincronizar
                </button>
                <button
                    type="button"
                    disabled={polling}
                    onClick={() => void pollOrders()}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {polling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <PackagePlus className="h-4 w-4" />
                    )}
                    Buscar pedidos
                </button>
            </div>
            <p className="text-[11px] text-zinc-400">
                Em mock, “Buscar pedidos” cria 1 pedido de exemplo na Fila. Com token real, faz polling
                iFood (PLC) + ACK. Ao mudar status na Fila (confirmado / em entrega), espelha confirm/dispatch.
            </p>
        </div>
    );
}
