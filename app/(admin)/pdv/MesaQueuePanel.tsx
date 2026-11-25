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

function money(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function MesaQueuePanel({
    cashRegisterId,
    onConfirmed,
}: {
    cashRegisterId: string | null;
    onConfirmed: () => void;
}) {
    const [rows, setRows] = useState<QueueRow[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Part[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/pdv/mesa-queue", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setRows(Array.isArray(json.queue) ? json.queue : []);
    }, []);

    useEffect(() => {
        void load();
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

    if (rows.length === 0 && !open) return null;

    return (
        <div className="mb-4 rounded-xl border border-orange-900/40 bg-orange-950/20 p-3">
            <p className="mb-2 text-xs font-semibold text-orange-200">Contas de mesa aguardando o caixa</p>
            <div className="space-y-2">
                {rows.map((row) => (
                    <button
                        key={row.session_id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left"
                        onClick={() => {
                            setOpenId(row.session_id);
                            setDraft(row.parts.map((p) => ({ ...p, method: p.method })));
                            setMsg(null);
                        }}
                    >
                        <span className="min-w-0 text-sm text-zinc-100">
                            <span className="block truncate">Mesa {row.table_code ?? row.customer_name}</span>
                            {(row.previous_table_codes ?? []).length > 0 && (
                                <span className="block truncate text-xs text-zinc-400">
                                    Antes {(row.previous_table_codes ?? []).map((code) => `Mesa ${code}`).join(", ")}
                                </span>
                            )}
                        </span>
                        <span className="text-sm font-semibold text-orange-300">{money(Number(row.due || 0))}</span>
                    </button>
                ))}
            </div>
            {open && (
                <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                    <p className="text-xs text-zinc-400">
                        Mesa {open.table_code}
                        {(open.previous_table_codes ?? []).length > 0
                            ? ` · antes ${(open.previous_table_codes ?? []).map((code) => `Mesa ${code}`).join(", ")}`
                            : ""}
                        . Ajuste valor e forma se precisar.
                    </p>
                    {draft.map((part, index) => (
                        <div key={part.id} className="grid grid-cols-[1fr_8rem] gap-2">
                            <input
                                inputMode="decimal"
                                value={String(part.amount)}
                                onChange={(e) =>
                                    setDraft((rows) =>
                                        rows.map((r, i) => (i === index ? { ...r, amount: Number(e.target.value.replace(",", ".")) } : r))
                                    )
                                }
                                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                            />
                            <select
                                value={part.method}
                                onChange={(e) =>
                                    setDraft((rows) =>
                                        rows.map((r, i) =>
                                            i === index ? { ...r, method: e.target.value as MesaPaymentMethod } : r
                                        )
                                    )
                                }
                                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
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
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                        Confirmar lançamento
                    </button>
                </div>
            )}
        </div>
    );
}
