"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Brand = { id: string; name: string };

type Unit = "none" | "ml" | "l" | "kg";

type VariantRow = {
    tempId: string;

    hasVolume: boolean;
    volumeValue: string; // ex: "350" ou "2"
    unit: Unit; // none/ml/l/kg

    details: string;

    unitPrice: string; // "0,00"

    hasCase: boolean;
    caseQty: string; // livre: "12", "24"...
    casePrice: string; // "0,00"
};

function newRow(): VariantRow {
    return {
        tempId: crypto.randomUUID(),

        hasVolume: false,
        volumeValue: "",
        unit: "none",

        details: "",

        unitPrice: "0,00",

        hasCase: false,
        caseQty: "",
        casePrice: "0,00",
    };
}

/** máscara simples BR: só números -> 0,00 */
function formatBRLInput(raw: string) {
    const digits = raw.replace(/\D/g, "");
    const num = Number(digits) / 100;
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlToNumber(v: string) {
    // "1.234,56" -> 1234.56
    const cleaned = v.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
}

function qtyToNumber(v: string) {
    const cleaned = v.replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
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
                    width: "min(520px, 100%)",
                    background: "#fff",
                    borderRadius: 14,
                    border: "1px solid #ddd",
                    padding: 16,
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

export default function ProdutosPage() {
    const supabase = useMemo(() => createClient(), []);

    // dados
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);

    // Categoria UX (boolean selecionar existente)
    const [useExistingCategory, setUseExistingCategory] = useState(false);
    const [categoryId, setCategoryId] = useState("");
    const [categoryNewName, setCategoryNewName] = useState("");
    const [categoryModalOpen, setCategoryModalOpen] = useState(false);

    // Marca UX (boolean selecionar existente)
    const [useExistingBrand, setUseExistingBrand] = useState(false);
    const [brandId, setBrandId] = useState("");
    const [brandNewName, setBrandNewName] = useState("");
    const [brandModalOpen, setBrandModalOpen] = useState(false);

    // linhas
    const [rows, setRows] = useState<VariantRow[]>([newRow()]);

    // status
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    async function loadLists() {
        setMsg(null);

        const [catRes, brandRes] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (catRes.error) setMsg(`Erro categorias: ${catRes.error.message}`);
        if (brandRes.error) setMsg(`Erro marcas: ${brandRes.error.message}`);

        setCategories((catRes.data as Category[]) ?? []);
        setBrands((brandRes.data as Brand[]) ?? []);
    }

    useEffect(() => {
        loadLists();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Quando usuário ativa "selecionar existente" mas não existe nada => abrir modal de adicionar
    useEffect(() => {
        if (useExistingCategory && categories.length === 0) setCategoryModalOpen(true);
    }, [useExistingCategory, categories.length]);

    useEffect(() => {
        if (useExistingBrand && brands.length === 0) setBrandModalOpen(true);
    }, [useExistingBrand, brands.length]);

    function addRow() {
        setRows((prev) => [...prev, newRow()]);
    }

    function removeRow(tempId: string) {
        setRows((prev) => prev.filter((r) => r.tempId !== tempId));
    }

    function updateRow(tempId: string, patch: Partial<VariantRow>) {
        setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
    }

    async function createCategory(name: string) {
        const n = name.trim();
        if (!n) {
            setMsg("Informe o nome da categoria.");
            return null;
        }

        const { data, error } = await supabase.from("categories").insert({ name: n, is_active: true }).select("id").single();
        if (error) {
            setMsg(`Erro ao adicionar categoria: ${error.message}`);
            return null;
        }

        await loadLists();
        return data.id as string;
    }

    async function createBrand(name: string) {
        const n = name.trim();
        if (!n) {
            setMsg("Informe o nome da marca.");
            return null;
        }

        const { data, error } = await supabase.from("brands").insert({ name: n, is_active: true }).select("id").single();
        if (error) {
            setMsg(`Erro ao adicionar marca: ${error.message}`);
            return null;
        }

        await loadLists();
        return data.id as string;
    }

    async function resolveCategoryId() {
        // Se usuário escolheu "selecionar existente", precisa do select
        if (useExistingCategory) {
            if (!categoryId) return null;
            return categoryId;
        }

        // Senão, cria nova (a ideia é "salvar" = digitar e salvar)
        if (!categoryNewName.trim()) return null;
        const created = await createCategory(categoryNewName);
        if (created) setCategoryNewName("");
        return created;
    }

    async function resolveBrandId() {
        if (useExistingBrand) {
            if (!brandId) return null;
            return brandId;
        }

        if (!brandNewName.trim()) return null;
        const created = await createBrand(brandNewName);
        if (created) setBrandNewName("");
        return created;
    }

    async function saveAll() {
        setSaving(true);
        setMsg(null);

        const finalCategoryId = await resolveCategoryId();
        if (!finalCategoryId) {
            setMsg("Categoria: selecione uma existente (boolean) ou adicione uma nova.");
            setSaving(false);
            return;
        }

        const finalBrandId = await resolveBrandId();
        if (!finalBrandId) {
            setMsg("Marca: selecione uma existente (boolean) ou adicione uma nova.");
            setSaving(false);
            return;
        }

        // Nome automático (pode mudar depois)
        const catName = categories.find((c) => c.id === finalCategoryId)?.name ?? "Categoria";
        const brandName = brands.find((b) => b.id === finalBrandId)?.name ?? "Marca";
        const baseName = `${catName} ${brandName}`.trim();

        // Cria produto base
        const { data: product, error: productErr } = await supabase
            .from("products")
            .insert({
                name: baseName,
                category_id: finalCategoryId,
                brand_id: finalBrandId,
                is_active: true,
            })
            .select("id")
            .single();

        if (productErr) {
            setMsg(`Erro ao criar produto base: ${productErr.message}`);
            setSaving(false);
            return;
        }

        const productId = product.id as string;

        // Variantes
        const payload = rows.map((r) => {
            const unitPrice = brlToNumber(r.unitPrice);
            const casePrice = brlToNumber(r.casePrice);

            const hasVolume = r.hasVolume;
            const volumeValue = hasVolume ? qtyToNumber(r.volumeValue) : null;
            const unit = hasVolume ? (r.unit === "none" ? "none" : r.unit) : "none";

            const hasCase = r.hasCase;
            const caseQty = hasCase ? Number(r.caseQty || "0") : null;

            return {
                product_id: productId,

                details: r.details?.trim() || null,

                volume_value: volumeValue,
                unit, // none/ml/l/kg

                unit_price: unitPrice,

                has_case: hasCase,
                case_qty: hasCase ? (caseQty && caseQty > 0 ? caseQty : null) : null,
                case_price: hasCase ? casePrice : null,

                is_active: true,
            };
        });

        const { error: varErr } = await supabase.from("product_variants").insert(payload);

        if (varErr) {
            setMsg(`Erro ao salvar variações: ${varErr.message}`);
            setSaving(false);
            return;
        }

        setMsg("✅ Salvo com sucesso!");
        setRows([newRow()]);
        setSaving(false);
    }

    return (
        <main style={{ padding: 24, maxWidth: 1200 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800 }}>Cadastro de Produtos</h1>
            <p style={{ marginTop: 8, color: "#555" }}>
                Categoria e Marca têm opção de <b>selecionar existente</b> (boolean) ou <b>adicionar nova</b>.
            </p>

            {/* PRODUTO BASE */}
            <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 14 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Produto base</h2>

                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
                    {/* CATEGORIA */}
                    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 800 }}>Categoria</div>
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input
                                    type="checkbox"
                                    checked={useExistingCategory}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setUseExistingCategory(v);
                                        setMsg(null);
                                        if (!v) setCategoryId("");
                                        if (v && categories.length === 0) setCategoryModalOpen(true);
                                    }}
                                />
                                Selecionar existente
                            </label>
                        </div>

                        {useExistingCategory ? (
                            <>
                                <select
                                    value={categoryId}
                                    onChange={(e) => setCategoryId(e.target.value)}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 10 }}
                                >
                                    <option value="">Selecione...</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>

                                {categories.length > 0 && (
                                    <button
                                        onClick={() => setCategoryModalOpen(true)}
                                        style={{
                                            marginTop: 10,
                                            padding: "10px 12px",
                                            borderRadius: 10,
                                            border: "1px solid #999",
                                            cursor: "pointer",
                                        }}
                                    >
                                        + Adicionar categoria
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <input
                                    placeholder="Digite para salvar nova categoria"
                                    value={categoryNewName}
                                    onChange={(e) => setCategoryNewName(e.target.value)}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 10 }}
                                />
                                <small style={{ display: "block", marginTop: 6, color: "#666" }}>
                                    Ao salvar, essa categoria fica guardada para usar depois.
                                </small>
                            </>
                        )}
                    </div>

                    {/* MARCA */}
                    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 800 }}>Marca</div>
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input
                                    type="checkbox"
                                    checked={useExistingBrand}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setUseExistingBrand(v);
                                        setMsg(null);
                                        if (!v) setBrandId("");
                                        if (v && brands.length === 0) setBrandModalOpen(true);
                                    }}
                                />
                                Selecionar existente
                            </label>
                        </div>

                        {useExistingBrand ? (
                            <>
                                <select
                                    value={brandId}
                                    onChange={(e) => setBrandId(e.target.value)}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 10 }}
                                >
                                    <option value="">Selecione...</option>
                                    {brands.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>

                                {brands.length > 0 && (
                                    <button
                                        onClick={() => setBrandModalOpen(true)}
                                        style={{
                                            marginTop: 10,
                                            padding: "10px 12px",
                                            borderRadius: 10,
                                            border: "1px solid #999",
                                            cursor: "pointer",
                                        }}
                                    >
                                        + Adicionar marca
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <input
                                    placeholder="Digite para salvar nova marca"
                                    value={brandNewName}
                                    onChange={(e) => setBrandNewName(e.target.value)}
                                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, marginTop: 10 }}
                                />
                                <small style={{ display: "block", marginTop: 6, color: "#666" }}>
                                    Ao salvar, essa marca fica guardada para usar depois.
                                </small>
                            </>
                        )}
                    </div>
                </div>
            </section>

            {/* VARIANTES */}
            <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Variações (linhas)</h2>
                    <button
                        onClick={addRow}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        + Adicionar linha
                    </button>
                </div>

                <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                        <thead>
                            <tr style={{ background: "#f5f5f5" }}>
                                <th style={{ textAlign: "center", padding: 10 }}>Volume?</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Volume</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Unidade</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Detalhes</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Valor unitário (R$)</th>
                                <th style={{ textAlign: "center", padding: 10 }}>Caixa?</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Caixa com</th>
                                <th style={{ textAlign: "left", padding: 10 }}>Valor caixa (R$)</th>
                                <th style={{ textAlign: "center", padding: 10 }}>Ações</th>
                            </tr>
                        </thead>

                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.tempId} style={{ borderTop: "1px solid #eee" }}>
                                    {/* VOLUME BOOL */}
                                    <td style={{ padding: 10, textAlign: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={r.hasVolume}
                                            onChange={(e) =>
                                                updateRow(r.tempId, {
                                                    hasVolume: e.target.checked,
                                                    volumeValue: e.target.checked ? r.volumeValue : "",
                                                    unit: e.target.checked ? (r.unit === "none" ? "ml" : r.unit) : "none",
                                                })
                                            }
                                        />
                                    </td>

                                    {/* VOLUME VALUE */}
                                    <td style={{ padding: 10 }}>
                                        <input
                                            disabled={!r.hasVolume}
                                            value={r.volumeValue}
                                            onChange={(e) => updateRow(r.tempId, { volumeValue: e.target.value })}
                                            placeholder={r.hasVolume ? "Ex: 350, 2, 5" : "—"}
                                            style={{ width: 150, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                        />
                                    </td>

                                    {/* UNIDADE */}
                                    <td style={{ padding: 10 }}>
                                        <select
                                            disabled={!r.hasVolume}
                                            value={r.hasVolume ? r.unit : "none"}
                                            onChange={(e) => updateRow(r.tempId, { unit: e.target.value as Unit })}
                                            style={{ width: 150, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                        >
                                            <option value="ml">ml</option>
                                            <option value="l">litros</option>
                                            <option value="kg">kg</option>
                                        </select>
                                    </td>

                                    {/* DETALHES */}
                                    <td style={{ padding: 10 }}>
                                        <input
                                            value={r.details}
                                            onChange={(e) => updateRow(r.tempId, { details: e.target.value })}
                                            placeholder="Ex: retornável, long neck..."
                                            style={{ width: 260, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                        />
                                    </td>

                                    {/* VALOR UNIT */}
                                    <td style={{ padding: 10 }}>
                                        <input
                                            value={r.unitPrice}
                                            onChange={(e) => updateRow(r.tempId, { unitPrice: formatBRLInput(e.target.value) })}
                                            style={{ width: 170, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    {/* CAIXA BOOL */}
                                    <td style={{ padding: 10, textAlign: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={r.hasCase}
                                            onChange={(e) =>
                                                updateRow(r.tempId, {
                                                    hasCase: e.target.checked,
                                                    caseQty: e.target.checked ? (r.caseQty || "") : "",
                                                    casePrice: e.target.checked ? r.casePrice : "0,00",
                                                })
                                            }
                                        />
                                    </td>

                                    {/* CAIXA COM (LIVRE) */}
                                    <td style={{ padding: 10 }}>
                                        <input
                                            disabled={!r.hasCase}
                                            value={r.caseQty}
                                            onChange={(e) => updateRow(r.tempId, { caseQty: e.target.value })}
                                            placeholder={r.hasCase ? "Ex: 6, 12, 24" : "—"}
                                            style={{ width: 140, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    {/* VALOR CAIXA */}
                                    <td style={{ padding: 10 }}>
                                        <input
                                            disabled={!r.hasCase}
                                            value={r.casePrice}
                                            onChange={(e) => updateRow(r.tempId, { casePrice: formatBRLInput(e.target.value) })}
                                            placeholder={r.hasCase ? "0,00" : "—"}
                                            style={{ width: 170, padding: 8, border: "1px solid #ccc", borderRadius: 10 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    {/* AÇÕES */}
                                    <td style={{ padding: 10, textAlign: "center" }}>
                                        <button
                                            onClick={() => removeRow(r.tempId)}
                                            disabled={rows.length === 1}
                                            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                                        >
                                            Remover
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
                    <button
                        onClick={saveAll}
                        disabled={saving}
                        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        {saving ? "Salvando..." : "Salvar tudo"}
                    </button>

                    {msg && <p style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}
                </div>
            </section>

            {/* MODAL CATEGORIA */}
            <Modal title="Adicionar categoria" open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)}>
                <p style={{ marginTop: 0, color: "#555" }}>
                    Digite o nome e clique em salvar. Ela ficará disponível para seleção depois.
                </p>

                <input
                    value={categoryNewName}
                    onChange={(e) => setCategoryNewName(e.target.value)}
                    placeholder="Ex: Cerveja"
                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                />

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                        onClick={async () => {
                            const id = await createCategory(categoryNewName);
                            if (id) {
                                setCategoryModalOpen(false);
                                if (useExistingCategory) setCategoryId(id);
                            }
                        }}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        Salvar
                    </button>

                    <button
                        onClick={() => setCategoryModalOpen(false)}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        Cancelar
                    </button>
                </div>
            </Modal>

            {/* MODAL MARCA */}
            <Modal title="Adicionar marca" open={brandModalOpen} onClose={() => setBrandModalOpen(false)}>
                <p style={{ marginTop: 0, color: "#555" }}>
                    Digite o nome e clique em salvar. Ela ficará disponível para seleção depois.
                </p>

                <input
                    value={brandNewName}
                    onChange={(e) => setBrandNewName(e.target.value)}
                    placeholder="Ex: Skol"
                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10 }}
                />

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                        onClick={async () => {
                            const id = await createBrand(brandNewName);
                            if (id) {
                                setBrandModalOpen(false);
                                if (useExistingBrand) setBrandId(id);
                            }
                        }}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        Salvar
                    </button>

                    <button
                        onClick={() => setBrandModalOpen(false)}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
                    >
                        Cancelar
                    </button>
                </div>
            </Modal>
        </main>
    );
}
