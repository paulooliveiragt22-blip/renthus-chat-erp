"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, CheckCircle2, X } from "lucide-react";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { brl, isoDate, PAY_META } from "../lib/format";
import type { AgingSummary, Bill } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Filter = "open" | "partial" | "paid" | "overdue" | "all";

type Props = {
    companyId: string | null;
    refreshKey: number;
};

export default function ReceberTab({ companyId, refreshKey }: Props) {
    const [bills, setBills] = useState<Bill[]>([]);
    const [aging, setAging] = useState<AgingSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<Filter>("open");
    const [payBill, setPayBill] = useState<Bill | null>(null);
    const [payForm, setPayForm] = useState({ amount: "", payment_method: "pix", received_at: isoDate(new Date()) });
    const [paying, setPaying] = useState(false);

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const qs = new URLSearchParams({ type: "receivable", status: filter });
        const res = await fetch(`/api/admin/financeiro/bills?${qs}`, { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setBills((json.bills ?? []) as Bill[]);
        setAging(json.aging ?? null);
        setLoading(false);
    }, [companyId, filter]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function handlePay() {
        if (!payBill || !payForm.amount) return;
        setPaying(true);
        const paid = Number.parseFloat(payForm.amount) || 0;
        const res = await fetch("/api/admin/financeiro/bills", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: payBill.id,
                pay_amount: paid,
                payment_method: payForm.payment_method,
                received_at: payForm.received_at,
                idempotency_key: `bill:${payBill.id}:settle:${paid}:${payForm.received_at}`,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setPaying(false);
        if (!res.ok) {
            alert("Erro: " + (json?.error ?? "falha"));
            return;
        }
        setPayBill(null);
        load();
    }

    return (
        <div className="flex flex-col gap-4">
            {aging && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                        { label: "Total aberto", value: aging.totalOpen, cls: "text-amber-600" },
                        { label: "A vencer", value: aging.current, cls: "text-zinc-700 dark:text-zinc-200" },
                        { label: "0–30 d", value: aging.overdue0To30, cls: "text-orange-600" },
                        { label: "31–60 d", value: aging.overdue31To60, cls: "text-orange-700" },
                        { label: "61–90 d", value: aging.overdue61To90, cls: "text-red-600" },
                        { label: "90+ d", value: aging.overdue90Plus, cls: "text-red-700" },
                    ].map((c) => (
                        <div key={c.label} className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
                            <p className="text-xs text-zinc-400">{c.label}</p>
                            <p className={`mt-1 text-lg font-bold ${c.cls}`}>{brl(c.value)}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {(["open", "partial", "overdue", "paid", "all"] as const).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            filter === f
                                ? "border-violet-600 bg-violet-600 text-white"
                                : "border-zinc-200 text-zinc-500 dark:border-zinc-700"
                        }`}
                    >
                        {{ open: "Em aberto", partial: "Parcial", overdue: "Vencidas", paid: "Pagas", all: "Todas" }[f]}
                    </button>
                ))}
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                    <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Contas a receber</p>
                    <span className="ml-auto text-xs text-zinc-400">{bills.length} registros</span>
                </div>
                {loading ? (
                    <div className="space-y-2 p-5">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : bills.length === 0 ? (
                    <p className="py-12 text-center text-sm text-zinc-400">Nenhum título neste filtro.</p>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                {["Vencimento", "Cliente", "Descrição", "Forma", "Valor", "Saldo", "Status", ""].map(
                                    (h) => (
                                        <th key={h} className="px-4 py-2.5 text-left font-semibold text-zinc-400">
                                            {h}
                                        </th>
                                    )
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                            {bills.map((b) => {
                                const overdue =
                                    b.status === "overdue" ||
                                    (b.status === "open" && new Date(b.due_date) < new Date());
                                return (
                                    <tr key={b.id}>
                                        <td className={`px-4 py-3 font-mono ${overdue && b.status !== "paid" ? "text-red-500" : "text-zinc-600"}`}>
                                            {new Date(b.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                                        </td>
                                        <td className="px-4 py-3">{b.customer_name ?? "—"}</td>
                                        <td className="px-4 py-3 text-zinc-500">{b.description ?? "—"}</td>
                                        <td className="px-4 py-3">{PAY_META[b.payment_method ?? ""]?.label ?? "—"}</td>
                                        <td className="px-4 py-3 font-mono">{brl(b.original_amount)}</td>
                                        <td className="px-4 py-3 font-mono text-amber-600">{brl(b.saldo_devedor)}</td>
                                        <td className="px-4 py-3">{b.status}</td>
                                        <td className="px-4 py-3">
                                            {b.status !== "paid" && b.status !== "canceled" && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPayBill(b);
                                                        setPayForm({
                                                            amount: b.saldo_devedor.toFixed(2),
                                                            payment_method: b.payment_method ?? "pix",
                                                            received_at: isoDate(new Date()),
                                                        });
                                                    }}
                                                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white"
                                                >
                                                    Receber
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            <Dialog open={!!payBill} onOpenChange={(next) => !next && setPayBill(null)}>
                <DialogContent
                    hideClose
                    className="max-w-sm gap-0 rounded-2xl p-0 shadow-2xl"
                    aria-describedby={undefined}
                >
                    {payBill ? (
                        <>
                            <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                <DialogHeader className="flex-1 space-y-0">
                                    <DialogTitle className="text-sm font-bold">Registrar recebimento</DialogTitle>
                                </DialogHeader>
                                <DialogClose asChild>
                                    <button type="button" className="text-zinc-400" aria-label="Fechar">
                                        <X className="h-4 w-4" />
                                    </button>
                                </DialogClose>
                            </div>
                            <div className="space-y-3 p-5">
                                <p className="text-sm">
                                    Saldo: <b className="text-amber-600">{brl(payBill.saldo_devedor)}</b>
                                </p>
                                <input
                                    type="number"
                                    min={0.01}
                                    step={0.01}
                                    value={payForm.amount}
                                    onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                />
                                <Select
                                    value={payForm.payment_method}
                                    onValueChange={(v) => setPayForm((p) => ({ ...p, payment_method: v }))}
                                >
                                    <SelectTrigger className="w-full rounded-xl border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(PAY_META).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>
                                                {v.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <input
                                    type="date"
                                    value={payForm.received_at}
                                    onChange={(e) => setPayForm((p) => ({ ...p, received_at: e.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                />
                            </div>
                            <DialogFooter className="flex-row gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:justify-stretch">
                                <button
                                    type="button"
                                    onClick={() => setPayBill(null)}
                                    className="flex-1 rounded-xl border py-2.5 text-sm"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePay}
                                    disabled={paying || !payForm.amount}
                                    className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                >
                                    {paying ? "Salvando…" : "Confirmar"}
                                </button>
                            </DialogFooter>
                        </>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
