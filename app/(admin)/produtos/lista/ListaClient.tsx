// app/(admin)/produtos/lista/ListaClient.tsx
"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    CheckCircle2, Loader2, Pencil, Plus, RefreshCw,
    Search, ShoppingBag, ToggleLeft, ToggleRight, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type Unit     = "none" | "ml" | "l" | "kg";
type Category = { id: string; name: string };
type Brand    = { id: string; name: string };

type RowProduct = {
    name:        string | null;
    category_id: string | null;
    brand_id:    string | null;
    categories:  { id: string; name: string } | null;
    brands:      { id: string; name: string } | null;
} | null;

type Row = {
    id:          string;
    product_id:  string;
    details:     string | null;
    volume_value: number | null;
    unit:        Unit;
    unit_price:  number;
    has_case:    boolean;
    case_qty:    number | null;
    case_price:  number | null;
    is_active:   boolean;
    products:    RowProduct;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(n: number | null | undefined) {
    return (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatBRLInput(raw: string) {
    const digits = raw.replace(/\D/g, "");
    return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlToNumber(v: string) {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
}

function unitLabel(u: Unit) {
    if (u === "l") return "L"; if (u === "none") return ""; return u;
}

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
}

function normalizeRows(input: unknown): Row[] {
    return (Array.isArray(input) ? input : []).map((r: any) => {
        const rawUnit = r?.unit ?? "none";
        const unit: Unit = ["ml","l","kg","none"].includes(rawUnit) ? rawUnit : "none";
        const p0 = firstOrNull<any>(r?.products);
        const c0 = firstOrNull<any>(p0?.categories);
        const b0 = firstOrNull<any>(p0?.brands);
        return {
            id:           String(r?.id ?? ""),
            product_id:   String(r?.product_id ?? ""),
            details:      r?.details ?? null,
            volume_value: r?.volume_value ?? null,
            unit,
            unit_price:   Number(r?.unit_price ?? 0),
            has_case:     Boolean(r?.has_case),
            case_qty:     r?.case_qty ?? null,
            case_price:   r?.case_price ?? null,
            is_active:    Boolean(r?.is_active),
            products: p0 ? {
                name:        p0?.name ?? null,
                category_id: p0?.category_id ?? null,
                brand_id:    p0?.brand_id ?? null,
                categories:  c0 ? { id: String(c0.id), name: String(c0.name ?? "") } : null,
                brands:      b0 ? { id: String(b0.id), name: String(b0.name ?? "") } : null,
            } : null,
        };
    });
}

// ─── sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";
const selectCls = inputCls;

function Modal({ title, open, onClose, wide = false, children }: { title: string; open: boolean; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
    if (!open) return null;
    return (
        <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <div onClick={(e) => e.stopPropagation()} className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 max-h-[90vh] overflow-y-auto`}>
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button type="button" onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${checked ? "bg-violet-600" : "bg-zinc-300"}`}>
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
        </button>
    );
}

function Skeleton() {
    return <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />;
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function ProdutosListaPage() {
    const supabase    = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();

    const [rows,       setRows]       = useState<Row[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands,     setBrands]     = useState<Brand[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [msg,        setMsg]        = useState<string | null>(null);
    const [search,     setSearch]     = useState("");

    // edit modal
    const [open,     setOpen]     = useState(false);
    const [selected, setSelected] = useState<Row | null>(null);
    const [saving,   setSaving]   = useState(false);

    // edit fields — variant
    const [details,     setDetails]     = useState("");
    const [hasVolume,   setHasVolume]   = useState(false);
    const [volumeValue, setVolumeValue] = useState("");
    const [unit,        setUnit]        = useState<Unit>("none");
    const [unitPrice,   setUnitPrice]   = useState("0,00");
    const [hasCase,     setHasCase]     = useState(false);
    const [caseQty,     setCaseQty]     = useState("");
    const [casePrice,   setCasePrice]   = useState("0,00");
    const [isActive,    setIsActive]    = useState(true);

    // edit fields — product base
    const [categoryId,       setCategoryId]       = useState("");
    const [brandId,          setBrandId]          = useState("");
    const [newCategoryName,  setNewCategoryName]  = useState("");
    const [newBrandName,     setNewBrandName]     = useState("");
    const [addCategoryOpen,  setAddCategoryOpen]  = useState(false);
    const [addBrandOpen,     setAddBrandOpen]     = useState(false);

    // flash row
    const [flashId, setFlashId] = useState<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function flashRow(id: string) {
        setFlashId(id);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashId(null), 1500);
    }

    // ── data loaders ────────────────────────────────────────────────────────

    async function load() {
        setLoading(true); setMsg(null);
        const [varRes, catRes, brRes] = await Promise.all([
            supabase.from("product_variants")
                .select(`id,product_id,details,volume_value,unit,unit_price,has_case,case_qty,case_price,is_active,products(name,category_id,brand_id,categories(id,name),brands(id,name))`)
                .order("created_at", { ascending: false }),
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);
        if (varRes.error) { setMsg(`Erro: ${varRes.error.message}`); setLoading(false); return; }
        setRows(normalizeRows(varRes.data));
        if (!catRes.error) setCategories((catRes.data as any[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
        if (!brRes.error)  setBrands((brRes.data as any[]).map((b)  => ({ id: String(b.id), name: String(b.name) })));
        setLoading(false);
    }

    async function reloadCatsAndBrands() {
        const [cats, brs] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);
        if (!cats.error) setCategories((cats.data as any[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
        if (!brs.error)  setBrands((brs.data as any[]).map((b)   => ({ id: String(b.id), name: String(b.name) })));
    }

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    // ── realtime ─────────────────────────────────────────────────────────────

    useEffect(() => {
        const ch = supabase
            .channel("product_variants_realtime")
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "product_variants" }, async (p: any) => {
                console.log("[Produtos Realtime] INSERT:", p);
                const id = p?.new?.id as string;
                if (!id) return;
                // busca a linha completa com joins
                const { data } = await supabase.from("product_variants")
                    .select(`id,product_id,details,volume_value,unit,unit_price,has_case,case_qty,case_price,is_active,products(name,category_id,brand_id,categories(id,name),brands(id,name))`)
                    .eq("id", id).maybeSingle();
                if (data) {
                    setRows((prev) => [normalizeRows([data])[0], ...prev]);
                    flashRow(id);
                }
            })
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "product_variants" }, async (p: any) => {
                console.log("[Produtos Realtime] UPDATE:", p);
                const id = p?.new?.id as string;
                if (!id) return;
                const { data } = await supabase.from("product_variants")
                    .select(`id,product_id,details,volume_value,unit,unit_price,has_case,case_qty,case_price,is_active,products(name,category_id,brand_id,categories(id,name),brands(id,name))`)
                    .eq("id", id).maybeSingle();
                if (data) {
                    setRows((prev) => prev.map((r) => r.id === id ? normalizeRows([data])[0] : r));
                    flashRow(id);
                }
            })
            .subscribe((s: string) => console.log("[Produtos Realtime] status:", s));

        return () => { supabase.removeChannel(ch); };
    }, [supabase]);

    // ── toggle active ─────────────────────────────────────────────────────────

    async function toggleActive(row: Row) {
        const next = !row.is_active;
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_active: next } : r));
        await supabase.from("product_variants").update({ is_active: next }).eq("id", row.id);
        flashRow(row.id);
    }

    // ── open edit ─────────────────────────────────────────────────────────────

    function openEdit(r: Row) {
        setSelected(r); setOpen(true); setMsg(null);
        setDetails(r.details ?? "");
        const hv = r.unit !== "none" && r.volume_value !== null;
        setHasVolume(hv); setVolumeValue(hv ? String(r.volume_value ?? "") : ""); setUnit(hv ? r.unit : "none");
        setUnitPrice(brl(r.unit_price));
        setHasCase(!!r.has_case); setCaseQty(r.case_qty ? String(r.case_qty) : ""); setCasePrice(brl(r.case_price ?? 0));
        setIsActive(!!r.is_active);
        setCategoryId(r.products?.category_id ?? r.products?.categories?.id ?? "");
        setBrandId(r.products?.brand_id ?? r.products?.brands?.id ?? "");
        setNewCategoryName(""); setNewBrandName("");
    }

    // ── save edit ─────────────────────────────────────────────────────────────

    async function saveEdit() {
        if (!selected) return;
        setSaving(true); setMsg(null);
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        if (!brandId)    { setMsg("Selecione uma marca.");    setSaving(false); return; }

        // Update product base
        await supabase.from("products").update({ category_id: categoryId, brand_id: brandId }).eq("id", selected.product_id);

        // Update variant
        const patch: Record<string, unknown> = {
            details:    details.trim() || null,
            unit_price: brlToNumber(unitPrice),
            has_case:   hasCase,
            is_active:  isActive,
        };
        if (!hasVolume) { patch.volume_value = null; patch.unit = "none"; }
        else            { patch.volume_value = Number(String(volumeValue).replace(",",".")); patch.unit = unit; }
        if (!hasCase)   { patch.case_qty = null; patch.case_price = null; }
        else            { patch.case_qty = Number(caseQty || 0); patch.case_price = brlToNumber(casePrice); }

        const { error } = await supabase.from("product_variants").update(patch).eq("id", selected.id);
        if (error) { setMsg(`Erro: ${error.message}`); setSaving(false); return; }
        setSaving(false); setOpen(false); setSelected(null);
    }

    // ── create cat / brand inline ─────────────────────────────────────────────

    async function quickCreateCategory(name: string) {
        if (!name.trim() || !companyId) return null;
        const { data, error } = await supabase.from("categories").insert({ name: name.trim(), is_active: true, company_id: companyId }).select("id").single();
        if (error) { setMsg(`Erro: ${error.message}`); return null; }
        await reloadCatsAndBrands();
        return String((data as any).id);
    }

    async function quickCreateBrand(name: string) {
        if (!name.trim() || !companyId) return null;
        const { data, error } = await supabase.from("brands").insert({ name: name.trim(), is_active: true, company_id: companyId }).select("id").single();
        if (error) { setMsg(`Erro: ${error.message}`); return null; }
        await reloadCatsAndBrands();
        return String((data as any).id);
    }

    // ── filter ────────────────────────────────────────────────────────────────

    const filtered = rows.filter((r) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return [r.products?.categories?.name, r.products?.brands?.name, r.details, r.products?.name]
            .some((x) => (x ?? "").toLowerCase().includes(s));
    });

    const activeCount   = rows.filter((r) => r.is_active).length;
    const inactiveCount = rows.length - activeCount;

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Lista de Produtos</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">
                        {rows.length} variações · {activeCount} ativas · {inactiveCount} inativas
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <a href="/produtos" className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600">
                        <Plus className="h-3.5 w-3.5" /> Cadastrar
                    </a>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: "Total de variações", value: rows.length, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30" },
                    { label: "Ativas",              value: activeCount, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30" },
                    { label: "Inativas",            value: inactiveCount, color: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold ${color}`}>{value}</span>
                        <span className="text-xs text-zinc-500">{label}</span>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por categoria, marca ou detalhes…"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>

            {/* Table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                {/* sticky header */}
                <div className="grid grid-cols-[1fr_1fr_1.5fr_100px_90px_90px_1fr_60px_80px] gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    <span>Categoria</span><span>Marca</span><span>Detalhes</span>
                    <span className="text-right">Vol.</span><span className="text-right">Unit (R$)</span>
                    <span>Caixa</span><span className="text-right">Cx (R$)</span>
                    <span className="text-center">Ativo</span><span className="text-center">Ações</span>
                </div>

                <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                    {loading
                        ? Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="px-4 py-3"><Skeleton /></div>
                        ))
                        : filtered.length === 0
                        ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-16">
                                <ShoppingBag className="h-10 w-10 text-zinc-300" />
                                <p className="text-sm text-zinc-400">{search ? "Nenhum resultado." : "Nenhum produto cadastrado."}</p>
                            </div>
                        )
                        : filtered.map((r) => (
                            <div
                                key={r.id}
                                className={`grid grid-cols-[1fr_1fr_1.5fr_100px_90px_90px_1fr_60px_80px] items-center gap-2 px-4 py-3 transition-colors ${
                                    flashId === r.id
                                        ? "bg-emerald-50 dark:bg-emerald-900/15"
                                        : r.is_active
                                        ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                        : "bg-zinc-50/60 opacity-60 dark:bg-zinc-800/30"
                                }`}
                            >
                                <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                    {r.products?.categories?.name ?? <span className="text-zinc-300">—</span>}
                                </span>
                                <span className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                                    {r.products?.brands?.name ?? "—"}
                                </span>
                                <span className="truncate text-xs text-zinc-500">{r.details ?? "—"}</span>
                                <span className="text-right text-xs text-zinc-500">
                                    {r.unit === "none" || r.volume_value == null ? "—" : `${r.volume_value} ${unitLabel(r.unit)}`}
                                </span>
                                <span className="text-right text-xs font-semibold text-violet-700 dark:text-violet-400">
                                    R$ {brl(r.unit_price)}
                                </span>
                                <span className="text-xs text-zinc-500">{r.has_case ? `cx ${r.case_qty ?? "?"}` : "—"}</span>
                                <span className="text-right text-xs text-zinc-500">
                                    {r.has_case ? `R$ ${brl(r.case_price ?? 0)}` : "—"}
                                </span>
                                <div className="flex justify-center">
                                    <button onClick={() => toggleActive(r)}>
                                        {r.is_active
                                            ? <ToggleRight className="h-5 w-5 text-violet-600" />
                                            : <ToggleLeft  className="h-5 w-5 text-zinc-400" />}
                                    </button>
                                </div>
                                <div className="flex justify-center">
                                    <button onClick={() => openEdit(r)} className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 dark:border-zinc-700">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                </div>
            </div>

            {/* Edit Modal */}
            <Modal title={selected ? `Editar: ${selected.products?.categories?.name ?? ""} ${selected.products?.brands?.name ?? ""}`.trim() : "Editar"} open={open} onClose={() => { setOpen(false); setSelected(null); setMsg(null); }} wide>
                <div className="flex flex-col gap-5">
                    {/* Categoria */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Categoria</p>
                                <p className="text-xs text-zinc-400">{selected?.products?.categories?.name ?? "—"}</p>
                            </div>
                            <button onClick={() => setAddCategoryOpen(true)} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                <Plus className="h-3 w-3" /> Nova
                            </button>
                        </div>
                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectCls}>
                            <option value="">Selecione…</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {/* Marca */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Marca</p>
                                <p className="text-xs text-zinc-400">{selected?.products?.brands?.name ?? "—"}</p>
                            </div>
                            <button onClick={() => setAddBrandOpen(true)} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                <Plus className="h-3 w-3" /> Nova
                            </button>
                        </div>
                        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={selectCls}>
                            <option value="">Selecione…</option>
                            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>

                    {/* Variant fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Detalhes</label>
                            <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Ex: long neck, retornável…" className={inputCls} />
                        </div>
                        <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <label className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                <input type="checkbox" checked={hasVolume} onChange={(e) => { setHasVolume(e.target.checked); if (!e.target.checked) { setVolumeValue(""); setUnit("none"); } else { setUnit("ml"); } }} className="h-4 w-4 accent-violet-600 rounded" />
                                Volume
                            </label>
                            <div className="mt-3 flex gap-2">
                                <input disabled={!hasVolume} value={volumeValue} onChange={(e) => setVolumeValue(e.target.value)} placeholder="350" className={inputCls} />
                                <select disabled={!hasVolume} value={hasVolume ? unit : "none"} onChange={(e) => setUnit(e.target.value as Unit)} className={`${selectCls} w-24`}>
                                    <option value="ml">ml</option><option value="l">litros</option><option value="kg">kg</option>
                                </select>
                            </div>
                        </div>
                        <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Valor unitário (R$)</label>
                            <input value={unitPrice} onChange={(e) => setUnitPrice(formatBRLInput(e.target.value))} className={inputCls} inputMode="numeric" />
                        </div>
                        <div className="col-span-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <label className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                <input type="checkbox" checked={hasCase} onChange={(e) => { setHasCase(e.target.checked); if (!e.target.checked) { setCaseQty(""); setCasePrice("0,00"); } }} className="h-4 w-4 accent-violet-600 rounded" />
                                Vende por caixa
                            </label>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-zinc-500">Caixa com</label>
                                    <input disabled={!hasCase} value={caseQty} onChange={(e) => setCaseQty(e.target.value)} placeholder="12" className={inputCls} inputMode="numeric" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-zinc-500">Valor da caixa (R$)</label>
                                    <input disabled={!hasCase} value={casePrice} onChange={(e) => setCasePrice(formatBRLInput(e.target.value))} className={inputCls} inputMode="numeric" />
                                </div>
                            </div>
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Ativo no catálogo</p>
                                <p className="text-xs text-zinc-400">Desativando, o item some do chatbot e pedidos.</p>
                            </div>
                            <Toggle checked={isActive} onChange={setIsActive} />
                        </div>
                    </div>

                    {msg && <p className={`text-xs font-semibold ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</p>}

                    <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button onClick={saveEdit} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {saving ? "Salvando…" : "Salvar alterações"}
                        </button>
                        <button onClick={() => { setOpen(false); setSelected(null); }} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                    </div>
                </div>

                {/* Sub-modal: nova categoria */}
                <Modal title="Nova Categoria" open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)}>
                    <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Ex: Cerveja" className={inputCls} />
                    <div className="mt-4 flex gap-2">
                        <button onClick={async () => { const id = await quickCreateCategory(newCategoryName); if (id) { setCategoryId(id); setNewCategoryName(""); setAddCategoryOpen(false); } }} className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600">Criar e selecionar</button>
                        <button onClick={() => setAddCategoryOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                    </div>
                </Modal>

                {/* Sub-modal: nova marca */}
                <Modal title="Nova Marca" open={addBrandOpen} onClose={() => setAddBrandOpen(false)}>
                    <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Ex: Skol" className={inputCls} />
                    <div className="mt-4 flex gap-2">
                        <button onClick={async () => { const id = await quickCreateBrand(newBrandName); if (id) { setBrandId(id); setNewBrandName(""); setAddBrandOpen(false); } }} className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600">Criar e selecionar</button>
                        <button onClick={() => setAddBrandOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                    </div>
                </Modal>
            </Modal>
        </div>
    );
}
