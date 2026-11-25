"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";
import { CASE_STAGE_LABELS, type CaseStage } from "@/src/service/domain/types";

type CardRow = {
    id: string;
    title: string;
    stage: CaseStage;
    label: string;
    phone_e164: string;
};

const STAGES = Object.keys(CASE_STAGE_LABELS) as CaseStage[];

export default function CardsPage() {
    const { snapshot, loading } = useServiceSnapshot();
    const [rows, setRows] = useState<CardRow[]>([]);
    const [labelOpen, setLabelOpen] = useState(false);
    const [stage, setStage] = useState<CaseStage>("aberto");
    const [label, setLabel] = useState("");
    const [moveError, setMoveError] = useState<string | null>(null);

    async function load() {
        const res = await fetch("/api/admin/service/cases", { credentials: "include", cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { rows?: CardRow[] };
        setRows(Array.isArray(json.rows) ? json.rows : []);
    }

    useEffect(() => {
        if (snapshot?.casesEnabled) void load();
    }, [snapshot?.casesEnabled]);

    async function move(id: string, next: CaseStage) {
        const res = await fetch("/api/admin/service/cases", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stage", caseId: id, stage: next }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
        if (!res.ok || json.ok === false) {
            setMoveError(json.code === "case_closed" ? "Card encerrado não volta de etapa." : "Não foi possível mudar a etapa.");
            return;
        }
        setMoveError(null);
        await load();
    }

    async function saveLabel() {
        await fetch("/api/admin/service/cases", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "label", stage, label }),
        });
        setLabelOpen(false);
        await load();
    }

    if (loading || !snapshot) return <Skeleton className="h-28 w-full" />;
    if (!snapshot.casesEnabled) {
        return <p className="text-sm text-zinc-600 dark:text-zinc-300">Os cards não estão ligados neste modelo.</p>;
    }

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Cards</h1>
                <Button type="button" variant="outline" onClick={() => setLabelOpen(true)}>Rótulos</Button>
            </div>
            {moveError ? <p className="text-sm text-red-600 dark:text-red-400">{moveError}</p> : null}
            <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{row.title}</p>
                            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{row.label} · {row.phone_e164}</p>
                        </div>
                        <Select value={row.stage} onValueChange={(value) => void move(row.id, value as CaseStage)}>
                            <SelectTrigger className="w-40" aria-label={`Etapa de ${row.title}`}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {STAGES.map((item) => (
                                    <SelectItem key={item} value={item}>{CASE_STAGE_LABELS[item]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </li>
                ))}
            </ul>
            <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Rótulo da etapa</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-3">
                        <Select value={stage} onValueChange={(value) => setStage(value as CaseStage)}>
                            <SelectTrigger aria-label="Etapa"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {STAGES.map((item) => (
                                    <SelectItem key={item} value={item}>{CASE_STAGE_LABELS[item]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="Rótulo visível" />
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => void saveLabel()}>Salvar rótulo</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
