"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceFaqPanel } from "@/components/service/ServiceFaqPanel";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { siteChatPageUrl } from "@/src/service/domain/siteChat";
import type { ServicePreset } from "@/src/service/domain/types";

const PRESETS: { value: ServicePreset; label: string }[] = [
    { value: "horario", label: "Horário — clínica, salão" },
    { value: "servico", label: "Serviço — oficina, móveis, serralheria" },
    { value: "consulta_caso", label: "Consulta e caso — advogado, arquiteto" },
    { value: "balcao", label: "Balcão — sem hora e sem card" },
];

export default function AtendimentoPage() {
    const { snapshot, loading, reload } = useServiceSnapshot();
    const [preset, setPreset] = useState<ServicePreset>("horario");
    const [contextText, setContextText] = useState("");
    const [cancelEnabled, setCancelEnabled] = useState(false);
    const [rescheduleEnabled, setRescheduleEnabled] = useState(false);
    const [replies, setReplies] = useState(["", "", ""]);
    const [message, setMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!snapshot) return;
        if (snapshot.preset) setPreset(snapshot.preset);
        setContextText(snapshot.contextText);
        setCancelEnabled(snapshot.cancelEnabled);
        setRescheduleEnabled(snapshot.rescheduleEnabled);
        setReplies([
            snapshot.siteChatReplies[0] ?? "",
            snapshot.siteChatReplies[1] ?? "",
            snapshot.siteChatReplies[2] ?? "",
        ]);
    }, [snapshot]);

    async function post(body: unknown) {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/service/profile", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = (await res.json().catch(() => ({}))) as { code?: string };
            setMessage(res.ok ? "Salvo." : (json.code ?? "Não foi possível salvar."));
            reload();
        } finally {
            setSaving(false);
        }
    }

    if (loading || !snapshot) {
        return (
            <div className="flex flex-col gap-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-28 w-full" />
            </div>
        );
    }

    if (snapshot.attendanceMode !== "service") {
        return (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Esta empresa está no modo delivery. O modelo de serviço é escolhido no cadastro.
            </p>
        );
    }

    const agendaOn = snapshot.agendaEnabled;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Atendimento</h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    O modelo liga a agenda e os cards. O texto abaixo é o que o atendente sabe sobre a empresa.
                </p>
            </div>

            <label className="flex flex-col gap-2 text-sm text-zinc-800 dark:text-zinc-100">
                Modelo
                <Select value={preset} onValueChange={(value) => setPreset(value as ServicePreset)}>
                    <SelectTrigger aria-label="Modelo de atendimento">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PRESETS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </label>
            <Button type="button" disabled={saving} onClick={() => void post({ action: "preset", preset })}>
                Trocar modelo
            </Button>

            <label className="flex flex-col gap-2 text-sm text-zinc-800 dark:text-zinc-100">
                Contexto
                <textarea
                    value={contextText}
                    maxLength={4000}
                    onChange={(event) => setContextText(event.target.value)}
                    className="min-h-36 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                />
            </label>
            <Button type="button" disabled={saving} onClick={() => void post({ action: "context", contextText })}>
                Salvar contexto
            </Button>

            <ServiceFaqPanel />

            {snapshot.siteChatKey ? (
                <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Chat do site</p>
                    <p className="break-all text-sm text-zinc-600 dark:text-zinc-300">{siteChatPageUrl(snapshot.siteChatKey)}</p>
                    {replies.map((reply, index) => (
                        <label key={index} className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100">
                            {`Resposta rápida ${index + 1}`}
                            <input
                                value={reply}
                                maxLength={80}
                                onChange={(event) => {
                                    const next = [...replies];
                                    next[index] = event.target.value;
                                    setReplies(next);
                                }}
                                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                            />
                        </label>
                    ))}
                    <Button
                        type="button"
                        disabled={saving}
                        onClick={() => void post({
                            action: "replies",
                            replies: replies.map((item) => item.trim()).filter((item) => item.length > 0),
                        })}
                    >
                        Salvar respostas
                    </Button>
                </div>
            ) : null}

            {snapshot.siteContacts.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Contatos do chat</p>
                    <ul className="flex flex-col gap-2">
                        {snapshot.siteContacts.map((contact) => (
                            <li key={`${contact.phone}-${contact.at}`} className="min-w-0 text-sm text-zinc-700 dark:text-zinc-200">
                                <span className="block truncate font-medium">{contact.name}</span>
                                <span className="block truncate">{contact.phone}</span>
                                <span className="block truncate text-zinc-500 dark:text-zinc-400">{contact.interest}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <FlagRow
                    label="Cancelar pelo WhatsApp"
                    checked={cancelEnabled}
                    disabled={!agendaOn || saving}
                    onCheckedChange={setCancelEnabled}
                />
                <FlagRow
                    label="Remarcar pelo WhatsApp"
                    checked={rescheduleEnabled}
                    disabled={!agendaOn || saving}
                    onCheckedChange={setRescheduleEnabled}
                />
                <Button
                    type="button"
                    disabled={!agendaOn || saving}
                    onClick={() => void post({ action: "flags", cancelEnabled, rescheduleEnabled })}
                >
                    Salvar interruptores
                </Button>
            </div>
            {message ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p> : null}
        </div>
    );
}

function FlagRow({
    label,
    checked,
    disabled,
    onCheckedChange,
}: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (value: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-zinc-800 dark:text-zinc-100">{label}</span>
            <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={label} />
        </div>
    );
}
