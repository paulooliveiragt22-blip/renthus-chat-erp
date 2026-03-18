// app/(admin)/produtos/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    DollarSign, Loader2, Package, Plus, Save, ShoppingBag, Tag, Trash2, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string };
type Brand    = { id: string; name: string };
type Unit     = "none" | "ml" | "l" | "kg";

type VariantRow = {
    tempId:           string;
    hasVolume:        boolean;
    volumeValue:      string;
    unit:             Unit;
    tags:             string;   // sinônimos separados por vírgula
    unitPrice:        string;
    costPrice:        string;   // preço de custo
    hasCase:          boolean;
    caseQty:          string;
    casePrice:        string;
    isAccompaniment:  boolean;  // oferecer como acompanhamento
    stock:            number | null; // saldo lido do banco
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeClientId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function newRow(tempId: string): VariantRow {
    return {
        tempId, hasVolume: false, volumeValue: "", unit: "none",
        tags: "", unitPrice: "0,00", costPrice: "0,00",
        hasCase: false, caseQty: "", casePrice: "0,00",
        isAccompaniment: false, stock: null,
    };
}

function formatBRLInput(raw: string) {
    const digits = raw.replace(/\D/g, "");
    return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlToNumber(v: string) {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
}

function qtyToNumber(v: string) {
    const n = Number(v.replace(",", "."));
    return isNaN(n) ? 0 : n;
}

// ─── sub-components ────────────────────────────────────────────────────────────

function Modal({ title, open, onClose, children }: {
    title: string; open: boolean; onClose: () => void; children: React.ReactNode;
}) {
    if (!open) return null;
    return (
        <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
                    <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
                <div className="mt-4">{children}</div>
            </div>
        </div>
    );
}

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";
const selectCls = inputCls;

function StockBadge({ n }: { n: number | null }) {
    if (n === null) return <span className="text-xs text-zinc-300">—</span>;
    const cls = n <= 0 ? "bg-red-100 text-red-700" : n <= 5 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}><Package className="h-2.5 w-2.5" />{n}</span>;
}

// ─── main ──────────────────────────────────────────────────────────────────────

export default function ProdutosPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();

    const [categories, setCategories] = useState<Category[]>([]);
    const [brands,     setBrands]     = useState<Brand[]>([]);
    const [categoryId, setCategoryId] = useState("");
    const [brandId,    setBrandId]    = useState("");

    const [categoryNewName, setCategoryNewName] = useState("");
    const [brandNewName,    setBrandNewName]    = useState("");
    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [brandModalOpen,    setBrandModalOpen]    = useState(false);

    const [rows,   setRows]   = useState<VariantRow[]>(() => [newRow("row-0")]);
    const [saving, setSaving] = useState(false);
    const [msg,    setMsg]    = useState<string | null>(null);

    // ── load stock balances for existing rows ─────────────────────────────────
    // (only after initial load — rows are temp until saved)

    async function loadLists() {
        setMsg(null);
        const [catRes, brandRes] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);
        if (catRes.error)   setMsg(`Erro categorias: ${catRes.error.message}`);
        if (brandRes.error) setMsg(`Erro marcas: ${brandRes.error.message}`);
        const cats = (catRes.data  as Category[]) ?? [];
        const brs  = (brandRes.data as Brand[])   ?? [];
        setCategories(cats);
        setBrands(brs);
        if (!categoryId && cats.length > 0) setCategoryId(cats[0].id);
        if (!brandId    && brs.length  > 0) setBrandId(brs[0].id);
        if (cats.length === 0) setCategoryModalOpen(true);
        if (brs.length  === 0) setBrandModalOpen(true);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadLists(); }, []);

    function addRow()    { setRows((p) => [...p, newRow(makeClientId())]); }
    function removeRow(id: string) { setRows((p) => p.filter((r) => r.tempId !== id)); }
    function updateRow(id: string, patch: Partial<VariantRow>) {
        setRows((p) => p.map((r) => r.tempId === id ? { ...r, ...patch } : r));
    }

    async function createCategory(name: string) {
        const n = name.trim();
        if (!n)         { setMsg("Informe o nome da categoria."); return null; }
        if (!companyId) { setMsg("Nenhuma empresa ativa."); return null; }
        const { data, error } = await supabase.from("categories").insert({ name: n, is_active: true, company_id: companyId }).select("id").single();
        if (error) { setMsg(`Erro ao adicionar categoria: ${error.message}`); return null; }
        await loadLists();
        return data.id as string;
    }

    async function createBrand(name: string) {
        const n = name.trim();
        if (!n)         { setMsg("Informe o nome da marca."); return null; }
        if (!companyId) { setMsg("Nenhuma empresa ativa."); return null; }
        const { data, error } = await supabase.from("brands").insert({ name: n, is_active: true, company_id: companyId }).select("id").single();
        if (error) { setMsg(`Erro ao adicionar marca: ${error.message}`); return null; }
        await loadLists();
        return data.id as string;
    }

    async function saveAll() {
        setSaving(true); setMsg(null);
        if (!companyId)  { setMsg("Nenhuma empresa ativa."); setSaving(false); return; }
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        if (!brandId)    { setMsg("Selecione uma marca."); setSaving(false); return; }

        const catName   = categories.find((c) => c.id === categoryId)?.name ?? "Categoria";
        const brandName = brands.find((b) => b.id === brandId)?.name        ?? "Marca";

        const { data: product, error: productErr } = await supabase
            .from("products")
            .insert({ name: `${catName} ${brandName}`.trim(), company_id: companyId, category_id: categoryId, brand_id: brandId, is_active: true })
            .select("id").single();

        if (productErr) { setMsg(`Erro ao criar produto: ${productErr.message}`); setSaving(false); return; }

        const payload = rows.map((r) => ({
            product_id:       product.id,
            company_id:       companyId,
            tags:             r.tags.trim()  || null,
            volume_value:     r.hasVolume ? qtyToNumber(r.volumeValue) : null,
            unit:             r.hasVolume ? r.unit : "none",
            unit_price:       brlToNumber(r.unitPrice),
            cost_price:       brlToNumber(r.costPrice) || null,
            has_case:         r.hasCase,
            case_qty:         r.hasCase && r.caseQty ? Number(r.caseQty) : null,
            case_price:       r.hasCase ? brlToNumber(r.casePrice) : null,
            is_active:        true,
            is_accompaniment: r.isAccompaniment,
        }));

        const { error: varErr } = await supabase.from("product_variants").insert(payload);
        if (varErr) { setMsg(`Erro ao salvar variações: ${varErr.message}`); setSaving(false); return; }

        setMsg("✓ Produto salvo com sucesso!");
        setRows([newRow("row-0")]);
        setSaving(false);
    }

    // ── render ─────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Cadastro de Produtos</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Selecione categoria e marca, depois adicione as variações de volume e preço</p>
                </div>
                <a href="/produtos/lista" className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    <ShoppingBag className="h-3.5 w-3.5" /> Ver Lista
                </a>
            </div>

            {/* Produto base */}
            <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                <div className="mb-4 flex items-center gap-2">
                    <Tag className="h-4 w-4 text-violet-600" />
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Produto Base</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Categoria */}
                    <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="mb-3 flex items-center justify-between">
                            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Categoria</label>
                            <button onClick={() => setCategoryModalOpen(true)} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                <Plus className="h-3 w-3" /> Adicionar
                            </button>
                        </div>
                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectCls}>
                            <option value="">{categories.length ? "Selecione..." : "Sem categorias"}</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    {/* Marca */}
                    <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="mb-3 flex items-center justify-between">
                            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Marca</label>
                            <button onClick={() => setBrandModalOpen(true)} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                <Plus className="h-3 w-3" /> Adicionar
                            </button>
                        </div>
                        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={selectCls}>
                            <option value="">{brands.length ? "Selecione..." : "Sem marcas"}</option>
                            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Legenda de campos novos */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs text-violet-700 dark:border-violet-900/30 dark:bg-violet-900/10 dark:text-violet-300">
                <span className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 text-violet-500" /> <strong>Tags/Sinônimos:</strong> palavras separadas por vírgula para o bot encontrar o produto</span>
                <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5 text-emerald-500" /> <strong>Custo:</strong> oculto para o cliente — usado no módulo Financeiro</span>
                <span className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-orange-500" /> <strong>Saldo:</strong> calculado de movimentos de estoque</span>
            </div>

            {/* Variações */}
            <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Variações</h2>
                    <button onClick={addRow} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600">
                        <Plus className="h-3 w-3" /> Adicionar linha
                    </button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                    <table className="w-full min-w-[1100px] text-sm">
                        <thead>
                            <tr className="bg-violet-50 text-xs text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
                                <th className="px-3 py-2.5 text-center">Vol?</th>
                                <th className="px-3 py-2.5 text-left">Volume</th>
                                <th className="px-3 py-2.5 text-left">Un</th>
                                <th className="px-3 py-2.5 text-left">Tags / Sinônimos</th>
                                <th className="px-3 py-2.5 text-left">Unit (R$)</th>
                                <th className="px-3 py-2.5 text-left">Custo (R$)</th>
                                <th className="px-3 py-2.5 text-center">Cx?</th>
                                <th className="px-3 py-2.5 text-left">Cx c/</th>
                                <th className="px-3 py-2.5 text-left">Cx (R$)</th>
                                <th className="px-3 py-2.5 text-center" title="Oferecer como acompanhamento?">Acomp?</th>
                                <th className="px-3 py-2.5 text-center">Saldo</th>
                                <th className="px-3 py-2.5 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {rows.map((r) => (
                                <tr key={r.tempId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                    {/* Vol? */}
                                    <td className="px-3 py-2 text-center">
                                        <input type="checkbox" checked={r.hasVolume}
                                            onChange={(e) => updateRow(r.tempId, {
                                                hasVolume: e.target.checked,
                                                volumeValue: e.target.checked ? r.volumeValue : "",
                                                unit: e.target.checked ? (r.unit === "none" ? "ml" : r.unit) : "none",
                                            })}
                                            className="h-4 w-4 rounded border-zinc-300 accent-violet-600" />
                                    </td>
                                    {/* Volume */}
                                    <td className="px-3 py-2">
                                        <input disabled={!r.hasVolume} value={r.volumeValue}
                                            onChange={(e) => updateRow(r.tempId, { volumeValue: e.target.value })}
                                            placeholder={r.hasVolume ? "350" : "—"} className={`${inputCls} w-20`} />
                                    </td>
                                    {/* Unidade */}
                                    <td className="px-3 py-2">
                                        <select disabled={!r.hasVolume} value={r.hasVolume ? r.unit : "none"}
                                            onChange={(e) => updateRow(r.tempId, { unit: e.target.value as Unit })}
                                            className={`${selectCls} w-16`}>
                                            <option value="ml">ml</option>
                                            <option value="l">l</option>
                                            <option value="kg">kg</option>
                                        </select>
                                    </td>
                                    {/* Tags */}
                                    <td className="px-3 py-2">
                                        <input value={r.tags}
                                            onChange={(e) => updateRow(r.tempId, { tags: e.target.value })}
                                            placeholder="latinha, gelada, skolzinha…"
                                            title="Palavras separadas por vírgula que o bot usa para encontrar este produto"
                                            className={`${inputCls} w-52`} />
                                    </td>
                                    {/* Preço unit */}
                                    <td className="px-3 py-2">
                                        <input value={r.unitPrice}
                                            onChange={(e) => updateRow(r.tempId, { unitPrice: formatBRLInput(e.target.value) })}
                                            className={`${inputCls} w-24`} inputMode="numeric" />
                                    </td>
                                    {/* Custo */}
                                    <td className="px-3 py-2">
                                        <div className="relative">
                                            <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-300" />
                                            <input value={r.costPrice}
                                                onChange={(e) => updateRow(r.tempId, { costPrice: formatBRLInput(e.target.value) })}
                                                placeholder="0,00"
                                                title="Preço de custo (visível somente no ERP)"
                                                className={`${inputCls} w-24 pl-6`} inputMode="numeric" />
                                        </div>
                                    </td>
                                    {/* Cx? */}
                                    <td className="px-3 py-2 text-center">
                                        <input type="checkbox" checked={r.hasCase}
                                            onChange={(e) => updateRow(r.tempId, {
                                                hasCase: e.target.checked,
                                                caseQty: e.target.checked ? r.caseQty : "",
                                                casePrice: e.target.checked ? r.casePrice : "0,00",
                                            })}
                                            className="h-4 w-4 rounded border-zinc-300 accent-violet-600" />
                                    </td>
                                    {/* Cx c/ */}
                                    <td className="px-3 py-2">
                                        <input disabled={!r.hasCase} value={r.caseQty}
                                            onChange={(e) => updateRow(r.tempId, { caseQty: e.target.value })}
                                            placeholder={r.hasCase ? "12" : "—"} className={`${inputCls} w-16`} inputMode="numeric" />
                                    </td>
                                    {/* Cx R$ */}
                                    <td className="px-3 py-2">
                                        <input disabled={!r.hasCase} value={r.casePrice}
                                            onChange={(e) => updateRow(r.tempId, { casePrice: formatBRLInput(e.target.value) })}
                                            placeholder="0,00" className={`${inputCls} w-24`} inputMode="numeric" />
                                    </td>
                                    {/* Acompanhamento */}
                                    <td className="px-3 py-2 text-center">
                                        <div className="flex flex-col items-center">
                                            <input type="checkbox" checked={r.isAccompaniment}
                                                onChange={(e) => updateRow(r.tempId, { isAccompaniment: e.target.checked })}
                                                title="Se marcado, o bot vai sugerir este item ao cliente após fechar um pedido de bebidas"
                                                className="h-4 w-4 rounded border-zinc-300 accent-orange-500" />
                                            {r.isAccompaniment && <span className="mt-0.5 text-[9px] font-bold text-orange-500">BOT</span>}
                                        </div>
                                    </td>
                                    {/* Saldo */}
                                    <td className="px-3 py-2 text-center">
                                        <StockBadge n={r.stock} />
                                    </td>
                                    {/* Excluir */}
                                    <td className="px-3 py-2 text-center">
                                        <button onClick={() => removeRow(r.tempId)} disabled={rows.length === 1}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:border-zinc-700">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Tags hint */}
                <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    💡 <strong>Tags/Sinônimos:</strong> escreva palavras separadas por vírgula no campo Tags (ex: <em>latinha, gelada, skolzinha</em>).
                    O Chatbot irá encontrar este produto quando o cliente digitar qualquer uma dessas palavras no WhatsApp.
                </div>

                <div className="mt-4 flex items-center gap-3">
                    <button onClick={saveAll} disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-60">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {saving ? "Salvando…" : "Salvar tudo"}
                    </button>
                    {msg && <p className={`text-xs font-semibold ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</p>}
                </div>
            </div>

            {/* Modal Categoria */}
            <Modal title="Adicionar Categoria" open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)}>
                <p className="mb-3 text-xs text-zinc-500">Digite o nome da nova categoria e salve.</p>
                <input value={categoryNewName} onChange={(e) => setCategoryNewName(e.target.value)} placeholder="Ex: Cerveja" className={inputCls} />
                <div className="mt-4 flex gap-2">
                    <button onClick={async () => { const id = await createCategory(categoryNewName); if (id) { setCategoryNewName(""); setCategoryModalOpen(false); setCategoryId(id); } }}
                        className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">Salvar</button>
                    <button onClick={() => setCategoryModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                </div>
            </Modal>

            {/* Modal Marca */}
            <Modal title="Adicionar Marca" open={brandModalOpen} onClose={() => setBrandModalOpen(false)}>
                <p className="mb-3 text-xs text-zinc-500">Digite o nome da nova marca e salve.</p>
                <input value={brandNewName} onChange={(e) => setBrandNewName(e.target.value)} placeholder="Ex: Skol" className={inputCls} />
                <div className="mt-4 flex gap-2">
                    <button onClick={async () => { const id = await createBrand(brandNewName); if (id) { setBrandNewName(""); setBrandModalOpen(false); setBrandId(id); } }}
                        className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">Salvar</button>
                    <button onClick={() => setBrandModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                </div>
            </Modal>
        </div>
    );
}
