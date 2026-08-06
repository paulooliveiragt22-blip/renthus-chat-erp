"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

type Connection = {
    id: string;
    pageId: string;
    pageName: string | null;
    igUserId: string | null;
    status: string;
    messengerEnabled: boolean;
    instagramEnabled: boolean;
    hasAccessToken: boolean;
};

export default function MetaMessagingSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [webhookPath, setWebhookPath] = useState("/api/meta/messaging/incoming");
    const [pageId, setPageId] = useState("");
    const [pageName, setPageName] = useState("");
    const [igUserId, setIgUserId] = useState("");
    const [pageAccessToken, setPageAccessToken] = useState("");
    const [messengerEnabled, setMessengerEnabled] = useState(true);
    const [instagramEnabled, setInstagramEnabled] = useState(true);
    const [conn, setConn] = useState<Connection | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/meta-messaging", {
                credentials: "include",
                cache: "no-store",
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: Connection | null;
                webhookPath?: string;
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Falha ao carregar.");
                return;
            }
            if (json.webhookPath) setWebhookPath(json.webhookPath);
            const c = json.connection ?? null;
            setConn(c);
            if (c) {
                setPageId(c.pageId);
                setPageName(c.pageName ?? "");
                setIgUserId(c.igUserId ?? "");
                setMessengerEnabled(c.messengerEnabled);
                setInstagramEnabled(c.instagramEnabled);
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
            const res = await fetch("/api/admin/meta-messaging", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pageId,
                    pageName: pageName || null,
                    igUserId: igUserId || null,
                    pageAccessToken: pageAccessToken.trim() || undefined,
                    messengerEnabled,
                    instagramEnabled,
                    status: "active",
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: Connection;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setMsg(json.hint || json.error || "Não foi possível salvar.");
                return;
            }
            setConn(json.connection ?? null);
            setPageAccessToken("");
            setMsg("Conexão salva. Configure o webhook na Meta apontando para a URL abaixo.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando Instagram / Messenger…
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        Instagram e Messenger
                    </h3>
                    <p className="mt-1 text-sm text-zinc-500">
                        Conecte a Facebook Page (e Instagram profissional vinculado) para o bot
                        atender no mesmo motor do WhatsApp.
                    </p>
                </div>
                {conn?.hasAccessToken ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        Conectado
                    </span>
                ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Pendente
                    </span>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Page ID</span>
                    <input
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        value={pageId}
                        onChange={(e) => setPageId(e.target.value)}
                        placeholder="Ex.: 123456789012345"
                    />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                        Nome da página (opcional)
                    </span>
                    <input
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        value={pageName}
                        onChange={(e) => setPageName(e.target.value)}
                    />
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                        Instagram User ID (IGSID da conta profissional)
                    </span>
                    <input
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        value={igUserId}
                        onChange={(e) => setIgUserId(e.target.value)}
                        placeholder="Necessário para webhook object=instagram"
                    />
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                        Page Access Token
                        {conn?.hasAccessToken ? " (deixe em branco para manter)" : ""}
                    </span>
                    <input
                        type="password"
                        autoComplete="off"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        value={pageAccessToken}
                        onChange={(e) => setPageAccessToken(e.target.value)}
                        placeholder="Token com pages_messaging / instagram_manage_messages"
                    />
                </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={messengerEnabled}
                        onChange={(e) => setMessengerEnabled(e.target.checked)}
                    />
                    Messenger
                </label>
                <label className="inline-flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={instagramEnabled}
                        onChange={(e) => setInstagramEnabled(e.target.checked)}
                    />
                    Instagram
                </label>
            </div>

            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <p className="font-medium text-zinc-800 dark:text-zinc-100">Webhook Meta</p>
                <p className="mt-1 break-all">
                    Callback URL:{" "}
                    <code>
                        {typeof globalThis.location !== "undefined"
                            ? `${globalThis.location.origin}${webhookPath}`
                            : webhookPath}
                    </code>
                </p>
                <p className="mt-1">
                    Verify token: env <code>META_MESSAGING_WEBHOOK_VERIFY_TOKEN</code> (ou
                    WHATSAPP_WEBHOOK_VERIFY_TOKEN). Assinatura:{" "}
                    <code>META_APP_SECRET</code> / <code>WHATSAPP_APP_SECRET</code>.
                </p>
            </div>

            {msg && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>}

            <div className="mt-4">
                <button
                    type="button"
                    disabled={saving || !pageId.trim()}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                    {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    Salvar conexão
                </button>
            </div>
        </div>
    );
}
