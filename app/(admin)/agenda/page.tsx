"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useServiceSnapshot } from "@/components/service/useServiceSnapshot";

type Row = {
    id: string;
    offering_name: string;
    starts_at: string;
    phone_e164: string;
    customer_name: string | null;
    google_sync?: string | null;
};

type Offering = { id: string; name: string; duration_min: number | null };

export default function AgendaPage() {
    const { snapshot, loading } = useServiceSnapshot();
    const [rows, setRows] = useState<Row[]>([]);
    const [offerings, setOfferings] = useState<Offering[]>([]);
    const [open, setOpen] = useState(false);
    const [offeringId, setOfferingId] = useState("");
    const [startsAt, setStartsAt] = useState("");
    const [phone, setPhone] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function load() {
        const [agendaRes, offeringRes] = await Promise.all([
            fetch("/api/admin/service/agenda", { credentials: "include", cache: "no-store" }),
            fetch("/api/admin/service/offerings", { credentials: "include", cache: "no-store" }),
        ]);
        const agenda = (await agendaRes.json().catch(() => ({}))) as { rows?: Row[] };
        const offeringJson = (await offeringRes.json().catch(() => ({}))) as { rows?: Offering[] };
        setRows(Array.isArray(agenda.rows) ? agenda.rows : []);
        setOfferings((offeringJson.rows ?? []).filter((row) => row.duration_min != null));
    }

    useEffect(() => {
        if (snapshot?.agendaEnabled) void load();
    }, [snapshot?.agendaEnabled]);

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
        await load();
    }

    async function cancel(id: string) {
        await fetch("/api/admin/service/agenda", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", appointmentId: id }),
        });
        await load();
    }

    if (loading || !snapshot) return <Skeleton className="h-28 w-full" />;
    if (!snapshot.agendaEnabled) {
        return <p className="text-sm text-zinc-600 dark:text-zinc-300">A agenda não está ligada neste modelo.</p>;
    }

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Agenda</h1>
                <Button type="button" onClick={() => { setError(null); setOpen(true); }}>Marcar</Button>
            </div>
            <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{row.offering_name}</p>
                            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                                {new Date(row.starts_at).toLocaleString("pt-BR")} · {row.customer_name || row.phone_e164}
                            </p>
                            {row.google_sync === "failed" ? (
                                <p className="text-sm text-amber-700 dark:text-amber-300">Não entrou no Google.</p>
                            ) : null}
                        </div>
                        <Button type="button" variant="outline" onClick={() => void cancel(row.id)}>Cancelar</Button>
                    </li>
                ))}
            </ul>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Marcar horário</DialogTitle></DialogHeader>
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
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefone" />
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome" />
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
