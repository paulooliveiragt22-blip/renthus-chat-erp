"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Brand = { id: string; name: string };

type Unit = "none" | "ml" | "l" | "kg";

type VariantRow = {
    tempId: string;

    hasVolume: boolean;
    volumeValue: string;
    unit: Unit;

    details: string;

    unitPrice: string;

    hasCase: boolean;
    caseQty: string;
    casePrice: string;
};

function makeClientId() {
    // Só é usado em ações do usuário (client), então não dá mismatch.
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function newRow(tempId: string): VariantRow {
    return {
        tempId,

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

    const theme = {
        purple: "#3B246B",
        orange: "#FF6600",
        border: "#E7E3EF",
        text: "#201A2B",
        muted: "#6B647A",
    };

    const btn: React.CSSProperties = {
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 12.5,
        fontWeight: 900,
        cursor: "pointer",
        border: `1px solid ${theme.border}`,
        background: "#fff",
        color: theme.text,
        whiteSpace: "nowrap",
    };

    const btnPrimary: React.CSSProperties = {
        ...btn,
        background: theme.purple,
        border: `1px solid ${theme.purple}`,
        color: "#fff",
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.40)",
                display: "grid",
                placeItems: "center",
                padding: 12,
                zIndex: 50,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(520px, 100%)",
                    background: "#fff",
                    borderRadius: 14,
                    border: `1px solid ${theme.border}`,
                    padding: 12,
                    boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950, color: theme.text }}>{title}</h3>
                    <button onClick={onClose} style={btnPrimary}>
                        Fechar
                    </button>
                </div>
                <div style={{ marginTop: 10 }}>{children}</div>
            </div>
        </div>
    );
}

