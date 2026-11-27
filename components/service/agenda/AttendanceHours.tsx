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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DAYS: { dow: number; short: string; label: string }[] = [
    { dow: 1, short: "Seg", label: "Segunda" },
    { dow: 2, short: "Ter", label: "Terça" },
    { dow: 3, short: "Qua", label: "Quarta" },
    { dow: 4, short: "Qui", label: "Quinta" },
    { dow: 5, short: "Sex", label: "Sexta" },
    { dow: 6, short: "Sáb", label: "Sábado" },
    { dow: 0, short: "Dom", label: "Domingo" },
];

const WEEKDAYS = ["1", "2", "3", "4", "5"];

type Window = { dow: number; open: string; close: string };
type Shifts = { open: string; close: string; open2: string; close2: string };

const EMPTY: Shifts = { open: "", close: "", open2: "", close2: "" };
const SAMPLE: Shifts = { open: "07:00", close: "11:00", open2: "13:00", close2: "17:00" };

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

function describe(row: Shifts): string {
    const parts = [
        row.open && row.close ? `${row.open}–${row.close}` : "",
        row.open2 && row.close2 ? `${row.open2}–${row.close2}` : "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "fechado";
}

export function AttendanceHours() {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<Record<number, Shifts>>(() => rowsFrom([]));
    const [template, setTemplate] = useState<Shifts>(SAMPLE);
    const [selected, setSelected] = useState<string[]>(WEEKDAYS);
    const [note, setNote] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function load() {
        const res = await fetch("/api/admin/service/hours", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { windows?: Window[] };
        const next = rowsFrom(Array.isArray(json.windows) ? json.windows : []);
        setRows(next);
        const sample = DAYS.map((day) => next[day.dow]).find((row) => row && row.open && row.close);
        if (sample) setTemplate({ ...sample });
        setNote(null);
    }

    function setTemplateField(key: keyof Shifts, value: string) {
        setTemplate((current) => ({ ...current, [key]: value }));
    }

    function apply() {
        if (selected.length === 0) {
            setNote("Marque pelo menos um dia para aplicar o turno.");
            return;
        }
        setRows((current) => {
            const next = { ...current };
            for (const id of selected) next[Number(id)] = { ...template };
            return next;
        });
        const names = DAYS.filter((day) => selected.includes(String(day.dow))).map((day) => day.label);
        setNote(`Turno aplicado em ${names.join(", ")}. Salve para valer no WhatsApp.`);
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
            setNote("Não foi possível salvar. Cada turno precisa terminar depois de começar.");
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
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full px-3">
                    Expediente
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Expediente do atendimento</DialogTitle>
                    <DialogDescription>
                        Monte um turno e aplique nos dias que quiser. Dá para repetir com outro horário em outros dias.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <TimeField label="Abertura" value={template.open} onChange={(value) => setTemplateField("open", value)} />
                        <span className="text-xs text-zinc-400">às</span>
                        <TimeField label="Fechamento" value={template.close} onChange={(value) => setTemplateField("close", value)} />
                        <span className="px-1 text-xs text-zinc-300">e</span>
                        <TimeField label="Segunda abertura" value={template.open2} onChange={(value) => setTemplateField("open2", value)} />
                        <span className="text-xs text-zinc-400">às</span>
                        <TimeField label="Segundo fechamento" value={template.close2} onChange={(value) => setTemplateField("close2", value)} />
                    </div>
                    <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(WEEKDAYS)}>
                            Dias úteis
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(["6"])}>
                            Sábado
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(["0"])}>
                            Domingo
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(DAYS.map((day) => String(day.dow)))}>
                            Todos
                        </Button>
                    </div>
                    <ToggleGroup
                        type="multiple"
                        value={selected}
                        onValueChange={setSelected}
                        className="flex flex-wrap justify-start gap-1"
                        aria-label="Dias do turno"
                    >
                        {DAYS.map((day) => (
                            <ToggleGroupItem
                                key={day.dow}
                                value={String(day.dow)}
                                className="h-7 rounded-full border border-zinc-200/80 px-2 data-[state=on]:bg-zinc-900 data-[state=on]:text-white dark:border-zinc-800/80 dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900"
                            >
                                {day.short}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <Button type="button" size="sm" variant="outline" onClick={apply}>
                        Aplicar nestes dias
                    </Button>
                    <ul className="flex flex-col gap-1 border-t border-zinc-200/80 pt-3 dark:border-zinc-800/80">
                        {DAYS.map((day) => {
                            const row = rows[day.dow] ?? EMPTY;
                            return (
                                <li key={day.dow} className="flex items-center justify-between gap-2">
                                    <p className="text-sm text-zinc-700 dark:text-zinc-200">
                                        {day.label}{" "}
                                        <span className="font-mono text-xs tabular-nums text-zinc-500">{describe(row)}</span>
                                    </p>
                                    <button
                                        type="button"
                                        className="text-xs text-zinc-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                                        onClick={() => {
                                            setTemplate({ ...row });
                                            setSelected([String(day.dow)]);
                                        }}
                                    >
                                        Usar este
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
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
