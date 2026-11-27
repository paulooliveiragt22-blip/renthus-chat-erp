"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GoogleCalendarConnect } from "@/components/service/GoogleCalendarConnect";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { cn } from "@/lib/utils";

type LocalRow = {
    id: string;
    offering_name: string;
    starts_at: string;
    ends_at?: string;
    phone_e164: string;
    customer_name: string | null;
    google_sync?: string | null;
};

type GoogleEvent = {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
};

type AgendaItem = {
    key: string;
    title: string;
    detail: string;
    when: string;
    sort: number;
    day: string;
    appointmentId?: string;
    failed?: boolean;
};

const WEEKDAYS = [
    { id: "dom", label: "D" },
    { id: "seg", label: "S" },
    { id: "ter", label: "T" },
    { id: "qua", label: "Q" },
    { id: "qui", label: "Q" },
    { id: "sex", label: "S" },
    { id: "sab", label: "S" },
];

function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function keyFromIso(iso: string): string {
    const dateOnly = /^(\d{4}-\d{2}-\d{2})T00:00:00$/u.exec(iso);
    if (dateOnly?.[1] && !iso.includes("+") && !iso.endsWith("Z")) return dateOnly[1];
    return dayKey(new Date(iso));
}

function monthCells(cursor: Date): Date[] {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
    });
}

