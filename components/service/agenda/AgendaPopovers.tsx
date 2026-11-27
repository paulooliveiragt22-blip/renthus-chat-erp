"use client";

import { useEffect, useRef, useState } from "react";
import { cva } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type OfferingChoice = { id: string; name: string; duration_min: number | null };
type ContactHit = { name: string; phone: string; source: "cliente" | "conversa" };

const DURATIONS = [15, 30, 60] as const;

const toneDot = cva("h-1.5 w-1.5 shrink-0 rounded-full", {
    variants: {
        tone: {
            sky: "bg-sky-500",
            emerald: "bg-emerald-500",
            amber: "bg-amber-500",
            violet: "bg-violet-500",
            rose: "bg-rose-500",
            cyan: "bg-cyan-500",
        },
    },
});

export const eventTone = cva("", {
    variants: {
        tone: {
            sky: "border-l-sky-500 bg-sky-500/10 text-sky-900 dark:text-sky-100",
            emerald: "border-l-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
            amber: "border-l-amber-500 bg-amber-500/10 text-amber-950 dark:text-amber-100",
            violet: "border-l-violet-500 bg-violet-500/10 text-violet-950 dark:text-violet-100",
            rose: "border-l-rose-500 bg-rose-500/10 text-rose-950 dark:text-rose-100",
            cyan: "border-l-cyan-500 bg-cyan-500/10 text-cyan-950 dark:text-cyan-100",
            google: "border-l-sky-500/80 bg-sky-500/5 text-zinc-900 dark:text-zinc-50",
        },
    },
});

export type Tone = "sky" | "emerald" | "amber" | "violet" | "rose" | "cyan" | "google";
type OfferingTone = Exclude<Tone, "google">;

const TONES: OfferingTone[] = ["sky", "emerald", "amber", "violet", "rose", "cyan"];

export function toneFor(name: string): OfferingTone {
    let hash = 0;
    for (let index = 0; index < name.length; index += 1) hash = (hash + name.charCodeAt(index)) % TONES.length;
    return TONES[hash] ?? "sky";
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function clockFromMinutes(minutes: number): string {
    const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

function Anchor({ rect }: { rect: DOMRect | null }) {
    if (!rect) return null;
    return (
        <PopoverAnchor asChild>
            <span
                className="pointer-events-none fixed"
                style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) }}
            />
        </PopoverAnchor>
    );
}

