"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MetaMessagingSettings from "@/components/menu/MetaMessagingSettings";
import MarketPlanGate from "@/components/menu/MarketPlanGate";
import WhatsAppEmbeddedSignupButton from "@/components/channels/WhatsAppEmbeddedSignupButton";
import { migrateButtonLabel } from "@/lib/channels/migrateWhatsappLabel";
import { profileLabel } from "@/lib/workspace/loginDestination";
import type { AttendanceMode } from "@/src/service/domain/types";

type AdministeredChannel = {
    channelId: string;
    companyName: string;
    attendanceMode: AttendanceMode;
    phoneNumberId: string;
    displayPhone: string | null;
    isCurrent: boolean;
};

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
    const [readiness, setReadiness] = useState<{
        ready: boolean;
        checks: Array<{ label: string; ok: boolean }>;
    } | null>(null);
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [pasteSaving, setPasteSaving] = useState(false);
    const [migrating, setMigrating] = useState(false);
    const [migratingId, setMigratingId] = useState<string | null>(null);
    const [administered, setAdministered] = useState<AdministeredChannel[]>([]);
    const [currentName, setCurrentName] = useState("Este perfil");
    const [currentMode, setCurrentMode] = useState<AttendanceMode>("delivery");
    const [taken, setTaken] = useState<{
        sourceName: string;
        sourceMode: AttendanceMode;
        targetMode: AttendanceMode;
    } | null>(null);

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
                currentName?: string;
                currentMode?: AttendanceMode;
                administered?: AdministeredChannel[];
            };
            if (!res.ok) {
                toast.error(json.error || "Falha ao carregar canal WhatsApp.");
                return;
            }
            if (json.webhookPath) setWebhookPath(json.webhookPath);
            setDisplayPhone(json.displayPhone ?? "");
            setConn(json.connection ?? null);
            setPhoneNumberId(json.connection?.from_identifier ?? "");
            setWabaId(json.connection?.waba_id ?? "");
            setAccessToken("");
            setCurrentName(json.currentName?.trim() || "Este perfil");
            setCurrentMode(json.currentMode === "service" ? "service" : "delivery");
            setAdministered(Array.isArray(json.administered) ? json.administered : []);
            const readyRes = await fetch("/api/admin/bot-readiness", {
                credentials: "include",
                cache: "no-store",
            });
            const readyJson = (await readyRes.json().catch(() => ({}))) as {
                ready?: boolean;
                checks?: Array<{ label: string; ok: boolean }>;
            };
            if (readyRes.ok && Array.isArray(readyJson.checks)) {
                setReadiness({ ready: readyJson.ready === true, checks: readyJson.checks });
            } else {
                setReadiness(null);
            }
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

    async function saveCredentials() {
        setPasteSaving(true);
        try {
            const res = await fetch("/api/admin/whatsapp-channel", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phoneNumberId,
                    accessToken,
                    wabaId,
                    displayPhone,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                connection?: WaConnection;
                error?: string;
                hint?: string;
                canMigrate?: boolean;
                sourceName?: string;
                sourceMode?: AttendanceMode;
                targetMode?: AttendanceMode;
            };
            if (!res.ok) {
                if (
                    json.error === "whatsapp_already_registered" &&
                    json.canMigrate &&
                    json.sourceName &&
                    (json.sourceMode === "delivery" || json.sourceMode === "service") &&
                    (json.targetMode === "delivery" || json.targetMode === "service")
                ) {
                    setTaken({
                        sourceName: json.sourceName,
                        sourceMode: json.sourceMode,
                        targetMode: json.targetMode,
                    });
                    return;
                }
                setTaken(null);
                toast.error(json.hint || json.error || "Não foi possível salvar as credenciais.");
                return;
            }
            setTaken(null);
            setAccessToken("");
            if (json.connection) setConn(json.connection);
            toast.success("Credenciais salvas.");
            await load();
        } finally {
            setPasteSaving(false);
        }
    }

    async function migrateChannel() {
        if (!taken) return;
        setMigrating(true);
        try {
            const res = await fetch("/api/admin/whatsapp-channel/migrate", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phoneNumberId,
                    accessToken,
                    wabaId,
                    displayPhone,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                toast.error(json.hint || "Não foi possível migrar o WhatsApp.");
                return;
            }
            setTaken(null);
            setAccessToken("");
            toast.success("WhatsApp migrado. As conversas antigas ficam no perfil de origem.");
            await load();
        } finally {
            setMigrating(false);
        }
    }

    async function migrateListed(channelId: string) {
        setMigratingId(channelId);
        try {
            const res = await fetch("/api/admin/whatsapp-channel/migrate", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channelId }),
            });
            const json = (await res.json().catch(() => ({}))) as { hint?: string };
            if (!res.ok) {
                toast.error(json.hint || "Não foi possível migrar o WhatsApp.");
                return;
            }
            toast.success(`WhatsApp migrado para ${currentName}. As conversas antigas ficam no perfil de origem.`);
            await load();
        } finally {
            setMigratingId(null);
        }
    }

    const connected = Boolean(conn?.hasAccessToken && conn.status === "active");
    const currentHasChannel = administered.some((row) => row.isCurrent);

    return (
        <div className="space-y-8">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">WhatsApp</h3>
                        <p className="mt-1 max-w-prose text-sm text-zinc-500">
                            Conecte pelo botão da Meta ou cole o Phone Number ID e o token, como no
                            delivery. O número e o token precisam ser do mesmo aplicativo Meta do
                            webhook. Você continua usando o WhatsApp Business no celular.
                        </p>
                    </div>
                    {connected && readiness?.ready ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                            Pronto
                            {conn?.is_on_biz_app ? " · celular" : ""}
                        </span>
                    ) : connected ? (
                        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-800 dark:bg-sky-950 dark:text-sky-200">
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

                        <div className="mb-6 grid gap-2">
                            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                                WhatsApps dos seus perfis
                            </h4>
                            <p className="max-w-prose text-xs text-zinc-500">
                                Migrar traz o número para {currentName}, o perfil aberto. As conversas
                                antigas ficam onde estavam.
                            </p>
                            {administered.length === 0 ? (
                                <p className="text-sm text-zinc-500">Nenhum WhatsApp nos perfis que você administra.</p>
                            ) : (
                                <ul className="grid gap-2">
                                    {administered.map((row) => (
                                        <li
                                            key={row.channelId}
                                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                                    {row.companyName} · {profileLabel(row.attendanceMode)}
                                                </p>
                                                <p className="truncate text-xs text-zinc-500">
                                                    {row.displayPhone || row.phoneNumberId}
                                                </p>
                                            </div>
                                            {row.isCurrent ? (
                                                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                                                    Este perfil
                                                </span>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    disabled={Boolean(migratingId) || migrating || currentHasChannel}
                                                    onClick={() => void migrateListed(row.channelId)}
                                                >
                                                    {migratingId === row.channelId
                                                        ? "Migrando…"
                                                        : migrateButtonLabel(row.attendanceMode, currentMode)}
                                                </Button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {currentHasChannel && administered.some((row) => !row.isCurrent) ? (
                                <p className="text-xs text-zinc-500">
                                    Este perfil já tem um WhatsApp. O botão de migrar fica disponível quando ele não tiver número.
                                </p>
                            ) : null}
                        </div>

                        <WhatsAppEmbeddedSignupButton onConnected={() => void load()} />

                        <form
                            className="mt-6 grid gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void saveCredentials();
                            }}
                        >
                            <div>
                                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                                    Credenciais
                                </h4>
                                <p className="mt-1 max-w-prose text-xs text-zinc-500">
                                    Phone Number ID, token e, se tiver, o WABA. O token não volta para
                                    esta tela depois de salvar.
                                </p>
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="wa-phone-number-id">Phone Number ID</Label>
                                <Input
                                    id="wa-phone-number-id"
                                    name="phoneNumberId"
                                    autoComplete="off"
                                    value={phoneNumberId}
                                    onChange={(event) => {
                                        setPhoneNumberId(event.target.value);
                                        setTaken(null);
                                    }}
                                    required
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="wa-access-token">Token</Label>
                                <Input
                                    id="wa-access-token"
                                    name="accessToken"
                                    type="password"
                                    autoComplete="new-password"
                                    value={accessToken}
                                    onChange={(event) => setAccessToken(event.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="grid gap-1.5">
                                    <Label htmlFor="wa-waba-id">WABA</Label>
                                    <Input
                                        id="wa-waba-id"
                                        name="wabaId"
                                        autoComplete="off"
                                        value={wabaId}
                                        onChange={(event) => setWabaId(event.target.value)}
                                    />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="wa-display-phone">Telefone exibido</Label>
                                    <Input
                                        id="wa-display-phone"
                                        name="displayPhone"
                                        autoComplete="tel"
                                        value={displayPhone}
                                        onChange={(event) => setDisplayPhone(event.target.value)}
                                    />
                                </div>
                            </div>
                            <div>
                                <Button type="submit" disabled={pasteSaving || saving || migrating}>
                                    {pasteSaving ? "Salvando…" : "Salvar credenciais"}
                                </Button>
                            </div>
                            {taken ? (
                                <div
                                    role="status"
                                    className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
                                >
                                    <p className="text-sm font-medium text-amber-950 dark:text-amber-50">
                                        WhatsApp já cadastrado
                                    </p>
                                    <p className="max-w-prose text-sm text-amber-900 dark:text-amber-100">
                                        Este número está em {taken.sourceName}. Ele continua lá até você
                                        migrar. As conversas antigas não mudam de perfil.
                                    </p>
                                    <div>
                                        <Button
                                            type="button"
                                            disabled={migrating || pasteSaving}
                                            onClick={() => void migrateChannel()}
                                        >
                                            {migrating
                                                ? "Migrando…"
                                                : migrateButtonLabel(taken.sourceMode, taken.targetMode)}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </form>

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

                        {readiness ? (
                            <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                                    Pronto para o atendimento
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                    O canal marca Pronto quando estes itens passam. A conversa não
                                    muda por causa desta lista.
                                </p>
                                <ul className="mt-3 space-y-1.5 text-sm">
                                    {readiness.checks.map((check) => (
                                        <li key={check.label} className="flex items-center gap-2">
                                            <span
                                                className={
                                                    check.ok
                                                        ? "text-emerald-700 dark:text-emerald-300"
                                                        : "text-amber-700 dark:text-amber-300"
                                                }
                                            >
                                                {check.ok ? "Ok" : "Falta"}
                                            </span>
                                            <span className="text-zinc-700 dark:text-zinc-200">{check.label}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

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
