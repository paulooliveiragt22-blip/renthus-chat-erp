"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Megaphone, RefreshCw } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { parseCampaignPhones } from "@/lib/campaigns/parsePhones";

type TemplateOpt = {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    components?: unknown;
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

type Person = { phone: string; name: string | null };
type Who = "everyone" | "recent" | "chosen";

const fieldClass =
    "w-full rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80 dark:bg-zinc-950";

function messageBody(components: unknown): string {
    if (!Array.isArray(components)) return "";
    for (const item of components) {
        if (!item || typeof item !== "object") continue;
        const row = item as { type?: string; text?: string };
        if (String(row.type ?? "").toUpperCase() === "BODY" && typeof row.text === "string") {
            return row.text;
        }
    }
    return "";
}

function blankCount(text: string): number {
    let max = 0;
    for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) {
        max = Math.max(max, Number(match[1]));
    }
    return max;
}

function humanName(name: string): string {
    const words = name.replace(/_/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanKind(category: string | null): string {
    if (category === "MARKETING") return "Promoção";
    if (category === "AUTHENTICATION") return "Código";
    if (category === "UTILITY") return "Aviso";
    return "Mensagem";
}

function humanStatus(status: string): string {
    if (status === "running") return "Enviando";
    if (status === "paused") return "Pausada";
    if (status === "cancelled") return "Cancelada";
    if (status === "done") return "Enviada";
    return status;
}

function showPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length === 13) {
        return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    return phone;
}

function explainError(error?: string, hint?: string): string {
    if (error === "no_opt_in_audience") {
        return "Ninguém dessa lista pediu para receber ofertas. Peça que a pessoa escreva QUERO OFERTAS no seu WhatsApp.";
    }
    if (error === "empty_audience") return "Nenhum WhatsApp válido nessa lista.";
    if (error === "template_not_approved") return "Essa mensagem ainda não foi aprovada.";
    if (error === "no_active_channel") return "Conecte o WhatsApp antes de enviar.";
    return hint || "Não foi possível enviar.";
}

export default function CampaignsClient() {
    const { snapshot } = useServiceSnapshot();
    const serviceMode = snapshot?.attendanceMode === "service";
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
    const [templates, setTemplates] = useState<TemplateOpt[]>([]);
    const [name, setName] = useState("");
    const [templateId, setTemplateId] = useState("");
    const [who, setWho] = useState<Who>("everyone");
    const [orderedLastDays, setOrderedLastDays] = useState(30);
    const [params, setParams] = useState<string[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [paste, setPaste] = useState("");
    const [query, setQuery] = useState("");
    const [contacts, setContacts] = useState<Person[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (serviceMode && who === "recent") setWho("everyone");
    }, [serviceMode, who]);

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
                setErr(cJson.hint || cJson.error || "Não consegui carregar as mensagens.");
                return;
            }
            if (!tRes.ok) {
                setErr(tJson.hint || tJson.error || "Não consegui carregar as mensagens prontas.");
                return;
            }
            setCampaigns(cJson.campaigns ?? []);
            const approved = (tJson.templates ?? []).filter((t) => t.status === "APPROVED");
            setTemplates(approved);
            setTemplateId((current) => current || approved[0]?.id || "");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const selectedTpl = templates.find((t) => t.id === templateId) ?? null;
    const body = messageBody(selectedTpl?.components);
    const slots = blankCount(body);
    const promotion = selectedTpl?.category === "MARKETING";
    const codeMessage = selectedTpl?.category === "AUTHENTICATION";

    useEffect(() => {
        setParams((prev) => Array.from({ length: slots }, (_, index) => prev[index] ?? ""));
    }, [slots, templateId]);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setContacts([]);
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setSearching(true);
            void fetch(`/api/admin/campaigns/contacts?q=${encodeURIComponent(q)}`, {
                credentials: "include",
                cache: "no-store",
                signal: controller.signal,
            })
                .then(async (res) => {
                    const json = (await res.json().catch(() => ({}))) as {
                        contacts?: Array<{ name: string; phone: string }>;
                    };
                    if (!res.ok) return;
                    setContacts(
                        (json.contacts ?? []).map((contact) => ({
                            phone: contact.phone,
                            name: contact.name,
                        }))
                    );
                })
                .catch((error: unknown) => {
                    if (error instanceof DOMException && error.name === "AbortError") return;
                })
                .finally(() => {
                    if (!controller.signal.aborted) setSearching(false);
                });
        }, 250);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    function addPeople(next: Person[]) {
        setPeople((current) => {
            const seen = new Set(current.map((person) => person.phone));
            const merged = [...current];
            for (const person of next) {
                if (seen.has(person.phone)) continue;
                seen.add(person.phone);
                merged.push(person);
            }
            return merged.slice(0, 500);
        });
    }

    function addPasted() {
        const phones = parseCampaignPhones(paste);
        addPeople(phones.map((phone) => ({ phone, name: null })));
        setPaste("");
    }

    const missingBlank = params.some((value) => value.trim() === "");
    const canSend =
        Boolean(templateId) &&
        !codeMessage &&
        !missingBlank &&
        (who !== "chosen" || people.length > 0);

    async function start() {
        setStarting(true);
        setMsg(null);
        setErr(null);
        try {
            const res = await fetch("/api/admin/campaigns", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim() || "Mensagem",
                    templateId,
                    audienceMode:
                        who === "chosen"
                            ? "selected"
                            : who === "recent"
                              ? "ordered_last_days"
                              : "all_with_phone",
                    orderedLastDays: who === "recent" ? orderedLastDays : undefined,
                    phones: who === "chosen" ? people.map((person) => person.phone) : undefined,
                    bodyParams: slots > 0 ? params.map((value) => value.trim()) : undefined,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                queued?: number;
                leftOut?: number;
                error?: string;
                hint?: string;
            };
            if (!res.ok) {
                setErr(explainError(json.error, json.hint));
                return;
            }
            const queued = json.queued ?? 0;
            const leftOut = json.leftOut ?? 0;
            const sent =
                queued === 1 ? "1 pessoa vai receber." : `${queued} pessoas vão receber.`;
            const aside =
                leftOut > 0
                    ? ` ${leftOut} ficaram de fora porque ainda não pediram ofertas.`
                    : "";
            setMsg(`Pronto. ${sent}${aside}`);
            setPeople([]);
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
            setErr(json.error === "not_cancellable" ? "Essa leva já terminou." : "Não consegui cancelar.");
            return;
        }
        setMsg("Envio cancelado. Quem ainda não recebeu fica de fora.");
        await load();
    }

    const whoHint = useMemo(() => {
        if (who === "chosen") {
            return people.length === 1
                ? "1 pessoa na lista."
                : `${people.length} pessoas na lista.`;
        }
        if (who === "recent") {
            return `Clientes que compraram nos últimos ${orderedLastDays} dias.`;
        }
        return "Todo cliente que já tem WhatsApp salvo.";
    }, [orderedLastDays, people.length, who]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando…
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Mensagens para vários clientes
                    </h1>
                    <p className="mt-1 max-w-prose text-sm text-zinc-500">
                        Escolha uma mensagem já aprovada e quem vai receber. Promoção só chega em
                        quem escreveu QUERO OFERTAS.
                    </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="h-4 w-4" />
                    Atualizar
                </Button>
            </div>

            {err ? (
                <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200" role="alert">
                    {err}
                </p>
            ) : null}
            {msg ? (
                <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200" role="status">
                    {msg}
                </p>
            ) : null}

            <section className="space-y-5 rounded-xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-950">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Megaphone className="h-4 w-4" />
                    Nova leva
                </h2>
                {templates.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                        Nenhuma mensagem aprovada ainda. Peça a aprovação em{" "}
                        <a href="/templates" className="underline">
                            Mensagens prontas
                        </a>
                        .
                    </p>
                ) : (
                    <div className="space-y-5">
                        <label className="block text-sm">
                            <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                Nome desta leva
                            </span>
                            <input
                                className={fieldClass}
                                value={name}
                                placeholder="Oferta de sexta"
                                onChange={(event) => setName(event.target.value)}
                            />
                        </label>

                        <div className="block text-sm">
                            <label htmlFor="campaign-message" className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                Qual mensagem
                            </label>
                            <Select value={templateId || undefined} onValueChange={setTemplateId}>
                                <SelectTrigger id="campaign-message" className="w-full">
                                    <SelectValue placeholder="Escolha a mensagem" />
                                </SelectTrigger>
                                <SelectContent>
                                    {templates.map((template) => (
                                        <SelectItem key={template.id} value={template.id}>
                                            {humanName(template.name)} · {humanKind(template.category)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {body ? (
                            <p className="rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800/80 dark:bg-zinc-900/50 dark:text-zinc-200">
                                {body}
                            </p>
                        ) : null}

                        {promotion ? (
                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                Isto é uma promoção. Só recebe quem já pediu ofertas no seu WhatsApp.
                            </p>
                        ) : null}
                        {codeMessage ? (
                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                Isto é um código de acesso. Não serve para avisar vários clientes.
                            </p>
                        ) : null}

                        {slots > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {params.map((value, index) => (
                                    <label key={index} className="block text-sm">
                                        <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                            Texto do {index + 1}º espaço
                                        </span>
                                        <input
                                            className={fieldClass}
                                            value={value}
                                            onChange={(event) =>
                                                setParams((current) =>
                                                    current.map((item, itemIndex) =>
                                                        itemIndex === index ? event.target.value : item
                                                    )
                                                )
                                            }
                                        />
                                    </label>
                                ))}
                            </div>
                        ) : null}

                        <fieldset className="space-y-3">
                            <legend className="text-sm text-zinc-600 dark:text-zinc-300">
                                Quem recebe
                            </legend>
                            <ToggleGroup
                                type="single"
                                value={who}
                                onValueChange={(value) => {
                                    if (value === "everyone" || value === "recent" || value === "chosen") {
                                        setWho(value);
                                    }
                                }}
                                className="flex flex-wrap justify-start gap-2"
                            >
                                <ToggleGroupItem value="everyone" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                    Todos os clientes
                                </ToggleGroupItem>
                                {serviceMode ? null : (
                                    <ToggleGroupItem value="recent" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                        Quem comprou
                                    </ToggleGroupItem>
                                )}
                                <ToggleGroupItem value="chosen" className="h-8 rounded-full border border-zinc-200 px-3 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-700 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900">
                                    Pessoas que eu escolher
                                </ToggleGroupItem>
                            </ToggleGroup>
                            <p className="text-sm text-zinc-500">{whoHint}</p>

                            {who === "recent" ? (
                                <label className="block max-w-xs text-sm">
                                    <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                        Nos últimos quantos dias
                                    </span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        className={fieldClass}
                                        value={orderedLastDays}
                                        onChange={(event) =>
                                            setOrderedLastDays(Number(event.target.value) || 30)
                                        }
                                    />
                                </label>
                            ) : null}

                            {who === "chosen" ? (
                                <div className="space-y-3">
                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                            Buscar cliente
                                        </span>
                                        <input
                                            className={fieldClass}
                                            value={query}
                                            placeholder="Nome ou WhatsApp"
                                            onChange={(event) => setQuery(event.target.value)}
                                        />
                                    </label>
                                    {searching ? (
                                        <p className="text-sm text-zinc-500">Procurando…</p>
                                    ) : null}
                                    {contacts.length > 0 ? (
                                        <ul className="overflow-hidden rounded-lg border border-zinc-200/80 dark:border-zinc-800/80">
                                            {contacts.map((contact) => (
                                                <li key={contact.phone}>
                                                    <button
                                                        type="button"
                                                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800/50"
                                                        onClick={() => addPeople([contact])}
                                                    >
                                                        <span className="truncate">{contact.name}</span>
                                                        <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
                                                            {showPhone(contact.phone)}
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                    {query.trim().length >= 2 && !searching && contacts.length === 0 ? (
                                        <p className="text-sm text-zinc-500">
                                            Nenhum cliente com esse nome ou número.
                                        </p>
                                    ) : null}

                                    <label className="block text-sm">
                                        <span className="mb-1 block text-zinc-600 dark:text-zinc-300">
                                            Ou cole vários WhatsApps
                                        </span>
                                        <textarea
                                            className={`${fieldClass} min-h-24 resize-y`}
                                            value={paste}
                                            placeholder={"Um por linha\n65 99999-0000"}
                                            onChange={(event) => setPaste(event.target.value)}
                                        />
                                    </label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={parseCampaignPhones(paste).length === 0}
                                        onClick={addPasted}
                                    >
                                        Colocar na lista
                                    </Button>

                                    {people.length > 0 ? (
                                        <ul className="flex flex-wrap gap-2">
                                            {people.map((person) => (
                                                <li
                                                    key={person.phone}
                                                    className="flex max-w-full items-center gap-2 rounded-full border border-zinc-200/80 py-1 pl-3 pr-1 text-sm dark:border-zinc-800/80"
                                                >
                                                    <span className="truncate">
                                                        {person.name ?? "WhatsApp"}
                                                    </span>
                                                    <span className="font-mono text-xs tabular-nums text-zinc-500">
                                                        {showPhone(person.phone)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="rounded-full px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800"
                                                        aria-label={`Tirar ${person.name ?? showPhone(person.phone)}`}
                                                        onClick={() =>
                                                            setPeople((current) =>
                                                                current.filter(
                                                                    (item) => item.phone !== person.phone
                                                                )
                                                            )
                                                        }
                                                    >
                                                        Tirar
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            ) : null}
                        </fieldset>

                        <Button type="button" disabled={starting || !canSend} onClick={() => void start()}>
                            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                            Enviar agora
                        </Button>
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-950">
                <h2 className="mb-3 text-sm font-semibold">O que já foi enviado</h2>
                {campaigns.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nenhuma leva ainda.</p>
                ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {campaigns.map((campaign) => (
                            <li
                                key={campaign.id}
                                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                            >
                                <div className="min-w-0">
                                    <p className="truncate font-medium">
                                        {campaign.name}{" "}
                                        <span className="rounded-full border border-zinc-200/80 px-2 py-0.5 text-xs font-normal text-zinc-500 dark:border-zinc-700">
                                            {humanStatus(campaign.status)}
                                        </span>
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        {campaign.templateName
                                            ? `${humanName(campaign.templateName)} · ${humanKind(campaign.templateCategory)}`
                                            : "Mensagem"}
                                        {" · "}
                                        <span className="font-mono tabular-nums">
                                            {campaign.sentCount}/{campaign.totalRecipients}
                                        </span>{" "}
                                        receberam
                                        {campaign.failedCount > 0
                                            ? ` · ${campaign.failedCount} falhas`
                                            : ""}
                                        {campaign.skippedCount > 0
                                            ? ` · ${campaign.skippedCount} ficaram de fora`
                                            : ""}
                                    </p>
                                </div>
                                {campaign.status === "running" ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void cancel(campaign.id)}
                                    >
                                        Parar
                                    </Button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