export function QuickCreatePopover({
    open,
    rect,
    dayLabel,
    minutes,
    offerings,
    error,
    onOpenChange,
    onSave,
}: {
    open: boolean;
    rect: DOMRect | null;
    dayLabel: string;
    minutes: number;
    offerings: OfferingChoice[];
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onSave: (input: {
        offeringId: string | null;
        durationMin: (typeof DURATIONS)[number];
        minutes: number;
        phone: string;
        customerName: string;
        label: string;
    }) => void;
}) {
    const [offeringId, setOfferingId] = useState("");
    const [chosenDuration, setChosenDuration] = useState<(typeof DURATIONS)[number]>(30);
    const [start, setStart] = useState(minutes);
    const [title, setTitle] = useState("");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [hits, setHits] = useState<ContactHit[]>([]);
    const picked = useRef("");

    useEffect(() => {
        if (!open) return;
        setStart(minutes);
        setTitle("");
        setName("");
        setPhone("");
        setHits([]);
        picked.current = "";
        setOfferingId("");
        setChosenDuration(30);
    }, [open, minutes]);

    useEffect(() => {
        if (!open) return;
        if (picked.current === `${name.trim()}|${phone.trim()}`) return;
        const query = (name.trim().length >= 2 ? name : phone).trim();
        if (query.length < 2) {
            setHits([]);
            return;
        }
        const handle = window.setTimeout(() => {
            void fetch(`/api/admin/service/contacts?q=${encodeURIComponent(query)}`, { credentials: "include" })
                .then((res) => res.json())
                .then((json: { contacts?: ContactHit[] }) => {
                    setHits(Array.isArray(json.contacts) ? json.contacts : []);
                })
                .catch(() => setHits([]));
        }, 200);
        return () => window.clearTimeout(handle);
    }, [open, name, phone]);

    const offering = offerings.find((row) => row.id === offeringId) ?? null;
    const duration = offering?.duration_min ?? chosenDuration;

    function pickDuration(value: string) {
        const minutesWanted = Number(value);
        if (minutesWanted !== 15 && minutesWanted !== 30 && minutesWanted !== 60) return;
        setOfferingId("");
        setChosenDuration(minutesWanted);
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <Anchor rect={rect} />
            <PopoverContent
                className="w-[22rem]"
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    const field = document.getElementById("agenda-quick-title");
                    if (field instanceof HTMLInputElement) field.focus();
                }}
            >
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const chip = duration === 15 || duration === 30 || duration === 60 ? duration : chosenDuration;
                        onSave({
                            offeringId: offeringId || null,
                            durationMin: chip,
                            minutes: start,
                            phone: phone.trim(),
                            customerName: name.trim(),
                            label: title.trim(),
                        });
                    }}
                >
                    <div>
                        <p className="text-xs text-zinc-500">{dayLabel}</p>
                        <input
                            id="agenda-quick-title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Visita para orçamento"
                            aria-label="Título"
                            className="mt-1 w-full border-0 border-b border-zinc-200/80 bg-transparent py-1 text-sm outline-none focus-visible:border-zinc-400 dark:border-zinc-800/80"
                        />
                    </div>
                    {offerings.length > 0 ? (
                        <ToggleGroup
                            type="single"
                            value={offeringId}
                            onValueChange={setOfferingId}
                            className="flex flex-wrap justify-start gap-1"
                            aria-label="Oferta"
                        >
                            {offerings.map((row) => (
                                <ToggleGroupItem
                                    key={row.id}
                                    value={row.id}
                                    className="h-7 rounded-full border border-zinc-200/80 px-2 data-[state=on]:border-transparent data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-800/80 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900"
                                >
                                    <span className={toneDot({ tone: toneFor(row.name) })} aria-hidden />
                                    <span className="max-w-32 truncate">{row.name}</span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    ) : null}
                    <div className="flex items-center gap-2">
                        <input
                            type="time"
                            aria-label="Início"
                            value={clockFromMinutes(start)}
                            onChange={(event) => {
                                const [hour, minute] = event.target.value.split(":").map(Number);
                                if (Number.isFinite(hour) && Number.isFinite(minute)) setStart(hour! * 60 + minute!);
                            }}
                            className="rounded-md border border-zinc-200/80 bg-transparent px-2 py-1 font-mono text-xs tabular-nums dark:border-zinc-800/80"
                        />
                        <span className="text-xs text-zinc-400">até</span>
                        <span className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{clockFromMinutes(start + duration)}</span>
                    </div>
                    <ToggleGroup
                        type="single"
                        value={String(duration)}
                        onValueChange={pickDuration}
                        className="flex justify-start gap-1"
                        aria-label="Duração"
                    >
                        {DURATIONS.map((value) => (
                            <ToggleGroupItem
                                key={value}
                                value={String(value)}
                                className="h-7 rounded-full border border-zinc-200/80 px-2 font-mono tabular-nums data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-800/80 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900"
                            >
                                {value === 60 ? "1h" : `${value}m`}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Nome do cliente"
                        aria-label="Nome do cliente"
                        className="rounded-md border border-zinc-200/80 bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80"
                    />
                    <input
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="WhatsApp"
                        aria-label="WhatsApp"
                        className="rounded-md border border-zinc-200/80 bg-transparent px-2 py-1.5 font-mono text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80"
                    />
                    {hits.length === 0 ? (
                        <p className="text-[11px] text-zinc-400">Digite o nome ou o WhatsApp para vincular um cliente salvo ou uma conversa.</p>
                    ) : null}
                    {hits.length > 0 ? (
                        <ul role="listbox" aria-label="Contatos salvos" className="flex flex-col">
                            {hits.map((hit) => (
                                <li key={hit.phone}>
                                    <button
                                        type="button"
                                        role="option"
                                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800/50"
                                        onClick={() => {
                                            picked.current = `${hit.name}|${hit.phone}`;
                                            setName(hit.name);
                                            setPhone(hit.phone);
                                            setHits([]);
                                        }}
                                    >
                                        <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">{hit.name}</span>
                                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
                                            {hit.source === "cliente" ? "cliente" : "conversa"} {hit.phone}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
                    <Button type="submit" size="sm">
                        Salvar
                    </Button>
                </form>
            </PopoverContent>
        </Popover>
    );
}

export function EventPeek({
    open,
    rect,
    title,
    person,
    category,
    when,
    phone,
    originLabel,
    syncLabel,
    canEdit,
    initialStart,
    error,
    onOpenChange,
    onSaveTime,
    onCancel,
    googleHref,
}: {
    open: boolean;
    rect: DOMRect | null;
    title: string;
    person?: string;
    category: string;
    when: string;
    phone?: string;
    originLabel: string;
    syncLabel: string | null;
    canEdit: boolean;
    initialStart: string;
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onSaveTime: (value: string) => void;
    onCancel: () => void;
    googleHref: string | null;
}) {
    const [editing, setEditing] = useState(false);
    const [start, setStart] = useState("");

    useEffect(() => {
        if (!open) setEditing(false);
    }, [open]);

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <Anchor rect={rect} />
            <PopoverContent className="w-80">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</p>
                {person ? <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{person}</p> : null}
                <p className="mt-1 text-xs text-zinc-500">{category}</p>
                <p className="mt-2 font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-200">{when}</p>
                <p className="mt-2 text-xs text-zinc-500">{originLabel}</p>
                {phone ? <p className="font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-200">{phone}</p> : null}
                {syncLabel ? <p className="mt-1 text-xs text-zinc-500">{syncLabel}</p> : null}
                {editing ? (
                    <form
                        className="mt-3 flex items-center gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (start) onSaveTime(start);
                        }}
                    >
                        <input
                            type="datetime-local"
                            aria-label="Novo horário"
                            value={start}
                            onChange={(event) => setStart(event.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-zinc-200/80 bg-transparent px-2 py-1 font-mono text-xs tabular-nums dark:border-zinc-800/80"
                        />
                        <Button type="submit" size="sm">
                            Salvar
                        </Button>
                    </form>
                ) : null}
                {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                    {canEdit && !editing ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setStart(initialStart);
                                setEditing(true);
                            }}
                        >
                            Editar horário
                        </Button>
                    ) : null}
                    {canEdit ? (
                        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
                            Excluir
                        </Button>
                    ) : null}
                    {googleHref ? (
                        <Button type="button" size="sm" variant="outline" asChild>
                            <a href={googleHref} target="_blank" rel="noreferrer">
                                Abrir no Google
                            </a>
                        </Button>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}
