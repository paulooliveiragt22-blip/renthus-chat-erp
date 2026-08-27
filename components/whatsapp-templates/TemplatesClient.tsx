"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Save } from "lucide-react";

type TemplateRow = {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    rejectionReason: string | null;
    lastSyncedAt: string | null;
};

export default function TemplatesClient() {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [templates, setTemplates] = useState<TemplateRow[]>([]);
    const [name, setName] = useState("pedido_saiu_entrega");
    const [language, setLanguage] = useState("pt_BR");
    const [category, setCategory] = useState<"UTILITY" | "MARKETING" | "AUTHENTICATION">(
        "UTILITY"
    );
    const [bodyText, setBodyText] = useState(
        "Olá {{1}}! Seu pedido #{{2}} saiu para entrega."
    );
    const [footerText, setFooterText] = useState("Renthus");
    const [example1, setExample1] = useState("Maria");
    const [example2, setExample2] = useState("1042");

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch("/api/admin/whatsapp-templates", {
                credentials: "include",
                cache: "no-store",
            });
            const json = (await res.json().catch(() => ({}))) as {
                templates?: TemplateRow[];
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(json.hint || json.error || "Falha ao carregar templates.");
                return;
            }
            setTemplates(json.templates ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function sync() {
        setSyncing(true);
        setMsg(null);
        setErr(null);
        try {
            const res = await fetch("/api/admin/whatsapp-templates", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "sync" }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                synced?: number;
                templates?: TemplateRow[];
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(json.hint || json.error || "Falha ao sincronizar.");
                return;
            }
            setTemplates(json.templates ?? []);
            setMsg(`Sincronizados ${json.synced ?? 0} modelo(s) da Meta.`);
        } finally {
            setSyncing(false);
        }
    }

    async function submit() {
        setSaving(true);
        setMsg(null);
        setErr(null);
        try {
            const examples = [example1, example2].filter((v) => v.trim());
            const res = await fetch("/api/admin/whatsapp-templates/submit", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    language: language.trim() || "pt_BR",
                    category,
                    bodyText: bodyText.trim(),
                    footerText: footerText.trim() || undefined,
                    exampleBodyValues: examples.length ? examples : undefined,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                template?: TemplateRow;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(json.hint || json.error || "Falha ao criar template.");
                return;
            }
            setMsg(`Template “${json.template?.name}” enviado (status PENDING).`);
            await load();
        } finally {
            setSaving(false);
        }
    }

    function statusClass(status: string) {
        if (status === "APPROVED") return "bg-emerald-100 text-emerald-800";
        if (status === "REJECTED") return "bg-red-100 text-red-800";
        if (status === "PENDING") return "bg-amber-100 text-amber-800";
        return "bg-zinc-100 text-zinc-700";
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando templates…
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Templates WhatsApp
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        Crie e sincronize modelos (HSM) com a Meta — necessário para App Review e
                        mensagens fora da janela 24h.
                    </p>
                </div>
                <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void sync()}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                >
                    {syncing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    Sincronizar da Meta
                </button>
            </div>

            {err && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    {err}
                </p>
            )}
            {msg && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    {msg}
                </p>
            )}

            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Plus className="h-4 w-4" />
                    Criar modelo (envia para aprovação Meta)
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Nome (snake_case)</span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Idioma</span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Categoria</span>
                        <select
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={category}
                            onChange={(e) =>
                                setCategory(e.target.value as typeof category)
                            }
                        >
                            <option value="UTILITY">UTILITY</option>
                            <option value="MARKETING">MARKETING</option>
                            <option value="AUTHENTICATION">AUTHENTICATION</option>
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Rodapé (opcional)</span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={footerText}
                            onChange={(e) => setFooterText(e.target.value)}
                        />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block text-zinc-600">
                            Corpo (use {"{{1}}"}, {"{{2}}"}…)
                        </span>
                        <textarea
                            rows={3}
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={bodyText}
                            onChange={(e) => setBodyText(e.target.value)}
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Exemplo {"{{1}}"}</span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={example1}
                            onChange={(e) => setExample1(e.target.value)}
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block text-zinc-600">Exemplo {"{{2}}"}</span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={example2}
                            onChange={(e) => setExample2(e.target.value)}
                        />
                    </label>
                </div>
                <button
                    type="button"
                    disabled={saving || !name.trim() || !bodyText.trim()}
                    onClick={() => void submit()}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                    {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    Enviar para aprovação
                </button>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-3 text-sm font-semibold">Modelos sincronizados</h2>
                {templates.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                        Nenhum template ainda. Crie um acima ou sincronize do WhatsApp Manager.
                    </p>
                ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {templates.map((t) => (
                            <li
                                key={t.id}
                                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                            >
                                <div>
                                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                                        {t.name}
                                        <span className="ml-2 text-xs font-normal text-zinc-400">
                                            {t.language} · {t.category}
                                        </span>
                                    </p>
                                    {t.rejectionReason ? (
                                        <p className="text-xs text-red-600">{t.rejectionReason}</p>
                                    ) : null}
                                </div>
                                <span
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusClass(t.status)}`}
                                >
                                    {t.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
