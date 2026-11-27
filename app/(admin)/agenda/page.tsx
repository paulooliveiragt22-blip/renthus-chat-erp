"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { cva } from "class-variance-authority";
import { Bot, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceHours } from "@/components/service/agenda/AttendanceHours";
import { GoogleCalendarConnect } from "@/components/service/GoogleCalendarConnect";
import {
    EventPeek,
    eventTone,
    QuickCreatePopover,
    toneFor,
    type OfferingChoice,
    type Tone,
} from "@/components/service/agenda/AgendaPopovers";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { cn } from "@/lib/utils";

type Origin = "google" | "whatsapp" | "admin";
type View = "day" | "week" | "month" | "year";

type LocalRow = {
    id: string;
    offering_name: string | null;
    starts_at: string;
    ends_at?: string;
    phone_e164: string;
    customer_name: string | null;
    label?: string | null;
    google_sync?: string | null;
    google_event_id?: string | null;
    source?: string | null;
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
    offeringName: string;
    detail: string;
    when: string;
    sort: number;
    endSort: number;
    day: string;
    origin: Origin;
    tone: Tone;
    appointmentId?: string;
    failed?: boolean;
    phone?: string;
    customerName?: string;
    googleEventId?: string | null;
    allDay?: boolean;
};

type Point = { day: string; minutes: number; rect: DOMRect };

const WEEKDAYS = [
    { id: "dom", label: "D" },
    { id: "seg", label: "S" },
    { id: "ter", label: "T" },
    { id: "qua", label: "Q" },
    { id: "qui", label: "Q" },
    { id: "sex", label: "S" },
    { id: "sab", label: "S" },
];

const OPEN_MIN = 0;
const CLOSE_MIN = 24 * 60;
const HOUR_REM = 3.5;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const block = cva(
    "absolute z-10 overflow-hidden rounded-md border border-zinc-200/80 border-l-2 px-2 py-1 text-left transition-colors duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80",
    { variants: { tone: { sky: "", emerald: "", amber: "", violet: "", rose: "", cyan: "", google: "" } } }
);

function dayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDay(key: string): Date {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year || 1970, (month || 1) - 1, day || 1);
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

function weekOf(key: string): Date[] {
    const selected = parseDay(key);
    const start = new Date(selected);
    start.setDate(selected.getDate() - selected.getDay());
    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
    });
}

