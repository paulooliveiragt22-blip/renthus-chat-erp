// app/(admin)/produtos/lista/CreateProductModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ORANGE = "#FF6600";

type Category = { id: string; name: string };
type Brand = { id: string; name: string };
type Unit = "none" | "ml" | "l" | "kg";

type VariantRow = {
    tempId: string;
    details: string;
    hasVolume: boolean;
    volumeValue: string;
    unit: Unit;
    unitPrice: string;
    hasCase: boolean;
    caseQty: string;
    casePrice: string;
    isActive: boolean;
};

function makeClientId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function newRow(tempId: string): VariantRow {
    return {
        tempId,
        details: "",
        hasVolume: false,
        volumeValue: "",
        unit: "none",
        unitPrice: "0,00",
        hasCase: false,
        caseQty: "",
        casePrice: "0,00",
        isActive: true,
    };
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
function qtyToNumber(v: string) {
    const cleaned = v.replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
}

/** Modal pequeno reaproveitável para criar categoria/marca */
function SmallCreateModal({
    open,
    title,
    placeholder,
    onClose,
    onSave,
}: {
    open: boolean;
    title: string;
    placeholder?: string;
    onClose: () => void;
    onSave: (name: string) => Promise<string | null>; // retorna id string ou null
}) {
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setName("");
            setMsg(null);
            setSaving(false);
        }
    }, [open]);

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            const id = await onSave(name);
            if (!id) {
                setMsg("Erro ao salvar.");
                setSaving(false);
                return;
            }
            setMsg("✅ Criado");
            setTimeout(() => {
                setName("");
                setMsg(null);
                onClose();
            }, 450);
        } catch (e) {
            console.error(e);
            setMsg("Erro ao salvar.");
        } finally {
            setSaving(false);
        }
    }

    if (!open) return null;
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                display: "grid",
                placeItems: "center",
                padding: 12,
                zIndex: 80,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(520px, 94%)",
                    background: "#fff",
                    borderRadius: 10,
                    border: "1px solid #E7E3EF",
                    padding: 12,
                    boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>{title}</h3>
                    <button onClick={onClose} style={{ borderRadius: 8, padding: "8px 12px", cursor: "pointer", background: "#3B246B", color: "#fff", border: "none" }}>
                        Fechar
                    </button>
                </div>

                <div style={{ marginTop: 10 }}>
                    <div style={{ marginBottom: 8, color: "#6B647A" }}>Digite o nome e clique em salvar.</div>
                    <input
                        placeholder={placeholder ?? ""}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E7E3EF", fontSize: 14 }}
                    />
                    {msg ? <div style={{ marginTop: 8, color: msg.startsWith("✅") ? "green" : "crimson", fontWeight: 700 }}>{msg}</div> : null}
                    <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E7E3EF" }}>
                            Cancelar
                        </button>
                        <button onClick={save} disabled={saving} style={{ padding: "8px 12px", borderRadius: 8, background: ORANGE, color: "#fff", fontWeight: 800 }}>
                            {saving ? "Salvando..." : "Salvar"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModalShell({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
    if (!open) return null;
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                display: "grid",
                placeItems: "center",
                padding: 16,
                zIndex: 70,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(920px, 98%)",
                    maxHeight: "92vh",
                    overflow: "auto",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #E7E3EF",
                    padding: 14,
                    boxShadow: "0 18px 48px rgba(0,0,0,0.16)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{title}</h3>
                    <button onClick={onClose} style={{ borderRadius: 8, padding: "8px 12px", cursor: "pointer", border: "1px solid #E7E3EF", background: "#fff" }}>
                        Fechar
                    </button>
                </div>
                <div style={{ marginTop: 12 }}>{children}</div>
            </div>
        </div>
    );
}

export default function CreateProductModal() {
    const supabase = useMemo(() => createClient(), []);

    const [open, setOpen] = useState(false);

    // product base
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [categoryId, setCategoryId] = useState("");
    const [brandId, setBrandId] = useState("");

    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [brandModalOpen, setBrandModalOpen] = useState(false);

    // variants
    const [rows, setRows] = useState<VariantRow[]>(() => [newRow(makeClientId())]);

    // status
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const theme = {
        border: "#E7E3EF",
        text: "#201A2B",
        muted: "#6B647A",
        purple: "#3B246B",
        orange: ORANGE,
    };

    const inputSm: React.CSSProperties = {
        width: "100%",
        padding: "8px 10px",
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        fontSize: 13,
        outline: "none",
        background: "#fff",
        color: theme.text,
    };

    const btnBase: React.CSSProperties = {
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 800,
        cursor: "pointer",
        border: `1px solid ${theme.border}`,
        background: "#fff",
        color: theme.text,
        whiteSpace: "nowrap",
    };
    const btnPrimary: React.CSSProperties = { ...btnBase, background: theme.purple, border: `1px solid ${theme.purple}`, color: "#fff" };
    const btnOrange: React.CSSProperties = { ...btnBase, background: theme.orange, border: `1px solid ${theme.orange}`, color: "#fff" };

    async function loadLists() {
        setMsg(null);
        try {
            const [catRes, brandRes] = await Promise.all([
                supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
                supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
            ]);
            if (!catRes.error) setCategories(((catRes.data as any[]) ?? []).map((c) => ({ id: String(c.id), name: String(c.name ?? "") })));
            if (!brandRes.error) setBrands(((brandRes.data as any[]) ?? []).map((b) => ({ id: String(b.id), name: String(b.name ?? "") })));
        } catch (e) {
            console.error(e);
        }
    }

    useEffect(() => {
        if (open) loadLists();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    async function createCategory(name: string) {
        const n = name.trim();
        if (!n) return null;
        const { data, error } = await supabase.from("categories").insert({ name: n, is_active: true }).select("id").single();
        if (error) return null;
        await loadLists();
        return String((data as any).id);
    }
    async function createBrand(name: string) {
        const n = name.trim();
        if (!n) return null;
        const { data, error } = await supabase.from("brands").insert({ name: n, is_active: true }).select("id").single();
        if (error) return null;
        await loadLists();
        return String((data as any).id);
    }

    // rows helpers
    function addRow() {
        setRows((p) => [...p, newRow(makeClientId())]);
    }
    function removeRow(tempId: string) {
        setRows((p) => p.filter((r) => r.tempId !== tempId));
    }
    function updateRow(tempId: string, patch: Partial<VariantRow>) {
        setRows((p) => p.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
    }

    // core save - if closeAfter true, close modal
    async function saveCore(closeAfter: boolean) {
        setSaving(true);
        setMsg(null);

        try {
            // validate category & brand
            if (!categoryId) {
                setMsg("Selecione ou crie uma categoria.");
                setSaving(false);
                return;
            }
            if (!brandId) {
                setMsg("Selecione ou crie uma marca.");
                setSaving(false);
                return;
            }

            // create product base
            const catName = categories.find((c) => c.id === categoryId)?.name ?? "";
            const brandName = brands.find((b) => b.id === brandId)?.name ?? "";
            const baseName = `${catName} ${brandName}`.trim();

            const { data: product, error: productErr } = await supabase
                .from("products")
                .insert({ name: baseName, category_id: categoryId, brand_id: brandId, is_active: true })
                .select("id")
                .single();

            if (productErr) {
                setMsg(`Erro ao criar produto: ${productErr.message}`);
                setSaving(false);
                return;
            }
            const productId = (product as any).id as string;

            // prepare variants payload (mirror ProdutosPage logic)
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
                    is_active: !!r.isActive,
                };
            });

            const { error: varErr } = await supabase.from("product_variants").insert(payload);
            if (varErr) {
                setMsg(`Erro ao criar variações: ${varErr.message}`);
                setSaving(false);
                return;
            }

            // success
            setMsg("✅ Produto cadastrado com sucesso!");
            try {
                window.dispatchEvent(new CustomEvent("renthus:product:created", { detail: { productId } }));
            } catch {
                /* ignore */
            }

            if (closeAfter) {
                setOpen(false);
            } else {
                setRows([newRow(makeClientId())]);
            }
        } catch (e) {
            console.error(e);
            setMsg("Erro inesperado ao salvar.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <button onClick={() => setOpen(true)} style={{ background: ORANGE, color: "#fff", padding: "10px 14px", borderRadius: 10, fontWeight: 900, border: `1px solid ${ORANGE}`, cursor: "pointer" }}>
                    Cadastrar produto
                </button>
            </div>

            <ModalShell title="Cadastrar produto (rápido)" open={open} onClose={() => setOpen(false)}>
                <div style={{ display: "grid", gap: 14 }}>
                    {/* product base: category/brand */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 800 }}>Produto base</label>
                            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}` }}>
                                    <option value="">— selecionar categoria —</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                                <button onClick={() => setCategoryModalOpen(true)} style={{ background: ORANGE, color: "#fff", border: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 800 }}>
                                    + Adicionar
                                </button>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: 13, fontWeight: 800, visibility: "hidden" }}>Marca</label>
                            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                                <select value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}` }}>
                                    <option value="">— selecionar marca —</option>
                                    {brands.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                                <button onClick={() => setBrandModalOpen(true)} style={{ background: ORANGE, color: "#fff", border: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 800 }}>
                                    + Adicionar
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* variant rows header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 900 }}>Variações</div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={addRow} style={{ ...btnBase }}>
                                + Adicionar variação
                            </button>
                        </div>
                    </div>

                    {/* variant rows */}
                    <div style={{ display: "grid", gap: 12 }}>
                        {rows.map((r, idx) => (
                            <div key={r.tempId} style={{ border: "1px solid #EEE", borderRadius: 10, padding: 12 }}>
                                {/* NOTE: details column reduced to avoid overlap with price */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 12 }}>
                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 700 }}>Detalhes</label>
                                        <input value={r.details} onChange={(e) => updateRow(r.tempId, { details: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, marginTop: 8 }} />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 700 }}>Preço unitário</label>
                                        <input value={r.unitPrice} onChange={(e) => updateRow(r.tempId, { unitPrice: formatBRLInput(e.target.value) })} style={{ width: 140, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, marginTop: 8 }} />
                                    </div>
                                </div>

                                <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <input type="checkbox" checked={r.hasVolume} onChange={(e) => updateRow(r.tempId, { hasVolume: e.target.checked })} />
                                        <span style={{ fontSize: 13 }}>Volume</span>
                                    </label>

                                    {r.hasVolume && (
                                        <>
                                            <div>
                                                <input placeholder="Valor" value={r.volumeValue} onChange={(e) => updateRow(r.tempId, { volumeValue: e.target.value })} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, width: 120 }} />
                                            </div>
                                            <div>
                                                <select value={r.unit} onChange={(e) => updateRow(r.tempId, { unit: e.target.value as Unit })} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}` }}>
                                                    <option value="none">Nenhum</option>
                                                    <option value="ml">ml</option>
                                                    <option value="l">L</option>
                                                    <option value="kg">kg</option>
                                                </select>
                                            </div>
                                        </>
                                    )}

                                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <input type="checkbox" checked={r.hasCase} onChange={(e) => updateRow(r.tempId, { hasCase: e.target.checked })} />
                                        <span style={{ fontSize: 13 }}>Vende caixa?</span>
                                    </label>

                                    {r.hasCase && (
                                        <>
                                            <div>
                                                <input placeholder="Qtd" value={r.caseQty} onChange={(e) => updateRow(r.tempId, { caseQty: e.target.value })} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, width: 100 }} />
                                            </div>
                                            <div>
                                                <input placeholder="Preço da caixa" value={r.casePrice} onChange={(e) => updateRow(r.tempId, { casePrice: formatBRLInput(e.target.value) })} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, width: 140 }} />
                                            </div>
                                        </>
                                    )}

                                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <input type="checkbox" checked={r.isActive} onChange={(e) => updateRow(r.tempId, { isActive: e.target.checked })} />
                                        <span style={{ fontSize: 13 }}>Ativo</span>
                                    </label>

                                    {rows.length > 1 ? (
                                        <button onClick={() => removeRow(r.tempId)} style={{ marginLeft: "auto", ...btnBase }}>
                                            Remover
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>

                    {msg ? <div style={{ color: msg.startsWith("✅") ? "green" : "crimson", fontWeight: 800 }}>{msg}</div> : null}

                    {/* ações */}
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                        <button onClick={() => setOpen(false)} style={{ ...btnBase }}>
                            Fechar
                        </button>
                        <button onClick={() => saveCore(false)} disabled={saving} style={{ ...btnOrange, opacity: saving ? 0.6 : 1 }}>
                            {saving ? "Salvando..." : "Salvar"}
                        </button>
                        <button onClick={() => saveCore(true)} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                            {saving ? "Salvando..." : "Salvar e fechar"}
                        </button>
                    </div>
                </div>
            </ModalShell>

            {/* small modals for creating category/brand */}
            <SmallCreateModal
                open={categoryModalOpen}
                title="Adicionar categoria"
                placeholder="Ex: Cerveja"
                onClose={() => setCategoryModalOpen(false)}
                onSave={async (name) => {
                    const id = await createCategory(name);
                    if (id) setCategoryId(id);
                    return id;
                }}
            />
            <SmallCreateModal
                open={brandModalOpen}
                title="Adicionar marca"
                placeholder="Ex: Heineken"
                onClose={() => setBrandModalOpen(false)}
                onSave={async (name) => {
                    const id = await createBrand(name);
                    if (id) setBrandId(id);
                    return id;
                }}
            />
        </>
    );
}
