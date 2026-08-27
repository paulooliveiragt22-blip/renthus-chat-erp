"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type TemplateRow = {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    rejectionReason: string | null;
    lastSyncedAt: string | null;
    components?: Array<Record<string, unknown>>;
};

type ButtonDraft =
    | { type: "QUICK_REPLY"; text: string }
    | { type: "URL"; text: string; url: string }
    | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

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
    const [headerText, setHeaderText] = useState("");
    const [headerExample, setHeaderExample] = useState("");
    const [bodyText, setBodyText] = useState(
        "Olá {{1}}! Seu pedido #{{2}} saiu para entrega."
    );
    const [footerText, setFooterText] = useState("Renthus");
    const [example1, setExample1] = useState("Maria");
    const [example2, setExample2] = useState("1042");
    const [buttons, setButtons] = useState<ButtonDraft[]>([]);

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
            const cleanedButtons = buttons
                .map((b) => {
                    if (b.type === "QUICK_REPLY") {
                        return b.text.trim()
                            ? { type: "QUICK_REPLY" as const, text: b.text.trim() }
                            : null;
                    }
                    if (b.type === "URL") {
                        return b.text.trim() && b.url.trim()
                            ? {
                                  type: "URL" as const,
                                  text: b.text.trim(),
                                  url: b.url.trim(),
                              }
                            : null;
                    }
                    return b.text.trim() && b.phoneNumber.trim()
                        ? {
                              type: "PHONE_NUMBER" as const,
                              text: b.text.trim(),
                              phoneNumber: b.phoneNumber.trim(),
                          }
                        : null;
                })
                .filter(Boolean);

            const res = await fetch("/api/admin/whatsapp-templates/submit", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    language: language.trim() || "pt_BR",
                    category,
                    headerText: headerText.trim() || undefined,
                    headerExample: headerExample.trim() || undefined,
                    bodyText: bodyText.trim(),
                    footerText: footerText.trim() || undefined,
                    exampleBodyValues: examples.length ? examples : undefined,
                    buttons: cleanedButtons.length ? cleanedButtons : undefined,
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

    function addButton(type: ButtonDraft["type"]) {
        if (buttons.length >= 3) return;
        if (type === "QUICK_REPLY") setButtons((b) => [...b, { type, text: "" }]);
        else if (type === "URL") setButtons((b) => [...b, { type, text: "", url: "" }]);
        else setButtons((b) => [...b, { type, text: "", phoneNumber: "+55" }]);
    }

    function summarizeComponents(components: Array<Record<string, unknown>> | undefined) {
        if (!components?.length) return null;
        const parts: string[] = [];
        for (const c of components) {
            const t = String(c.type ?? "").toUpperCase();
            if (t === "HEADER") parts.push("header");
            if (t === "FOOTER") parts.push("footer");
            if (t === "BUTTONS") {
                const btns = Array.isArray(c.buttons) ? c.buttons.length : 0;
                parts.push(`${btns} botão(ões)`);
            }
        }
        return parts.length ? parts.join(" · ") : null;
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
                        Header, corpo, rodapé e até 3 botões. Sync atualiza status
                        PENDING/APPROVED/REJECTED.
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
                    Criar modelo (aprovação Meta)
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
                            Header texto (opcional, máx. 60)
                        </span>
                        <input
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={headerText}
                            onChange={(e) => setHeaderText(e.target.value)}
                            placeholder="Ex.: Pedido {{1}}"
                        />
                    </label>
                    {headerText.includes("{{") && (
                        <label className="block text-sm sm:col-span-2">
                            <span className="mb-1 block text-zinc-600">
                                Exemplo do header
                            </span>
                            <input
                                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                value={headerExample}
                                onChange={(e) => setHeaderExample(e.target.value)}
                            />
                        </label>
                    )}
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

                <div className="mt-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Botões (até 3)
                        </p>
                        <div className="flex flex-wrap gap-1">
                            <button
                                type="button"
                                disabled={buttons.length >= 3}
                                onClick={() => addButton("QUICK_REPLY")}
                                className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                            >
                                + Resposta rápida
                            </button>
                            <button
                                type="button"
                                disabled={buttons.length >= 3}
                                onClick={() => addButton("URL")}
                                className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                            >
                                + URL
                            </button>
                            <button
                                type="button"
                                disabled={buttons.length >= 3}
                                onClick={() => addButton("PHONE_NUMBER")}
                                className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                            >
                                + Telefone
                            </button>
                        </div>
                    </div>
                    {buttons.map((b, idx) => (
                        <div
                            key={`${b.type}-${idx}`}
                            className="grid gap-2 rounded-lg border border-zinc-100 p-3 sm:grid-cols-[1fr_1fr_auto] dark:border-zinc-800"
                        >
                            <input
                                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                placeholder="Texto do botão"
                                value={b.text}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    setButtons((prev) =>
                                        prev.map((x, i) =>
                                            i === idx ? { ...x, text } : x
                                        )
                                    );
                                }}
                            />
                            {b.type === "URL" && (
                                <input
                                    className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    placeholder="https://..."
                                    value={b.url}
                                    onChange={(e) => {
                                        const url = e.target.value;
                                        setButtons((prev) =>
                                            prev.map((x, i) =>
                                                i === idx && x.type === "URL"
                                                    ? { ...x, url }
                                                    : x
                                            )
                                        );
                                    }}
                                />
                            )}
                            {b.type === "PHONE_NUMBER" && (
                                <input
                                    className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    placeholder="+5565..."
                                    value={b.phoneNumber}
                                    onChange={(e) => {
                                        const phoneNumber = e.target.value;
                                        setButtons((prev) =>
                                            prev.map((x, i) =>
                                                i === idx && x.type === "PHONE_NUMBER"
                                                    ? { ...x, phoneNumber }
                                                    : x
                                            )
                                        );
                                    }}
                                />
                            )}
                            {b.type === "QUICK_REPLY" && (
                                <span className="self-center text-xs text-zinc-400">
                                    QUICK_REPLY
                                </span>
                            )}
                            <button
                                type="button"
                                aria-label="Remover botão"
                                onClick={() =>
                                    setButtons((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="justify-self-end rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                    <p className="text-[11px] text-zinc-400">
                        Header com mídia (imagem/vídeo) fica fora deste formulário — use o
                        WhatsApp Manager e depois sincronize.
                    </p>
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
                                    {summarizeComponents(t.components) ? (
                                        <p className="text-xs text-zinc-500">
                                            {summarizeComponents(t.components)}
                                        </p>
                                    ) : null}
                                    {t.rejectionReason ? (
                                        <p className="mt-0.5 text-xs text-red-600">
                                            Rejeitado: {t.rejectionReason}
                                        </p>
                                    ) : null}
                                    {t.lastSyncedAt ? (
                                        <p className="text-[10px] text-zinc-400">
                                            Sync: {new Date(t.lastSyncedAt).toLocaleString("pt-BR")}
                                        </p>
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
