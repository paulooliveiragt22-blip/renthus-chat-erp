"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type Offering = {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price_cents: number | null;
};

export default function OfertasPage() {
    const [rows, setRows] = useState<Offering[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Offering | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [duration, setDuration] = useState("");
    const [price, setPrice] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/service/offerings", { credentials: "include", cache: "no-store" });
            const json = (await res.json().catch(() => ({}))) as { rows?: Offering[] };
            setRows(Array.isArray(json.rows) ? json.rows : []);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    function startCreate() {
        setEditing(null);
        setName("");
        setDescription("");
        setDuration("");
        setPrice("");
        setError(null);
        setOpen(true);
    }

    function startEdit(row: Offering) {
        setEditing(row);
        setName(row.name);
        setDescription(row.description ?? "");
        setDuration(row.duration_min == null ? "" : String(row.duration_min));
        setPrice(row.price_cents == null ? "" : (row.price_cents / 100).toFixed(2));
        setError(null);
        setOpen(true);
    }

    async function save() {
        const durationMin = duration.trim() === "" ? null : Number(duration);
        const priceCents = price.trim() === "" ? null : Math.round(Number(price.replace(",", ".")) * 100);
        const res = await fetch("/api/admin/service/offerings", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: editing?.id ?? null,
                name,
                description,
                durationMin: Number.isFinite(durationMin) ? durationMin : null,
                priceCents: priceCents != null && Number.isFinite(priceCents) ? priceCents : null,
                active: true,
            }),
        });
        if (!res.ok) {
            setError("Não foi possível salvar a oferta.");
            return;
        }
        setOpen(false);
        await load();
    }

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Ofertas</h1>
                <Button type="button" onClick={startCreate}>Nova oferta</Button>
            </div>
            {loading ? (
                <Skeleton className="h-24 w-full" />
            ) : (
                <ul className="flex flex-col gap-2">
                    {rows.map((row) => (
                        <li key={row.id}>
                            <button
                                type="button"
                                onClick={() => startEdit(row)}
                                className="flex w-full flex-col rounded-xl border border-zinc-200 px-4 py-3 text-left dark:border-zinc-800"
                            >
                                <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{row.name}</span>
                                <span className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                                    {row.duration_min ? `${row.duration_min} min` : "Sem horário"}
                                    {row.price_cents != null ? ` · ${(row.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing ? "Editar oferta" : "Nova oferta"}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" />
                        <textarea className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição" />
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Duração em minutos, vazio se não marca hora" inputMode="numeric" />
                        <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm dark:bg-zinc-950" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Preço em reais, vazio se não houver" inputMode="decimal" />
                        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => void save()}>Salvar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
