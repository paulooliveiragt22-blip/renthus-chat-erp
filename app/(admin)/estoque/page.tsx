// app/(admin)/estoque/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    ArrowDownCircle, ArrowUpCircle, BarChart3, Loader2,
    Package, Plus, RefreshCw, Search, Settings2, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type StockItem = {
    id:           string;     // products.id
    category:     string;
    details:      string | null;
    codigo_interno: string | null;
    preco_custo_unitario: number;
    estoque_minimo: number;
    is_active:    boolean;
    estoque_atual: number;
};

type Movement = {
    id:         string;
    type:       "entrada" | "saida" | "ajuste";
    quantity:   number;
    note:       string | null;
    created_at: string;
    variant_id: string;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function brl(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function stockColor(n: number) {
    if (n <= 0)  return "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400";
    if (n <= 5)  return "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400";
    return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400";
}

// ─── sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";
const selectCls = inputCls;

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

    // movement modal
    const [movOpen,    setMovOpen]    = useState(false);
    const [movItem,    setMovItem]    = useState<StockItem | null>(null);
    const [movType,    setMovType]    = useState<"entrada" | "saida" | "ajuste">("entrada");
    const [movQty,     setMovQty]     = useState("");
    const [movNote,    setMovNote]    = useState("");
    const [movSaving,  setMovSaving]  = useState(false);
    const [movMsg,     setMovMsg]     = useState<string | null>(null);

    // history modal
    const [histOpen,    setHistOpen]    = useState(false);
    const [histItem,    setHistItem]    = useState<StockItem | null>(null);
    const [movements,   setMovements]   = useState<Movement[]>([]);
    const [loadingHist, setLoadingHist] = useState(false);

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

        const { data: prodRes, error } = await supabase
            .from("products")
            .select(`
              id,
              name,
              codigo_interno,
              details,
              preco_custo_unitario,
              estoque_atual,
              estoque_minimo,
              is_active,
              categories(name)
            `)
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });

        if (error) { setLoading(false); return; }

        const mapped: StockItem[] = (prodRes ?? []).map((p: any) => {
            const cat = Array.isArray(p?.categories) ? p.categories?.[0]?.name : p?.categories?.name;
            return {
                id: String(p.id),
                category: cat ?? "—",
                details: p.details ?? null,
                codigo_interno: p.codigo_interno ?? null,
                preco_custo_unitario: Number(p.preco_custo_unitario ?? 0),
                estoque_atual: Number(p.estoque_atual ?? 0),
                estoque_minimo: Number(p.estoque_minimo ?? 0),
                is_active: Boolean(p.is_active),
            };
        });

        setItems(mapped);
        setLoading(false);
    }, [companyId, supabase]);

    useEffect(() => { load(); }, [load]);

    // ── realtime ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!companyId) return;
        const ch = supabase
            .channel("products_realtime")
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, (p: any) => {
                const pid = p?.new?.id as string;
                const nextStock = Number(p?.new?.estoque_atual ?? 0);
                if (!pid) return;
                setItems(prev => prev.map(item => item.id === pid ? { ...item, estoque_atual: nextStock } : item));
                flash(pid);
            })
            .subscribe((s: string) => console.log("[Estoque Realtime] status:", s));
        return () => { supabase.removeChannel(ch); };
    }, [companyId, supabase]);

    // ── open movement modal ───────────────────────────────────────────────────

    function openMovement(item: StockItem, type: "entrada" | "saida" | "ajuste") {
        setMovItem(item); setMovType(type); setMovQty(""); setMovNote(""); setMovMsg(null); setMovOpen(true);
    }

    async function saveMovement() {
        if (!movItem || !companyId) return;
        const qty = Number(movQty.replace(",", "."));
        if (!qty || qty <= 0) { setMovMsg("Informe uma quantidade válida."); return; }
        setMovSaving(true); setMovMsg(null);
        const cur = movItem.estoque_atual;
        const next =
            movType === "entrada" ? cur + qty :
            movType === "saida"   ? cur - qty :
            qty;
        const { error } = await supabase
            .from("products")
            .update({ estoque_atual: next })
            .eq("id", movItem.id)
            .eq("company_id", companyId);

        if (error) { setMovMsg(`Erro: ${error.message}`); setMovSaving(false); return; }
        setItems(prev => prev.map(i => i.id === movItem.id ? { ...i, estoque_atual: next } : i));
        setMovSaving(false); setMovOpen(false);
    }

    // ── load history ──────────────────────────────────────────────────────────

    async function openHistory(item: StockItem) {
        // No novo modelo, estoque é consolidado em `products.estoque_atual`.
        // Para manter o UI funcionando, mostramos uma mensagem em vez do histórico detalhado.
        setHistItem(item);
        setHistOpen(true);
        setLoadingHist(false);
        setMovements([]);
    }

    // ── filter + stats ────────────────────────────────────────────────────────

    const filtered = items.filter((i) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return [i.category, i.details ?? ""].some((x) => x.toLowerCase().includes(s));
    });

    const totalItems    = items.length;
    const lowStock      = items.filter((i) => i.estoque_atual > 0 && i.estoque_atual <= 5).length;
    const outOfStock    = items.filter((i) => i.estoque_atual <= 0).length;
    const totalValue    = items.reduce((a, b) => a + b.estoque_atual * b.preco_custo_unitario, 0);

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Estoque</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Saldo consolidado em `products.estoque_atual`</p>
                </div>
                <button onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    { icon: Package,    label: "Variações ativas",  value: totalItems,                  color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30" },
                    { icon: BarChart3,  label: "Valor em estoque",  value: `R$ ${brl(totalValue)}`,      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30" },
                    { icon: ArrowDownCircle, label: "Estoque baixo (≤5)", value: lowStock,               color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30" },
                    { icon: X,          label: "Sem estoque",       value: outOfStock,                   color: "bg-red-100 text-red-600 dark:bg-red-900/30" },
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

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar por categoria ou detalhes…"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>

            {/* Table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                <div className="grid grid-cols-[1fr_1.2fr_80px_100px_80px_160px] gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    <span>Categoria</span><span>Detalhes</span>
                    <span>Código Interno</span><span className="text-right">Custo (R$)</span>
                    <span className="text-center">Saldo</span><span className="text-center">Ações</span>
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
                                <p className="text-sm text-zinc-400">{search ? "Nenhum resultado." : "Nenhuma variação ativa."}</p>
                            </div>
                        )
                        : filtered.map((item) => (
                            <div
                                key={item.id}
                                className={`grid grid-cols-[1fr_1.2fr_80px_100px_80px_160px] items-center gap-2 px-4 py-3 transition-colors ${
                                    flashId === item.id ? "bg-emerald-50 dark:bg-emerald-900/15" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                }`}
                            >
                                <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{item.category}</span>
                                <span className="truncate text-xs text-zinc-500">{item.details ?? "—"}</span>
                                <span className="text-xs text-zinc-400">{item.codigo_interno ?? "—"}</span>
                                <span className="text-right text-xs font-semibold text-violet-700 dark:text-violet-400">R$ {brl(item.preco_custo_unitario)}</span>
                                <span className={`mx-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${stockColor(item.estoque_atual)}`}>
                                    {item.estoque_atual}
                                </span>
                                <div className="flex items-center justify-center gap-1">
                                    <button onClick={() => openMovement(item, "entrada")} title="Entrada" className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-900/20">
                                        <ArrowUpCircle className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => openMovement(item, "saida")} title="Saída" className="flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                                        <ArrowDownCircle className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => openMovement(item, "ajuste")} title="Ajustar saldo" className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                                        <Settings2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => openHistory(item)} title="Histórico" className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:hover:bg-violet-900/20">
                                        <BarChart3 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                </div>
            </div>

            {/* Movement Modal */}
            <Modal
                title={movType === "entrada" ? "📥 Registrar Entrada" : movType === "saida" ? "📤 Registrar Saída" : "⚙️ Ajustar Saldo"}
                open={movOpen}
                onClose={() => setMovOpen(false)}
            >
                {movItem && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg bg-violet-50 px-3 py-2 dark:bg-violet-900/20">
                            <p className="text-xs font-bold text-violet-700 dark:text-violet-300">{movItem.category}</p>
                            <p className="text-xs text-violet-500">
                                {movItem.details ?? ""} {movItem.codigo_interno ?? ""} — saldo atual: <strong>{movItem.estoque_atual}</strong>
                            </p>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                {movType === "ajuste" ? "Novo saldo total" : "Quantidade"}
                            </label>
                            <input value={movQty} onChange={(e) => setMovQty(e.target.value)} placeholder="Ex: 24" className={inputCls} inputMode="numeric" />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Observação (opcional)</label>
                            <input value={movNote} onChange={(e) => setMovNote(e.target.value)} placeholder="Ex: Compra fornecedor João" className={inputCls} />
                        </div>

                        {movMsg && <p className="text-xs font-semibold text-red-600">{movMsg}</p>}

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
                            <button onClick={() => setMovOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* History Modal */}
            <Modal title={`Histórico: ${histItem?.category ?? ""}`} open={histOpen} onClose={() => setHistOpen(false)}>
                {loadingHist ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-violet-600" /></div>
                ) : (
                    <p className="py-8 text-center text-sm text-zinc-400">
                        Sem histórico detalhado no novo modelo (estoque consolidado em <code>products.estoque_atual</code>).
                    </p>
                )}
            </Modal>
        </div>
    );
}
