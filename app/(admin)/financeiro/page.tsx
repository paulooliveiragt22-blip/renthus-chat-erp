// app/(admin)/financeiro/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    BadgeDollarSign, ShoppingCart, TrendingUp, TrendingDown,
    Wallet, CreditCard, Banknote, QrCode, RefreshCcw,
    Calendar, Plus, Trash2, CheckCircle2, Clock, AlertCircle,
    ArrowDownCircle, ArrowUpCircle, X, FileText, ChevronDown,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(v: number) { return v.toFixed(1) + "%"; }
function shortDay(iso: string) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// ─── types ────────────────────────────────────────────────────────────────────

type Period = "today" | "7d" | "15d" | "30d" | "custom";
type Tab    = "dashboard" | "extrato" | "receber" | "pagar";

interface Bill {
    id: string;
    type: "receivable" | "payable";
    description: string | null;
    customer_name: string | null;
    original_amount: number;
    saldo_devedor: number;
    due_date: string;
    status: "open" | "partial" | "paid" | "overdue" | "canceled";
    payment_method: string | null;
    sale_id: string | null;
    order_id: string | null;
}

interface ExtratoLine {
    id:             string;
    date:           string;
    type:           "income" | "expense";
    source:         "order" | "financial_entry" | "expense";
    description:    string;
    customer:       string;
    channel:        string;
    payment_method: string;
    amount:         number;
    status:         string;
}

interface DaySummary  { isoDate: string; label: string; revenue: number; cost: number; orders: number; expensesDay: number }
interface PaySummary  { method: string; label: string; color: string; total: number; count: number }
interface Expense     { id: string; category: string; description: string; amount: number; due_date: string; payment_status: string }

interface Stats {
    revenue: number; cost: number; expensesPaid: number;
    profit: number; realProfit: number;
    orders: number; ticket: number;
    byDay: DaySummary[]; byPay: PaySummary[];
}

const PAY_META: Record<string, { label: string; color: string }> = {
    pix:                { label: "PIX",           color: "#22c55e" },
    card:               { label: "Cartão",         color: "#6d28d9" },
    cash:               { label: "Dinheiro",       color: "#f97316" },
    debit:              { label: "Débito",          color: "#3b82f6" },
    credit_installment: { label: "Crédito Parc.",  color: "#a855f7" },
    boleto:             { label: "Boleto",          color: "#0ea5e9" },
    promissoria:        { label: "Promissória",     color: "#f59e0b" },
    cheque:             { label: "Cheque",          color: "#64748b" },
    credit:             { label: "A Prazo",         color: "#ef4444" }, // legado
};

const EXPENSE_CATS = [
    "Fornecedor de Bebidas",
    "Aluguel",
    "Energia/Água",
    "Salários",
    "Marketing",
    "Outros",
];

const EXP_STATUS: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    pending:  { label: "Pendente",  icon: Clock,         cls: "text-amber-600  bg-amber-50  dark:bg-amber-900/20"  },
    paid:     { label: "Pago",      icon: CheckCircle2,  cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20" },
    overdue:  { label: "Vencido",   icon: AlertCircle,   cls: "text-red-600    bg-red-50    dark:bg-red-900/20"    },
};

