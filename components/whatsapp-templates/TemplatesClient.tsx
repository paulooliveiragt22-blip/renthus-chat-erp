"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { formatMetaClientError } from "@/lib/whatsapp-templates/metaGraphError";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
    | { type: "PHONE_NUMBER"; text: string; phoneNumber: string }
    | { type: "COPY_CODE"; example: string };

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
    const [marketingKind, setMarketingKind] = useState<"custom" | "limited_time_offer">("custom");
    const [offerText, setOfferText] = useState("");
    const [offerHasExpiration, setOfferHasExpiration] = useState(true);
    const [addSecurityRecommendation, setAddSecurityRecommendation] = useState(true);
    const [codeExpirationMinutes, setCodeExpirationMinutes] = useState("");
    const [otpType, setOtpType] = useState<"COPY_CODE" | "ONE_TAP">("COPY_CODE");
    const [packageName, setPackageName] = useState("");
    const [signatureHash, setSignatureHash] = useState("");
    const { snapshot } = useServiceSnapshot();
    const limitedOffer = category === "MARKETING" && marketingKind === "limited_time_offer";
    const buttonCap = limitedOffer ? 2 : 10;

    useEffect(() => {
        if (snapshot?.attendanceMode !== "service") return;
        setName((current) => (current === "pedido_saiu_entrega" ? "lembrete_horario" : current));
        setBodyText((current) =>
            current === "Olá {{1}}! Seu pedido #{{2}} saiu para entrega."
                ? "Olá {{1}}! Seu horário de {{2}} está confirmado."
                : current
        );
        setExample2((current) => (current === "1042" ? "terça 14h" : current));
    }, [snapshot?.attendanceMode]);

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
                setErr(
                    formatMetaClientError(
                        json.error,
                        json.hint,
                        "Falha ao carregar templates."
                    )
                );
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
                setErr(
                    formatMetaClientError(
                        json.error,
                        json.hint,
                        "Falha ao sincronizar."
                    )
                );
                return;
            }
            setTemplates(json.templates ?? []);
            setMsg(`Sincronizados ${json.synced ?? 0} modelo(s) da Meta.`);
        } finally {
            setSyncing(false);
        }
    }

    function cleanedButtons(drafts: ButtonDraft[]) {
        return drafts
            .map((button) => {
                if (button.type === "QUICK_REPLY") {
                    return button.text.trim()
                        ? { type: "QUICK_REPLY" as const, text: button.text.trim() }
                        : null;
                }
                if (button.type === "URL") {
                    return button.text.trim() && button.url.trim()
                        ? { type: "URL" as const, text: button.text.trim(), url: button.url.trim() }
                        : null;
                }
                if (button.type === "COPY_CODE") {
                    return button.example.trim()
                        ? { type: "COPY_CODE" as const, example: button.example.trim() }
                        : null;
                }
                return button.text.trim() && button.phoneNumber.trim()
                    ? {
                          type: "PHONE_NUMBER" as const,
                          text: button.text.trim(),
                          phoneNumber: button.phoneNumber.trim(),
                      }
                    : null;
            })
            .filter((button) => button != null);
    }

    async function submit() {
        setSaving(true);
        setMsg(null);
        setErr(null);
        try {
            if (category === "AUTHENTICATION" && codeExpirationMinutes.trim()) {
                const minutes = Number(codeExpirationMinutes);
                if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) {
                    setErr("A validade fica entre 1 e 90 minutos.");
                    return;
                }
            }
            const examples = [example1, example2].filter((v) => v.trim());
            const payload =
                category === "AUTHENTICATION"
                    ? {
                          name: name.trim(),
                          language: language.trim() || "pt_BR",
                          category,
                          addSecurityRecommendation,
                          codeExpirationMinutes: codeExpirationMinutes.trim()
                              ? Number(codeExpirationMinutes)
                              : undefined,
                          otpType,
                          packageName: packageName.trim() || undefined,
                          signatureHash: signatureHash.trim() || undefined,
                      }
                    : {
                          name: name.trim(),
                          language: language.trim() || "pt_BR",
                          category,
                          marketingKind: category === "MARKETING" ? marketingKind : "custom",
                          offerText: limitedOffer ? offerText.trim() : undefined,
                          offerHasExpiration: limitedOffer ? offerHasExpiration : undefined,
                          headerText: limitedOffer ? undefined : headerText.trim() || undefined,
                          headerExample: limitedOffer ? undefined : headerExample.trim() || undefined,
                          bodyText: bodyText.trim(),
                          footerText: limitedOffer ? undefined : footerText.trim() || undefined,
                          exampleBodyValues: examples.length ? examples : undefined,
                          buttons: cleanedButtons(buttons),
                      };

            const res = await fetch("/api/admin/whatsapp-templates/submit", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = (await res.json().catch(() => ({}))) as {
                template?: TemplateRow;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(
                    formatMetaClientError(
                        json.error,
                        json.hint,
                        "Falha ao criar template."
                    )
                );
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
        if (buttons.length >= buttonCap) return;
        if (limitedOffer && type !== "URL" && type !== "COPY_CODE") return;
        if (type === "QUICK_REPLY") setButtons((b) => [...b, { type, text: "" }]);
        else if (type === "URL") setButtons((b) => [...b, { type, text: "", url: "" }]);
        else if (type === "COPY_CODE") setButtons((b) => [...b, { type, example: "" }]);
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
                        Os campos mudam conforme a categoria da Meta. A sincronização atualiza PENDING, APPROVED e REJECTED.
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
                        <Select
                            value={category}
                            onValueChange={(v) => setCategory(v as typeof category)}
                        >
                            <SelectTrigger aria-label="Categoria do template">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="UTILITY">Utilidade</SelectItem>
                                <SelectItem value="MARKETING">Marketing</SelectItem>
                                <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                            </SelectContent>
                        </Select>
                    </label>
                    <p className="text-sm text-zinc-500 sm:col-span-2">
                        {category === "UTILITY"
                            ? "Confirmação ou atualização. Cabeçalho, corpo, rodapé e até 10 botões: resposta, link, telefone ou código."
                            : category === "MARKETING"
                              ? "Promoção. Personalizado leva os mesmos blocos, com até 10 botões. Oferta por tempo limitado troca o rodapé pelo texto de 16 caracteres."
                              : "O texto do código é fixo da Meta. Você escolhe o aviso de segurança, a validade e o botão de copiar ou preencher."}
                    </p>
                    {category === "MARKETING" ? (
                        <div className="sm:col-span-2">
                            <p className="mb-1 text-sm text-zinc-600">Formato</p>
                            <ToggleGroup
                                type="single"
                                value={marketingKind}
                                onValueChange={(value) => {
                                    if (value !== "custom" && value !== "limited_time_offer") return;
                                    setMarketingKind(value);
                                    if (value === "limited_time_offer") {
                                        setButtons((current) =>
                                            current.filter((button) => button.type === "URL" || button.type === "COPY_CODE")
                                        );
                                    }
                                }}
                                className="justify-start"
                                aria-label="Formato do marketing"
                            >
                                <ToggleGroupItem value="custom" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                    Personalizado
                                </ToggleGroupItem>
                                <ToggleGroupItem value="limited_time_offer" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                    Oferta por tempo limitado
                                </ToggleGroupItem>
                            </ToggleGroup>
                        </div>
                    ) : null}
                    {category === "AUTHENTICATION" ? (
                        <>
                            <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
                                <span>Aviso “não compartilhe este código”</span>
                                <Switch
                                    checked={addSecurityRecommendation}
                                    onCheckedChange={setAddSecurityRecommendation}
                                    aria-label="Aviso de segurança"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block text-zinc-600">Validade em minutos (1 a 90, vazio sem aviso)</span>
                                <input
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                                    value={codeExpirationMinutes}
                                    onChange={(e) => setCodeExpirationMinutes(e.target.value.replace(/\D/g, "").slice(0, 2))}
                                />
                            </label>
                            <div className="sm:col-span-2">
                                <p className="mb-1 text-sm text-zinc-600">Botão do código</p>
                                <ToggleGroup
                                    type="single"
                                    value={otpType}
                                    onValueChange={(value) => {
                                        if (value === "COPY_CODE" || value === "ONE_TAP") setOtpType(value);
                                    }}
                                    className="justify-start"
                                    aria-label="Tipo do botão de autenticação"
                                >
                                    <ToggleGroupItem value="COPY_CODE" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                        Copiar código
                                    </ToggleGroupItem>
                                    <ToggleGroupItem value="ONE_TAP" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                        Preencher no Android
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            </div>
                            {otpType === "ONE_TAP" ? (
                                <>
                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600">Pacote Android</span>
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                            value={packageName}
                                            onChange={(e) => setPackageName(e.target.value)}
                                            placeholder="com.empresa.app"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600">Assinatura do app (11 caracteres)</span>
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                                            value={signatureHash}
                                            onChange={(e) => setSignatureHash(e.target.value)}
                                            maxLength={11}
                                        />
                                    </label>
                                </>
                            ) : null}
                        </>
                    ) : (
                        <>
                            {limitedOffer ? (
                                <>
                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600">Texto da oferta (máx. 16)</span>
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                            value={offerText}
                                            maxLength={16}
                                            onChange={(e) => setOfferText(e.target.value)}
                                        />
                                    </label>
                                    <label className="flex items-center justify-between gap-3 text-sm">
                                        <span>Mostrar o prazo</span>
                                        <Switch
                                            checked={offerHasExpiration}
                                            onCheckedChange={setOfferHasExpiration}
                                            aria-label="Mostrar o prazo da oferta"
                                        />
                                    </label>
                                </>
                            ) : (
                                <>
                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600">Rodapé (opcional, máx. 60)</span>
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                            value={footerText}
                                            maxLength={60}
                                            onChange={(e) => setFooterText(e.target.value)}
                                        />
                                    </label>
                                    <label className="block text-sm sm:col-span-2">
                                        <span className="mb-1 block text-zinc-600">Cabeçalho em texto (opcional, máx. 60)</span>
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                            value={headerText}
                                            maxLength={60}
                                            onChange={(e) => setHeaderText(e.target.value)}
                                            placeholder="Ex.: Pedido {{1}}"
                                        />
                                    </label>
                                    {headerText.includes("{{") ? (
                                        <label className="block text-sm sm:col-span-2">
                                            <span className="mb-1 block text-zinc-600">Exemplo do cabeçalho</span>
                                            <input
                                                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                                value={headerExample}
                                                onChange={(e) => setHeaderExample(e.target.value)}
                                            />
                                        </label>
                                    ) : null}
                                </>
                            )}
                            <label className="block text-sm sm:col-span-2">
                                <span className="mb-1 block text-zinc-600">Corpo (use {"{{1}}"}, {"{{2}}"}…)</span>
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
                        </>
                    )}
                </div>

                {category === "AUTHENTICATION" ? null : (
                <div className="mt-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Botões (até {buttonCap})
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {limitedOffer ? null : (
                                <button
                                    type="button"
                                    disabled={buttons.length >= buttonCap}
                                    onClick={() => addButton("QUICK_REPLY")}
                                    className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                                >
                                    + Resposta rápida
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={buttons.length >= buttonCap}
                                onClick={() => addButton("URL")}
                                className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                            >
                                + URL
                            </button>
                            {limitedOffer ? null : (
                                <button
                                    type="button"
                                    disabled={buttons.length >= buttonCap}
                                    onClick={() => addButton("PHONE_NUMBER")}
                                    className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                                >
                                    + Telefone
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={buttons.length >= buttonCap}
                                onClick={() => addButton("COPY_CODE")}
                                className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                            >
                                + Código
                            </button>
                        </div>
                    </div>
                    {buttons.map((b, idx) => (
                        <div
                            key={`${b.type}-${idx}`}
                            className="grid gap-2 rounded-lg border border-zinc-100 p-3 sm:grid-cols-[1fr_1fr_auto] dark:border-zinc-800"
                        >
                            {b.type === "COPY_CODE" ? (
                                <input
                                    className="rounded-lg border border-zinc-200 px-2 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    placeholder="Exemplo do código"
                                    maxLength={15}
                                    value={b.example}
                                    onChange={(e) => {
                                        const example = e.target.value;
                                        setButtons((prev) =>
                                            prev.map((x, i) =>
                                                i === idx && x.type === "COPY_CODE" ? { ...x, example } : x
                                            )
                                        );
                                    }}
                                />
                            ) : (
                            <input
                                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                placeholder="Texto do botão"
                                maxLength={25}
                                value={b.text}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    setButtons((prev) =>
                                        prev.map((x, i) =>
                                            i === idx && x.type !== "COPY_CODE" ? { ...x, text } : x
                                        )
                                    );
                                }}
                            />
                            )}
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
                        {limitedOffer
                            ? "A oferta por tempo limitado não tem rodapé. Cabeçalho de imagem ou vídeo pede o arquivo na Meta antes, então fica no Gerenciador."
                            : "Cabeçalho de imagem, vídeo ou documento pede o arquivo na Meta antes. Esse envio fica no Gerenciador; depois é só sincronizar."}
                    </p>
                </div>
                )}

                <button
                    type="button"
                    disabled={
                        saving ||
                        !name.trim() ||
                        (category !== "AUTHENTICATION" && !bodyText.trim()) ||
                        (limitedOffer && !offerText.trim()) ||
                        (category === "AUTHENTICATION" &&
                            otpType === "ONE_TAP" &&
                            (!packageName.trim() || signatureHash.trim().length !== 11))
                    }
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
                                    {t.status === "REJECTED" && t.rejectionReason ? (
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
