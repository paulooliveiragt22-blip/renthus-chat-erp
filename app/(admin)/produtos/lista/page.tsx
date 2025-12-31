"use client";
// vercel: rebuild with normalizeRows
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Unit = "none" | "ml" | "l" | "kg";
type Category = { id: string; name: string };
type Brand = { id: string; name: string };

type RowProduct = {
    name: string | null;
    category_id: string | null;
    brand_id: string | null;
    categories: { id: string; name: string } | null;
    brands: { id: string; name: string } | null;
} | null;

type Row = {
    id: string;
    product_id: string;

    details: string | null;
    volume_value: number | null;
    unit: Unit;

    unit_price: number;
    has_case: boolean;
    case_qty: number | null;
    case_price: number | null;

    is_active: boolean;

    products: RowProduct;
};

function formatBRL(n: number | null | undefined) {
    const v = typeof n === "number" ? n : 0;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBRLInput(raw: string) {
    const digits = raw.replace(/\D/g, "");
    const num = Number(digits) / 100;
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlToNumber(v: string) {
    const cleaned = v.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
}

function unitLabel(u: Unit) {
    if (u === "none") return "Nenhum";
    if (u === "l") return "litros";
    return u; // ml/kg
}

function Modal({
    title,
    open,
    onClose,
    children,
}: {
    title: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    if (!open) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "grid",
                placeItems: "center",
                padding: 16,
                zIndex: 50,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(860px, 100%)",
                    background: "#fff",
                    borderRadius: 14,
                    border: "1px solid #ddd",
                    padding: 16,
                    maxHeight: "90vh",
                    overflow: "auto",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{ border: "1px solid #ccc", borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}
                    >
                        Fechar
                    </button>
                </div>
                <div style={{ marginTop: 12 }}>{children}</div>
            </div>
        </div>
    );
}

// ✅ helper: se vier objeto OU array (por bug/ambiguidade de relação), pega o primeiro ou null
function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
}

// ✅ Normaliza o retorno do Supabase para bater com Row
function normalizeRows(input: unknown): Row[] {
    const arr = Array.isArray(input) ? input : [];

    return arr.map((r: any) => {
        const rawUnit = (r?.unit ?? "none") as string;
        const unit: Unit = rawUnit === "ml" || rawUnit === "l" || rawUnit === "kg" || rawUnit === "none" ? (rawUnit as Unit) : "none";

        // products pode vir como array
        const p0: any = firstOrNull<any>(r?.products);

        // categories/brands podem vir como array
        const c0: any = firstOrNull<any>(p0?.categories);
        const b0: any = firstOrNull<any>(p0?.brands);

        const products: RowProduct = p0
            ? {
                name: p0?.name ?? null,
                category_id: p0?.category_id ?? null,
                brand_id: p0?.brand_id ?? null,
                categories: c0 ? { id: String(c0.id), name: String(c0.name ?? "") } : null,
                brands: b0 ? { id: String(b0.id), name: String(b0.name ?? "") } : null,
            }
            : null;

        return {
            id: String(r?.id ?? ""),
            product_id: String(r?.product_id ?? ""),

            details: r?.details ?? null,
            volume_value: r?.volume_value ?? null,
            unit,

            unit_price: Number(r?.unit_price ?? 0),
            has_case: Boolean(r?.has_case),
            case_qty: r?.case_qty ?? null,
            case_price: r?.case_price ?? null,

            is_active: Boolean(r?.is_active),

            products,
        };
    });
}

export default function ProdutosListaPage() {
    const supabase = useMemo(() => createClient(), []);

    const [rows, setRows] = useState<Row[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);

    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);

    const [search, setSearch] = useState("");

    // modal principal (editar variação)
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<Row | null>(null);

    // === edição VARIANTE ===
    const [details, setDetails] = useState("");
    const [hasVolume, setHasVolume] = useState(false);
    const [volumeValue, setVolumeValue] = useState("");
    const [unit, setUnit] = useState<Unit>("none");

    const [unitPrice, setUnitPrice] = useState("0,00");

    const [hasCase, setHasCase] = useState(false);
    const [caseQty, setCaseQty] = useState("");
    const [casePrice, setCasePrice] = useState("0,00");

    const [isActive, setIsActive] = useState(true);

    // === edição PRODUTO BASE (categoria/marca) ===
    const [useExistingCategory, setUseExistingCategory] = useState(true);
    const [categoryId, setCategoryId] = useState("");
    const [newCategoryName, setNewCategoryName] = useState("");

    const [useExistingBrand, setUseExistingBrand] = useState(true);
    const [brandId, setBrandId] = useState("");
    const [newBrandName, setNewBrandName] = useState("");

    // sub-modais: adicionar categoria/marca (botões dentro do modal)
    const [addCategoryOpen, setAddCategoryOpen] = useState(false);
    const [addBrandOpen, setAddBrandOpen] = useState(false);

    const [saving, setSaving] = useState(false);

    async function load() {
        setLoading(true);
        setMsg(null);

        const [variantsRes, categoriesRes, brandsRes] = await Promise.all([
            supabase
                .from("product_variants")
                .select(
                    `
          id, product_id,
          details, volume_value, unit,
          unit_price, has_case, case_qty, case_price,
          is_active,
          products (
            name,
            category_id,
            brand_id,
            categories ( id, name ),
            brands ( id, name )
          )
        `
                )
                .order("created_at", { ascending: false }),

            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (variantsRes.error) {
            setMsg(`Erro ao carregar: ${variantsRes.error.message}`);
            setRows([]);
            setLoading(false);
            return;
        }

        if (!categoriesRes.error) {
            setCategories(
                ((categoriesRes.data as any[]) ?? []).map((c) => ({
                    id: String(c.id),
                    name: String(c.name ?? ""),
                }))
            );
        }
        if (!brandsRes.error) {
            setBrands(
                ((brandsRes.data as any[]) ?? []).map((b) => ({
                    id: String(b.id),
                    name: String(b.name ?? ""),
                }))
            );
        }

        // ✅ AQUI está a correção (sem cast que quebra no build)
        setRows(normalizeRows(variantsRes.data));
        setLoading(false);
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function openEdit(r: Row) {
        setSelected(r);
        setOpen(true);
        setMsg(null);

        // variante
        setDetails(r.details ?? "");

        const hv = r.unit !== "none" && r.volume_value !== null;
        setHasVolume(hv);
        setVolumeValue(hv ? String(r.volume_value ?? "") : "");
        setUnit(hv ? r.unit : "none");

        setUnitPrice(formatBRL(r.unit_price));

        setHasCase(!!r.has_case);
        setCaseQty(r.case_qty ? String(r.case_qty) : "");
        setCasePrice(formatBRL(r.case_price ?? 0));

        setIsActive(!!r.is_active);

        // categoria/marca do produto base
        const currentCategoryId = r.products?.category_id ?? r.products?.categories?.id ?? "";
        const currentBrandId = r.products?.brand_id ?? r.products?.brands?.id ?? "";

        setCategoryId(currentCategoryId);
        setBrandId(currentBrandId);

        setUseExistingCategory(true);
        setUseExistingBrand(true);

        setNewCategoryName("");
        setNewBrandName("");
    }

    async function reloadCatsAndBrands() {
        const [cats, brs] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (!cats.error) {
            setCategories(
                ((cats.data as any[]) ?? []).map((c) => ({
                    id: String(c.id),
                    name: String(c.name ?? ""),
                }))
            );
        }
        if (!brs.error) {
            setBrands(
                ((brs.data as any[]) ?? []).map((b) => ({
                    id: String(b.id),
                    name: String(b.name ?? ""),
                }))
            );
        }
    }

    async function createCategory(name: string) {
        const n = name.trim();
        if (!n) {
            setMsg("Informe o nome da categoria.");
            return null;
        }

        const { data, error } = await supabase.from("categories").insert({ name: n, is_active: true }).select("id").single();
        if (error) {
            setMsg(`Erro ao criar categoria: ${error.message}`);
            return null;
        }

        await reloadCatsAndBrands();
        return String((data as any).id);
    }

    async function createBrand(name: string) {
        const n = name.trim();
        if (!n) {
            setMsg("Informe o nome da marca.");
            return null;
        }

        const { data, error } = await supabase.from("brands").insert({ name: n, is_active: true }).select("id").single();
        if (error) {
            setMsg(`Erro ao criar marca: ${error.message}`);
            return null;
        }

        await reloadCatsAndBrands();
        return String((data as any).id);
    }

    async function saveEdit() {
        if (!selected) return;

        setSaving(true);
        setMsg(null);

        // 1) resolver categoria
        let finalCategoryId = categoryId;
        if (!useExistingCategory) {
            const created = await createCategory(newCategoryName);
            if (!created) {
                setSaving(false);
                return;
            }
            finalCategoryId = created;
        }
        if (!finalCategoryId) {
            setMsg("Categoria: selecione uma existente ou crie uma nova.");
            setSaving(false);
            return;
        }

        // 2) resolver marca
        let finalBrandId = brandId;
        if (!useExistingBrand) {
            const created = await createBrand(newBrandName);
            if (!created) {
                setSaving(false);
                return;
            }
            finalBrandId = created;
        }
        if (!finalBrandId) {
            setMsg("Marca: selecione uma existente ou crie uma nova.");
            setSaving(false);
            return;
        }

        // 3) atualizar produto base (categoria + marca)
        const productId = selected.product_id;

        const { error: prodErr } = await supabase
            .from("products")
            .update({ category_id: finalCategoryId, brand_id: finalBrandId })
            .eq("id", productId);

        if (prodErr) {
            setMsg(`Erro ao salvar categoria/marca do produto: ${prodErr.message}`);
            setSaving(false);
            return;
        }

        // 4) atualizar variação
        const patch: {
            details: string | null;
            unit_price: number;
            has_case: boolean;
            is_active: boolean;
            volume_value?: number | null;
            unit?: Unit;
            case_qty?: number | null;
            case_price?: number | null;
        } = {
            details: details.trim() || null,
            unit_price: brlToNumber(unitPrice),
            has_case: hasCase,
            is_active: isActive,
        };

        if (!hasVolume) {
            patch.volume_value = null;
            patch.unit = "none";
        } else {
            const vv = Number(String(volumeValue).replace(",", "."));
            patch.volume_value = Number.isFinite(vv) ? vv : null;
            patch.unit = unit;
        }

        if (!hasCase) {
            patch.case_qty = null;
            patch.case_price = null;
        } else {
            const cq = Number(String(caseQty || "0").replace(/\D/g, ""));
            patch.case_qty = cq > 0 ? cq : null;
            patch.case_price = brlToNumber(casePrice);
        }

        const { error: varErr } = await supabase.from("product_variants").update(patch).eq("id", selected.id);

        if (varErr) {
            setMsg(`Erro ao salvar variação: ${varErr.message}`);
            setSaving(false);
            return;
        }

        setSaving(false);
        setOpen(false);
        setSelected(null);
        await load();
    }

    const filtered = rows.filter((r) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        const cat = r.products?.categories?.name?.toLowerCase() ?? "";
        const brand = r.products?.brands?.name?.toLowerCase() ?? "";
        const det = (r.details ?? "").toLowerCase();
        const name = (r.products?.name ?? "").toLowerCase();
        return [cat, brand, det, name].some((x) => x.includes(s));
    });

    return (
        <main style={{ padding: 24, maxWidth: 1300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>Lista de Produtos</h1>
                    <p style={{ marginTop: 8, color: "#555" }}>Editar por modal (com botão Salvar).</p>
                </div>

                <a href="/produtos" style={{ border: "1px solid #999", borderRadius: 10, padding: "10px 12px" }}>
                    + Cadastrar
                </a>
            </div>

            <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 14 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                        placeholder="Buscar por categoria, marca, detalhes..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ minWidth: 320, padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                    />

                    <button
                        onClick={load}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        Recarregar
                    </button>

                    {msg && <span style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</span>}
                </div>

                <div style={{ marginTop: 14, overflowX: "auto" }}>
                    {loading ? (
                        <p>Carregando...</p>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                            <thead>
                                <tr style={{ background: "#f5f5f5" }}>
                                    <th style={{ textAlign: "left", padding: 10 }}>Categoria</th>
                                    <th style={{ textAlign: "left", padding: 10 }}>Marca</th>
                                    <th style={{ textAlign: "left", padding: 10 }}>Detalhes</th>
                                    <th style={{ textAlign: "left", padding: 10 }}>Volume</th>
                                    <th style={{ textAlign: "right", padding: 10 }}>Valor unitário(R$)</th>
                                    <th style={{ textAlign: "left", padding: 10 }}>Caixa</th>
                                    <th style={{ textAlign: "right", padding: 10 }}>Caixa (R$)</th>
                                    <th style={{ textAlign: "center", padding: 10 }}>Ativo</th>
                                    <th style={{ textAlign: "center", padding: 10 }}>Ações</th>
                                </tr>
                            </thead>

                            <tbody>
                                {filtered.map((r) => (
                                    <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                                        <td style={{ padding: 10 }}>{r.products?.categories?.name ?? "-"}</td>
                                        <td style={{ padding: 10 }}>{r.products?.brands?.name ?? "-"}</td>
                                        <td style={{ padding: 10 }}>{r.details ?? "-"}</td>

                                        <td style={{ padding: 10 }}>
                                            {r.unit === "none" || r.volume_value === null ? "—" : `${r.volume_value} ${unitLabel(r.unit)}`}
                                        </td>

                                        <td style={{ padding: 10, textAlign: "right" }}>{formatBRL(r.unit_price)}</td>

                                        <td style={{ padding: 10 }}>{r.has_case ? `com ${r.case_qty ?? "?"}` : "—"}</td>

                                        <td style={{ padding: 10, textAlign: "right" }}>{r.has_case ? formatBRL(r.case_price ?? 0) : "—"}</td>

                                        <td style={{ padding: 10, textAlign: "center" }}>{r.is_active ? "✅" : "—"}</td>

                                        <td style={{ padding: 10, textAlign: "center" }}>
                                            <button
                                                onClick={() => openEdit(r)}
                                                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                                            >
                                                Editar
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={9} style={{ padding: 10, color: "#666" }}>
                                            Nenhum item encontrado.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            {/* MODAL PRINCIPAL */}
            <Modal
                title={
                    selected
                        ? `Editar: ${selected.products?.categories?.name ?? ""} ${selected.products?.brands?.name ?? ""}`.trim()
                        : "Editar"
                }
                open={open}
                onClose={() => {
                    setOpen(false);
                    setSelected(null);
                    setMsg(null);
                }}
            >
                {/* CATEGORIA */}
                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div>
                            <div style={{ fontWeight: 900 }}>Categoria</div>
                            <div style={{ color: "#555" }}>{selected?.products?.categories?.name ?? "-"}</div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                                <input
                                    type="checkbox"
                                    checked={useExistingCategory}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setUseExistingCategory(v);
                                        setMsg(null);
                                        if (v) setNewCategoryName("");
                                    }}
                                />
                                Selecionar existente
                            </label>

                            <button
                                onClick={() => {
                                    setMsg(null);
                                    setAddCategoryOpen(true);
                                }}
                                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                            >
                                + Adicionar
                            </button>
                        </div>
                    </div>

                    {useExistingCategory ? (
                        <div style={{ marginTop: 10 }}>
                            <select
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            >
                                <option value="">Selecione...</option>
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <small style={{ color: "#666" }}>Ao salvar, a categoria do produto base será atualizada.</small>
                        </div>
                    ) : (
                        <div style={{ marginTop: 10 }}>
                            <input
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                placeholder="Digite para criar nova categoria"
                                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            />
                            <small style={{ color: "#666" }}>A nova categoria será criada e usada neste produto.</small>
                        </div>
                    )}
                </div>

                {/* MARCA */}
                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div>
                            <div style={{ fontWeight: 900 }}>Marca</div>
                            <div style={{ color: "#555" }}>{selected?.products?.brands?.name ?? "-"}</div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                                <input
                                    type="checkbox"
                                    checked={useExistingBrand}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setUseExistingBrand(v);
                                        setMsg(null);
                                        if (v) setNewBrandName("");
                                    }}
                                />
                                Selecionar existente
                            </label>

                            <button
                                onClick={() => {
                                    setMsg(null);
                                    setAddBrandOpen(true);
                                }}
                                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                            >
                                + Adicionar
                            </button>
                        </div>
                    </div>

                    {useExistingBrand ? (
                        <div style={{ marginTop: 10 }}>
                            <select
                                value={brandId}
                                onChange={(e) => setBrandId(e.target.value)}
                                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            >
                                <option value="">Selecione...</option>
                                {brands.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name}
                                    </option>
                                ))}
                            </select>
                            <small style={{ color: "#666" }}>Ao salvar, a marca do produto base será atualizada.</small>
                        </div>
                    ) : (
                        <div style={{ marginTop: 10 }}>
                            <input
                                value={newBrandName}
                                onChange={(e) => setNewBrandName(e.target.value)}
                                placeholder="Digite para criar nova marca"
                                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            />
                            <small style={{ color: "#666" }}>A nova marca será criada e usada neste produto.</small>
                        </div>
                    )}
                </div>

                {/* VARIANTE */}
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                        <label style={{ fontWeight: 700 }}>Detalhes</label>
                        <input
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            placeholder="Ex: long neck, retornável..."
                            style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 6 }}
                        />
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                            <input
                                type="checkbox"
                                checked={hasVolume}
                                onChange={(e) => {
                                    const v = e.target.checked;
                                    setHasVolume(v);
                                    if (!v) {
                                        setVolumeValue("");
                                        setUnit("none");
                                    } else {
                                        setUnit("ml");
                                    }
                                }}
                            />
                            Volume
                        </label>

                        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                            <input
                                disabled={!hasVolume}
                                value={volumeValue}
                                onChange={(e) => setVolumeValue(e.target.value)}
                                placeholder={hasVolume ? "Ex: 350" : "—"}
                                style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            />
                            <select
                                disabled={!hasVolume}
                                value={hasVolume ? unit : "none"}
                                onChange={(e) => setUnit(e.target.value as Unit)}
                                style={{ width: 140, padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                            >
                                <option value="ml">ml</option>
                                <option value="l">litros</option>
                                <option value="kg">kg</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                        <label style={{ fontWeight: 800 }}>Valor unitário (R$)</label>
                        <input
                            value={unitPrice}
                            onChange={(e) => setUnitPrice(formatBRLInput(e.target.value))}
                            style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 6 }}
                            inputMode="numeric"
                        />
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, gridColumn: "1 / -1" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                            <input
                                type="checkbox"
                                checked={hasCase}
                                onChange={(e) => {
                                    const v = e.target.checked;
                                    setHasCase(v);
                                    if (!v) {
                                        setCaseQty("");
                                        setCasePrice("0,00");
                                    }
                                }}
                            />
                            Vende por caixa
                        </label>

                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "200px 240px", marginTop: 10 }}>
                            <div>
                                <label style={{ fontWeight: 700 }}>Caixa com</label>
                                <input
                                    disabled={!hasCase}
                                    value={caseQty}
                                    onChange={(e) => setCaseQty(e.target.value)}
                                    placeholder={hasCase ? "Ex: 12" : "—"}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 6 }}
                                    inputMode="numeric"
                                />
                            </div>

                            <div>
                                <label style={{ fontWeight: 700 }}>Valor da caixa (R$)</label>
                                <input
                                    disabled={!hasCase}
                                    value={casePrice}
                                    onChange={(e) => setCasePrice(formatBRLInput(e.target.value))}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 6 }}
                                    inputMode="numeric"
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, gridColumn: "1 / -1" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                            Ativo
                        </label>
                        <small style={{ color: "#666" }}>Desmarque para “desativar” sem apagar.</small>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
                    <button
                        onClick={saveEdit}
                        disabled={saving}
                        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        {saving ? "Salvando..." : "Salvar"}
                    </button>

                    {msg && <span style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</span>}
                </div>

                {/* SUBMODAL: ADICIONAR CATEGORIA */}
                <Modal title="Adicionar categoria" open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)}>
                    <p style={{ marginTop: 0, color: "#555" }}>Cria uma categoria nova e já seleciona ela para este produto.</p>
                    <input
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Ex: Cerveja"
                        style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                    />
                    <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                        <button
                            onClick={async () => {
                                setMsg(null);
                                const id = await createCategory(newCategoryName);
                                if (id) {
                                    setCategoryId(id);
                                    setUseExistingCategory(true);
                                    setNewCategoryName("");
                                    setAddCategoryOpen(false);
                                }
                            }}
                            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                        >
                            Criar e selecionar
                        </button>
                        <button
                            onClick={() => setAddCategoryOpen(false)}
                            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                        >
                            Cancelar
                        </button>
                    </div>
                </Modal>

                {/* SUBMODAL: ADICIONAR MARCA */}
                <Modal title="Adicionar marca" open={addBrandOpen} onClose={() => setAddBrandOpen(false)}>
                    <p style={{ marginTop: 0, color: "#555" }}>Cria uma marca nova e já seleciona ela para este produto.</p>
                    <input
                        value={newBrandName}
                        onChange={(e) => setNewBrandName(e.target.value)}
                        placeholder="Ex: Skol"
                        style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                    />
                    <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                        <button
                            onClick={async () => {
                                setMsg(null);
                                const id = await createBrand(newBrandName);
                                if (id) {
                                    setBrandId(id);
                                    setUseExistingBrand(true);
                                    setNewBrandName("");
                                    setAddBrandOpen(false);
                                }
                            }}
                            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                        >
                            Criar e selecionar
                        </button>
                        <button
                            onClick={() => setAddBrandOpen(false)}
                            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                        >
                            Cancelar
                        </button>
                    </div>
                </Modal>
            </Modal>
        </main>
    );
}
