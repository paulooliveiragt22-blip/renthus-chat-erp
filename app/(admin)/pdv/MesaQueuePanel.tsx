"use client";

import { useCallback, useEffect, useState } from "react";
import { MESA_PAYMENT_LABELS, MESA_PAYMENT_METHODS, type MesaPaymentMethod } from "@/src/mesa/domain/paymentParts";

type Part = { id: string; amount: number; method: MesaPaymentMethod };
type QueueRow = {
    session_id: string;
    table_code: string | null;
    customer_name: string | null;
    previous_table_codes?: string[];
    due: number;
    parts: Part[];
};
type OpenTable = {
    session_id: string;
    table_code: string | null;
    table_label: string | null;
    opened_at: string | null;
    due: number;
    items_count: number;
    previous_table_codes?: string[];
};

function money(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function minutesOpen(iso: string | null) {
    if (!iso) return null;
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function beforeLabel(codes: string[] | undefined) {
    if (!codes || codes.length === 0) return null;
    return `Antes ${codes.map((code) => `Mesa ${code}`).join(", ")}`;
}

export default function MesaQueuePanel({
    cashRegisterId,
    onConfirmed,
}: {
    cashRegisterId: string | null;
    onConfirmed: () => void;
}) {
    const [rows, setRows] = useState<QueueRow[]>([]);
    const [openTables, setOpenTables] = useState<OpenTable[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Part[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/pdv/mesa-queue", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setRows(Array.isArray(json.queue) ? json.queue : []);
        setOpenTables(Array.isArray(json.open) ? json.open : []);
    }, []);

    useEffect(() => {
        void load();
        const timer = setInterval(() => void load(), 12000);
        return () => clearInterval(timer);
    }, [load]);

    const open = rows.find((r) => r.session_id === openId) ?? null;

    async function confirm() {
        if (!open) return;
        if (!cashRegisterId) {
            setMsg("Abra o caixa para lançar o financeiro. A mesa já está livre.");
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/pdv/mesa-queue", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: open.session_id,
                    cash_register_id: cashRegisterId,
                    parts: draft.map((p) => ({ amount: Number(p.amount), method: p.method })),
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não confirmou.");
                return;
            }
            setOpenId(null);
            await load();
            onConfirmed();
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            <div className="mb-4">
                <div className="mb-2 flex items-center gap-2">
                    <p className="text-xs font-semibold text-emerald-300">Mesas em aberto</p>
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="ml-auto rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                    >
                        Atualizar
                    </button>
                </div>
                {openTables.length === 0 ? (
                    <p className="text-xs text-zinc-500">Nenhuma mesa em consumo.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {openTables.map((table) => (
                            <div key={table.session_id} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="truncate text-sm font-semibold text-zinc-100">
                                        {table.table_label || `Mesa ${table.table_code}`}
                                    </p>
                                    <p className="shrink-0 text-sm font-semibold text-emerald-300">{money(Number(table.due || 0))}</p>
                                </div>
                                <p className="mt-1 text-xs text-zinc-400">
                                    Em aberto
                                    {minutesOpen(table.opened_at) ? ` · ${minutesOpen(table.opened_at)}` : ""}
                                    {` · ${table.items_count} itens`}
                                </p>
                                {beforeLabel(table.previous_table_codes) && (
                                    <p className="truncate text-xs text-zinc-500">{beforeLabel(table.previous_table_codes)}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-orange-900/40 bg-orange-950/20 p-3">
                <p className="mb-2 text-xs font-semibold text-orange-200">Mesas fechadas · aguardando o caixa</p>
                {rows.length === 0 ? (
                    <p className="text-xs text-zinc-500">Nenhuma conta fechada na fila.</p>
                ) : (
                    <div className="space-y-2">
                        {rows.map((row) => (
                            <button
                                key={row.session_id}
                                type="button"
                                className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left"
                                onClick={() => {
                                    setOpenId(row.session_id);
                                    setDraft(row.parts.map((p) => ({ ...p, method: p.method })));
                                    setMsg(null);
                                }}
                            >
                                <span className="min-w-0 text-sm text-zinc-100">
                                    <span className="block truncate">Mesa {row.table_code ?? row.customer_name}</span>
                                    {beforeLabel(row.previous_table_codes) && (
                                        <span className="block truncate text-xs text-zinc-400">{beforeLabel(row.previous_table_codes)}</span>
                                    )}
                                </span>
                                <span className="shrink-0 text-sm font-semibold text-orange-300">{money(Number(row.due || 0))}</span>
                            </button>
                        ))}
                    </div>
                )}
                {open && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                        <p className="text-xs text-zinc-400">
                            Mesa {open.table_code}
                            {beforeLabel(open.previous_table_codes) ? ` · ${beforeLabel(open.previous_table_codes)}` : ""}
                            . Ajuste valor e forma se precisar.
                        </p>
                        {draft.map((part, index) => (
                            <div key={part.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                                <input
                                    inputMode="decimal"
                                    value={String(part.amount)}
                                    onChange={(e) =>
                                        setDraft((current) =>
                                            current.map((r, i) => (i === index ? { ...r, amount: Number(e.target.value.replace(",", ".")) } : r))
                                        )
                                    }
                                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                                    aria-label={`Valor da parte ${index + 1}`}
                                />
                                <select
                                    value={part.method}
                                    onChange={(e) =>
                                        setDraft((current) =>
                                            current.map((r, i) =>
                                                i === index ? { ...r, method: e.target.value as MesaPaymentMethod } : r
                                            )
                                        )
                                    }
                                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                                    aria-label={`Forma da parte ${index + 1}`}
                                >
                                    {MESA_PAYMENT_METHODS.map((method) => (
                                        <option key={method} value={method}>
                                            {MESA_PAYMENT_LABELS[method]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                        {msg && <p className="text-xs text-amber-300">{msg}</p>}
                        {!cashRegisterId && (
                            <p className="text-xs text-amber-300">Caixa fechado. A mesa já está livre; o lançamento espera o caixa abrir.</p>
                        )}
                        <button
                            type="button"
                            disabled={busy || !cashRegisterId}
                            onClick={() => void confirm()}
                            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 sm:w-auto"
                        >
                            Confirmar lançamento
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
