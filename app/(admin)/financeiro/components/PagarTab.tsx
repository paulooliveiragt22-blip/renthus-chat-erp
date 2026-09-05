"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, CheckCircle2, Plus, X } from "lucide-react";
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
import { toast } from "sonner";
import { brl, EXPENSE_CATS, isoDate, PAY_META } from "../lib/format";
import type { Bill } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Filter = "open" | "partial" | "paid" | "overdue" | "all";

type Props = {
    companyId: string | null;
    refreshKey: number;
};

export default function PagarTab({ companyId, refreshKey }: Props) {
    const [bills, setBills] = useState<Bill[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<Filter>("open");
    const [payBill, setPayBill] = useState<Bill | null>(null);
    const [payForm, setPayForm] = useState({ amount: "", payment_method: "pix", received_at: isoDate(new Date()) });
    const [paying, setPaying] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [newForm, setNewForm] = useState({
        category: EXPENSE_CATS[0] ?? "Outros",
        notes: "",
        amount: "",
        due_date: isoDate(new Date()),
        payment_method: "pix",
        payment_status: "pending",
    });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const qs = new URLSearchParams({ type: "payable", status: filter });
        const res = await fetch(`/api/admin/financeiro/bills?${qs}`, { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setBills((json.bills ?? []) as Bill[]);
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
            toast.error("Erro: " + (json?.error ?? "falha"));
            return;
        }
        setPayBill(null);
        load();
    }

    async function handleNew() {
        if (!newForm.amount || !newForm.due_date) return;
        setSaving(true);
        const res = await fetch("/api/admin/financeiro/opex", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                category: newForm.category,
                notes: newForm.notes,
                amount: newForm.amount.replaceAll(",", "."),
                due_date: newForm.due_date,
                payment_method: newForm.payment_method,
                payment_status: newForm.payment_status,
                idempotency_key: `opex:${crypto.randomUUID()}`,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            toast.error("Erro: " + (json?.error ?? "falha"));
            return;
        }
        setShowNew(false);
        setNewForm({
            category: EXPENSE_CATS[0] ?? "Outros",
            notes: "",
            amount: "",
            due_date: isoDate(new Date()),
            payment_method: "pix",
            payment_status: "pending",
        });
        load();
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                {(["open", "partial", "overdue", "paid", "all"] as const).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            filter === f
                                ? "border-red-600 bg-red-600 text-white"
                                : "border-zinc-200 text-zinc-500 dark:border-zinc-700"
                        }`}
                    >
                        {{ open: "Em aberto", partial: "Parcial", overdue: "Vencidas", paid: "Pagas", all: "Todas" }[f]}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => setShowNew(true)}
                    className="ml-auto flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                    <Plus className="h-3 w-3" /> Nova conta
                </button>
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                    <ArrowUpCircle className="h-4 w-4 text-red-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Contas a pagar</p>
                    <span className="ml-auto text-xs text-zinc-400">{bills.length} registros</span>
                </div>
                {loading ? (
                    <div className="space-y-2 p-5">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : bills.length === 0 ? (
                    <p className="py-12 text-center text-sm text-zinc-400">Nenhuma conta neste filtro.</p>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-xs">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                {["Vencimento", "Descrição", "Forma", "Valor", "Saldo", "Status", ""].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-zinc-400">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                            {bills.map((b) => (
                                <tr key={b.id}>
                                    <td className="px-4 py-3 font-mono">
                                        {new Date(b.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                                    </td>
                                    <td className="px-4 py-3">{b.description ?? "—"}</td>
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
                                                Pagar
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            <Dialog open={showNew} onOpenChange={(next) => !next && setShowNew(false)}>
                <DialogContent
                    hideClose
                    className="max-w-sm gap-0 rounded-2xl p-0 shadow-2xl"
                    aria-describedby={undefined}
                >
                    <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                        <ArrowUpCircle className="h-5 w-5 text-red-600" />
                        <DialogHeader className="flex-1 space-y-0">
                            <DialogTitle className="text-sm font-bold">Nova conta a pagar</DialogTitle>
                        </DialogHeader>
                        <DialogClose asChild>
                            <button type="button" className="text-zinc-400" aria-label="Fechar">
                                <X className="h-4 w-4" />
                            </button>
                        </DialogClose>
                    </div>
                    <div className="space-y-3 p-5">
                        <Select
                            value={newForm.category}
                            onValueChange={(v) => setNewForm((p) => ({ ...p, category: v }))}
                        >
                            <SelectTrigger className="w-full rounded-xl border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EXPENSE_CATS.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <input
                            value={newForm.notes}
                            onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))}
                            placeholder="Observação"
                            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={newForm.amount}
                            onChange={(e) => setNewForm((p) => ({ ...p, amount: e.target.value }))}
                            placeholder="Valor"
                            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        <input
                            type="date"
                            value={newForm.due_date}
                            onChange={(e) => setNewForm((p) => ({ ...p, due_date: e.target.value }))}
                            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        <Select
                            value={newForm.payment_status}
                            onValueChange={(v) => setNewForm((p) => ({ ...p, payment_status: v }))}
                        >
                            <SelectTrigger className="w-full rounded-xl border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pending">A pagar</SelectItem>
                                <SelectItem value="paid">Já pago (baixa caixa)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter className="flex-row gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:justify-stretch">
                        <button
                            type="button"
                            onClick={() => setShowNew(false)}
                            className="flex-1 rounded-xl border py-2.5 text-sm"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleNew}
                            disabled={saving || !newForm.amount || !newForm.due_date}
                            className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                        >
                            {saving ? "Salvando…" : "Salvar"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                                    <DialogTitle className="text-sm font-bold">Registrar pagamento</DialogTitle>
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
