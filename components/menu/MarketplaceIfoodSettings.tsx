"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus, RefreshCw, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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

function Toggle({
    checked,
    onChange,
    disabled,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
            aria-checked={checked}
        />
    );
}

function ModeBadge({ useMock, hasToken }: { useMock: boolean; hasToken: boolean }) {
    if (useMock) {
        return (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Mock · teste
            </span>
        );
    }
    if (!hasToken) {
        return (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-800 dark:bg-red-900/40 dark:text-red-200">
                Live · sem token
            </span>
        );
    }
    return (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            Live · iFood
        </span>
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
                setAutoSyncEnabled(Boolean(c.autoSyncEnabled) && !c.useMock);
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

    function onToggleMock(next: boolean) {
        setUseMock(next);
        if (next) setAutoSyncEnabled(false);
    }

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            if (!useMock && !accessToken.trim() && !conn?.hasAccessToken) {
                setMsg("Modo live exige access token. Cole o token ou mantenha o mock.");
                return;
            }
            const body: Record<string, unknown> = {
                merchantId,
                useMock,
                status: "connected",
                autoSyncEnabled: useMock ? false : autoSyncEnabled,
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
                setMsg(json.hint ?? json.error ?? "Erro ao salvar");
                return;
            }
            setAccessToken("");
            const next = json.connection as Connection;
            setConn(next);
            setUseMock(next.useMock);
            setAutoSyncEnabled(Boolean(next.autoSyncEnabled) && !next.useMock);
            setMsg(
                next.useMock
                    ? "Conexão salva em modo mock (só teste manual)."
                    : "Conexão live salva."
            );
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
            const modeHint = useMock || conn?.useMock ? " (mock)" : " (live)";
            setMsg(
                json.ok
                    ? `Sync ok${modeHint}: ${c.created ?? 0} criados, ${c.updated ?? 0} atualizados, ${c.imagesDownloaded ?? 0} fotos, ${c.errors ?? 0} erros.`
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

    const effectiveHasToken = Boolean(conn?.hasAccessToken) || Boolean(accessToken.trim());

    return (
        <div className="space-y-5 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        iFood — importar cardápio
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                        Mock = dados de exemplo. Live = API iFood com token. Auto-sync só no live.
                    </p>
                </div>
                <ModeBadge useMock={useMock} hasToken={effectiveHasToken} />
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
                    disabled={useMock}
                />
            </label>

            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Usar catálogo mock
                    </p>
                    <p className="text-xs text-zinc-500">
                        Ative até ter credenciais. Importa 3 itens de exemplo (sem API iFood).
                    </p>
                </div>
                <Toggle checked={useMock} onChange={onToggleMock} />
            </div>

            {!useMock && !effectiveHasToken ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    Cole o access token antes de salvar o modo live. Sem token a API rejeita o
                    save (não há fallback silencioso para mock).
                </p>
            ) : null}

            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Sync automático
                    </p>
                    <p className="text-xs text-zinc-500">
                        {useMock
                            ? "Indisponível em mock — use “Importar / Sincronizar” manualmente."
                            : "Cron horário no servidor; respeita o intervalo abaixo (1–6 h)."}
                    </p>
                </div>
                <Toggle
                    checked={autoSyncEnabled && !useMock}
                    onChange={setAutoSyncEnabled}
                    disabled={useMock}
                />
            </div>

            <label className="block text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Intervalo (horas)</span>
                <select
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                    value={syncIntervalHours}
                    onChange={(e) => setSyncIntervalHours(Number(e.target.value))}
                    disabled={useMock || !autoSyncEnabled}
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
                        · status: {conn.status} ·{" "}
                        {conn.useMock ? "mock" : "live"}
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