export default function ProdutosPage() {
    const supabase = useMemo(() => createClient(), []);

    // dados
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);

    // agora é SEM checkbox: sempre "selecionar existente" (invisível pro usuário)
    const [categoryId, setCategoryId] = useState("");
    const [brandId, setBrandId] = useState("");

    // modal input
    const [categoryNewName, setCategoryNewName] = useState("");
    const [brandNewName, setBrandNewName] = useState("");
    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [brandModalOpen, setBrandModalOpen] = useState(false);

    // linhas (ID estável no SSR)
    const [rows, setRows] = useState<VariantRow[]>(() => [newRow("row-0")]);

    // status
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const theme = {
        purple: "#3B246B",
        orange: "#FF6600",
        border: "#E7E3EF",
        border2: "#F0EDF6",
        text: "#201A2B",
        muted: "#6B647A",
        panel: "#FBFAFE",
        softPurple: "#F4F0FF",
    };

    const shadowSm = "0 8px 20px rgba(32,26,43,0.06)";

    // mais slim (produto base ~50% menor)
    const inputSm: React.CSSProperties = {
        width: "100%",
        padding: "6px 8px",
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        fontSize: 12,
        outline: "none",
        background: "#fff",
        color: theme.text,
    };

    const selectSm: React.CSSProperties = {
        ...inputSm,
        padding: "6px 8px",
    };

    const btnBase: React.CSSProperties = {
        borderRadius: 10,
        padding: "6px 9px",
        fontSize: 12,
        fontWeight: 900,
        cursor: "pointer",
        border: `1px solid ${theme.border}`,
        background: "#fff",
        color: theme.text,
        whiteSpace: "nowrap",
    };

    const btnPrimary: React.CSSProperties = {
        ...btnBase,
        background: theme.purple,
        border: `1px solid ${theme.purple}`,
        color: "#fff",
    };

    const btnOrange: React.CSSProperties = {
        ...btnBase,
        background: theme.orange,
        border: `1px solid ${theme.orange}`,
        color: "#fff",
    };

    const btnGhost: React.CSSProperties = {
        ...btnBase,
        background: "#fff",
        border: `1px solid ${theme.border}`,
        color: theme.text,
    };

    async function loadLists() {
        setMsg(null);

        const [catRes, brandRes] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (catRes.error) setMsg(`Erro categorias: ${catRes.error.message}`);
        if (brandRes.error) setMsg(`Erro marcas: ${brandRes.error.message}`);

        const cats = (catRes.data as Category[]) ?? [];
        const brs = (brandRes.data as Brand[]) ?? [];

        setCategories(cats);
        setBrands(brs);

        // auto-seleciona o primeiro item (se ainda não selecionou)
        if (!categoryId && cats.length > 0) setCategoryId(cats[0].id);
        if (!brandId && brs.length > 0) setBrandId(brs[0].id);

        // se não existe nada, abre modal automaticamente
        if (cats.length === 0) setCategoryModalOpen(true);
        if (brs.length === 0) setBrandModalOpen(true);
    }

    useEffect(() => {
        loadLists();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function addRow() {
        setRows((prev) => [...prev, newRow(makeClientId())]);
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

    async function saveAll() {
        setSaving(true);
        setMsg(null);

        if (!categoryId) {
            setMsg("Categoria: selecione uma existente ou adicione uma nova.");
            setSaving(false);
            return;
        }
        if (!brandId) {
            setMsg("Marca: selecione uma existente ou adicione uma nova.");
            setSaving(false);
            return;
        }

        const catName = categories.find((c) => c.id === categoryId)?.name ?? "Categoria";
        const brandName = brands.find((b) => b.id === brandId)?.name ?? "Marca";
        const baseName = `${catName} ${brandName}`.trim();

        const { data: product, error: productErr } = await supabase
            .from("products")
            .insert({
                name: baseName,
                category_id: categoryId,
                brand_id: brandId,
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
                unit,

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
        setRows([newRow("row-0")]); // volta pra um id estável
        setSaving(false);
    }

    return (
        <main style={{ padding: 12, maxWidth: 1050, margin: "0 auto", color: theme.text }}>
            {/* CSS global estável (SEM hydration mismatch) */}
            <style jsx global>{`
        @media (max-width: 840px) {
          .pb-grid {
            grid-template-columns: 1fr !important;
          }
        }
        input:focus,
        select:focus {
          border-color: ${theme.purple} !important;
          box-shadow: 0 0 0 3px rgba(59, 36, 107, 0.12) !important;
        }
      `}</style>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <div>
                    <h1 style={{ fontSize: 18, fontWeight: 950, margin: 0, letterSpacing: -0.2 }}>Cadastro de Produtos</h1>
                    <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: 12.5 }}>
                        Categoria e Marca: seleção automática + botão de adicionar.
                    </p>
                </div>
            </div>

            {/* PRODUTO BASE (bem menor) */}
            <section
                style={{
                    marginTop: 10,
                    padding: 10,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 14,
                    background: theme.panel,
                    boxShadow: shadowSm,
                }}
            >
                <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 950 }}>Produto base</h2>

                <div className="pb-grid" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 8 }}>
                    {/* CATEGORIA */}
                    <div style={{ border: `1px solid ${theme.border2}`, borderRadius: 14, padding: 8, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div style={{ fontWeight: 950, fontSize: 12.5 }}>Categoria</div>
                            <button onClick={() => setCategoryModalOpen(true)} style={btnOrange}>
                                + Adicionar
                            </button>
                        </div>

                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...selectSm, marginTop: 8 }}>
                            <option value="">{categories.length ? "Selecione..." : "Sem categorias"}</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* MARCA */}
                    <div style={{ border: `1px solid ${theme.border2}`, borderRadius: 14, padding: 8, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div style={{ fontWeight: 950, fontSize: 12.5 }}>Marca</div>
                            <button onClick={() => setBrandModalOpen(true)} style={btnOrange}>
                                + Adicionar
                            </button>
                        </div>

                        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ ...selectSm, marginTop: 8 }}>
                            <option value="">{brands.length ? "Selecione..." : "Sem marcas"}</option>
                            {brands.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </section>

            {/* VARIANTES (mais compactas) */}
            <section
                style={{
                    marginTop: 10,
                    padding: 10,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 14,
                    background: theme.panel,
                    boxShadow: shadowSm,
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 950 }}>Variações (linhas)</h2>
                    <button onClick={addRow} style={btnOrange}>
                        + Adicionar linha
                    </button>
                </div>

                <div style={{ marginTop: 8, overflowX: "auto", borderRadius: 12, border: `1px solid ${theme.border2}`, background: "#fff" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                        <thead>
                            <tr style={{ background: theme.softPurple }}>
                                <th style={{ textAlign: "center", padding: "6px 6px", fontSize: 12 }}>Vol?</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Volume</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Un</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Detalhes</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Unit (R$)</th>
                                <th style={{ textAlign: "center", padding: "6px 6px", fontSize: 12 }}>Cx?</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Cx c/</th>
                                <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 12 }}>Cx (R$)</th>
                                <th style={{ textAlign: "center", padding: "6px 6px", fontSize: 12 }}>Ações</th>
                            </tr>
                        </thead>

                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.tempId} style={{ borderTop: `1px solid ${theme.border2}` }}>
                                    <td style={{ padding: "6px 6px", textAlign: "center" }}>
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

                                    <td style={{ padding: "6px 6px" }}>
                                        <input
                                            disabled={!r.hasVolume}
                                            value={r.volumeValue}
                                            onChange={(e) => updateRow(r.tempId, { volumeValue: e.target.value })}
                                            placeholder={r.hasVolume ? "350" : "—"}
                                            style={{ ...inputSm, width: 90, opacity: r.hasVolume ? 1 : 0.55 }}
                                        />
                                    </td>

                                    <td style={{ padding: "6px 6px" }}>
                                        <select
                                            disabled={!r.hasVolume}
                                            value={r.hasVolume ? r.unit : "none"}
                                            onChange={(e) => updateRow(r.tempId, { unit: e.target.value as Unit })}
                                            style={{ ...selectSm, width: 90, opacity: r.hasVolume ? 1 : 0.55 }}
                                        >
                                            <option value="ml">ml</option>
                                            <option value="l">l</option>
                                            <option value="kg">kg</option>
                                        </select>
                                    </td>

                                    <td style={{ padding: "6px 6px" }}>
                                        <input
                                            value={r.details}
                                            onChange={(e) => updateRow(r.tempId, { details: e.target.value })}
                                            placeholder="Ex: retornável..."
                                            style={{ ...inputSm, width: 220 }}
                                        />
                                    </td>

                                    <td style={{ padding: "6px 6px" }}>
                                        <input
                                            value={r.unitPrice}
                                            onChange={(e) => updateRow(r.tempId, { unitPrice: formatBRLInput(e.target.value) })}
                                            style={{ ...inputSm, width: 110 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    <td style={{ padding: "6px 6px", textAlign: "center" }}>
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

                                    <td style={{ padding: "6px 6px" }}>
                                        <input
                                            disabled={!r.hasCase}
                                            value={r.caseQty}
                                            onChange={(e) => updateRow(r.tempId, { caseQty: e.target.value })}
                                            placeholder={r.hasCase ? "12" : "—"}
                                            style={{ ...inputSm, width: 90, opacity: r.hasCase ? 1 : 0.55 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    <td style={{ padding: "6px 6px" }}>
                                        <input
                                            disabled={!r.hasCase}
                                            value={r.casePrice}
                                            onChange={(e) => updateRow(r.tempId, { casePrice: formatBRLInput(e.target.value) })}
                                            placeholder={r.hasCase ? "0,00" : "—"}
                                            style={{ ...inputSm, width: 110, opacity: r.hasCase ? 1 : 0.55 }}
                                            inputMode="numeric"
                                        />
                                    </td>

                                    <td style={{ padding: "6px 6px", textAlign: "center" }}>
                                        <button
                                            onClick={() => removeRow(r.tempId)}
                                            disabled={rows.length === 1}
                                            style={{
                                                ...btnGhost,
                                                padding: "6px 8px",
                                                fontSize: 12,
                                                opacity: rows.length === 1 ? 0.55 : 1,
                                                cursor: rows.length === 1 ? "not-allowed" : "pointer",
                                            }}
                                        >
                                            Remover
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={saveAll} disabled={saving} style={{ ...btnPrimary, padding: "8px 12px", fontSize: 12.5, opacity: saving ? 0.8 : 1 }}>
                        {saving ? "Salvando..." : "Salvar tudo"}
                    </button>

                    {msg && (
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: msg.startsWith("✅") ? "#0DAA00" : "crimson" }}>
                            {msg}
                        </p>
                    )}
                </div>
            </section>

            {/* MODAL CATEGORIA */}
            <Modal title="Adicionar categoria" open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)}>
                <p style={{ marginTop: 0, color: theme.muted, fontSize: 12.5 }}>
                    Digite o nome e clique em salvar.
                </p>

                <input
                    value={categoryNewName}
                    onChange={(e) => setCategoryNewName(e.target.value)}
                    placeholder="Ex: Cerveja"
                    style={inputSm}
                />

                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                        onClick={async () => {
                            const id = await createCategory(categoryNewName);
                            if (id) {
                                setCategoryNewName("");
                                setCategoryModalOpen(false);
                                setCategoryId(id);
                            }
                        }}
                        style={btnOrange}
                    >
                        Salvar
                    </button>

                    <button onClick={() => setCategoryModalOpen(false)} style={btnGhost}>
                        Cancelar
                    </button>
                </div>
            </Modal>

            {/* MODAL MARCA */}
            <Modal title="Adicionar marca" open={brandModalOpen} onClose={() => setBrandModalOpen(false)}>
                <p style={{ marginTop: 0, color: theme.muted, fontSize: 12.5 }}>
                    Digite o nome e clique em salvar.
                </p>

                <input
                    value={brandNewName}
                    onChange={(e) => setBrandNewName(e.target.value)}
                    placeholder="Ex: Skol"
                    style={inputSm}
                />

                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                        onClick={async () => {
                            const id = await createBrand(brandNewName);
                            if (id) {
                                setBrandNewName("");
                                setBrandModalOpen(false);
                                setBrandId(id);
                            }
                        }}
                        style={btnOrange}
                    >
                        Salvar
                    </button>

                    <button onClick={() => setBrandModalOpen(false)} style={btnGhost}>
                        Cancelar
                    </button>
                </div>
            </Modal>
        </main>
    );
}