function clock(iso: string): string {
    if (/T00:00:00$/u.test(iso) && !iso.endsWith("Z") && !iso.includes("+")) return "Dia inteiro";
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function labelMinutes(minutes: number): string {
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function localInput(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFrom(day: string, minutes: number): string {
    const date = parseDay(day);
    date.setHours(0, 0, 0, 0);
    date.setMinutes(minutes);
    return date.toISOString();
}

function googleDayHref(day: string): string {
    const [year, month, date] = day.split("-");
    return `https://calendar.google.com/calendar/u/0/r/day/${year}/${Number(month)}/${Number(date)}`;
}

function minutesOf(ms: number): number {
    const date = new Date(ms);
    return date.getHours() * 60 + date.getMinutes();
}

function inWindow(item: AgendaItem): { top: number; height: number } | null {
    if (item.allDay || !Number.isFinite(item.sort)) return null;
    const startMin = minutesOf(item.sort);
    const endMin = Number.isFinite(item.endSort) ? minutesOf(item.endSort) : startMin + 30;
    if (endMin <= OPEN_MIN || startMin >= CLOSE_MIN) return null;
    const topMin = Math.max(startMin, OPEN_MIN) - OPEN_MIN;
    const bottomMin = Math.min(Math.max(endMin, startMin + 20), CLOSE_MIN) - OPEN_MIN;
    return { top: (topMin / 60) * HOUR_REM, height: Math.max(((bottomMin - topMin) / 60) * HOUR_REM, 1.6) };
}

function lanesFor(items: AgendaItem[]): Map<string, { lane: number; count: number }> {
    const sorted = items.filter((item) => inWindow(item)).sort((a, b) => a.sort - b.sort);
    const ends: number[] = [];
    const laneOf = new Map<string, number>();
    for (const item of sorted) {
        let lane = ends.findIndex((end) => end <= item.sort);
        if (lane < 0) {
            lane = ends.length;
            ends.push(item.endSort);
        } else ends[lane] = item.endSort;
        laneOf.set(item.key, lane);
    }
    const count = Math.max(ends.length, 1);
    return new Map([...laneOf].map(([key, lane]) => [key, { lane, count }]));
}

function bookMessage(code: string | undefined, fallback: string): string {
    if (code === "slot_taken") return "Esse horário está ocupado na agenda do Google.";
    if (code === "calendar_unavailable") return "A agenda do Google não respondeu. Tente de novo.";
    if (code === "outside_hours" || code === "no_hours") return "Esse horário está fora do expediente da empresa.";
    if (code === "phone_mismatch") return "Informe o WhatsApp para gravar o horário.";
    if (code === "cap_reached") return "Esse WhatsApp já tem o limite de horários futuros.";
    return fallback;
}

function periodLabel(view: View, selected: string, cursor: Date): string {
    if (view === "year") return String(cursor.getFullYear());
    if (view === "month") return cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    if (view === "day") return parseDay(selected).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    const days = weekOf(selected);
    const start = days[0]!.toLocaleDateString("pt-BR", { day: "numeric" });
    const end = days[6]!.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
    return `${start} – ${end}`;
}

function movePeriod(view: View, selected: string, cursor: Date, dir: number): { selected: string; cursor: Date } {
    if (view === "year") {
        const next = new Date(cursor.getFullYear() + dir, 0, 1);
        return { selected: dayKey(next), cursor: next };
    }
    if (view === "month") {
        const next = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
        return { selected: dayKey(next), cursor: next };
    }
    const date = parseDay(selected);
    date.setDate(date.getDate() + (view === "week" ? dir * 7 : dir));
    return { selected: dayKey(date), cursor: date };
}

function typingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

function nextFree(day: string, items: AgendaItem[]): number {
    for (let minutes = 7 * 60; minutes < CLOSE_MIN; minutes += 30) {
        const start = Date.parse(isoFrom(day, minutes));
        const end = start + 30 * 60_000;
        const busy = items.some((item) => item.day === day && item.sort < end && item.endSort > start);
        if (!busy) return minutes;
    }
    return 9 * 60;
}

function DayColumn({
    day,
    items,
    onCreate,
    onOpen,
}: {
    day: string;
    items: AgendaItem[];
    onCreate: (day: string, minutes: number, rect: DOMRect) => void;
    onOpen: (item: AgendaItem, rect: DOMRect) => void;
}) {
    const [hover, setHover] = useState<number | null>(null);
    const placed = items.filter((item) => inWindow(item));
    const lanes = lanesFor(placed);
    const height = `${((CLOSE_MIN - OPEN_MIN) / 60) * HOUR_REM}rem`;

    function minutesAt(event: MouseEvent<HTMLDivElement>): number {
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = bounds.height === 0 ? 0 : (event.clientY - bounds.top) / bounds.height;
        const raw = OPEN_MIN + ratio * (CLOSE_MIN - OPEN_MIN);
        return Math.min(CLOSE_MIN - 15, Math.max(OPEN_MIN, Math.round(raw / 15) * 15));
    }

    return (
        <div
            className="relative border-l border-zinc-200/80 dark:border-zinc-800/80"
            style={{ height }}
            onMouseMove={(event) => setHover(minutesAt(event))}
            onMouseLeave={() => setHover(null)}
            onClick={(event) => {
                if ((event.target as HTMLElement).closest("[data-event]")) return;
                const minutes = minutesAt(event);
                onCreate(day, minutes, new DOMRect(event.clientX, event.clientY, 8, 8));
            }}
        >
            {hover != null ? (
                <div
                    className="pointer-events-none absolute inset-x-1 z-20 flex items-center gap-2"
                    style={{ top: `${((hover - OPEN_MIN) / 60) * HOUR_REM}rem` }}
                >
                    <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                    <span className="font-mono text-[11px] tabular-nums text-zinc-500">{labelMinutes(hover)}</span>
                    <span className="text-[11px] text-zinc-500">+ Novo</span>
                </div>
            ) : null}
            {placed.map((item) => {
                const box = inWindow(item);
                const lane = lanes.get(item.key) ?? { lane: 0, count: 1 };
                if (!box) return null;
                return (
                    <button
                        key={item.key}
                        type="button"
                        data-event=""
                        className={cn(block({ tone: item.tone }), eventTone({ tone: item.tone }))}
                        style={{
                            top: `${box.top}rem`,
                            height: `${box.height}rem`,
                            left: `${(lane.lane / lane.count) * 100}%`,
                            width: `${100 / lane.count}%`,
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen(item, (event.currentTarget as HTMLButtonElement).getBoundingClientRect());
                        }}
                    >
                        <span className="flex items-center gap-1">
                            {item.origin === "whatsapp" ? <Bot className="h-3 w-3 shrink-0" aria-label="IA WhatsApp" /> : null}
                            {item.origin === "google" ? <Calendar className="h-3 w-3 shrink-0" aria-label="Google Agenda" /> : null}
                            <span className="truncate text-xs font-medium">{item.title}</span>
                        </span>
                        <span className="block truncate font-mono text-[11px] tabular-nums opacity-70">{item.when}</span>
                    </button>
                );
            })}
        </div>
    );
}

export default function AgendaPage() {
    const { snapshot, loading } = useServiceSnapshot();
    const [cursor, setCursor] = useState(() => new Date());
    const [selected, setSelected] = useState(() => dayKey(new Date()));
    const [view, setView] = useState<View>("day");
    const [items, setItems] = useState<AgendaItem[]>([]);
    const [aiToday, setAiToday] = useState(0);
    const [googleNote, setGoogleNote] = useState<string | null>(null);
    const [offerings, setOfferings] = useState<OfferingChoice[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [createAt, setCreateAt] = useState<Point | null>(null);
    const [peek, setPeek] = useState<{ item: AgendaItem; rect: DOMRect } | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    const cells = useMemo(() => monthCells(cursor), [cursor]);
    const today = dayKey(new Date());
    const visibleDays = view === "week" ? weekOf(selected) : [parseDay(selected)];
    const weekKeys = new Set(weekOf(selected).map((day) => dayKey(day)));

    async function load(visible: Date[], exclusiveEnd = false) {
        const from = new Date(visible[0]!);
        from.setHours(0, 0, 0, 0);
        const to = new Date(visible[visible.length - 1]!);
        if (!exclusiveEnd) to.setDate(to.getDate() + 1);
        to.setHours(0, 0, 0, 0);
        const [agendaRes, offeringRes] = await Promise.all([
            fetch(`/api/admin/service/agenda?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { credentials: "include", cache: "no-store" }),
            fetch("/api/admin/service/offerings", { credentials: "include", cache: "no-store" }),
        ]);
        const agenda = (await agendaRes.json().catch(() => ({}))) as {
            rows?: LocalRow[];
            google?: { unavailable?: boolean; events?: GoogleEvent[] };
        };
        const offeringJson = (await offeringRes.json().catch(() => ({}))) as { rows?: OfferingChoice[] };
        const local = (Array.isArray(agenda.rows) ? agenda.rows : []).map((row) => {
            const origin: Origin = row.source === "whatsapp_button" ? "whatsapp" : "admin";
            return {
                key: row.id,
                title: row.label?.trim() || row.customer_name?.trim() || row.offering_name?.trim() || "Evento",
                customerName: row.customer_name?.trim() || undefined,
                offeringName: row.offering_name?.trim() || "Evento",
                detail: row.google_sync === "failed" ? "Não entrou no Google" : row.phone_e164,
                when: clock(row.starts_at),
                sort: Date.parse(row.starts_at),
                endSort: Date.parse(row.ends_at || row.starts_at),
                day: keyFromIso(row.starts_at),
                origin,
                tone: toneFor(row.offering_name?.trim() || row.label?.trim() || "Evento"),
                appointmentId: row.id,
                failed: row.google_sync === "failed",
                phone: row.phone_e164,
                googleEventId: row.google_event_id,
            };
        });
        const remote = (agenda.google?.events ?? []).map((event) => ({
            key: `g:${event.id}`,
            title: event.summary,
            offeringName: "Google Agenda",
            detail: "Google",
            when: event.allDay ? "Dia inteiro" : clock(event.startsAt),
            sort: Date.parse(event.startsAt),
            endSort: Date.parse(event.endsAt || event.startsAt),
            day: event.allDay ? event.startsAt.slice(0, 10) : keyFromIso(event.startsAt),
            origin: "google" as const,
            tone: "google" as const,
            googleEventId: event.id,
            allDay: event.allDay,
        }));
        const next = [...local, ...remote].sort((a, b) => a.sort - b.sort);
        setItems(next);
        if (visible.some((day) => dayKey(day) === today)) {
            setAiToday(next.filter((item) => item.origin === "whatsapp" && item.day === today).length);
        }
        setGoogleNote(agenda.google?.unavailable ? "A agenda do Google não respondeu. Os horários do sistema continuam nesta tela." : null);
        setOfferings((offeringJson.rows ?? []).filter((row) => row.duration_min != null));
    }

    useEffect(() => {
        if (!snapshot?.agendaEnabled) return;
        if (view === "year") {
            void load([new Date(cursor.getFullYear(), 0, 1), new Date(cursor.getFullYear() + 1, 0, 1)], true);
            return;
        }
        void load(cells);
    }, [snapshot?.agendaEnabled, cursor, reloadKey, view]);

    useEffect(() => {
        if (view === "month" || view === "year") return;
        const node = gridRef.current;
        if (!node) return;
        node.scrollTop = 7 * HOUR_REM * 16;
    }, [view, selected]);

    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === "d" || key === "w" || key === "m" || key === "y") {
                setView(key === "d" ? "day" : key === "w" ? "week" : key === "m" ? "month" : "year");
                return;
            }
            if (key !== "c") return;
            const day = dayKey(new Date());
            setView("day");
            setSelected(day);
            setCursor(new Date());
            setPeek(null);
            setError(null);
            setCreateAt({ day, minutes: nextFree(day, items), rect: new DOMRect(window.innerWidth / 2, 120, 8, 8) });
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [items]);

    function chooseDay(key: string) {
        const date = parseDay(key);
        setSelected(key);
        setCursor(date);
    }

    function openOnDay(key: string, event: MouseEvent<HTMLElement>) {
        setPeek(null);
        setError(null);
        setCreateAt({ day: key, minutes: 9 * 60, rect: new DOMRect(event.clientX, event.clientY, 8, 8) });
    }

    function shift(dir: number) {
        const next = movePeriod(view, selected, cursor, dir);
        setSelected(next.selected);
        setCursor(next.cursor);
    }

    async function book(input: { offeringId: string | null; durationMin: 15 | 30 | 60; minutes: number; phone: string; customerName: string; label: string }) {
        if (!createAt) return;
        if (input.phone.length < 8) {
            setError("Informe o WhatsApp para gravar o horário.");
            return;
        }
        const res = await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "book",
                offeringId: input.offeringId,
                durationMin: input.durationMin,
                startsAt: isoFrom(createAt.day, input.minutes),
                phoneE164: input.phone,
                customerName: input.customerName,
                label: input.label,
                idempotencyKey: `admin-${crypto.randomUUID()}`,
            }),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string };
        if (!res.ok) {
            setError(bookMessage(json.code, "Não foi possível marcar."));
            return;
        }
        setCreateAt(null);
        setError(null);
        setReloadKey((value) => value + 1);
    }

    async function cancel(id: string) {
        await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", appointmentId: id }),
        });
        setPeek(null);
        setReloadKey((value) => value + 1);
    }

    async function saveMove(value: string) {
        if (!peek?.item.appointmentId) return;
        const res = await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "reschedule",
                appointmentId: peek.item.appointmentId,
                startsAt: new Date(value).toISOString(),
                idempotencyKey: `admin-${crypto.randomUUID()}`,
            }),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string };
        if (!res.ok) {
            setError(bookMessage(json.code, "Não foi possível remarcar."));
            return;
        }
        setPeek(null);
        setError(null);
        setReloadKey((value) => value + 1);
    }

    if (loading || !snapshot) return <Skeleton className="h-96 w-full" />;
    if (!snapshot.agendaEnabled) {
        return <p className="text-sm text-zinc-600 dark:text-zinc-300">A agenda não está ligada neste modelo.</p>;
    }

    const marked = new Set(items.map((item) => item.day));
    const outside = items.filter((item) => item.day === selected && !item.allDay && !inWindow(item));

    return (
        <div className="flex w-full flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 pb-3 dark:border-zinc-800/80">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <h1 className="text-base font-semibold capitalize text-zinc-900 dark:text-zinc-50">{periodLabel(view, selected, cursor)}</h1>
                    <div className="flex items-center gap-1">
                        <button type="button" aria-label="Período anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800/50" onClick={() => shift(-1)}>
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-3" onClick={() => { const now = new Date(); setSelected(dayKey(now)); setCursor(now); }}>
                            Hoje
                        </Button>
                        <button type="button" aria-label="Próximo período" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800/50" onClick={() => shift(1)}>
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <AttendanceHours />
                    <GoogleCalendarConnect onChange={() => setReloadKey((value) => value + 1)} />
                </div>
                <Tabs value={view} onValueChange={(value) => setView(value as View)}>
                    <TabsList className="h-9 border border-zinc-200/80 bg-transparent p-0.5 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                        <TabsTrigger value="day">Dia</TabsTrigger>
                        <TabsTrigger value="week">Semana</TabsTrigger>
                        <TabsTrigger value="month">Mês</TabsTrigger>
                        <TabsTrigger value="year">Ano</TabsTrigger>
                    </TabsList>
                </Tabs>
            </header>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <aside className="flex flex-col gap-3">
                    <section className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800/80 dark:bg-zinc-950">
                        <p className="text-sm font-medium capitalize text-zinc-800 dark:text-zinc-100">
                            {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                        </p>
                        <div className="mt-2 grid grid-cols-7 gap-1" role="grid" aria-label="Mini calendário">
                            {WEEKDAYS.map((day) => (
                                <div key={day.id} className="pb-1 text-center text-xs text-zinc-400" aria-hidden>{day.label}</div>
                            ))}
                            {cells.map((day) => {
                                const key = dayKey(day);
                                const isSelected = key === selected;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        role="gridcell"
                                        aria-pressed={isSelected}
                                        aria-label={day.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                                        onClick={() => chooseDay(key)}
                                        className={cn(
                                            "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400",
                                            isSelected && "bg-primary font-semibold text-white",
                                            !isSelected && view === "week" && weekKeys.has(key) && "bg-zinc-100 dark:bg-zinc-800/80",
                                            !isSelected && marked.has(key) && "text-emerald-700 dark:text-emerald-300",
                                            day.getMonth() !== cursor.getMonth() && !isSelected && "text-zinc-300 dark:text-zinc-600"
                                        )}
                                    >
                                        {day.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                    <section className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800/80 dark:bg-zinc-950">
                        <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />
                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">IA no WhatsApp</p>
                        </div>
                        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{aiToday}</p>
                        <p className="text-xs text-zinc-500">agendamentos automáticos hoje</p>
                    </section>
                </aside>

                <section className="min-w-0 rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-950">
                    {googleNote ? <p className="border-b border-amber-500/20 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">{googleNote}</p> : null}
                    {view === "year" ? (
                        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-4" aria-label={periodLabel(view, selected, cursor)}>
                            {Array.from({ length: 12 }, (_, month) => {
                                const days = monthCells(new Date(cursor.getFullYear(), month, 1));
                                return (
                                    <section key={month} className="min-w-0">
                                        <p className="mb-1 text-xs capitalize text-zinc-500">
                                            {new Date(cursor.getFullYear(), month, 1).toLocaleDateString("pt-BR", { month: "long" })}
                                        </p>
                                        <div className="grid grid-cols-7 gap-0.5">
                                            {days.map((day) => {
                                                const key = dayKey(day);
                                                const inMonth = day.getMonth() === month;
                                                const has = marked.has(key);
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        aria-label={day.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}
                                                        onClick={() => {
                                                            chooseDay(key);
                                                            setView("day");
                                                        }}
                                                        className={cn(
                                                            "flex h-6 items-center justify-center rounded-full font-mono text-[10px] tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400",
                                                            key === selected && "bg-primary text-white",
                                                            key !== selected && has && "text-emerald-700 dark:text-emerald-300",
                                                            !inMonth && "text-zinc-300 dark:text-zinc-600"
                                                        )}
                                                    >
                                                        {day.getDate()}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    ) : view === "month" ? (
                        <div className="grid grid-cols-7" role="grid" aria-label={periodLabel(view, selected, cursor)}>
                            {WEEKDAYS.map((day) => (
                                <div key={day.id} className="border-b border-zinc-200/80 px-2 py-2 text-center text-[11px] text-zinc-400 dark:border-zinc-800/80">{day.label}</div>
                            ))}
                            {cells.map((day) => {
                                const key = dayKey(day);
                                const dayItems = items.filter((item) => item.day === key).slice(0, 3);
                                const extra = items.filter((item) => item.day === key).length - dayItems.length;
                                return (
                                    <div
                                        key={key}
                                        className={cn(
                                            "relative min-h-28 border-b border-r border-zinc-200/80 p-1 dark:border-zinc-800/80",
                                            day.getMonth() !== cursor.getMonth() && "bg-zinc-50/70 dark:bg-zinc-900/40"
                                        )}
                                    >
                                        <button
                                            type="button"
                                            className="absolute inset-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                                            aria-label={`Novo horário em ${day.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`}
                                            onClick={(event) => {
                                                chooseDay(key);
                                                openOnDay(key, event);
                                            }}
                                        />
                                        <p className={cn("pointer-events-none relative z-10 px-1 font-mono text-xs tabular-nums", key === today && "text-emerald-600 dark:text-emerald-300")}>{day.getDate()}</p>
                                        <div className="relative z-10 mt-1 flex flex-col gap-1">
                                            {dayItems.map((item) => (
                                                <button
                                                    key={item.key}
                                                    type="button"
                                                    data-event=""
                                                    className={cn("truncate rounded-md border border-transparent border-l-2 px-1.5 py-0.5 text-left text-[11px]", eventTone({ tone: item.tone }))}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setCreateAt(null);
                                                        setError(null);
                                                        setPeek({ item, rect: event.currentTarget.getBoundingClientRect() });
                                                    }}
                                                >
                                                    <span className="font-mono tabular-nums">{item.allDay ? "dia" : item.when}</span> {item.title}
                                                </button>
                                            ))}
                                            {extra > 0 ? <p className="px-1 text-[11px] text-zinc-400">+{extra}</p> : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div ref={gridRef} className="max-h-[calc(100dvh-14rem)] overflow-auto">
                            <div className={cn(view === "week" ? "min-w-[64rem]" : "min-w-[36rem]")}>
                                <div className="sticky top-0 z-30 grid border-b border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-950" style={{ gridTemplateColumns: `3.5rem repeat(${visibleDays.length}, minmax(0,1fr))` }}>
                                    <div />
                                    {visibleDays.map((day) => {
                                        const key = dayKey(day);
                                        return (
                                            <button key={key} type="button" onClick={() => chooseDay(key)} className="border-l border-zinc-200/80 px-2 py-2 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80 dark:hover:bg-zinc-800/50">
                                                <p className="text-[11px] uppercase text-zinc-400">{day.toLocaleDateString("pt-BR", { weekday: "short" })}</p>
                                                <p className={cn("font-mono text-sm tabular-nums", key === today && "text-emerald-600 dark:text-emerald-300")}>{day.getDate()}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${visibleDays.length}, minmax(0,1fr))` }}>
                                    <div className="relative" style={{ height: `${((CLOSE_MIN - OPEN_MIN) / 60) * HOUR_REM}rem` }}>
                                        {HOURS.map((hour) => (
                                            <p key={hour} className="absolute right-2 font-mono text-[11px] tabular-nums text-zinc-400" style={{ top: `${((hour * 60 - OPEN_MIN) / 60) * HOUR_REM}rem` }}>
                                                {pad(hour)}:00
                                            </p>
                                        ))}
                                    </div>
                                    {visibleDays.map((day) => (
                                        <DayColumn
                                            key={dayKey(day)}
                                            day={dayKey(day)}
                                            items={items.filter((item) => item.day === dayKey(day) && !item.allDay)}
                                            onCreate={(key, minutes, rect) => {
                                                setPeek(null);
                                                setError(null);
                                                setCreateAt({ day: key, minutes, rect });
                                            }}
                                            onOpen={(item, rect) => {
                                                setCreateAt(null);
                                                setError(null);
                                                setPeek({ item, rect });
                                            }}
                                        />
                                    ))}
                                </div>
                                {outside.length > 0 ? (
                                    <div className="flex flex-wrap gap-2 border-t border-zinc-200/80 p-2 dark:border-zinc-800/80">
                                        {outside.map((item) => (
                                            <button key={item.key} type="button" className={cn("rounded-md border border-l-2 px-2 py-1 text-xs", eventTone({ tone: item.tone }))} onClick={(event) => setPeek({ item, rect: event.currentTarget.getBoundingClientRect() })}>
                                                <span className="font-mono tabular-nums">{item.when}</span> {item.title}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}
                </section>
            </div>

            <QuickCreatePopover
                open={createAt != null}
                rect={createAt?.rect ?? null}
                dayLabel={createAt ? parseDay(createAt.day).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) : ""}
                minutes={createAt?.minutes ?? 9 * 60}
                offerings={offerings}
                error={createAt ? error : null}
                onOpenChange={(next) => { if (!next) { setCreateAt(null); setError(null); } }}
                onSave={(input) => void book(input)}
            />
            <EventPeek
                open={peek != null}
                rect={peek?.rect ?? null}
                title={peek?.item.title ?? ""}
                person={peek?.item.customerName && peek.item.customerName !== peek.item.title ? peek.item.customerName : undefined}
                category={peek?.item.offeringName ?? ""}
                when={peek?.item.when ?? ""}
                phone={peek?.item.phone}
                originLabel={peek?.item.origin === "whatsapp" ? "IA no WhatsApp" : peek?.item.origin === "google" ? "Google Agenda" : "Painel"}
                syncLabel={peek?.item.failed ? "Não entrou no Google" : peek?.item.googleEventId ? "Sincronizado com o Google" : null}
                canEdit={Boolean(peek?.item.appointmentId)}
                initialStart={peek ? localInput(peek.item.sort) : ""}
                error={peek ? error : null}
                onOpenChange={(next) => { if (!next) { setPeek(null); setError(null); } }}
                onSaveTime={(value) => void saveMove(value)}
                onCancel={() => { if (peek?.item.appointmentId) void cancel(peek.item.appointmentId); }}
                googleHref={peek && (peek.item.origin === "google" || peek.item.googleEventId) ? googleDayHref(peek.item.day) : null}
            />
        </div>
    );
}
