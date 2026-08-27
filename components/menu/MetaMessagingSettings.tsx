"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Link2 } from "lucide-react";

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

type PendingPage = {
    pageId: string;
    pageName: string;
    igUserId: string | null;
};

export default function MetaMessagingSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [oauthBusy, setOauthBusy] = useState(false);
    const [healthBusy, setHealthBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [webhookPath, setWebhookPath] = useState("/api/meta/messaging/incoming");
    const [pageId, setPageId] = useState("");
    const [pageName, setPageName] = useState("");
    const [igUserId, setIgUserId] = useState("");
    const [pageAccessToken, setPageAccessToken] = useState("");
    const [messengerEnabled, setMessengerEnabled] = useState(true);
    const [instagramEnabled, setInstagramEnabled] = useState(true);
    const [conn, setConn] = useState<Connection | null>(null);
    const [oauthConfigured, setOauthConfigured] = useState(false);
    const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
    const [showManual, setShowManual] = useState(false);

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
                oauthConfigured?: boolean;
                pendingPages?: PendingPage[];
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Falha ao carregar.");
                return;
            }
            if (json.webhookPath) setWebhookPath(json.webhookPath);
            setOauthConfigured(Boolean(json.oauthConfigured));
            setPendingPages(Array.isArray(json.pendingPages) ? json.pendingPages : []);
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
        if (typeof window === "undefined") return;

        function onMessage(ev: MessageEvent) {
            if (ev.origin !== window.location.origin) return;
            const data = ev.data as {
                type?: string;
                oauth?: string | null;
                msg?: string | null;
            };
            if (data?.type !== "renthus-meta-oauth") return;
            if (data.oauth === "ok") setMsg("Page conectada via Facebook Login.");
            else if (data.oauth === "error") {
                setMsg(data.msg || "Falha no OAuth Meta.");
            } else if (data.oauth === "pick") {
                setMsg("Escolha a Facebook Page para conectar.");
            }
            void load();
        }
        window.addEventListener("message", onMessage);

        const q = new URLSearchParams(window.location.search);
        const oauth = q.get("meta_oauth");
        if (oauth === "ok") setMsg("Page conectada via Facebook Login.");
        if (oauth === "error") {
            setMsg(q.get("meta_oauth_msg") || "Falha no OAuth Meta.");
        }
        if (oauth === "pick") {
            setMsg("Escolha a Facebook Page para conectar.");
        }

        return () => window.removeEventListener("message", onMessage);
    }, [load]);

    async function startOAuth() {
        setOauthBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/meta-messaging/oauth/start", {
                credentials: "include",
                cache: "no-store",
            });
            const json = (await res.json().catch(() => ({}))) as {
                url?: string;
                redirectUri?: string;
                appId?: string;
                error?: string;
                hint?: string;
            };
            if (!res.ok || !json.url) {
                setMsg(json.hint || json.error || "OAuth indisponível.");
                setOauthBusy(false);
                return;
            }
            if (json.redirectUri) {
                console.info("[meta-oauth] redirect_uri=", json.redirectUri, "appId=", json.appId);
            }

            const popup = window.open(
                json.url,
                "renthus_meta_oauth",
                "popup=yes,width=680,height=760,scrollbars=yes,resizable=yes"
            );
            if (!popup) {
                setMsg(
                    "Pop-up bloqueado pelo navegador. Permita pop-ups para este site e tente de novo."
                );
                setOauthBusy(false);
                return;
            }
            setMsg("Conclua o login na janela do Facebook…");
            const timer = window.setInterval(() => {
                if (popup.closed) {
                    window.clearInterval(timer);
                    void load();
                    setOauthBusy(false);
                }
            }, 700);
        } catch {
            setMsg("Falha ao iniciar OAuth.");
            setOauthBusy(false);
        }
    }

    async function completeOAuth(pageIdPick: string) {
        setOauthBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/meta-messaging/oauth/complete", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageId: pageIdPick }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: Connection;
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Não foi possível concluir.");
                return;
            }
            setPendingPages([]);
            setConn(json.connection ?? null);
            setMsg("Page conectada.");
            await load();
        } finally {
            setOauthBusy(false);
        }
    }

    async function testHealth() {
        setHealthBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/meta-messaging/health", {
                method: "POST",
                credentials: "include",
            });
            const json = (await res.json().catch(() => ({}))) as {
                health?: { ok: boolean; errorMessage?: string; pageName?: string };
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setMsg(json.hint || json.error || "Falha no health Meta.");
                return;
            }
            if (json.health?.ok) {
                setMsg(
                    `Page OK` +
                        (json.health.pageName ? ` — ${json.health.pageName}` : "")
                );
            } else {
                setMsg(json.health?.errorMessage || "Health Meta falhou.");
            }
            await load();
        } finally {
            setHealthBusy(false);
        }
    }

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
            setMsg("Conexão salva. Confirme o webhook na Meta apontando para a URL abaixo.");
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

            <div className="mb-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={oauthBusy || !oauthConfigured}
                    onClick={() => void startOAuth()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                    {oauthBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Link2 className="h-4 w-4" />
                    )}
                    Conectar com Facebook
                </button>
                {conn?.hasAccessToken && (
                    <button
                        type="button"
                        disabled={healthBusy}
                        onClick={() => void testHealth()}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                    >
                        {healthBusy ? "Testando…" : "Testar Page"}
                    </button>
                )}
                <button
                    type="button"
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                    onClick={() => setShowManual((v) => !v)}
                >
                    {showManual ? "Ocultar token manual" : "Colar token manualmente"}
                </button>
            </div>

            {!oauthConfigured && (
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                    OAuth precisa de <code>META_APP_ID</code> + <code>META_APP_SECRET</code> no
                    ambiente. Enquanto isso, use token manual.
                </p>
            )}

            {pendingPages.length > 0 && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                    <p className="mb-2 text-sm font-medium text-blue-900 dark:text-blue-100">
                        Escolha a Page
                    </p>
                    <ul className="space-y-1">
                        {pendingPages.map((p) => (
                            <li key={p.pageId}>
                                <button
                                    type="button"
                                    disabled={oauthBusy}
                                    onClick={() => void completeOAuth(p.pageId)}
                                    className="w-full rounded-md bg-white px-3 py-2 text-left text-sm hover:bg-blue-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                                >
                                    <span className="font-medium">{p.pageName}</span>
                                    <span className="ml-2 text-xs text-zinc-500">{p.pageId}</span>
                                    {p.igUserId ? (
                                        <span className="ml-2 text-xs text-emerald-600">+ IG</span>
                                    ) : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(showManual || !oauthConfigured) && (
                <>
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
                </>
            )}

            {conn?.hasAccessToken && !showManual && (
                <div className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
                    <p>
                        <span className="font-medium">{conn.pageName || "Page"}</span>
                        <span className="ml-2 text-xs text-zinc-400">{conn.pageId}</span>
                    </p>
                    {conn.igUserId ? (
                        <p className="text-xs text-zinc-500">IG user: {conn.igUserId}</p>
                    ) : null}
                </div>
            )}

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
                <p className="mt-1">
                    OAuth redirect:{" "}
                    <code>/api/admin/meta-messaging/oauth/callback</code> (cadastre no app Meta).
                </p>
            </div>

            {msg && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>}

            {(showManual || !oauthConfigured) && (
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
            )}
        </div>
    );
}