function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700 ${className}`} />;
}

function BarTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const revenue     = payload.find((p: any) => p.dataKey === "revenue")?.value     ?? 0;
    const realProfit  = payload.find((p: any) => p.dataKey === "realProfit")?.value  ?? 0;
    const expensesDay = payload.find((p: any) => p.dataKey === "expensesDay")?.value ?? 0;
    return (
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-lg text-xs dark:border-zinc-700 dark:bg-zinc-900 space-y-1 min-w-[140px]">
            <p className="mb-1 font-bold text-zinc-700 dark:text-zinc-200">{label}</p>
            <p className="text-violet-600">Receita: <b>{brl(revenue)}</b></p>
            {realProfit > 0  && <p className="text-emerald-600">Lucro est.: <b>{brl(realProfit)}</b></p>}
            {expensesDay > 0 && <p className="text-red-500">Despesas: <b>{brl(expensesDay)}</b></p>}
        </div>
    );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function FinanceiroPage() {
    const supabase   = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const [activeTab,  setActiveTab]  = useState<Tab>("dashboard");
    const [period,     setPeriod]     = useState<Period>("30d");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo,   setCustomTo]   = useState("");
    const [loading,    setLoading]    = useState(true);
    const [stats,      setStats]      = useState<Stats | null>(null);
    const [expenses,   setExpenses]   = useState<Expense[]>([]);
    const [expLoading, setExpLoading] = useState(false);

    // Extrato
    const [extrato,        setExtrato]        = useState<ExtratoLine[]>([]);
    const [extratoLoading, setExtratoLoading] = useState(false);
    const [extratoPage,    setExtratoPage]    = useState(1);
    const EXTRATO_PAGE_SIZE = 50;

    // Contas a Receber / Pagar
    const [bills,        setBills]        = useState<Bill[]>([]);
    const [billsLoading, setBillsLoading] = useState(false);
    const [billFilter,   setBillFilter]   = useState<"open" | "paid" | "overdue" | "all">("open");

    // New expense modal
    const [showExpModal, setShowExpModal] = useState(false);
    const [expForm, setExpForm] = useState({ category: "Fornecedor de Bebidas", description: "", amount: "", due_date: isoDate(new Date()), payment_status: "pending" });
    const [saving, setSaving] = useState(false);

    // ── date range ────────────────────────────────────────────────────────────
    const dateRange = useMemo(() => {
        const now   = new Date();
        const today = isoDate(now);
        if (period === "today") return { from: today, to: today, days: 1 };
        if (period === "7d")    return { from: isoDate(new Date(Date.now() - 6  * 86400000)), to: today, days: 7  };
        if (period === "15d")   return { from: isoDate(new Date(Date.now() - 14 * 86400000)), to: today, days: 15 };
        if (period === "30d")   return { from: isoDate(new Date(Date.now() - 29 * 86400000)), to: today, days: 30 };
        if (period === "custom" && customFrom && customTo) {
            const diff = Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000) + 1;
            return { from: customFrom, to: customTo, days: Math.max(diff, 1) };
        }
        return { from: isoDate(new Date(Date.now() - 29 * 86400000)), to: today, days: 30 };
    }, [period, customFrom, customTo]);

    // ── load orders + costs ───────────────────────────────────────────────────
    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);

        const fromIso = dateRange.from + "T00:00:00.000Z";
        const toIso   = dateRange.to   + "T23:59:59.999Z";

        // 1. Pedidos não cancelados no período
        const { data: ordersRaw, error: ordErr } = await supabase
            .from("orders")
            .select("id, created_at, total_amount, delivery_fee, payment_method, status")
            .eq("company_id", companyId)
            .neq("status", "canceled")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .order("created_at", { ascending: true });

        if (ordErr) console.error("[financeiro] orders error:", ordErr.message);

        const safeOrders = (ordersRaw ?? []) as any[];
        console.log("[financeiro] pedidos carregados:", safeOrders.length, "| period:", dateRange);

        // 2. Custo real via order_items → produto_embalagens → products.preco_custo_unitario
        const orderIds = safeOrders.map((o) => o.id);
        const costMap: Record<string, number> = {};

        if (orderIds.length > 0) {
            const { data: items, error: itemErr } = await supabase
                .from("order_items")
                .select("order_id, quantity, qty, produto_embalagem_id, unit_price")
                .in("order_id", orderIds);

            if (itemErr) console.error("[financeiro] order_items error:", itemErr.message);

            const embIds = [...new Set((items ?? []).map((it: any) => it.produto_embalagem_id).filter(Boolean))];

            let embCostMap: Record<string, { baseCost: number; fator: number }> = {};
            if (embIds.length > 0) {
                const { data: embRows } = await supabase
                    .from("view_pdv_produtos")
                    .select("id, fator_conversao, product_preco_custo")
                    .eq("company_id", companyId)
                    .in("id", embIds);
                (embRows ?? []).forEach((e: any) => {
                    embCostMap[e.id] = {
                        baseCost: Number(e.product_preco_custo ?? 0),
                        fator: Number(e.fator_conversao ?? 1),
                    };
                });
            }

            (items ?? []).forEach((it: any) => {
                const q    = Number(it.quantity ?? it.qty ?? 1);
                const emb  = embCostMap[it.produto_embalagem_id];
                const cp   = emb ? emb.baseCost * emb.fator : 0;
                costMap[it.order_id] = (costMap[it.order_id] ?? 0) + cp * q;
            });
        }

        // 3. Despesas no período
        const { data: expData } = await supabase
            .from("expenses")
            .select("id, category, description, amount, due_date, payment_status")
            .eq("company_id", companyId)
            .gte("due_date", dateRange.from)
            .lte("due_date", dateRange.to)
            .order("due_date", { ascending: false });

        const safeExp = (expData ?? []) as Expense[];
        setExpenses(safeExp);

        // ── aggregate by day ──────────────────────────────────────────────────
        const dayMap: Record<string, DaySummary> = {};
        for (let i = 0; i < dateRange.days; i++) {
            const d   = new Date(Date.now() - (dateRange.days - 1 - i) * 86400000);
            const iso = isoDate(d);
            dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
        }

        safeOrders.forEach((o) => {
            const iso = o.created_at.slice(0, 10);
            if (!dayMap[iso]) dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
            dayMap[iso].revenue += Number(o.total_amount ?? 0);
            dayMap[iso].cost    += costMap[o.id] ?? 0;
            dayMap[iso].orders  += 1;
        });

        // map paid expenses to their due_date day
        safeExp.forEach((e) => {
            if (e.payment_status !== "paid") return;
            const iso = e.due_date;
            if (!dayMap[iso]) dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
            dayMap[iso].expensesDay += Number(e.amount);
        });

        const byDay = Object.values(dayMap).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

        // ── aggregate by payment method ───────────────────────────────────────
        const payMap: Record<string, { total: number; count: number }> = {};
        safeOrders.forEach((o) => {
            const m = (o.payment_method ?? "outros") as string;
            if (!payMap[m]) payMap[m] = { total: 0, count: 0 };
            payMap[m].total += Number(o.total_amount ?? 0);
            payMap[m].count += 1;
        });

        const byPay: PaySummary[] = Object.entries(payMap).map(([method, v]) => {
            const meta = PAY_META[method] ?? { label: method, color: "#a1a1aa" };
            return { method, ...meta, ...v };
        }).sort((a, b) => b.total - a.total);

        // ── totals ────────────────────────────────────────────────────────────
        const revenue      = byDay.reduce((s, d) => s + d.revenue, 0);
        const cost         = byDay.reduce((s, d) => s + d.cost,    0);
        const expensesPaid = safeExp.filter(e => e.payment_status === "paid").reduce((s, e) => s + Number(e.amount), 0);
        const orders       = byDay.reduce((s, d) => s + d.orders,  0);

        setStats({
            revenue, cost, expensesPaid,
            profit:     revenue - cost,
            realProfit: revenue - cost - expensesPaid,
            orders,
            ticket: orders > 0 ? revenue / orders : 0,
            byDay, byPay,
        });
        setLoading(false);
    }, [companyId, supabase, dateRange]);

    useEffect(() => { load(); }, [load]);

    // ── expense CRUD ──────────────────────────────────────────────────────────
    const saveExpense = async () => {
        if (!companyId || !expForm.amount || !expForm.due_date) return;
        setSaving(true);
        const { error } = await supabase.from("expenses").insert({
            company_id:     companyId,
            category:       expForm.category,
            description:    expForm.description,
            amount:         parseFloat(expForm.amount.replace(",", ".")),
            due_date:       expForm.due_date,
            payment_status: expForm.payment_status,
            ...(expForm.payment_status === "paid" ? { paid_at: new Date().toISOString() } : {}),
        });
        if (!error) {
            setExpForm({ category: "Fornecedor de Bebidas", description: "", amount: "", due_date: isoDate(new Date()), payment_status: "pending" });
            setShowExpModal(false);
            load();
        }
        setSaving(false);
    };

    const deleteExpense = async (id: string) => {
        await supabase.from("expenses").delete().eq("id", id);
        setExpenses((p) => p.filter((e) => e.id !== id));
        load();
    };

    const markPaid = async (id: string) => {
        await supabase.from("expenses").update({ payment_status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
        load();
    };

    // ── extrato (aba) ────────────────────────────────────────────────────────
    const loadExtrato = useCallback(async () => {
        if (!companyId) return;
        setExtratoLoading(true);
        const fromIso = dateRange.from + "T00:00:00.000Z";
        const toIso   = dateRange.to   + "T23:59:59.999Z";

        const lines: ExtratoLine[] = [];

        // 1. Pedidos (não cancelados) com cliente
        const { data: ordRows } = await supabase
            .from("orders")
            .select("id, created_at, total_amount, payment_method, status, channel, customers(name)")
            .eq("company_id", companyId)
            .neq("status", "canceled")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .order("created_at", { ascending: false })
            .limit(500);

        (ordRows ?? []).forEach((o: any) => {
            lines.push({
                id:             `ord-${o.id}`,
                date:           o.created_at,
                type:           "income",
                source:         "order",
                description:    `Pedido #${(o.id as string).slice(0,8)}`,
                customer:       o.customers?.name ?? "—",
                channel:        o.channel ?? "admin",
                payment_method: o.payment_method ?? "—",
                amount:         Number(o.total_amount ?? 0),
                status:         o.status,
            });
        });

        // 2. financial_entries no período
        const { data: feRows } = await supabase
            .from("financial_entries")
            .select("id, created_at, type, amount, payment_method, description, order_id")
            .eq("company_id", companyId)
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .order("created_at", { ascending: false })
            .limit(500);

        (feRows ?? []).forEach((f: any) => {
            lines.push({
                id:             `fe-${f.id}`,
                date:           f.created_at,
                type:           f.type === "expense" ? "expense" : "income",
                source:         "financial_entry",
                description:    f.description ?? `Lançamento #${(f.id as string).slice(0,8)}`,
                customer:       "—",
                channel:        f.order_id ? "pedido" : "manual",
                payment_method: f.payment_method ?? "—",
                amount:         Number(f.amount ?? 0),
                status:         "lançado",
            });
        });

        // 3. Despesas no período
        (expenses).forEach((e) => {
            lines.push({
                id:             `exp-${e.id}`,
                date:           e.due_date + "T12:00:00",
                type:           "expense",
                source:         "expense",
                description:    `${e.category}${e.description ? ` — ${e.description}` : ""}`,
                customer:       "—",
                channel:        "despesa",
                payment_method: "—",
                amount:         Number(e.amount ?? 0),
                status:         e.payment_status === "paid" ? "pago" : "pendente",
            });
        });

        lines.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setExtrato(lines);
        setExtratoPage(1);
        setExtratoLoading(false);
    }, [companyId, supabase, dateRange, expenses]);

    useEffect(() => {
        if (activeTab === "extrato") loadExtrato();
    }, [activeTab, loadExtrato]);

    // ── contas a receber / pagar ──────────────────────────────────────────────
    const loadBills = useCallback(async (type: "receivable" | "payable") => {
        if (!companyId) return;
        setBillsLoading(true);
        let q = supabase
            .from("bills")
            .select(`
                id, type, description, original_amount, saldo_devedor,
                due_date, status, payment_method, sale_id, order_id,
                customers(name)
            `)
            .eq("company_id", companyId)
            .eq("type", type)
            .order("due_date", { ascending: true });
        if (billFilter !== "all") q = q.eq("status", billFilter);
        const { data, error } = await q;
        if (error) console.error("[financeiro] bills:", error.message);
        setBills((data ?? []).map((b: any) => ({
            ...b,
            customer_name: b.customers?.name ?? null,
        })));
        setBillsLoading(false);
    }, [companyId, supabase, billFilter]);

    useEffect(() => {
        if (activeTab === "receber") loadBills("receivable");
        if (activeTab === "pagar")   loadBills("payable");
    }, [activeTab, loadBills]);

    const extratoPages     = Math.ceil(extrato.length / EXTRATO_PAGE_SIZE);
    const extratoSlice     = extrato.slice((extratoPage - 1) * EXTRATO_PAGE_SIZE, extratoPage * EXTRATO_PAGE_SIZE);
    const extratoIncome    = extrato.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
    const extratoExpenses  = extrato.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);

    const CHANNEL_LABEL: Record<string, string> = {
        whatsapp: "WhatsApp",
        admin:    "Admin",
        pdv:      "PDV",
        manual:   "Manual",
        pedido:   "Pedido",
        despesa:  "Despesa",
    };
    const PAY_LABEL: Record<string, string> = {
        pix:      "PIX",
        card:     "Cartão",
        cash:     "Dinheiro",
        credit:   "A Prazo",
        a_prazo:  "A Prazo",
        "—":      "—",
    };

    // ── chart config ──────────────────────────────────────────────────────────
    const chartColor = isDark ? "#a78bfa" : "#7c3aed";
    const gridColor  = isDark ? "#3f3f46" : "#e4e4e7";
    const axisColor  = isDark ? "#71717a" : "#a1a1aa";

    const periodLabel = { today:"Hoje","7d":"7d","15d":"15d","30d":"30d",custom:"Personalizado" }[period];
    const profitMargin  = stats && stats.revenue > 0 ? (stats.profit     / stats.revenue) * 100 : 0;
    const realMargin    = stats && stats.revenue > 0 ? (stats.realProfit / stats.revenue) * 100 : 0;

    // Pie chart data for expenses category
    const expensePieData = useMemo(() => {
        const catMap: Record<string, number> = {};
        expenses.forEach((e) => { catMap[e.category] = (catMap[e.category] ?? 0) + Number(e.amount); });
        const COLORS = ["#7c3aed","#f97316","#22c55e","#0ea5e9","#f43f5e","#a855f7","#eab308"];
        return Object.entries(catMap).map(([name, value], i) => ({ name, value, fill: COLORS[i % COLORS.length] }));
    }, [expenses]);

    // Chart data: revenue + estimated profit + daily expenses
    const realProfitData = useMemo(() => {
        if (!stats) return [];
        return stats.byDay.map((d) => ({
            ...d,
            realProfit:   Math.max(0, d.revenue - d.cost),
            expensesDay:  d.expensesDay,
        }));
    }, [stats]);

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <><div className="flex flex-col gap-6 p-6">

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Financeiro</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Receita, custos, despesas e lucro real do período</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {(["today","7d","15d","30d","custom"] as Period[]).map((p) => (
                        <button key={p} onClick={() => setPeriod(p)}
                            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                period === p
                                    ? "border-violet-600 bg-violet-600 text-white"
                                    : "border-zinc-200 bg-white text-zinc-600 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}>
                            <Calendar className="h-3 w-3" />
                            {{ today:"Hoje","7d":"7d","15d":"15d","30d":"30d",custom:"Personalizado" }[p]}
                        </button>
                    ))}
                    <button onClick={
                        activeTab === "extrato" ? loadExtrato
                        : activeTab === "receber" ? () => loadBills("receivable")
                        : activeTab === "pagar"   ? () => loadBills("payable")
                        : load
                    } disabled={loading || extratoLoading || billsLoading}
                        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                        <RefreshCcw className={`h-3 w-3 ${(loading || extratoLoading || billsLoading) ? "animate-spin" : ""}`} />
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50 w-fit">
                <button onClick={() => setActiveTab("dashboard")}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                        activeTab === "dashboard"
                            ? "bg-white text-violet-700 shadow dark:bg-zinc-800 dark:text-violet-400"
                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}>
                    <BadgeDollarSign className="h-3.5 w-3.5" /> Dashboard
                </button>
                <button onClick={() => setActiveTab("extrato")}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                        activeTab === "extrato"
                            ? "bg-white text-violet-700 shadow dark:bg-zinc-800 dark:text-violet-400"
                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}>
                    <FileText className="h-3.5 w-3.5" /> Extrato
                    {extrato.length > 0 && (
                        <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                            {extrato.length}
                        </span>
                    )}
                </button>
                <button onClick={() => setActiveTab("receber")}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                        activeTab === "receber"
                            ? "bg-white text-emerald-700 shadow dark:bg-zinc-800 dark:text-emerald-400"
                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}>
                    <ArrowDownCircle className="h-3.5 w-3.5" /> A Receber
                    {bills.filter(b => b.type === "receivable" && b.status !== "paid" && b.status !== "canceled").length > 0 && activeTab === "receber" && (
                        <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            {bills.filter(b => b.status !== "paid" && b.status !== "canceled").length}
                        </span>
                    )}
                </button>
                <button onClick={() => setActiveTab("pagar")}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                        activeTab === "pagar"
                            ? "bg-white text-red-700 shadow dark:bg-zinc-800 dark:text-red-400"
                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}>
                    <ArrowUpCircle className="h-3.5 w-3.5" /> A Pagar
                </button>
            </div>

            {period === "custom" && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="text-xs font-medium text-zinc-500">Período:</p>
                    <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                    <span className="text-xs text-zinc-400">até</span>
                    <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                </div>
            )}

            {activeTab === "dashboard" && (<>
            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                    { icon: BadgeDollarSign, label: "Receita Bruta",   value: stats ? brl(stats.revenue)     : "—", sub: `${stats?.orders ?? 0} pedidos`, bg: "bg-violet-100 dark:bg-violet-900/30", ic: "text-violet-600" },
                    { icon: TrendingUp,      label: "Lucro s/ Custo",  value: stats ? brl(stats.profit)      : "—", sub: stats && stats.revenue > 0 ? `Margem ${pct(profitMargin)}` : "Cadastre custo", bg: "bg-emerald-100 dark:bg-emerald-900/30", ic: "text-emerald-600" },
                    { icon: TrendingDown,    label: "Despesas Pagas",  value: stats ? brl(stats.expensesPaid): "—", sub: `${expenses.filter(e=>e.payment_status==="paid").length} lançamentos`, bg: "bg-red-100 dark:bg-red-900/30", ic: "text-red-500" },
                    { icon: Wallet,          label: "Lucro Real",      value: stats ? brl(stats.realProfit)  : "—", sub: stats && stats.revenue > 0 ? `Margem real ${pct(realMargin)}` : "após despesas", bg: "bg-orange-100 dark:bg-orange-900/30", ic: "text-orange-500" },
                ].map(({ icon: Icon, label, value, sub, bg, ic }) => (
                    <div key={label} className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                            <Icon className={`h-5 w-5 ${ic}`} />
                        </span>
                        <div className="min-w-0">
                            <p className="text-xs text-zinc-400">{label}</p>
                            {loading ? <Skeleton className="mt-1 h-7 w-28" /> : <p className="truncate text-xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>}
                            <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Bar chart */}
            <div className="rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Faturamento por dia — {periodLabel}</p>
                        <p className="text-xs text-zinc-400">Barra roxa = receita · Verde claro = lucro estimado</p>
                    </div>
                    {stats && <span className="rounded-full bg-violet-100 px-3 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{brl(stats.revenue)}</span>}
                </div>
                {loading ? <Skeleton className="h-[220px] w-full" /> : (
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={realProfitData} barCategoryGap="30%">
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false}
                                interval={stats && stats.byDay.length > 14 ? Math.floor(stats.byDay.length / 7) : 0} />
                            <YAxis tickFormatter={(v) => `R$${v >= 1000 ? (v/1000).toFixed(0)+"k" : v}`}
                                tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={52} />
                            <Tooltip content={<BarTooltip />} cursor={{ fill: isDark ? "#3f3f4650" : "#f4f4f550" }} />
                            <Bar dataKey="revenue" radius={[4,4,0,0]} maxBarSize={36} fill={chartColor} opacity={0.9} />
                            <Bar dataKey="realProfit" radius={[4,4,0,0]} maxBarSize={36} fill="#22c55e" opacity={0.75} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Bottom row */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

                {/* Payment methods */}
                <div className="rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-violet-600" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Formas de Pagamento</p>
                    </div>
                    {loading ? <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                        : !stats?.byPay.length ? <p className="py-8 text-center text-sm text-zinc-400">Sem dados.</p>
                        : (
                            <div className="space-y-3">
                                {stats.byPay.map(({ method, label, color, total, count }) => {
                                    const share = stats.revenue > 0 ? (total / stats.revenue) * 100 : 0;
                                    const Icon = method === "pix" ? QrCode : method === "card" ? CreditCard : Banknote;
                                    return (
                                        <div key={method}>
                                            <div className="mb-1 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Icon className="h-4 w-4" style={{ color }} />
                                                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
                                                    <span className="text-xs text-zinc-400">({count})</span>
                                                </div>
                                                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{brl(total)}</span>
                                            </div>
                                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${share}%`, backgroundColor: color }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                </div>

                {/* Profit breakdown */}
                <div className="rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Análise de Resultado</p>
                    </div>
                    {loading ? <div className="space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div> : (
                        <div className="space-y-3">
                            {[
                                { label: "Receita bruta",  value: stats?.revenue      ?? 0, color: "#7c3aed", textCls: "text-violet-600",  icon: BadgeDollarSign },
                                { label: "Custo produtos", value: stats?.cost         ?? 0, color: "#f43f5e", textCls: "text-red-500",     icon: ShoppingCart    },
                                { label: "Despesas pagas", value: stats?.expensesPaid ?? 0, color: "#f97316", textCls: "text-orange-500",  icon: TrendingDown    },
                                { label: "Lucro real",     value: stats?.realProfit   ?? 0, color: "#22c55e", textCls: "text-emerald-600", icon: TrendingUp      },
                            ].map(({ label, value, color, textCls, icon: Icon }) => {
                                const share = (stats?.revenue ?? 1) > 0 ? Math.min(Math.abs(value) / (stats?.revenue ?? 1) * 100, 100) : 0;
                                return (
                                    <div key={label} className="rounded-xl border border-zinc-100 p-3 dark:border-zinc-800">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Icon className={`h-4 w-4 ${textCls}`} />
                                                <p className="text-xs text-zinc-500">{label}</p>
                                            </div>
                                            <p className={`text-sm font-bold ${textCls}`}>{brl(value)}</p>
                                        </div>
                                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${share}%`, backgroundColor: color }} />
                                        </div>
                                    </div>
                                );
                            })}
                            {stats && stats.cost === 0 && (
                                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400">
                                    ⚠️ Cadastre o <strong>Preço de Custo</strong> nos produtos para ver o lucro real.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Expenses pie */}
                <div className="rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Despesas por categoria</p>
                    </div>
                    {expensePieData.length === 0
                        ? <p className="py-8 text-center text-xs text-zinc-400">Nenhuma despesa no período.</p>
                        : (
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie data={expensePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                                        {expensePieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: number) => brl(v)} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                </div>
            </div>

            {/* Expenses table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                    <TrendingDown className="h-4 w-4 text-red-500" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Despesas — {periodLabel}</p>
                    <span className="ml-auto text-xs text-zinc-400">
                        Total: <b className="text-red-500">{brl(expenses.reduce((s,e) => s + Number(e.amount), 0))}</b>
                    </span>
                    <button onClick={() => setShowExpModal(true)}
                        className="flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600 transition-colors">
                        <Plus className="h-3 w-3" /> Nova
                    </button>
                </div>

                {/* New expense form */}
                {showExpModal && (
                    <div className="border-b border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            <select value={expForm.category} onChange={(e) => setExpForm(f => ({ ...f, category: e.target.value }))}
                                className="col-span-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input placeholder="Descrição" value={expForm.description} onChange={(e) => setExpForm(f => ({ ...f, description: e.target.value }))}
                                className="col-span-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                            <input placeholder="Valor (R$)" value={expForm.amount} onChange={(e) => setExpForm(f => ({ ...f, amount: e.target.value }))}
                                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                            <input type="date" value={expForm.due_date} onChange={(e) => setExpForm(f => ({ ...f, due_date: e.target.value }))}
                                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                            <div className="flex gap-2">
                                <select value={expForm.payment_status} onChange={(e) => setExpForm(f => ({ ...f, payment_status: e.target.value }))}
                                    className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                    <option value="pending">Pendente</option>
                                    <option value="paid">Pago</option>
                                </select>
                                <button onClick={saveExpense} disabled={saving}
                                    className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                                    {saving ? "…" : "OK"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {expenses.length === 0
                    ? <p className="py-12 text-center text-sm text-zinc-400">Nenhuma despesa cadastrada para este período.</p>
                    : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            <div className="grid grid-cols-5 gap-4 bg-zinc-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/50">
                                <span>Categoria</span><span>Descrição</span><span className="text-right">Valor</span><span className="text-right">Vencimento</span><span className="text-right">Status</span>
                            </div>
                            {expenses.map((e) => {
                                const st = EXP_STATUS[e.payment_status] ?? EXP_STATUS.pending;
                                const StIcon = st.icon;
                                return (
                                    <div key={e.id} className="group grid grid-cols-5 gap-4 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors items-center">
                                        <span className="text-xs font-medium capitalize text-zinc-700 dark:text-zinc-300">{e.category}</span>
                                        <span className="truncate text-xs text-zinc-500">{e.description || "—"}</span>
                                        <span className="text-right text-sm font-bold text-red-500">{brl(Number(e.amount))}</span>
                                        <span className="text-right text-xs text-zinc-500">{new Date(e.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                                        <div className="flex items-center justify-end gap-2">
                                            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                                                <StIcon className="h-3 w-3" />{st.label}
                                            </span>
                                            {e.payment_status !== "paid" && (
                                                <button onClick={() => markPaid(e.id)} title="Marcar como pago"
                                                    className="hidden group-hover:flex items-center rounded-lg bg-emerald-100 p-1 text-emerald-600 hover:bg-emerald-200 dark:bg-emerald-900/30">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                            <button onClick={() => deleteExpense(e.id)}
                                                className="hidden group-hover:flex items-center rounded-lg bg-red-100 p-1 text-red-500 hover:bg-red-200 dark:bg-red-900/30">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
            </div>

            {/* Day-by-day table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                    <Wallet className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Detalhamento por dia</p>
                    <span className="ml-auto text-xs text-zinc-400">{periodLabel}</span>
                </div>
                {loading ? (
                    <div className="space-y-px p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : !stats?.byDay.filter(d => d.orders > 0).length ? (
                    <p className="py-16 text-center text-sm text-zinc-400">Nenhum pedido no período.</p>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        <div className="grid grid-cols-4 gap-4 bg-zinc-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/50">
                            <span>Data</span><span className="text-right">Pedidos</span><span className="text-right">Faturamento</span><span className="text-right">Lucro est.</span>
                        </div>
                        {stats.byDay.filter(d => d.orders > 0).reverse().map((d) => (
                            <div key={d.isoDate} className="grid grid-cols-4 gap-4 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{d.label}</p>
                                <p className="text-right text-sm text-zinc-500">{d.orders}</p>
                                <p className="text-right text-sm font-bold text-violet-600">{brl(d.revenue)}</p>
                                <p className={`text-right text-sm font-bold ${d.cost > 0 ? "text-emerald-600" : "text-zinc-300 dark:text-zinc-600"}`}>
                                    {d.cost > 0 ? brl(d.revenue - d.cost) : "—"}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            </>)}

            {/* ── Extrato Tab ─────────────────────────────────────────────────── */}
            {activeTab === "extrato" && (
                <div className="flex flex-col gap-4">
                    {/* summary strip */}
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { icon: ArrowUpCircle,   label: "Entradas",  value: brl(extratoIncome),   cls: "text-emerald-600" },
                            { icon: ArrowDownCircle, label: "Saídas",    value: brl(extratoExpenses), cls: "text-red-500" },
                            { icon: Wallet,          label: "Saldo",     value: brl(extratoIncome - extratoExpenses), cls: extratoIncome - extratoExpenses >= 0 ? "text-violet-600" : "text-red-500" },
                        ].map(({ icon: Icon, label, value, cls }) => (
                            <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                                <Icon className={`h-5 w-5 ${cls}`} />
                                <div>
                                    <p className="text-xs text-zinc-400">{label}</p>
                                    <p className={`text-lg font-bold ${cls}`}>{value}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* table */}
                    <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                            <FileText className="h-4 w-4 text-violet-600" />
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Extrato — {periodLabel}</p>
                            <span className="ml-auto text-xs text-zinc-400">{extrato.length} lançamentos</span>
                        </div>

                        {extratoLoading ? (
                            <div className="space-y-px p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                        ) : extrato.length === 0 ? (
                            <p className="py-16 text-center text-sm text-zinc-400">Nenhum lançamento no período.</p>
                        ) : (
                            <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                                            <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">Data</th>
                                            <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">Descrição</th>
                                            <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">Cliente</th>
                                            <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">Canal</th>
                                            <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">Pagamento</th>
                                            <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wide text-zinc-400">Valor</th>
                                            <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {extratoSlice.map((line) => (
                                            <tr key={line.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                                <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                                                    {new Date(line.date).toLocaleDateString("pt-BR")}
                                                    <span className="ml-1 text-zinc-300 dark:text-zinc-600">
                                                        {new Date(line.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                                    </span>
                                                </td>
                                                <td className="max-w-[220px] truncate px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{line.description}</td>
                                                <td className="px-4 py-3 text-zinc-500">{line.customer}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                        line.channel === "whatsapp" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                                        line.channel === "pdv"      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
                                                        line.channel === "despesa"  ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                                                        "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                                                    }`}>
                                                        {CHANNEL_LABEL[line.channel] ?? line.channel}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-zinc-500">{PAY_LABEL[line.payment_method] ?? line.payment_method}</td>
                                                <td className={`px-4 py-3 text-right font-bold ${line.type === "expense" ? "text-red-500" : "text-emerald-600"}`}>
                                                    {line.type === "expense" ? "− " : "+ "}{brl(line.amount)}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                        line.status === "finalized" || line.status === "delivered" || line.status === "lançado" || line.status === "pago"
                                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                            : line.status === "new"
                                                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                    }`}>
                                                        {line.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* pagination */}
                            {extratoPages > 1 && (
                                <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
                                    <p className="text-xs text-zinc-400">
                                        Página {extratoPage} de {extratoPages} · {extrato.length} registros
                                    </p>
                                    <div className="flex gap-2">
                                        <button onClick={() => setExtratoPage(p => Math.max(1, p - 1))} disabled={extratoPage === 1}
                                            className="rounded-lg border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-zinc-700">← Anterior</button>
                                        <button onClick={() => setExtratoPage(p => Math.min(extratoPages, p + 1))} disabled={extratoPage === extratoPages}
                                            className="rounded-lg border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-zinc-700">Próxima →</button>
                                    </div>
                                </div>
                            )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Contas a Receber / Pagar ────────────────────────────────────── */}
            {(activeTab === "receber" || activeTab === "pagar") && (
                <div className="flex flex-col gap-4">
                    {/* Filter strip */}
                    <div className="flex items-center gap-2">
                        {(["open","overdue","paid","all"] as const).map(f => (
                            <button key={f} onClick={() => setBillFilter(f)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${
                                    billFilter === f
                                        ? "bg-violet-600 text-white border-violet-600"
                                        : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                }`}>
                                {{ open:"Em aberto", overdue:"Vencidas", paid:"Pagas", all:"Todas" }[f]}
                            </button>
                        ))}
                        <button onClick={() => activeTab === "receber" ? loadBills("receivable") : loadBills("payable")}
                            disabled={billsLoading}
                            className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                            <RefreshCcw className={`h-3 w-3 ${billsLoading ? "animate-spin" : ""}`} />
                            Atualizar
                        </button>
                    </div>

                    {/* Totais rápidos */}
                    {bills.length > 0 && (
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { label: "Total em aberto",  value: bills.filter(b => b.status === "open" || b.status === "partial").reduce((s,b) => s + b.saldo_devedor, 0), cls: "text-amber-600" },
                                { label: "Total vencido",    value: bills.filter(b => b.status === "overdue").reduce((s,b) => s + b.saldo_devedor, 0), cls: "text-red-600" },
                                { label: "Total recebido",   value: bills.filter(b => b.status === "paid").reduce((s,b) => s + b.original_amount, 0), cls: "text-emerald-600" },
                            ].map(c => (
                                <div key={c.label} className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
                                    <p className="text-xs text-zinc-400">{c.label}</p>
                                    <p className={`mt-1 text-lg font-bold ${c.cls}`}>{brl(c.value)}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Table */}
                    <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                            {activeTab === "receber"
                                ? <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                                : <ArrowUpCircle className="h-4 w-4 text-red-600" />
                            }
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                {activeTab === "receber" ? "Contas a Receber" : "Contas a Pagar"}
                            </p>
                            <span className="ml-auto text-xs text-zinc-400">{bills.length} registros</span>
                        </div>

                        {billsLoading ? (
                            <div className="space-y-2 p-5">
                                {[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10 w-full" />)}
                            </div>
                        ) : bills.length === 0 ? (
                            <div className="py-12 text-center">
                                <CheckCircle2 className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                                <p className="mt-2 text-sm text-zinc-400">Nenhum registro encontrado</p>
                            </div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                        {["Vencimento","Cliente","Descrição","Forma","Valor","Saldo","Status"].map(h => (
                                            <th key={h} className="px-4 py-2.5 text-left font-semibold text-zinc-400">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                                    {bills.map(b => {
                                        const isOverdue = b.status === "overdue" || (b.status === "open" && new Date(b.due_date) < new Date());
                                        const statusInfo = {
                                            open:     { label: "Em aberto",  cls: "text-amber-600 bg-amber-50 dark:bg-amber-900/20" },
                                            partial:  { label: "Parcial",    cls: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
                                            paid:     { label: "Pago",       cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20" },
                                            overdue:  { label: "Vencido",    cls: "text-red-600 bg-red-50 dark:bg-red-900/20" },
                                            canceled: { label: "Cancelado",  cls: "text-zinc-400 bg-zinc-100 dark:bg-zinc-800" },
                                        }[isOverdue && b.status !== "paid" ? "overdue" : b.status] ?? { label: b.status, cls: "text-zinc-400" };
                                        return (
                                            <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                                <td className={`px-4 py-3 font-mono ${isOverdue && b.status !== "paid" ? "text-red-500" : "text-zinc-600 dark:text-zinc-400"}`}>
                                                    {new Date(b.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                                                </td>
                                                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{b.customer_name ?? "—"}</td>
                                                <td className="px-4 py-3 text-zinc-500">{b.description ?? "—"}</td>
                                                <td className="px-4 py-3 text-zinc-500">{PAY_META[b.payment_method ?? ""]?.label ?? b.payment_method ?? "—"}</td>
                                                <td className="px-4 py-3 font-mono font-semibold text-zinc-700 dark:text-zinc-200">{brl(b.original_amount)}</td>
                                                <td className={`px-4 py-3 font-mono font-semibold ${b.saldo_devedor > 0 ? "text-amber-600" : "text-emerald-600"}`}>{brl(b.saldo_devedor)}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${statusInfo.cls}`}>
                                                        {statusInfo.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>

        {/* ── Nova Despesa Modal (dark mode) ────────────────────────────────── */}
        {showExpModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
                    <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/20">
                            <ArrowDownCircle className="h-5 w-5 text-red-400" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-bold text-zinc-100">Nova Despesa</p>
                            <p className="text-xs text-zinc-500">Registre um lançamento de saída</p>
                        </div>
                        <button onClick={() => setShowExpModal(false)} className="rounded-lg p-1 text-zinc-500 hover:text-zinc-200">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="space-y-4 px-6 py-5">
                        <div>
                            <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Categoria</label>
                            <select value={expForm.category} onChange={(e) => setExpForm(f => ({ ...f, category: e.target.value }))}
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none">
                                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Descrição <span className="text-zinc-600">(opcional)</span></label>
                            <input value={expForm.description} onChange={(e) => setExpForm(f => ({ ...f, description: e.target.value }))}
                                placeholder="Ex: Nota fiscal fornecedor X"
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-500 focus:outline-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Valor (R$)</label>
                                <input type="number" min={0} step={0.01} value={expForm.amount}
                                    onChange={(e) => setExpForm(f => ({ ...f, amount: e.target.value }))}
                                    placeholder="0,00"
                                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Vencimento</label>
                                <input type="date" value={expForm.due_date}
                                    onChange={(e) => setExpForm(f => ({ ...f, due_date: e.target.value }))}
                                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-red-500 focus:outline-none" />
                            </div>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Status</label>
                            <div className="flex gap-2">
                                {[{v:"pending",l:"Pendente"},{v:"paid",l:"Pago"}].map(({ v, l }) => (
                                    <button key={v} type="button" onClick={() => setExpForm(f => ({ ...f, payment_status: v }))}
                                        className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors ${
                                            expForm.payment_status === v
                                                ? v==="paid" ? "border-emerald-600 bg-emerald-900/30 text-emerald-400" : "border-amber-600 bg-amber-900/30 text-amber-400"
                                                : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600"
                                        }`}>
                                        {l}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-3 border-t border-zinc-800 px-6 py-4">
                        <button onClick={() => setShowExpModal(false)}
                            className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-400 hover:border-zinc-600 transition-colors">
                            Cancelar
                        </button>
                        <button onClick={saveExpense} disabled={saving || !expForm.amount || !expForm.due_date}
                            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-40 transition-colors">
                            {saving ? "Salvando…" : "Registrar Despesa"}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