function clock(iso: string): string {
    if (/T00:00:00$/u.test(iso) && !iso.endsWith("Z") && !iso.includes("+")) return "Dia inteiro";
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function AgendaPage() {
    const { snapshot, loading } = useServiceSnapshot();
    const [cursor, setCursor] = useState(() => new Date());
    const [selected, setSelected] = useState(() => dayKey(new Date()));
    const [items, setItems] = useState<AgendaItem[]>([]);
    const [googleNote, setGoogleNote] = useState<string | null>(null);
    const [offerings, setOfferings] = useState<{ id: string; name: string; duration_min: number | null }[]>([]);
    const [open, setOpen] = useState(false);
    const [offeringId, setOfferingId] = useState("");
    const [startsAt, setStartsAt] = useState("");
    const [phone, setPhone] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const cells = useMemo(() => monthCells(cursor), [cursor]);

    async function load(visible: Date[]) {
        const from = new Date(visible[0]!);
        from.setHours(0, 0, 0, 0);
        const to = new Date(visible[visible.length - 1]!);
        to.setDate(to.getDate() + 1);
        to.setHours(0, 0, 0, 0);
        const [agendaRes, offeringRes] = await Promise.all([
            fetch(`/api/admin/service/agenda?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, {
                credentials: "include",
                cache: "no-store",
            }),
            fetch("/api/admin/service/offerings", { credentials: "include", cache: "no-store" }),
        ]);
        const agenda = (await agendaRes.json().catch(() => ({}))) as {
            rows?: LocalRow[];
            google?: { connected?: boolean; unavailable?: boolean; events?: GoogleEvent[] };
        };
        const offeringJson = (await offeringRes.json().catch(() => ({}))) as { rows?: { id: string; name: string; duration_min: number | null }[] };
        const local = (Array.isArray(agenda.rows) ? agenda.rows : []).map((row) => ({
            key: row.id,
            title: row.offering_name,
            detail: row.google_sync === "failed" ? "Não entrou no Google" : row.customer_name || row.phone_e164,
            when: clock(row.starts_at),
            sort: Date.parse(row.starts_at),
            day: keyFromIso(row.starts_at),
            appointmentId: row.id,
            failed: row.google_sync === "failed",
        }));
        const remote = (agenda.google?.events ?? []).map((event) => ({
            key: `g:${event.id}`,
            title: event.summary,
            detail: "Google",
            when: event.allDay ? "Dia inteiro" : clock(event.startsAt),
            sort: Date.parse(event.startsAt),
            day: event.allDay ? event.startsAt.slice(0, 10) : keyFromIso(event.startsAt),
        }));
        setItems([...local, ...remote].sort((a, b) => a.sort - b.sort));
        setGoogleNote(
            agenda.google?.unavailable
                ? "A agenda do Google não respondeu. Os horários do sistema continuam nesta tela."
                : null
        );
        setOfferings((offeringJson.rows ?? []).filter((row) => row.duration_min != null));
    }

    useEffect(() => {
        if (snapshot?.agendaEnabled) void load(cells);
    }, [snapshot?.agendaEnabled, cursor, reloadKey]);

    async function book() {
        const res = await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "book",
                offeringId,
                startsAt: new Date(startsAt).toISOString(),
                phoneE164: phone,
                customerName,
                idempotencyKey: `admin-${crypto.randomUUID()}`,
            }),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string };
        if (!res.ok) {
            setError(
                json.code === "slot_taken"
                    ? "Esse horário está ocupado na agenda do Google."
                    : json.code === "calendar_unavailable"
                      ? "A agenda do Google não respondeu. Tente de novo."
                      : "Não foi possível marcar."
            );
            return;
        }
        setOpen(false);
        setReloadKey((value) => value + 1);
    }

    async function cancel(id: string) {
        await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", appointmentId: id }),
        });
        setReloadKey((value) => value + 1);
    }

    if (loading || !snapshot) return <Skeleton className="h-96 w-full max-w-md" />;
    if (!snapshot.agendaEnabled) {
        return <p className="text-sm text-zinc-600 dark:text-zinc-300">A agenda não está ligada neste modelo.</p>;
    }

    const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const marked = new Set(items.map((item) => item.day));
    const selectedItems = items.filter((item) => item.day === selected);

    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
                <GoogleCalendarConnect onChange={() => setReloadKey((value) => value + 1)} />
                <Button type="button" onClick={() => { setError(null); setOpen(true); }}>
                    Marcar
                </Button>
            </div>

            <section className="rounded-2xl border border-border bg-background-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Agenda</h1>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                        onClick={() => {
                            const now = new Date();
                            setCursor(now);
                            setSelected(dayKey(now));
                        }}
                    >
                        Hoje
                    </Button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        aria-label="Mês anterior"
                        onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <p className="text-sm font-medium capitalize text-zinc-800 dark:text-zinc-100">{monthLabel}</p>
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        aria-label="Próximo mês"
                        onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel}>
                    {WEEKDAYS.map((day) => (
                        <div key={day.id} className="pb-1 text-center text-xs font-medium text-zinc-400" aria-hidden>
                            {day.label}
                        </div>
                    ))}
                    {cells.map((day) => {
                        const key = dayKey(day);
                        const outside = day.getMonth() !== cursor.getMonth();
                        const isSelected = key === selected;
                        const has = marked.has(key);
                        return (
                            <button
                                key={key}
                                type="button"
                                role="gridcell"
                                aria-pressed={isSelected}
                                aria-label={day.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                                onClick={() => setSelected(key)}
                                className={cn(
                                    "mx-auto flex h-9 w-9 items-center justify-center text-sm",
                                    isSelected && "rounded-full bg-primary font-semibold text-white",
                                    !isSelected && has && "rounded-xl bg-accent/70 font-medium text-accent-foreground",
                                    !isSelected && !has && "rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                                    outside && !isSelected && "text-zinc-300 dark:text-zinc-600"
                                )}
                            >
                                {day.getDate()}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                    {googleNote ? <p className="text-sm text-amber-700 dark:text-amber-300">{googleNote}</p> : null}
                    {selectedItems.length === 0 ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum horário neste dia.</p>
                    ) : (
                        selectedItems.map((item) => (
                            <article key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-3 dark:bg-zinc-900">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{item.title}</p>
                                    <p className={cn("truncate text-sm", item.failed ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")}>
                                        {item.detail}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{item.when}</span>
                                    {item.appointmentId ? (
                                        <button type="button" className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400" onClick={() => void cancel(item.appointmentId!)}>
                                            Cancelar
                                        </button>
                                    ) : null}
                                </div>
                            </article>
                        ))
                    )}
                </div>
            </section>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Marcar horário</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <Select value={offeringId || undefined} onValueChange={setOfferingId}>
                            <SelectTrigger className="w-full" aria-label="Oferta">
                                <SelectValue placeholder="Oferta" />
                            </SelectTrigger>
                            <SelectContent>
                                {offerings.map((row) => (
                                    <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <input type="datetime-local" className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefone" aria-label="Telefone" />
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome" aria-label="Nome" />
                        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => void book()}>Confirmar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
