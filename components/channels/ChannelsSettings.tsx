"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Link2 } from "lucide-react";
import MetaMessagingSettings from "@/components/menu/MetaMessagingSettings";
import MarketPlanGate from "@/components/menu/MarketPlanGate";

type WaConnection = {
    id: string;
    from_identifier: string;
    waba_id: string;
    status: string;
    hasAccessToken: boolean;
    provisioning_mode?: string;
    last_health_ok?: boolean | null;
};

export default function ChannelsSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [healthBusy, setHealthBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [conn, setConn] = useState<WaConnection | null>(null);
    const [displayPhone, setDisplayPhone] = useState("");
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [webhookPath, setWebhookPath] = useState("/api/whatsapp/incoming");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/whatsapp-channel", {
                credentials: "include",
                cache: "no-store",
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: WaConnection | null;
                displayPhone?: string | null;
                webhookPath?: string;
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Falha ao carregar canal WhatsApp.");
                return;
            }
            if (json.webhookPath) setWebhookPath(json.webhookPath);
            setDisplayPhone(json.displayPhone ?? "");
            const c = json.connection ?? null;
            setConn(c);
            if (c) {
                setPhoneNumberId(c.from_identifier);
                setWabaId(c.waba_id ?? "");
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function saveWa() {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/whatsapp-channel", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phoneNumberId,
                    wabaId: wabaId || null,
                    accessToken: accessToken.trim() || undefined,
                    whatsappPhone: displayPhone.trim() || null,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: WaConnection;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setMsg(json.hint || json.error || "Não foi possível salvar.");
                return;
            }
            setConn(json.connection ?? null);
            setAccessToken("");
            setMsg("Canal WhatsApp salvo.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    async function testHealth() {
        setHealthBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/whatsapp-channel/health", {
                method: "POST",
                credentials: "include",
            });
            const json = (await res.json().catch(() => ({}))) as {
                health?: {
                    ok: boolean;
                    errorMessage?: string;
                    displayPhoneNumber?: string;
                    verifiedName?: string;
                };
                connection?: WaConnection | null;
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Falha no teste de conexão.");
                return;
            }
            if (json.connection) setConn(json.connection);
            if (json.health?.ok) {
                setMsg(
                    `Conexão OK` +
                        (json.health.verifiedName ? ` — ${json.health.verifiedName}` : "") +
                        (json.health.displayPhoneNumber
                            ? ` (${json.health.displayPhoneNumber})`
                            : "")
                );
            } else {
                setMsg(json.health?.errorMessage || "Health check falhou.");
            }
        } finally {
            setHealthBusy(false);
        }
    }

    async function setStatus(status: "active" | "inactive") {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/whatsapp-channel", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: WaConnection;
                error?: string;
            };
            if (!res.ok) {
                setMsg(json.error || "Falha ao atualizar status.");
                return;
            }
            setConn(json.connection ?? null);
            setMsg(status === "active" ? "Canal reativado." : "Canal desativado.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-8">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                            WhatsApp Cloud API
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                            Conecte o número da loja (Phone Number ID + token). Use o mesmo Meta App
                            do webhook da plataforma.
                        </p>
                    </div>
                    {conn?.hasAccessToken && conn.status === "active" ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                            Conectado
                        </span>
                    ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                            Pendente
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando…
                    </div>
                ) : (
                    <>
                        {conn?.provisioning_mode === "platform" && (
                            <p className="mb-3 text-xs text-zinc-500">
                                Provisionado pela plataforma — você pode atualizar as credenciais
                                abaixo.
                            </p>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-sm sm:col-span-2">
                                <span className="mb-1 block text-zinc-600">Phone Number ID</span>
                                <input
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    value={phoneNumberId}
                                    onChange={(e) => setPhoneNumberId(e.target.value)}
                                    placeholder="Ex.: 109876543210987"
                                />
                            </label>
                            <label className="block text-sm sm:col-span-2">
                                <span className="mb-1 block text-zinc-600">WABA ID</span>
                                <input
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    value={wabaId}
                                    onChange={(e) => setWabaId(e.target.value)}
                                    placeholder="Necessário para templates / sync"
                                />
                            </label>
                            <label className="block text-sm sm:col-span-2">
                                <span className="mb-1 block text-zinc-600">
                                    Access Token
                                    {conn?.hasAccessToken
                                        ? " (deixe em branco para manter)"
                                        : ""}
                                </span>
                                <input
                                    type="password"
                                    autoComplete="off"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    value={accessToken}
                                    onChange={(e) => setAccessToken(e.target.value)}
                                />
                            </label>
                            <label className="block text-sm sm:col-span-2">
                                <span className="mb-1 block text-zinc-600">
                                    Telefone exibido (E.164)
                                </span>
                                <input
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    value={displayPhone}
                                    onChange={(e) => setDisplayPhone(e.target.value)}
                                    placeholder="+5565..."
                                />
                            </label>
                        </div>

                        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                            <p className="font-medium text-zinc-800 dark:text-zinc-100">
                                Webhook WhatsApp
                            </p>
                            <p className="mt-1 break-all">
                                Callback:{" "}
                                <code>
                                    {typeof globalThis.location !== "undefined"
                                        ? `${globalThis.location.origin}${webhookPath}`
                                        : webhookPath}
                                </code>
                            </p>
                        </div>

                        {msg && (
                            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={saving || !phoneNumberId.trim()}
                                onClick={() => void saveWa()}
                                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="h-4 w-4" />
                                )}
                                Salvar WhatsApp
                            </button>
                            {conn?.hasAccessToken && (
                                <button
                                    type="button"
                                    disabled={healthBusy || saving}
                                    onClick={() => void testHealth()}
                                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                                >
                                    {healthBusy ? "Testando…" : "Testar conexão"}
                                </button>
                            )}
                            {conn?.hasAccessToken && conn.status === "active" && (
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void setStatus("inactive")}
                                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                                >
                                    Desativar
                                </button>
                            )}
                            {conn?.status === "inactive" && (
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void setStatus("active")}
                                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                                >
                                    <Link2 className="h-4 w-4" />
                                    Reativar
                                </button>
                            )}
                        </div>
                    </>
                )}
            </section>

            <MarketPlanGate
                featureKey="omnichannel_ig_messenger"
                title="Instagram e Messenger"
                description="Atendimento do chatbot também nas redes Meta."
            >
                <MetaMessagingSettings />
            </MarketPlanGate>
        </div>
    );
}
