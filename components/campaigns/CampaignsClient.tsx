"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, RefreshCw } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type TemplateOpt = {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
};

type CampaignRow = {
    id: string;
    name: string;
    status: string;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    templateName: string | null;
    templateCategory: string | null;
    createdAt: string;
};

export default function CampaignsClient() {
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
    const [templates, setTemplates] = useState<TemplateOpt[]>([]);
    const [name, setName] = useState("Campanha");
    const [templateId, setTemplateId] = useState("");
    const [audienceMode, setAudienceMode] = useState<"all_with_phone" | "ordered_last_days">(
        "all_with_phone"
    );
    const [orderedLastDays, setOrderedLastDays] = useState(30);
    const [param1, setParam1] = useState("");
    const [param2, setParam2] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const [cRes, tRes] = await Promise.all([
                fetch("/api/admin/campaigns", { credentials: "include", cache: "no-store" }),
                fetch("/api/admin/whatsapp-templates", {
                    credentials: "include",
                    cache: "no-store",
                }),
            ]);
            const cJson = (await cRes.json().catch(() => ({}))) as {
                campaigns?: CampaignRow[];
                error?: string;
                hint?: string;
            };
            const tJson = (await tRes.json().catch(() => ({}))) as {
                templates?: TemplateOpt[];
                error?: string;
                hint?: string;
            };
            if (!cRes.ok) {
                setErr(cJson.hint || cJson.error || "Falha ao carregar campanhas.");
                return;
            }
            if (!tRes.ok) {
                setErr(tJson.hint || tJson.error || "Falha ao carregar templates.");
                return;
            }
            setCampaigns(cJson.campaigns ?? []);
            const approved = (tJson.templates ?? []).filter((t) => t.status === "APPROVED");
            setTemplates(approved);
            if (!templateId && approved[0]) setTemplateId(approved[0].id);
        } finally {
            setLoading(false);
        }
    }, [templateId]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function start() {
        setStarting(true);
        setMsg(null);
        setErr(null);
        try {
            const params = [param1, param2].map((p) => p.trim()).filter(Boolean);
            const res = await fetch("/api/admin/campaigns", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    templateId,
                    audienceMode,
                    orderedLastDays:
                        audienceMode === "ordered_last_days" ? orderedLastDays : undefined,
                    bodyParams: params.length ? params : undefined,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                queued?: number;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(json.hint || json.error || "Não foi possível iniciar.");
                return;
            }
            setMsg(`Campanha enfileirada: ${json.queued ?? 0} destinatário(s).`);
            await load();
        } finally {
            setStarting(false);
        }
    }

    async function cancel(id: string) {
        setErr(null);
        const res = await fetch(`/api/admin/campaigns/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel" }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
            setErr(json.error || "Falha ao cancelar.");
            return;
        }
        setMsg("Campanha cancelada.");
        await load();
    }

    const selectedTpl = templates.find((t) => t.id === templateId);

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando campanhas…
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Campanhas WhatsApp
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        Disparo em massa com templates aprovados. MARKETING exige opt-in (
                        <code className="text-xs">QUERO OFERTAS</code>).
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                >
                    <RefreshCw className="h-4 w-4" />
                    Atualizar
                </button>
            </div>

            {err && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {err}
                </p>
            )}
            {msg && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {msg}
                </p>
            )}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Megaphone className="h-4 w-4" />
                    Nova campanha
                </h2>
                {templates.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                        Nenhum template APPROVED. Crie em{" "}
                        <a href="/templates" className="underline">
                            Templates WA
                        </a>
                        .
                    </p>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm sm:col-span-2">
                            <span className="mb-1 block text-zinc-600">Nome</span>
                            <input
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </label>
                        <label className="block text-sm sm:col-span-2">
                            <span className="mb-1 block text-zinc-600">Template</span>
                            <Select value={templateId || undefined} onValueChange={setTemplateId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione um template" />
                                </SelectTrigger>
                                <SelectContent>
                                    {templates.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                            {t.name} ({t.language}) · {t.category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                        <label className="block text-sm sm:col-span-2">
                            <span className="mb-1 block text-zinc-600">Audiência</span>
                            <Select
                                value={audienceMode}
                                onValueChange={(v) =>
                                    setAudienceMode(v as "all_with_phone" | "ordered_last_days")
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all_with_phone">
                                        Todos clientes com telefone
                                    </SelectItem>
                                    <SelectItem value="ordered_last_days">
                                        Quem pediu nos últimos N dias
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </label>
                        {audienceMode === "ordered_last_days" && (
                            <label className="block text-sm">
                                <span className="mb-1 block text-zinc-600">Dias</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    value={orderedLastDays}
                                    onChange={(e) =>
                                        setOrderedLastDays(Number(e.target.value) || 30)
                                    }
                                />
                            </label>
                        )}
                        <label className="block text-sm">
                            <span className="mb-1 block text-zinc-600">{"{{1}}"}</span>
                            <input
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                value={param1}
                                onChange={(e) => setParam1(e.target.value)}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="mb-1 block text-zinc-600">{"{{2}}"}</span>
                            <input
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                value={param2}
                                onChange={(e) => setParam2(e.target.value)}
                            />
                        </label>
                        {selectedTpl?.category === "MARKETING" && (
                            <p className="sm:col-span-2 text-xs text-amber-700">
                                Template MARKETING: só clientes com opt-in receberão a mensagem.
                            </p>
                        )}
                        <div className="sm:col-span-2">
                            <button
                                type="button"
                                disabled={starting || !templateId}
                                onClick={() => void start()}
                                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                            >
                                {starting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Megaphone className="h-4 w-4" />
                                )}
                                Disparar campanha
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-3 text-sm font-semibold">Histórico</h2>
                {campaigns.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nenhuma campanha ainda.</p>
                ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {campaigns.map((c) => (
                            <li
                                key={c.id}
                                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                            >
                                <div>
                                    <p className="font-medium">
                                        {c.name}{" "}
                                        <span className="text-xs font-normal text-zinc-400">
                                            {c.templateName} · {c.status}
                                        </span>
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        {c.sentCount}/{c.totalRecipients} enviados ·{" "}
                                        {c.failedCount} falhas · {c.skippedCount} ignorados
                                    </p>
                                </div>
                                {c.status === "running" && (
                                    <button
                                        type="button"
                                        onClick={() => void cancel(c.id)}
                                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-700"
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
