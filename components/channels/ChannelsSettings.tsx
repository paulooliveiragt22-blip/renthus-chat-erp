"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import MetaMessagingSettings from "@/components/menu/MetaMessagingSettings";
import MarketPlanGate from "@/components/menu/MarketPlanGate";
import WhatsAppEmbeddedSignupButton from "@/components/channels/WhatsAppEmbeddedSignupButton";

type WaConnection = {
    id: string;
    from_identifier: string;
    waba_id: string;
    status: string;
    hasAccessToken: boolean;
    provisioning_mode?: string;
    is_on_biz_app?: boolean;
    last_health_ok?: boolean | null;
};

export default function ChannelsSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [healthBusy, setHealthBusy] = useState(false);
    const [conn, setConn] = useState<WaConnection | null>(null);
    const [displayPhone, setDisplayPhone] = useState("");
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
                toast.error(json.error || "Falha ao carregar canal WhatsApp.");
                return;
            }
            if (json.webhookPath) setWebhookPath(json.webhookPath);
            setDisplayPhone(json.displayPhone ?? "");
            setConn(json.connection ?? null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function testHealth() {
        setHealthBusy(true);
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
                toast.error(json.error || "Falha no teste de conexão.");
                return;
            }
            if (json.connection) setConn(json.connection);
            if (json.health?.ok) {
                toast.success(
                    `Conexão OK` +
                        (json.health.verifiedName ? ` — ${json.health.verifiedName}` : "") +
                        (json.health.displayPhoneNumber
                            ? ` (${json.health.displayPhoneNumber})`
                            : "")
                );
            } else {
                toast.error(json.health?.errorMessage || "Health check falhou.");
            }
        } finally {
            setHealthBusy(false);
        }
    }

    async function setStatus(status: "active" | "inactive") {
        setSaving(true);
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
                toast.error(json.error || "Falha ao atualizar status.");
                return;
            }
            setConn(json.connection ?? null);
            toast.success(status === "active" ? "Canal reativado." : "Canal desativado.");
        } finally {
            setSaving(false);
        }
    }

    const connected = Boolean(conn?.hasAccessToken && conn.status === "active");

    return (
        <div className="space-y-8">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">WhatsApp</h3>
                        <p className="mt-1 max-w-prose text-sm text-zinc-500">
                            Conecte o número da loja pelo fluxo oficial da Meta. Você continua usando
                            o WhatsApp Business no celular. Pedidos automáticos vêm do que o{" "}
                            <strong>cliente</strong> pede ao assistente; o que você digitar no
                            celular aparece na inbox e pausa o bot.
                        </p>
                    </div>
                    {connected ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                            Conectado
                            {conn?.is_on_biz_app ? " · celular" : ""}
                        </span>
                    ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            Pendente
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Carregando…
                    </div>
                ) : (
                    <>
                        {conn?.provisioning_mode === "platform" && (
                            <p className="mb-3 text-xs text-zinc-500">
                                Provisionado pela plataforma — você pode reconectar pelo botão abaixo.
                            </p>
                        )}

                        {connected ? (
                            <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
                                <div>
                                    <dt className="text-xs text-zinc-500">Modo</dt>
                                    <dd className="truncate">
                                        {conn?.is_on_biz_app
                                            ? "Coexistence (app + API)"
                                            : "Cloud API"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-zinc-500">Telefone</dt>
                                    <dd className="truncate">{displayPhone || "—"}</dd>
                                </div>
                                <div className="sm:col-span-2">
                                    <dt className="text-xs text-zinc-500">WABA</dt>
                                    <dd className="truncate font-mono text-xs">{conn?.waba_id || "—"}</dd>
                                </div>
                            </dl>
                        ) : null}

                        <WhatsAppEmbeddedSignupButton onConnected={() => void load()} />

                        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                            <p className="font-medium text-zinc-800 dark:text-zinc-100">Webhook WhatsApp</p>
                            <p className="mt-1 break-all">
                                Callback:{" "}
                                <code>
                                    {typeof globalThis.location !== "undefined"
                                        ? `${globalThis.location.origin}${webhookPath}`
                                        : webhookPath}
                                </code>
                            </p>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {conn?.hasAccessToken && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={healthBusy || saving}
                                    onClick={() => void testHealth()}
                                >
                                    {healthBusy ? "Testando…" : "Testar conexão"}
                                </Button>
                            )}
                            {conn?.hasAccessToken && conn.status === "active" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => void setStatus("inactive")}
                                >
                                    Desativar
                                </Button>
                            )}
                            {conn?.status === "inactive" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => void setStatus("active")}
                                >
                                    <Link2 className="h-4 w-4" aria-hidden />
                                    Reativar
                                </Button>
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
