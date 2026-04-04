// app/(admin)/estoque/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    AlertTriangle, ArrowDownCircle, ArrowUpCircle, BarChart3,
    DollarSign, Loader2, Package, Plus, RefreshCw, Search, Settings2,
    TrendingDown, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type StockItem = {
    id:                   string;   // product_volumes.id
    name:                 string;   // products.name
    category:             string;
    details:              string | null;  // "330 ml"
    codigo_interno:       string | null;
    preco_custo_unitario: number;
    estoque_minimo:       number;
    estoque_atual:        number;
    is_active:            boolean;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function brl(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function stockStatus(atual: number, minimo: number): "zero" | "low" | "ok" {
    if (atual <= 0)                        return "zero";
    if (minimo > 0 && atual <= minimo)     return "low";
    if (minimo === 0 && atual <= 5)        return "low";  // fallback quando min não definido
    return "ok";
}

function stockColorClass(atual: number, minimo: number) {
    const s = stockStatus(atual, minimo);
    if (s === "zero") return "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400";
    if (s === "low")  return "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400";
    return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400";
}

// ─── sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";

function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
    if (!open) return null;
    return (
        <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
                    <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function EstoquePage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();

    const [items,   setItems]   = useState<StockItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search,  setSearch]  = useState("");
    const [showInactive, setShowInactive] = useState(false);

    // movement modal
    const [movOpen,   setMovOpen]   = useState(false);
    const [movItem,   setMovItem]   = useState<StockItem | null>(null);
    const [movType,   setMovType]   = useState<"entrada" | "saida" | "ajuste">("entrada");
    const [movQty,    setMovQty]    = useState("");
    const [movNote,   setMovNote]   = useState("");
    const [movSaving, setMovSaving] = useState(false);
    const [movMsg,    setMovMsg]    = useState<string | null>(null);

    // flash
    const [flashId, setFlashId] = useState<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function flash(id: string) {
        setFlashId(id);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashId(null), 1500);
    }

    // ── load ─────────────────────────────────────────────────────────────────

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);

        const { data, error } = await supabase
            .from("view_products_estoque")
            .select("id, name, codigo_interno, details, preco_custo_unitario, estoque_atual, estoque_minimo, is_active, category_name")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });

        if (error) { console.error("[Estoque] load error:", error); setLoading(false); return; }

        const mapped: StockItem[] = (data ?? []).map((p: any) => ({
            id:                   String(p.id),
            name:                 String(p.name ?? "—"),
            category:             String(p.category_name ?? "—"),
            details:              p.details ?? null,
            codigo_interno:       p.codigo_interno ?? null,
            preco_custo_unitario: Number(p.preco_custo_unitario ?? 0),
            estoque_atual:        Number(p.estoque_atual ?? 0),
            estoque_minimo:       Number(p.estoque_minimo ?? 0),
            is_active:            Boolean(p.is_active),
        }));

        setItems(mapped);
        setLoading(false);
    }, [companyId, supabase]);

    useEffect(() => { load(); }, [load]);

    // ── realtime ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!companyId) return;
        const ch = supabase
            .channel("products_estoque_realtime")
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "product_volumes" }, (p: any) => {
                const pvid      = p?.new?.id as string;
                const nextStock = Number(p?.new?.estoque_atual ?? 0);
                if (!pvid) return;
                setItems(prev => prev.map(item =>
                    item.id === pvid ? { ...item, estoque_atual: nextStock } : item
                ));
                flash(pvid);
            })
            .subscribe((s: string) => console.log("[Estoque Realtime] status:", s));
        return () => { supabase.removeChannel(ch); };
    }, [companyId, supabase]);

    // ── movement modal ────────────────────────────────────────────────────────

    function openMovement(item: StockItem, type: "entrada" | "saida" | "ajuste") {
        setMovItem(item); setMovType(type); setMovQty(""); setMovNote(""); setMovMsg(null); setMovOpen(true);
    }

    async function saveMovement() {
        if (!movItem || !companyId) return;
        const qty = Number(movQty.replaceAll(",", "."));
        if (!qty || qty <= 0) { setMovMsg("Informe uma quantidade válida."); return; }
        setMovSaving(true); setMovMsg(null);
        const cur  = movItem.estoque_atual;
        const next =
            movType === "entrada" ? cur + qty :
            movType === "saida"   ? Math.max(0, cur - qty) :
            qty;
        const { error } = await supabase.rpc("rpc_update_product_volume_estoque", {
            p_product_volume_id: movItem.id,
            p_company_id:        companyId,
            p_estoque_atual:     next,
        });
        if (error) { setMovMsg(`Erro: ${error.message}`); setMovSaving(false); return; }
        setItems(prev => prev.map(i => i.id === movItem.id ? { ...i, estoque_atual: next } : i));
        flash(movItem.id);
        setMovSaving(false); setMovOpen(false);
    }

    // ── filter + stats ────────────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let list = showInactive ? items : items.filter(i => i.is_active);
        if (search.trim()) {
            const s = search.toLowerCase();
            list = list.filter(i =>
                [i.name, i.category, i.details ?? "", i.codigo_interno ?? ""].some(x => x.toLowerCase().includes(s))
            );
        }
        return list;
    }, [items, search, showInactive]);

    const activeItems  = items.filter(i => i.is_active);
    const outOfStock   = activeItems.filter(i => i.estoque_atual <= 0).length;
    const lowStock     = activeItems.filter(i => stockStatus(i.estoque_atual, i.estoque_minimo) === "low").length;
    const totalValue   = activeItems.reduce((a, b) => a + b.estoque_atual * b.preco_custo_unitario, 0);
    const totalUnits   = activeItems.reduce((a, b) => a + b.estoque_atual, 0);

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Estoque</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Saldo por volume — UN e CX compartilham o mesmo estoque</p>
                </div>
                <button onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    { icon: Package,      label: "Volumes ativos",     value: activeItems.length,        color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30" },
                    { icon: DollarSign,   label: "Valor em estoque",   value: `R$ ${brl(totalValue)}`,   color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30" },
                    { icon: AlertTriangle,label: "Estoque baixo",       value: lowStock,                  color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30" },
                    { icon: TrendingDown, label: "Sem estoque",         value: outOfStock,                color: "bg-red-100 text-red-600 dark:bg-red-900/30" },
                ].map(({ icon: Icon, label, value, color }) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
                            <Icon className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="text-xs text-zinc-400">{label}</p>
                            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{loading ? "…" : value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por produto, categoria, código…"
                        className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                </div>
                <button
                    onClick={() => setShowInactive(v => !v)}
                    className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        showInactive
                            ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300"
                            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
                    }`}
                >
                    {showInactive ? "Ocultar inativos" : "Ver inativos"}
                </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                {/* Header */}
                <div className="grid min-w-[640px] grid-cols-[1.8fr_0.9fr_72px_96px_120px_160px] gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    <span>Produto</span>
                    <span>Categoria</span>
                    <span>Código</span>
                    <span className="text-right">Custo (R$)</span>
                    <span className="text-center">Saldo / Mínimo</span>
                    <span className="text-center">Ações</span>
                </div>

                <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                    {loading
                        ? Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="px-4 py-3">
                                <div className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                            </div>
                        ))
                        : filtered.length === 0
                        ? (
                            <div className="flex flex-col items-center gap-3 py-16">
                                <Package className="h-10 w-10 text-zinc-300" />
                                <p className="text-sm text-zinc-400">
                                    {search ? "Nenhum resultado para a busca." : "Nenhuma variação ativa."}
                                </p>
                            </div>
                        )
                        : filtered.map((item) => {
                            const status = stockStatus(item.estoque_atual, item.estoque_minimo);
                            return (
                                <div
                                    key={item.id}
                                    className={`grid min-w-[640px] grid-cols-[1.8fr_0.9fr_72px_96px_120px_160px] items-center gap-2 px-4 py-3 transition-colors ${
                                        !item.is_active
                                            ? "opacity-50"
                                            : flashId === item.id
                                            ? "bg-emerald-50 dark:bg-emerald-900/15"
                                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                    }`}
                                >
                                    {/* Produto: name + volume */}
                                    <div className="min-w-0">
                                        <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                            {item.name}
                                            {!item.is_active && (
                                                <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700">inativo</span>
                                            )}
                                        </p>
                                        <p className="truncate text-[11px] text-zinc-400">{item.details ?? "—"}</p>
                                    </div>

                                    {/* Categoria */}
                                    <span className="truncate text-xs text-zinc-500">{item.category}</span>

                                    {/* Código */}
                                    <span className="text-[11px] text-zinc-400">{item.codigo_interno ?? "—"}</span>

                                    {/* Custo */}
                                    <span className="text-right text-xs font-semibold text-violet-700 dark:text-violet-400">
                                        R$ {brl(item.preco_custo_unitario)}
                                    </span>

                                    {/* Saldo / Mínimo */}
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${stockColorClass(item.estoque_atual, item.estoque_minimo)}`}>
                                            {item.estoque_atual}
                                        </span>
                                        <span className="text-[10px] text-zinc-400">
                                            mín: {item.estoque_minimo}
                                        </span>
                                        {status === "low"  && <span className="text-[10px] font-semibold text-amber-500">↓ baixo</span>}
                                        {status === "zero" && <span className="text-[10px] font-semibold text-red-500">✕ zerado</span>}
                                    </div>

                                    {/* Ações */}
                                    <div className="flex items-center justify-center gap-1">
                                        <button onClick={() => openMovement(item, "entrada")} title="Entrada de estoque"
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-900/20">
                                            <ArrowUpCircle className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => openMovement(item, "saida")} title="Saída de estoque"
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                                            <ArrowDownCircle className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => openMovement(item, "ajuste")} title="Ajustar saldo"
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                                            <Settings2 className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => openMovement(item, "ajuste")} title="Definir mínimo (use Ajustar)"
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:hover:bg-violet-900/20">
                                            <BarChart3 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                </div>

                {/* Footer summary */}
                {!loading && filtered.length > 0 && (
                    <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                        <span className="text-xs text-zinc-400">{filtered.length} volume{filtered.length !== 1 ? "s" : ""}</span>
                        <span className="text-xs text-zinc-400">
                            Total em unidades: <strong className="text-zinc-700 dark:text-zinc-300">{totalUnits.toLocaleString("pt-BR")}</strong>
                            {" · "}
                            Valor total: <strong className="text-violet-700 dark:text-violet-400">R$ {brl(totalValue)}</strong>
                        </span>
                    </div>
                )}
            </div>

            {/* Movement Modal */}
            <Modal
                title={movType === "entrada" ? "📥 Registrar Entrada" : movType === "saida" ? "📤 Registrar Saída" : "⚙️ Ajustar Saldo"}
                open={movOpen}
                onClose={() => setMovOpen(false)}
            >
                {movItem && (
                    <div className="flex flex-col gap-4">
                        {/* Product info card */}
                        <div className="rounded-lg bg-violet-50 px-3 py-2.5 dark:bg-violet-900/20">
                            <p className="text-xs font-bold text-violet-800 dark:text-violet-200">{movItem.name}</p>
                            <p className="text-xs text-violet-600 dark:text-violet-400">
                                {[movItem.details, movItem.category, movItem.codigo_interno].filter(Boolean).join(" · ")}
                            </p>
                            <div className="mt-1.5 flex items-center gap-3 text-xs">
                                <span className="text-violet-500">
                                    Saldo atual: <strong className={`font-bold ${stockStatus(movItem.estoque_atual, movItem.estoque_minimo) === "zero" ? "text-red-500" : "text-violet-700 dark:text-violet-300"}`}>{movItem.estoque_atual}</strong>
                                </span>
                                <span className="text-violet-400">·</span>
                                <span className="text-violet-500">Mínimo: <strong>{movItem.estoque_minimo}</strong></span>
                            </div>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                {movType === "ajuste" ? "Novo saldo total" : "Quantidade"}
                            </label>
                            <input
                                value={movQty}
                                onChange={(e) => setMovQty(e.target.value)}
                                placeholder={movType === "ajuste" ? `Ex: ${movItem.estoque_atual}` : "Ex: 24"}
                                className={inputCls}
                                inputMode="numeric"
                                autoFocus
                            />
                            {movType !== "ajuste" && movQty && !isNaN(Number(movQty.replaceAll(",", "."))) && (
                                <p className="mt-1 text-xs text-zinc-400">
                                    Novo saldo: <strong className="text-zinc-700 dark:text-zinc-300">
                                        {movType === "entrada"
                                            ? movItem.estoque_atual + Number(movQty.replaceAll(",", "."))
                                            : Math.max(0, movItem.estoque_atual - Number(movQty.replaceAll(",", ".")))}
                                    </strong>
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                Observação <span className="font-normal text-zinc-400">(opcional)</span>
                            </label>
                            <input value={movNote} onChange={(e) => setMovNote(e.target.value)}
                                placeholder="Ex: Compra fornecedor João, NF 1234"
                                className={inputCls} />
                        </div>

                        {movMsg && (
                            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/20">
                                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                                <p className="text-xs font-semibold text-red-600 dark:text-red-400">{movMsg}</p>
                            </div>
                        )}

                        <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                            <button onClick={saveMovement} disabled={movSaving}
                                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-bold text-white disabled:opacity-60 ${
                                    movType === "entrada" ? "bg-emerald-600 hover:bg-emerald-700" :
                                    movType === "saida"   ? "bg-red-500 hover:bg-red-600" :
                                    "bg-violet-600 hover:bg-violet-700"
                                }`}>
                                {movSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                {movSaving ? "Salvando…" : "Confirmar"}
                            </button>
                            <button onClick={() => setMovOpen(false)}
                                className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
