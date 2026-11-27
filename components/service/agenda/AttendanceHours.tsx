"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

const DAYS: { dow: number; label: string }[] = [
    { dow: 1, label: "Segunda" },
    { dow: 2, label: "Terça" },
    { dow: 3, label: "Quarta" },
    { dow: 4, label: "Quinta" },
    { dow: 5, label: "Sexta" },
    { dow: 6, label: "Sábado" },
    { dow: 0, label: "Domingo" },
];

type Window = { dow: number; open: string; close: string };
type Shifts = { open: string; close: string; open2: string; close2: string };

const EMPTY: Shifts = { open: "", close: "", open2: "", close2: "" };

function rowsFrom(windows: Window[]): Record<number, Shifts> {
    const next: Record<number, Shifts> = {};
    for (const day of DAYS) next[day.dow] = { ...EMPTY };
    for (const window of windows) {
        const row = next[window.dow];
        if (!row) continue;
        if (!row.open) {
            row.open = window.open;
            row.close = window.close;
        } else if (!row.open2) {
            row.open2 = window.open;
            row.close2 = window.close;
        }
    }
    return next;
}

export function AttendanceHours() {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<Record<number, Shifts>>(() => rowsFrom([]));
    const [note, setNote] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function load() {
        const res = await fetch("/api/admin/service/hours", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { windows?: Window[] };
        setRows(rowsFrom(Array.isArray(json.windows) ? json.windows : []));
        setNote(null);
    }

    function setField(dow: number, key: keyof Shifts, value: string) {
        setRows((current) => ({ ...current, [dow]: { ...current[dow], [key]: value } }));
    }

    async function save() {
        const windows: Window[] = [];
        for (const day of DAYS) {
            const row = rows[day.dow] ?? EMPTY;
            if (row.open && row.close) windows.push({ dow: day.dow, open: row.open, close: row.close });
            if (row.open2 && row.close2) windows.push({ dow: day.dow, open: row.open2, close: row.close2 });
        }
        setSaving(true);
        const res = await fetch("/api/admin/service/hours", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ windows }),
        });
        setSaving(false);
        if (!res.ok) {
            setNote("Não foi possível salvar o expediente. Cada turno precisa terminar depois de começar, no máximo dois por dia.");
            return;
        }
        setNote(windows.length === 0 ? "Expediente limpo. A marcação volta ao horário já salvo da empresa." : "Expediente salvo. Fora desses turnos o WhatsApp não marca.");
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (next) void load();
            }}
        >
            <DialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-3">
                    Expediente
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Expediente do atendimento</DialogTitle>
                    <DialogDescription>
                        Segunda a sexta, por exemplo, 07:00–11:00 e 13:00–17:00. Fora desses turnos o WhatsApp não marca horário. Isso não muda a grade do dia, que continua das 00:00 às 24:00.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    {DAYS.map((day) => {
                        const row = rows[day.dow] ?? EMPTY;
                        return (
                            <div key={day.dow} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                                <p className="text-sm text-zinc-700 dark:text-zinc-200">{day.label}</p>
                                <div className="flex flex-wrap items-center gap-1">
                                    <TimeField label={`Abertura da ${day.label}`} value={row.open} onChange={(value) => setField(day.dow, "open", value)} />
                                    <span className="text-xs text-zinc-400">às</span>
                                    <TimeField label={`Fechamento da ${day.label}`} value={row.close} onChange={(value) => setField(day.dow, "close", value)} />
                                    <span className="px-1 text-xs text-zinc-300">e</span>
                                    <TimeField label={`Segunda abertura da ${day.label}`} value={row.open2} onChange={(value) => setField(day.dow, "open2", value)} />
                                    <span className="text-xs text-zinc-400">às</span>
                                    <TimeField label={`Segundo fechamento da ${day.label}`} value={row.close2} onChange={(value) => setField(day.dow, "close2", value)} />
                                </div>
                            </div>
                        );
                    })}
                </div>
                {note ? <p className="text-xs text-zinc-500">{note}</p> : null}
                <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
                    Salvar expediente
                </Button>
            </DialogContent>
        </Dialog>
    );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <input
            type="time"
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="rounded-md border border-zinc-200/80 bg-transparent px-1.5 py-1 font-mono text-xs tabular-nums dark:border-zinc-800/80"
        />
    );
}
