// app/(admin)/produtos/lista/ListaClient.tsx
"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    Camera, CheckCircle2, Loader2, Pencil, Plus, RefreshCw,
    Search, ShoppingBag, Trash2, ToggleLeft, ToggleRight, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type Unit     = "none" | "ml" | "l" | "kg";
type Category = { id: string; name: string };

type RowProduct = {
    name:        string | null;
    category_id: string | null;
    categories:  { id: string; name: string } | null;
} | null;

type FormItem = {
    id: string;
    id_sigla_comercial: string;
    siglaLabel: string;
    descricao: string;
    fator_conversao: number;
    preco_venda: string;
    preco_custo: string;
    codigo_interno: string;
    codigo_barras_ean: string;
    tags: string;
    estoque: string;
    estoque_minimo: string;
    is_acompanhamento?: boolean;
};

type FormVolume = {
    id: string;
    volume_quantidade: string;
    id_unit_type: string | null;
    unitLabel: string;
    estoque_atual: string;
    estoque_minimo: string;
    items: FormItem[];
};

type Row = {
    id:          string;
    product_id:  string;
    details:     string | null;
    id_unit_type: string | null;
    volume_value: number | null;
    unit:        Unit;
    unit_price:  number;
    cost_price:  number | null;
    tags:        string | null;
    codigo_barras_ean: string | null;
    is_acompanhamento: boolean;
    codigo_interno: string | null;
    has_case:    boolean;
    case_qty:    number | null;
    case_price:  number | null;
    case_id:     string | null;
    case_details: string | null;
    case_sigla_id: string | null;
    case_codigo_interno: string | null;
    is_active:   boolean;
    product_volume_id: string | null;
    estoque_un:  number | null;
    estoque_cx:  number | null;
    products:    RowProduct;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(n: number | null | undefined) {
    return (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatBRLInput(raw: string) {
    const digits = raw.replaceAll(/\D/g, "");
    return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function brlToNumber(v: string) {
    const n = Number(v.replaceAll(".", "").replaceAll(",", "."));
    return Number.isNaN(n) ? 0 : n;
}

function unitLabel(u: Unit) {
    if (u === "l") return "L";
    if (u === "none") return "";
    return u;
}

/** Normaliza linhas da view_produtos_lista (estrutura flat) para Row */
function normalizeRowsFromView(input: unknown): Row[] {
    return (Array.isArray(input) ? input : []).map((r: any) => {
        const rawUnit = r?.unit ?? "none";
        const unit: Unit = ["ml","l","kg","none"].includes(rawUnit) ? rawUnit : "none";
        const catId = r?.category_id;
        return {
            id:           String(r?.id ?? ""),
            product_id:   String(r?.product_id ?? ""),
            details:      r?.details ?? null,
            volume_value: r?.volume_value != null ? Number(r.volume_value) : null,
            unit,
            unit_price:   Number(r?.unit_price ?? 0),
            cost_price:   r?.cost_price != null ? Number(r.cost_price) : null,
            tags:         r?.tags ?? null,
            codigo_barras_ean: r?.codigo_barras_ean ?? null,
            is_acompanhamento: Boolean(r?.is_acompanhamento),
            codigo_interno: r?.codigo_interno ?? null,
            has_case:     Boolean(r?.has_case),
            case_id:      r?.case_id ?? null,
            case_qty:     r?.case_qty != null ? Number(r.case_qty) : null,
            case_price:   r?.case_price != null ? Number(r.case_price) : null,
            case_details: r?.case_details ?? null,
            case_sigla_id: r?.case_sigla_id ?? null,
            case_codigo_interno: r?.case_codigo_interno ?? null,
            id_unit_type: r?.id_unit_type ?? null,
            is_active:    Boolean(r?.is_active),
            product_volume_id: r?.product_volume_id ?? null,
            estoque_un:   r?.estoque_un != null ? Number(r.estoque_un) : null,
            estoque_cx:   r?.estoque_cx != null ? Number(r.estoque_cx) : null,
            products: {
                name:        r?.product_name ?? null,
                category_id: catId ?? null,
                categories:  catId ? { id: String(catId), name: String(r?.category_name ?? "") } : null,
            },
        };
    });
}

function volumesWithFormItemAppended(prev: FormVolume[], volId: string, newItem: FormItem): FormVolume[] {
    return prev.map((v) => (v.id === volId ? { ...v, items: [...v.items, newItem] } : v));
}

function volumesWithFormItemRemoved(prev: FormVolume[], volId: string, itemId: string): FormVolume[] {
    return prev.map((v) =>
        v.id === volId ? { ...v, items: v.items.filter((i) => i.id !== itemId) } : v
    );
}

function volumesWithFormItemUpdated(
    prev: FormVolume[],
    volId: string,
    itemId: string,
    updates: Partial<FormItem>
): FormVolume[] {
    return prev.map((v) =>
        v.id === volId
            ? { ...v, items: v.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)) }
            : v
    );
}

// ─── sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";
const selectCls = inputCls;

function Modal({
    title,
    open,
    onClose,
    wide = false,
    children,
}: {
    title: string;
    open: boolean;
    onClose: () => void;
    wide?: boolean;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
        } else if (el.open) {
            el.close();
        }
    }, [open]);

    return (
        <dialog
            ref={ref}
            className={`fixed left-1/2 top-1/2 z-50 w-full max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 ${wide ? "max-w-3xl" : "max-w-md"}`}
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
                <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="p-5">{children}</div>
        </dialog>
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
    const [loading,    setLoading]    = useState(true);
    const [msg,        setMsg]        = useState<string | null>(null);
    const [search,     setSearch]     = useState("");

    // edit modal
    const [open,     setOpen]     = useState(false);
    const [openCreate, setOpenCreate] = useState(false);
    const [selected, setSelected] = useState<Row | null>(null);
    const [saving,   setSaving]   = useState(false);
    const [editLoading, setEditLoading] = useState(false);

    const [isActive,    setIsActive]    = useState(true);
    const [isAccomp,    setIsAccomp]    = useState(false);

    // edit fields — product base
    const [categoryId,       setCategoryId]       = useState("");
    const [newCategoryName,  setNewCategoryName]  = useState("");
    const [addCategoryOpen,  setAddCategoryOpen]  = useState(false);
    const [_siglaUnId, setSiglaUnId] = useState<string | null>(null);
    const [_siglaCxId, setSiglaCxId] = useState<string | null>(null);
    const [siglas, setSiglas] = useState<{ id: string; sigla: string }[]>([]);
    const [unitTypes, setUnitTypes] = useState<{ id: string; sigla: string }[]>([]);
    const [siglaExtraId, setSiglaExtraId] = useState<string | null>(null);
    const [addSiglaOpen, setAddSiglaOpen] = useState(false);
    const [newSiglaValue, setNewSiglaValue] = useState("");
    const [newSiglaDesc, setNewSiglaDesc] = useState("");
    const [acompModalOpen, setAcompModalOpen] = useState(false);
    const [acompSelected, setAcompSelected] = useState<{ id: string; name: string }[]>([]);

    // product images
    type ProductImage = { id: string; url: string; thumbnail_url: string | null; is_primary: boolean; product_volume_id: string | null };
    const [editImages,       setEditImages]       = useState<ProductImage[]>([]);
    const [imageFile,        setImageFile]        = useState<File | null>(null);
    const [volumeImageFiles, setVolumeImageFiles] = useState<Record<string, File>>({});
    const [createImageFile,  setCreateImageFile]  = useState<File | null>(null);
    const [imageUploading,   setImageUploading]   = useState(false);

    // novo fluxo create: nome produto + volumes + itens
    const [productName, setProductName] = useState("");
    const [productNameSearch, setProductNameSearch] = useState("");
    const [productNameOptions, setProductNameOptions] = useState<{ id: string; name: string }[]>([]);
    const [productNameDropdownOpen, setProductNameDropdownOpen] = useState(false);
    const [formVolumes, setFormVolumes] = useState<FormVolume[]>([]);
    const [codigoLoadingItemId, setCodigoLoadingItemId] = useState<string | null>(null);

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
        if (!companyId) { setLoading(false); return; }
        setLoading(true); setMsg(null);
        const [prodRes, catRes] = await Promise.all([
            supabase.from("view_produtos_lista")
                .select("*")
                .eq("company_id", companyId)
                .limit(500),
            supabase.from("view_categories")
                .select("id, name")
                .eq("is_active", true)
                .eq("company_id", companyId)
                .order("name"),
        ]);

        if (prodRes.error) {
            setMsg(`Erro: ${prodRes.error?.message ?? ""}`);
            setLoading(false);
            return;
        }

        setRows(normalizeRowsFromView(prodRes.data));
        if (!catRes.error) setCategories(((catRes.data ?? []) as any[]).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })));

        const [{ data: siglasData }, { data: unitTypesData }] = await Promise.all([
            supabase.from("view_siglas_comerciais").select("id, sigla").eq("company_id", companyId),
            supabase.from("view_unit_types").select("id, sigla").eq("company_id", companyId),
        ]);
        if (siglasData?.length) {
            const mappedSiglas = (siglasData as any[]).map((s) => ({
                id: String(s.id),
                sigla: String(s.sigla ?? "").toUpperCase(),
            }));
            setSiglas(mappedSiglas);
            const un = mappedSiglas.find((s) => s.sigla === "UN");
            const cx = mappedSiglas.find((s) => s.sigla === "CX");
            if (un) setSiglaUnId(un.id);
            if (cx) {
                setSiglaCxId(cx.id);
                setSiglaExtraId((prev) => prev ?? cx.id);
            }
        }
        if (unitTypesData?.length) {
            setUnitTypes((unitTypesData as any[]).map((u) => ({ id: String(u.id), sigla: String(u.sigla ?? "") })));
        }
        setLoading(false);
    }

    async function reloadCategories() {
        if (!companyId) return;
        const { data } = await supabase.from("view_categories").select("id, name").eq("is_active", true).eq("company_id", companyId).order("name");
        if (data) setCategories((data as any[]).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })));
    }

    async function quickCreateSigla(sigla: string, descricao: string) {
        if (!sigla.trim() || !companyId) return null;
        const { data, error } = await supabase.rpc("rpc_create_sigla", {
            p_company_id: companyId,
            p_sigla: sigla.trim(),
            p_descricao: descricao.trim() || null,
        });
        if (error) {
            setMsg(`Erro: ${error.message}`);
            return null;
        }
        const created = { id: String(data), sigla: sigla.trim().toUpperCase() };
        setSiglas((prev) => [...prev, created]);
        if (created.sigla === "UN") setSiglaUnId(created.id);
        if (!siglaExtraId) setSiglaExtraId(created.id);
        return created.id;
    }

    useEffect(() => { load(); }, [companyId]);

    async function loadProductImages(productId: string) {
        const { data } = await supabase
            .from("product_images")
            .select("id, url, thumbnail_url, is_primary, product_volume_id")
            .eq("product_id", productId)
            .order("is_primary", { ascending: false });
        setEditImages(((data ?? []) as ProductImage[]));
    }

    async function uploadProductImage(productId: string, file: File, volumeId?: string | null) {
        setImageUploading(true);
        try {
            const ext  = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
            const folder = volumeId ? `${companyId}/${productId}/${volumeId}` : `${companyId}/${productId}`;
            const path = `${folder}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from("product-images")
                .upload(path, file, { upsert: false });
            if (upErr) throw new Error(upErr.message);
            const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
            const publicUrl = urlData.publicUrl;
            // Set current images with the same scope (same volume or product-level) as non-primary
            const updateQuery = supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
            if (volumeId) {
                await updateQuery.eq("product_volume_id", volumeId);
            } else {
                await updateQuery.is("product_volume_id", null);
            }
            await supabase.from("product_images").insert({
                product_id:        productId,
                product_volume_id: volumeId ?? null,
                url:               publicUrl,
                thumbnail_url:     publicUrl,
                is_primary:        true,
                file_size:         file.size,
            });
            await loadProductImages(productId);
            setMsg("✓ Imagem salva.");
        } catch (e: any) {
            setMsg(`Erro ao enviar imagem: ${String(e?.message ?? e)}`);
        } finally {
            setImageUploading(false);
            setImageFile(null);
            setCreateImageFile(null);
        }
    }

    async function deleteProductImage(imageId: string, productId: string) {
        const img = editImages.find((i) => i.id === imageId);
        if (img) {
            const storagePath = img.url.split("/product-images/")[1];
            if (storagePath) await supabase.storage.from("product-images").remove([storagePath]);
        }
        await supabase.from("product_images").delete().eq("id", imageId);
        await loadProductImages(productId);
    }

    async function searchProductsByName(q: string) {
        if (!companyId) return;
        const { data } = await supabase.rpc("rpc_search_products_by_name", {
            p_company_id: companyId,
            p_search: q.trim() || null,
            p_limit: 15,
        });
        setProductNameOptions(((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name })));
    }

    useEffect(() => {
        const t = setTimeout(() => searchProductsByName(productNameSearch), 200);
        return () => clearTimeout(t);
    }, [companyId, productNameSearch]);

    function addFormVolume() {
        setFormVolumes((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                volume_quantidade: "",
                id_unit_type: null,
                unitLabel: "ml",
                estoque_atual: "",
                estoque_minimo: "",
                items: [],
            },
        ]);
    }

    function removeFormVolume(volId: string) {
        setFormVolumes((prev) => prev.filter((v) => v.id !== volId));
    }

    function updateFormVolume(volId: string, updates: Partial<FormVolume>) {
        setFormVolumes((prev) => prev.map((v) => (v.id === volId ? { ...v, ...updates } : v)));
    }

    function addFormItem(volId: string) {
        const un = siglas.find((s) => s.sigla === "UN");
        const newItem: FormItem = {
            id: crypto.randomUUID(),
            id_sigla_comercial: un?.id ?? siglas[0]?.id ?? "",
            siglaLabel: un?.sigla ?? siglas[0]?.sigla ?? "",
            descricao: "",
            fator_conversao: 1,
            preco_venda: "0,00",
            preco_custo: "0,00",
            codigo_interno: "",
            codigo_barras_ean: "",
            tags: "",
            estoque: "",
            estoque_minimo: "",
        };
        setFormVolumes((prev) => volumesWithFormItemAppended(prev, volId, newItem));
    }

    function removeFormItem(volId: string, itemId: string) {
        setFormVolumes((prev) => volumesWithFormItemRemoved(prev, volId, itemId));
    }

    function updateFormItem(volId: string, itemId: string, updates: Partial<FormItem>) {
        setFormVolumes((prev) => volumesWithFormItemUpdated(prev, volId, itemId, updates));
    }

    const isUnSigla = (sigla: string) => (sigla ?? "").toUpperCase() === "UN" || (sigla ?? "").toUpperCase() === "UNIDADE";

    function aplicarCustoNaUn(volId: string, itemCx: FormItem) {
        const custoCx = brlToNumber(itemCx.preco_custo);
        const fator = Math.max(1, itemCx.fator_conversao);
        const custoUn = custoCx / fator;
        const vol = formVolumes.find((v) => v.id === volId);
        const itemUn = vol?.items.find((i) => isUnSigla(i.siglaLabel));
        if (itemUn) {
            updateFormItem(volId, itemUn.id, { preco_custo: formatBRLInput(String(Math.round(custoUn * 100))) });
        }
    }

    function aplicarCustoNaCx(volId: string, itemUn: FormItem) {
        const custoUn = brlToNumber(itemUn.preco_custo);
        const vol = formVolumes.find((v) => v.id === volId);
        vol?.items.filter((i) => !isUnSigla(i.siglaLabel)).forEach((itemCx) => {
            const fator = Math.max(1, itemCx.fator_conversao);
            const custoCx = custoUn * fator;
            updateFormItem(volId, itemCx.id, { preco_custo: formatBRLInput(String(Math.round(custoCx * 100))) });
        });
    }

    function aplicarEstoqueNaUn(volId: string, itemCx: FormItem) {
        const estoqueCx = Math.round(Number(String(itemCx.estoque).replaceAll(",", ".")) || 0);
        const estoqueMinCx = Math.round(Number(String(itemCx.estoque_minimo).replaceAll(",", ".")) || 0);
        const fator = Math.max(1, itemCx.fator_conversao);
        const vol = formVolumes.find((v) => v.id === volId);
        const itemUn = vol?.items.find((i) => isUnSigla(i.siglaLabel));
        if (itemUn) {
            updateFormItem(volId, itemUn.id, {
                estoque: String(estoqueCx * fator),
                estoque_minimo: String(estoqueMinCx * fator),
            });
        }
    }

    function aplicarEstoqueNaCx(volId: string, itemUn: FormItem) {
        const estoqueUn = Math.round(Number(String(itemUn.estoque).replaceAll(",", ".")) || 0);
        const estoqueMinUn = Math.round(Number(String(itemUn.estoque_minimo).replaceAll(",", ".")) || 0);
        const vol = formVolumes.find((v) => v.id === volId);
        vol?.items.filter((i) => !isUnSigla(i.siglaLabel)).forEach((itemCx) => {
            const fator = Math.max(1, itemCx.fator_conversao);
            updateFormItem(volId, itemCx.id, {
                estoque: String(Math.round(estoqueUn / fator)),
                estoque_minimo: String(Math.round(estoqueMinUn / fator)),
            });
        });
    }

    async function gerarCodigoParaItem(itemId: string) {
        if (!companyId) return;
        setCodigoLoadingItemId(itemId);
        setMsg(null);
        try {
            const { data, error } = await supabase.rpc("gerar_proximo_codigo_interno", { p_company_id: companyId });
            if (error) throw new Error(error.message);
            const codigo = String(data ?? "");
            setFormVolumes((prev) => prev.map((v) => ({
                ...v,
                items: v.items.map((i) => (i.id === itemId ? { ...i, codigo_interno: codigo } : i)),
            })));
        } catch (e: any) {
            setMsg(`Erro ao gerar código: ${String(e?.message ?? e)}`);
        } finally {
            setCodigoLoadingItemId(null);
        }
    }

    // ── realtime ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!companyId) return;
        const ch = supabase
            .channel("products_realtime_v2")
            .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
                load();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "produto_embalagens" }, () => {
                load();
            })
            .subscribe();

        return () => { supabase.removeChannel(ch); };
    }, [supabase, companyId]);

    // ── toggle active ─────────────────────────────────────────────────────────

    async function toggleActive(row: Row) {
        const next = !row.is_active;
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_active: next } : r));
        await supabase.rpc("rpc_toggle_product_active", { p_product_id: row.product_id, p_company_id: companyId, p_is_active: next });
        flashRow(row.id);
    }

    // ── open edit ─────────────────────────────────────────────────────────────

    async function openEdit(r: Row) {
        setSelected(r); setOpen(true); setMsg(null); setEditLoading(true);
        setFormVolumes([]);
        setCategoryId(r.products?.category_id ?? r.products?.categories?.id ?? "");
        setNewCategoryName("");
        setAcompSelected([]);
        setEditImages([]);
        setImageFile(null);
        setVolumeImageFiles({});
        try {
            const { data, error } = await supabase.rpc("rpc_get_product_full", {
                p_product_id: r.product_id,
                p_company_id: companyId,
            });
            if (error) throw new Error(error.message);
            const prod = data as { id?: string; name?: string; category_id?: string; is_active?: boolean; volumes?: any[] } | null;
            if (!prod) { setMsg("Produto não encontrado."); setEditLoading(false); return; }

            setProductName(prod.name ?? "");
            setIsActive(!!prod.is_active);
            setCategoryId(prod.category_id ?? "");

            const vols: FormVolume[] = (prod.volumes ?? []).map((v: any) => {
                const volEstoque = Number(v.estoque_atual ?? 0);
                const volEstoqueMin = Number(v.estoque_minimo ?? 0);
                const items: FormItem[] = (v.items ?? []).map((it: any) => {
                    const fator = Math.max(1, Number(it.fator_conversao ?? 1));
                    const itemEstoque = volEstoque > 0 ? Math.round(volEstoque / fator) : 0;
                    const itemEstoqueMin = volEstoqueMin >= 0 ? Math.round(volEstoqueMin / fator) : 0;
                    return {
                        id: String(it.id ?? crypto.randomUUID()),
                        id_sigla_comercial: String(it.id_sigla_comercial ?? ""),
                        siglaLabel: String(it.sigla ?? ""),
                        descricao: String(it.descricao ?? ""),
                        fator_conversao: fator,
                        preco_venda: it.preco_venda != null ? formatBRLInput(String(Math.round(Number(it.preco_venda) * 100))) : "0,00",
                        preco_custo: it.preco_custo != null ? formatBRLInput(String(Math.round(Number(it.preco_custo) * 100))) : "0,00",
                        codigo_interno: String(it.codigo_interno ?? ""),
                        codigo_barras_ean: String(it.codigo_barras_ean ?? ""),
                        tags: String(it.tags ?? ""),
                        estoque: String(itemEstoque),
                        estoque_minimo: String(itemEstoqueMin),
                        is_acompanhamento: !!it.is_acompanhamento,
                    };
                });
                return {
                    id: String(v.volume_id ?? crypto.randomUUID()),
                    volume_quantidade: v.volume_quantidade != null ? String(v.volume_quantidade) : "",
                    id_unit_type: v.id_unit_type ?? null,
                    unitLabel: String(v.unit_sigla ?? "ml"),
                    estoque_atual: String(volEstoque),
                    estoque_minimo: String(volEstoqueMin),
                    items,
                };
            });
            setFormVolumes(vols);
            setIsAccomp(vols.some((v) => v.items.some((i) => i.is_acompanhamento)));

            const { data: ac } = await supabase
                .from("view_produto_embalagem_acompanhamentos")
                .select("acompanhamento_produto_embalagem_id")
                .eq("produto_embalagem_id", r.id)
                .order("ordem");
            const ids = ((ac ?? []) as any[]).map((x) => String(x.acompanhamento_produto_embalagem_id));
            const sel = ids.map((embId) => {
                const row = rows.find((x) => x.id === embId);
                const name = row ? [row.products?.categories?.name, row.details].filter(Boolean).join(" ") || row.products?.name || "—" : "—";
                return { id: embId, name };
            });
            setAcompSelected(sel);
            await loadProductImages(r.product_id);
        } catch (e: any) {
            setMsg(`Erro ao carregar: ${String(e?.message ?? e)}`);
        } finally {
            setEditLoading(false);
        }
    }

    function openNew() {
        setSelected(null);
        setMsg(null);
        setIsActive(true);
        setIsAccomp(false);
        setAcompSelected([]);
        setCategoryId("");
        setProductName("");
        setProductNameSearch("");
        setFormVolumes([]);
        setEditImages([]);
        setVolumeImageFiles({});
        setCreateImageFile(null);
        setOpenCreate(true);
    }

    // ── save edit ─────────────────────────────────────────────────────────────

    async function saveEdit() {
        if (!selected || !companyId) return;
        setSaving(true); setMsg(null);
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        const volumesWithItems = formVolumes.filter((v) => v.items.length > 0);
        if (volumesWithItems.length === 0) { setMsg("Adicione pelo menos um volume com itens."); setSaving(false); return; }
        const hasInvalidFator = volumesWithItems.some((v) => v.items.some((i) => !i.fator_conversao || i.fator_conversao < 1));
        if (hasInvalidFator) { setMsg("Campo Fator é obrigatório e deve ser maior que zero em todos os itens."); setSaving(false); return; }

        const volumesPayload = volumesWithItems.map((vol) => {
            const volQty = vol.volume_quantidade ? Number(vol.volume_quantidade.replaceAll(",", ".")) : null;
            const volUnitTypeId = vol.id_unit_type || null;
            const volEstoque = vol.estoque_atual ? Math.round(Number(vol.estoque_atual.replaceAll(",", ".")) || 0) : 0;
            const volEstoqueMin = vol.estoque_minimo ? Math.round(Number(vol.estoque_minimo.replaceAll(",", ".")) || 0) : 0;
            return {
                volume_quantidade: volQty,
                id_unit_type: volUnitTypeId,
                estoque_atual: volEstoque,
                estoque_minimo: volEstoqueMin,
                items: vol.items.map((it) => {
                    const fator = Math.max(1, it.fator_conversao);
                    const itemEstoque = it.estoque ? Math.round(Number(String(it.estoque).replaceAll(",", ".")) || 0) : null;
                    const itemEstoqueMin = it.estoque_minimo ? Math.round(Number(String(it.estoque_minimo).replaceAll(",", ".")) || 0) : null;
                    return {
                        id_sigla_comercial: it.id_sigla_comercial,
                        descricao: it.descricao.trim().toUpperCase() || null,
                        fator_conversao: fator,
                        preco_venda: brlToNumber(it.preco_venda),
                        preco_custo: brlToNumber(it.preco_custo) || null,
                        codigo_interno: it.codigo_interno.trim() || null,
                        codigo_barras_ean: it.codigo_barras_ean.trim() || null,
                        tags: it.tags.trim() || null,
                        is_acompanhamento: isAccomp,
                        estoque: itemEstoque != null && itemEstoque > 0 ? String(itemEstoque) : null,
                        estoque_minimo: itemEstoqueMin != null && itemEstoqueMin >= 0 ? String(itemEstoqueMin) : null,
                    };
                }),
            };
        });

        const { error } = await supabase.rpc("rpc_update_product_with_items", {
            p_company_id: companyId,
            p_product_id: selected.product_id,
            p_category_id: categoryId,
            p_is_active: isActive,
            p_volumes: volumesPayload,
            p_acompanhamento_ids: isAccomp && acompSelected.length > 0 ? acompSelected.map((a) => a.id) : [],
        });

        if (error) { setMsg(`Erro: ${error.message}`); setSaving(false); return; }

        if (imageFile && selected?.product_id) {
            await uploadProductImage(selected.product_id, imageFile, null);
        }

        setSaving(false);
        setOpen(false);
        setSelected(null);
        await load();
    }

    async function saveCreate() {
        setSaving(true);
        setMsg(null);
        if (!companyId) { setMsg("Nenhuma empresa ativa."); setSaving(false); return; }
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        const nameToUse = (productName || productNameSearch || "").trim().toUpperCase();
        if (!nameToUse) { setMsg("Informe ou selecione o nome do produto."); setSaving(false); return; }
        const volumesWithItems = formVolumes.filter((v) => v.items.length > 0);
        if (volumesWithItems.length === 0) { setMsg("Adicione pelo menos um volume com itens."); setSaving(false); return; }

        const volumesPayload = volumesWithItems.map((vol) => {
            const volQty = vol.volume_quantidade ? Number(vol.volume_quantidade.replaceAll(",", ".")) : null;
            const volUnitTypeId = vol.id_unit_type || null;
            const volEstoque = vol.estoque_atual ? Math.round(Number(vol.estoque_atual.replaceAll(",", ".")) || 0) : 0;
            const volEstoqueMin = vol.estoque_minimo ? Math.round(Number(vol.estoque_minimo.replaceAll(",", ".")) || 0) : 0;
            return {
                volume_quantidade: volQty,
                id_unit_type: volUnitTypeId,
                estoque_atual: volEstoque,
                estoque_minimo: volEstoqueMin,
                items: vol.items.map((it) => {
                    const fator = Math.max(1, it.fator_conversao);
                    const itemEstoque = it.estoque ? Math.round(Number(String(it.estoque).replaceAll(",", ".")) || 0) : null;
                    const itemEstoqueMin = it.estoque_minimo ? Math.round(Number(String(it.estoque_minimo).replaceAll(",", ".")) || 0) : null;
                    return {
                        id_sigla_comercial: it.id_sigla_comercial,
                        descricao: it.descricao.trim().toUpperCase() || null,
                        fator_conversao: fator,
                        preco_venda: brlToNumber(it.preco_venda),
                        preco_custo: brlToNumber(it.preco_custo) || null,
                        codigo_interno: it.codigo_interno.trim() || null,
                        codigo_barras_ean: it.codigo_barras_ean.trim() || null,
                        tags: it.tags.trim() || null,
                        is_acompanhamento: isAccomp,
                        estoque: itemEstoque != null && itemEstoque > 0 ? String(itemEstoque) : null,
                        estoque_minimo: itemEstoqueMin != null && itemEstoqueMin >= 0 ? String(itemEstoqueMin) : null,
                    };
                }),
            };
        });

        try {
            const { data: rpcData, error } = await supabase.rpc("rpc_create_product_with_items", {
                p_company_id: companyId,
                p_name: nameToUse,
                p_category_id: categoryId,
                p_is_active: isActive,
                p_volumes: volumesPayload,
                p_acompanhamento_ids: isAccomp && acompSelected.length > 0 ? acompSelected.map((a) => a.id) : [],
            });

            if (error) throw new Error(error.message);

            const newProductId = (rpcData as any)?.product_id as string | undefined;
            if (createImageFile && newProductId) {
                await uploadProductImage(newProductId, createImageFile);
            }

            setSaving(false);
            setOpenCreate(false);
            await load();
        } catch (e: any) {
            setMsg(`Erro: ${String(e?.message ?? e)}`);
            setSaving(false);
        }
    }

    // ── create cat / brand inline ─────────────────────────────────────────────

    async function quickCreateCategory(name: string) {
        if (!name.trim() || !companyId) return null;
        const { data, error } = await supabase.rpc("rpc_create_category", { p_company_id: companyId, p_name: name.trim() });
        if (error) { setMsg(`Erro: ${error.message}`); return null; }
        await reloadCategories();
        return String(data);
    }

    // ── filter ────────────────────────────────────────────────────────────────

    const filtered = rows.filter((r) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return [r.products?.categories?.name, r.details, r.products?.name]
            .some((x) => (x ?? "").toLowerCase().includes(s));
    });

    const acompCandidates = rows.filter((r) => {
        const pid = openCreate ? null : selected?.product_id;
        return !pid || r.product_id !== pid;
    });

    const activeCount      = rows.filter((r) => r.is_active).length;
    const inactiveCount    = rows.length - activeCount;
    const missingCostCount = rows.filter((r) => r.cost_price == null || r.cost_price === 0).length;

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
                    <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600">
                        <Plus className="h-3.5 w-3.5" /> Cadastrar novo
                    </button>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                    { label: "Total de variações", value: rows.length,      color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30" },
                    { label: "Ativas",              value: activeCount,      color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30" },
                    { label: "Inativas",            value: inactiveCount,    color: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800" },
                    { label: "Sem preço de custo",  value: missingCostCount, color: missingCostCount > 0 ? "bg-red-100 text-red-600 dark:bg-red-900/30" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${color}`}>{value}</span>
                        <span className="text-xs text-zinc-500">{label}</span>
                    </div>
                ))}
            </div>

            {/* Cost price warning banner */}
            {missingCostCount > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
                    <span className="mt-0.5 text-base">⚠️</span>
                    <div>
                        <p className="text-xs font-bold text-red-700 dark:text-red-400">
                            {missingCostCount} {missingCostCount === 1 ? "produto sem" : "produtos sem"} Preço de Custo
                        </p>
                        <p className="text-xs text-red-600/80 dark:text-red-500/80">
                            O Financeiro não consegue calcular o Lucro Real nesses itens. Clique no lápis para preencher.
                        </p>
                    </div>
                </div>
            )}

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por categoria, marca ou detalhes…"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>

            {/* Table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                {/* sticky header */}
                <div className="grid grid-cols-[1fr_1.5fr_1.2fr_70px_80px_70px_80px_80px_80px_1fr_60px_80px] gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    <span>Categoria</span><span>Produto</span><span>Detalhes</span>
                    <span className="text-right">Cód.</span>
                    <span className="text-right">Vol.</span>
                    <span className="text-right">Estoque</span>
                    <span className="text-right">Venda</span>
                    <span className="text-right text-red-500">Custo</span>
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
                        : filtered.map((r) => {
                            const missingCost = r.cost_price == null || r.cost_price === 0;
                            return (
                            <div
                                key={r.id}
                                className={`grid grid-cols-[1fr_1.5fr_1.2fr_70px_80px_70px_80px_80px_80px_1fr_60px_80px] items-center gap-2 px-4 py-3 transition-colors ${
                                    flashId === r.id
                                        ? "bg-emerald-50 dark:bg-emerald-900/15"
                                        : missingCost && r.is_active
                                        ? "border-l-2 border-red-400 bg-red-50/40 hover:bg-red-50/70 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                                        : r.is_active
                                        ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                        : "bg-zinc-50/60 opacity-60 dark:bg-zinc-800/30"
                                }`}
                            >
                                <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                    {r.products?.categories?.name ?? <span className="text-zinc-300">—</span>}
                                </span>
                                <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                    {r.products?.name ?? <span className="text-zinc-300">—</span>}
                                </span>
                                <span className="truncate text-xs text-zinc-500">{r.details ?? "—"}</span>
                                <span className="truncate text-right text-xs text-zinc-500" title={r.codigo_interno ?? ""}>
                                    {r.codigo_interno ?? "—"}
                                </span>
                                <span className="text-right text-xs text-zinc-500">
                                    {r.unit === "none" || r.volume_value == null ? "—" : `${r.volume_value} ${unitLabel(r.unit)}`}
                                </span>
                                <span className="text-right text-xs text-zinc-500">
                                    {r.estoque_un != null
                                        ? <span className={r.estoque_un === 0 ? "text-red-500" : ""}>{r.estoque_un} UN{r.estoque_cx != null ? ` / ${r.estoque_cx} CX` : ""}</span>
                                        : "—"}
                                </span>
                                <span className="text-right text-xs font-semibold text-violet-700 dark:text-violet-400">
                                    R$ {brl(r.unit_price)}
                                </span>
                                {/* Cost price column */}
                                <span className={`text-right text-xs font-semibold ${
                                    missingCost
                                        ? "text-red-500 dark:text-red-400"
                                        : "text-emerald-600 dark:text-emerald-400"
                                }`}>
                                    {missingCost
                                        ? <span className="flex items-center justify-end gap-0.5"><span>⚠</span><span>—</span></span>
                                        : `R$ ${brl(r.cost_price!)}`
                                    }
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
                            );
                        })}
                </div>
            </div>

            {/* Edit Modal */}
            <Modal title={selected ? `Editar: ${productName || selected.products?.name || ""}`.trim() : "Editar"} open={open} onClose={() => { setOpen(false); setSelected(null); setMsg(null); }} wide>
                <div className="flex flex-col gap-5">
                    {editLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                        </div>
                    ) : (
                        <>
                    {/* Nome do produto (fixo) */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Produto</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{productName || selected?.products?.name || "—"}</p>
                    </div>

                    {/* Foto do produto (nível produto, sem volume) */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <p className="mb-3 text-xs font-bold text-zinc-700 dark:text-zinc-300">Foto do produto <span className="font-normal text-zinc-400">(geral — aparece quando não há foto de embalagem)</span></p>
                        {editImages.filter((i) => i.product_volume_id === null).length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-3">
                                {editImages.filter((i) => i.product_volume_id === null).map((img) => (
                                    <div key={img.id} className="relative">
                                        <img
                                            src={img.thumbnail_url ?? img.url}
                                            alt="produto"
                                            className={`h-20 w-20 rounded-lg object-cover border-2 ${img.is_primary ? "border-violet-500" : "border-zinc-200 dark:border-zinc-700"}`}
                                        />
                                        {img.is_primary && (
                                            <span className="absolute -top-1.5 -right-1.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white">principal</span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => selected && deleteProductImage(img.id, selected.product_id)}
                                            className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-500 text-white shadow hover:bg-red-600"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-3 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800/50">
                            <Camera className="h-4 w-4 text-zinc-400" />
                            <span className="text-xs text-zinc-500">
                                {imageFile ? imageFile.name : "Selecionar foto (JPG, PNG, WEBP · max 2MB)"}
                            </span>
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                            />
                        </label>
                        {imageFile && (
                            <button
                                type="button"
                                disabled={imageUploading}
                                onClick={() => selected && uploadProductImage(selected.product_id, imageFile, null)}
                                className="mt-2 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                            >
                                {imageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                                {imageUploading ? "Enviando…" : "Enviar foto"}
                            </button>
                        )}
                    </div>

                    {/* Categoria */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Categoria</p>
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

                    {/* Embalagens (mesma estrutura do Create) */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Embalagens</p>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setAddSiglaOpen(true)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">
                                    Nova sigla
                                </button>
                                <button type="button" onClick={addFormVolume} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                    <Plus className="h-3 w-3" /> Adicionar embalagem
                                </button>
                            </div>
                        </div>
                        <p className="mb-3 text-[11px] text-zinc-400">Tamanho é opcional (produtos sem medida, ex: hambúrguer). Preço custo, estoque e tags por item. Botões →UN e →CX aplicam fator.</p>
                        {formVolumes.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
                                Nenhuma embalagem. Clique em &quot;Adicionar embalagem&quot;.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {formVolumes.map((vol) => (
                                    <div key={vol.id} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Tamanho <span className="font-normal text-zinc-400">(opcional)</span></span>
                                                <input value={vol.volume_quantidade} onChange={(e) => updateFormVolume(vol.id, { volume_quantidade: e.target.value })} placeholder="350" className={`${inputCls} w-20 py-1.5 text-xs`} />
                                                <select value={vol.id_unit_type ?? ""} onChange={(e) => { const val = e.target.value || null; const u = unitTypes.find((x) => x.id === val); updateFormVolume(vol.id, { id_unit_type: val, unitLabel: u?.sigla ?? "ml" }); }} className={`${selectCls} w-20 py-1.5 text-xs`}>
                                                    <option value="">—</option>
                                                    {unitTypes.map((u) => <option key={u.id} value={u.id}>{u.sigla}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => addFormItem(vol.id)} className="rounded-md bg-violet-600 px-2 py-1 text-xs font-bold text-white hover:bg-violet-700"><Plus className="inline h-3 w-3" /> Item</button>
                                                <button type="button" onClick={() => removeFormVolume(vol.id)} className="rounded-md border border-zinc-200 p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:border-zinc-700"><X className="h-4 w-4" /></button>
                                            </div>
                                        </div>
                                        {/* Foto por embalagem */}
                                        <div className="mb-3 rounded border border-dashed border-zinc-200 p-2 dark:border-zinc-700">
                                            <p className="mb-1 text-[10px] font-semibold text-zinc-500">Foto desta embalagem (opcional)</p>
                                            {editImages.filter((i) => i.product_volume_id === vol.id).map((img) => (
                                                <div key={img.id} className="mb-2 flex items-center gap-2">
                                                    <img src={img.thumbnail_url ?? img.url} alt="emb" className="h-12 w-12 rounded object-cover border border-violet-300" />
                                                    <button type="button" onClick={() => selected && deleteProductImage(img.id, selected.product_id)} className="text-xs text-red-500 hover:underline">remover</button>
                                                </div>
                                            ))}
                                            <div className="flex items-center gap-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-600">
                                                    <Camera className="h-3 w-3" />
                                                    {volumeImageFiles[vol.id] ? volumeImageFiles[vol.id].name : "Selecionar foto"}
                                                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                                        onChange={(e) => {
                                                            const f = e.target.files?.[0];
                                                            if (f) setVolumeImageFiles((prev) => ({ ...prev, [vol.id]: f }));
                                                        }}
                                                    />
                                                </label>
                                                {volumeImageFiles[vol.id] && selected && (
                                                    <button type="button" disabled={imageUploading}
                                                        onClick={async () => {
                                                            await uploadProductImage(selected.product_id, volumeImageFiles[vol.id], vol.id);
                                                            setVolumeImageFiles((prev) => { const n = { ...prev }; delete n[vol.id]; return n; });
                                                        }}
                                                        className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-700 dark:bg-violet-900/30"
                                                    >
                                                        {imageUploading ? "Enviando…" : "Enviar"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {vol.items.length === 0 ? (
                                            <p className="rounded border border-dashed border-zinc-200 py-3 text-center text-xs text-zinc-400 dark:border-zinc-600">Nenhum item. Clique em &quot;+ Item&quot;.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {vol.items.map((it) => (
                                                    <div key={it.id} className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-900/50">
                                                        <div className="mb-2 flex items-center justify-between">
                                                            <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">{it.siglaLabel}</span>
                                                            <button type="button" onClick={() => removeFormItem(vol.id, it.id)} className="text-zinc-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Sigla</label>
                                                                <select value={it.id_sigla_comercial} onChange={(e) => { const s = siglas.find((x) => x.id === e.target.value); updateFormItem(vol.id, it.id, { id_sigla_comercial: e.target.value, siglaLabel: s?.sigla ?? "" }); }} className={`${selectCls} py-1.5 text-xs`}>
                                                                    {siglas.map((s) => <option key={s.id} value={s.id}>{s.sigla}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Fator</label>
                                                                <input value={it.fator_conversao === 0 ? "" : it.fator_conversao} onChange={(e) => { const v = e.target.value; updateFormItem(vol.id, it.id, { fator_conversao: v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0) }); }} className={`${inputCls} py-1.5 text-xs`} type="number" min={0} placeholder="1" />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Preço venda (R$)</label>
                                                                <input value={it.preco_venda} onChange={(e) => updateFormItem(vol.id, it.id, { preco_venda: formatBRLInput(e.target.value) })} className={`${inputCls} py-1.5 text-xs`} inputMode="numeric" />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-red-600 dark:text-red-400">Preço custo (R$)</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.preco_custo} onChange={(e) => updateFormItem(vol.id, it.id, { preco_custo: formatBRLInput(e.target.value) })} className={`${inputCls} py-1.5 text-xs border-red-100`} inputMode="numeric" placeholder="0,00" />
                                                                    {(!isUnSigla(it.siglaLabel) && (it.siglaLabel?.toUpperCase() === "CX" || it.fator_conversao > 1)) && (
                                                                        <button type="button" onClick={() => aplicarCustoNaUn(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular custo da UN (custo CX ÷ fator)">→UN</button>
                                                                    )}
                                                                    {isUnSigla(it.siglaLabel) && (
                                                                        <button type="button" onClick={() => aplicarCustoNaCx(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular custo da CX (custo UN × fator)">→CX</button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Estoque / Est. mín.</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.estoque} onChange={(e) => updateFormItem(vol.id, it.id, { estoque: e.target.value.replaceAll(/\D/g, "").replaceAll(/^0+/g, "") || "" })} placeholder="0" className={`${inputCls} w-14 py-1.5 text-xs`} inputMode="numeric" />
                                                                    <input value={it.estoque_minimo} onChange={(e) => updateFormItem(vol.id, it.id, { estoque_minimo: e.target.value.replaceAll(/\D/g, "").replaceAll(/^0+/g, "") || "" })} placeholder="mín" className={`${inputCls} w-12 py-1.5 text-xs`} inputMode="numeric" title="Est. mínimo" />
                                                                    {(!isUnSigla(it.siglaLabel) && (it.siglaLabel?.toUpperCase() === "CX" || it.fator_conversao > 1)) && (
                                                                        <button type="button" onClick={() => aplicarEstoqueNaUn(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular estoque UN (CX × fator)">→UN</button>
                                                                    )}
                                                                    {isUnSigla(it.siglaLabel) && (
                                                                        <button type="button" onClick={() => aplicarEstoqueNaCx(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular estoque CX (UN ÷ fator)">→CX</button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Descrição</label>
                                                                <input value={it.descricao} onChange={(e) => updateFormItem(vol.id, it.id, { descricao: e.target.value.toUpperCase() })} placeholder="Ex: CX 15UN" className={`${inputCls} py-1.5 text-xs uppercase`} />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Código</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.codigo_interno} onChange={(e) => updateFormItem(vol.id, it.id, { codigo_interno: e.target.value })} placeholder="INT-1000" className={`${inputCls} py-1.5 text-xs`} />
                                                                    <button type="button" onClick={() => gerarCodigoParaItem(it.id)} disabled={!!codigoLoadingItemId} className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1.5 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300" title="Gerar próximo código">{" "}{codigoLoadingItemId === it.id ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Gerar"}</button>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">EAN</label>
                                                                <input value={it.codigo_barras_ean} onChange={(e) => updateFormItem(vol.id, it.id, { codigo_barras_ean: e.target.value })} placeholder="789..." className={`${inputCls} py-1.5 text-xs`} inputMode="numeric" />
                                                            </div>
                                                            <div className="sm:col-span-2">
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Tags / Sinônimos <span className="font-normal text-zinc-400">(usado no chatbot)</span></label>
                                                                <input value={it.tags} onChange={(e) => updateFormItem(vol.id, it.id, { tags: e.target.value })} placeholder="latinha, gelada…" className={`${inputCls} py-1.5 text-xs`} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                        <div className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Ativo no catálogo</p>
                                <p className="text-xs text-zinc-400">Desativando, o item some do chatbot e pedidos.</p>
                            </div>
                            <Toggle checked={isActive} onChange={setIsActive} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Acompanhamento (Chatbot)</p>
                                <p className="text-xs text-zinc-400">O bot sugere estes itens após o pedido (até 2).</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setAcompModalOpen(true)} className="rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">Selecionar</button>
                                <Toggle checked={isAccomp} onChange={setIsAccomp} />
                            </div>
                        </div>
                        {acompSelected.length > 0 && (
                            <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                                <p className="mb-1 text-xs font-semibold text-zinc-500">Produtos de acompanhamento:</p>
                                <p className="text-xs text-zinc-600">{acompSelected.map((a) => a.name).join(", ")}</p>
                            </div>
                        )}
                        </>
                    )}

                    {msg && <p className={`text-xs font-semibold ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</p>}

                    <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button onClick={saveEdit} disabled={saving || editLoading} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
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

                {/* Sub-modal: nova marca (ainda usado no editar) */}
                {/* Sub-modal: nova sigla comercial */}
                <Modal title="Nova sigla comercial" open={addSiglaOpen} onClose={() => setAddSiglaOpen(false)}>
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Sigla</label>
                            <input
                                value={newSiglaValue}
                                onChange={(e) => setNewSiglaValue(e.target.value.toUpperCase())}
                                placeholder="CX, FARD, PAC…"
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Descrição (opcional)</label>
                            <input
                                value={newSiglaDesc}
                                onChange={(e) => setNewSiglaDesc(e.target.value)}
                                placeholder="Caixa, Fardo, Pacote…"
                                className={inputCls}
                            />
                        </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={async () => {
                                const id = await quickCreateSigla(newSiglaValue, newSiglaDesc);
                                if (id) {
                                    setSiglaExtraId(id);
                                    setNewSiglaValue("");
                                    setNewSiglaDesc("");
                                    setAddSiglaOpen(false);
                                }
                            }}
                            className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600"
                        >
                            Criar e selecionar
                        </button>
                        <button
                            onClick={() => setAddSiglaOpen(false)}
                            className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700"
                        >
                            Cancelar
                        </button>
                    </div>
                </Modal>
            </Modal>

            {/* Create Modal — novo fluxo: Nome produto + ADICIONAR ITEM */}
            <Modal title="Cadastrar novo produto" open={openCreate} onClose={() => { setOpenCreate(false); setMsg(null); }} wide>
                <div className="flex flex-col gap-5">
                    {/* Nome do produto: buscar existente ou criar novo */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <label className="mb-1 block text-xs font-bold text-zinc-700 dark:text-zinc-300">Nome do produto</label>
                        <p className="mb-2 text-[11px] text-zinc-400">Busque um produto existente ou digite um nome novo (único por empresa)</p>
                        <div className="relative">
                            <input
                                value={productName || productNameSearch}
                                onChange={(e) => { setProductName(""); setProductNameSearch(e.target.value.toUpperCase()); setProductNameDropdownOpen(true); }}
                                onFocus={() => setProductNameDropdownOpen(true)}
                                placeholder="Ex: Skol, Heineken 600ml…"
                                className={inputCls}
                            />
                            {productNameDropdownOpen && productNameSearch.length >= 1 && (
                                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                                    {productNameOptions.length > 0 ? (
                                        productNameOptions.map((opt) => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => { setProductName(opt.name.toUpperCase()); setProductNameSearch(opt.name.toUpperCase()); setProductNameDropdownOpen(false); }}
                                                className="flex w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            >
                                                {opt.name}
                                            </button>
                                        ))
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => { setProductName(productNameSearch.toUpperCase()); setProductNameDropdownOpen(false); }}
                                            className="flex w-full px-3 py-2 text-left text-sm text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                                        >
                                            Criar novo: &quot;{productNameSearch}&quot;
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Foto do produto */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <p className="mb-3 text-xs font-bold text-zinc-700 dark:text-zinc-300">Foto do produto <span className="font-normal text-zinc-400">(opcional)</span></p>
                        {createImageFile && (
                            <div className="mb-3">
                                <img
                                    src={URL.createObjectURL(createImageFile)}
                                    alt="preview"
                                    className="h-20 w-20 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
                                />
                            </div>
                        )}
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-3 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800/50">
                            <Camera className="h-4 w-4 text-zinc-400" />
                            <span className="text-xs text-zinc-500">
                                {createImageFile ? createImageFile.name : "Selecionar foto (JPG, PNG, WEBP · max 2MB)"}
                            </span>
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => setCreateImageFile(e.target.files?.[0] ?? null)}
                            />
                        </label>
                    </div>

                    {/* Categoria */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Categoria</p>
                                <p className="text-xs text-zinc-400">Selecione para compor o nome do produto</p>
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

                    {/* Embalagens */}
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Embalagens</p>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setAddSiglaOpen(true)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">
                                    Nova sigla
                                </button>
                                <button type="button" onClick={addFormVolume} className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">
                                    <Plus className="h-3 w-3" /> Adicionar embalagem
                                </button>
                            </div>
                        </div>
                        <p className="mb-3 text-[11px] text-zinc-400">Tamanho é opcional (produtos sem medida, ex: hambúrguer). Cada embalagem pode ter UN, CX, etc. Use →UN/→CX para aplicar fator.</p>
                        {formVolumes.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
                                Nenhuma embalagem. Clique em &quot;Adicionar embalagem&quot; para começar.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {formVolumes.map((vol) => (
                                    <div key={vol.id} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Tamanho <span className="font-normal text-zinc-400">(opcional)</span></span>
                                                <input
                                                    value={vol.volume_quantidade}
                                                    onChange={(e) => updateFormVolume(vol.id, { volume_quantidade: e.target.value })}
                                                    placeholder="350"
                                                    className={`${inputCls} w-20 py-1.5 text-xs`}
                                                />
                                                <select
                                                    value={vol.id_unit_type ?? ""}
                                                    onChange={(e) => {
                                                        const val = e.target.value || null;
                                                        const u = unitTypes.find((x) => x.id === val);
                                                        updateFormVolume(vol.id, { id_unit_type: val, unitLabel: u?.sigla ?? "ml" });
                                                    }}
                                                    className={`${selectCls} w-20 py-1.5 text-xs`}
                                                >
                                                    <option value="">—</option>
                                                    {unitTypes.map((u) => (
                                                        <option key={u.id} value={u.id}>{u.sigla}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => addFormItem(vol.id)} className="rounded-md bg-violet-600 px-2 py-1 text-xs font-bold text-white hover:bg-violet-700">
                                                    <Plus className="inline h-3 w-3" /> Item
                                                </button>
                                                <button type="button" onClick={() => removeFormVolume(vol.id)} className="rounded-md border border-zinc-200 p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:border-zinc-700">
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                        {vol.items.length === 0 ? (
                                            <p className="rounded border border-dashed border-zinc-200 py-3 text-center text-xs text-zinc-400 dark:border-zinc-600">Nenhum item. Clique em &quot;+ Item&quot;.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {vol.items.map((it) => (
                                                    <div key={it.id} className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-900/50">
                                                        <div className="mb-2 flex items-center justify-between">
                                                            <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">{it.siglaLabel}</span>
                                                            <button type="button" onClick={() => removeFormItem(vol.id, it.id)} className="text-zinc-400 hover:text-red-500">
                                                                <X className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Sigla</label>
                                                                <select value={it.id_sigla_comercial} onChange={(e) => { const s = siglas.find((x) => x.id === e.target.value); updateFormItem(vol.id, it.id, { id_sigla_comercial: e.target.value, siglaLabel: s?.sigla ?? "" }); }} className={`${selectCls} py-1.5 text-xs`}>
                                                                    {siglas.map((s) => <option key={s.id} value={s.id}>{s.sigla}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Fator</label>
                                                                <input value={it.fator_conversao === 0 ? "" : it.fator_conversao} onChange={(e) => { const v = e.target.value; updateFormItem(vol.id, it.id, { fator_conversao: v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0) }); }} className={`${inputCls} py-1.5 text-xs`} type="number" min={0} placeholder="1" />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Preço venda (R$)</label>
                                                                <input value={it.preco_venda} onChange={(e) => updateFormItem(vol.id, it.id, { preco_venda: formatBRLInput(e.target.value) })} className={`${inputCls} py-1.5 text-xs`} inputMode="numeric" />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-red-600 dark:text-red-400">Preço custo (R$)</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.preco_custo} onChange={(e) => updateFormItem(vol.id, it.id, { preco_custo: formatBRLInput(e.target.value) })} className={`${inputCls} py-1.5 text-xs border-red-100`} inputMode="numeric" placeholder="0,00" />
                                                                    {(!isUnSigla(it.siglaLabel) && (it.siglaLabel?.toUpperCase() === "CX" || it.fator_conversao > 1)) && (
                                                                        <button type="button" onClick={() => aplicarCustoNaUn(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular custo da UN (custo CX ÷ fator)">
                                                                            →UN
                                                                        </button>
                                                                    )}
                                                                    {isUnSigla(it.siglaLabel) && (
                                                                        <button type="button" onClick={() => aplicarCustoNaCx(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular custo da CX (custo UN × fator)">
                                                                            →CX
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Estoque / Est. mín.</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.estoque} onChange={(e) => updateFormItem(vol.id, it.id, { estoque: e.target.value.replaceAll(/\D/g, "").replaceAll(/^0+/g, "") || "" })} placeholder="0" className={`${inputCls} w-14 py-1.5 text-xs`} inputMode="numeric" />
                                                                    <input value={it.estoque_minimo} onChange={(e) => updateFormItem(vol.id, it.id, { estoque_minimo: e.target.value.replaceAll(/\D/g, "").replaceAll(/^0+/g, "") || "" })} placeholder="mín" className={`${inputCls} w-12 py-1.5 text-xs`} inputMode="numeric" title="Est. mínimo" />
                                                                    {(!isUnSigla(it.siglaLabel) && (it.siglaLabel?.toUpperCase() === "CX" || it.fator_conversao > 1)) && (
                                                                        <button type="button" onClick={() => aplicarEstoqueNaUn(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular estoque UN (CX × fator)">→UN</button>
                                                                    )}
                                                                    {isUnSigla(it.siglaLabel) && (
                                                                        <button type="button" onClick={() => aplicarEstoqueNaCx(vol.id, it)} className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400" title="Calcular estoque CX (UN ÷ fator)">→CX</button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Descrição</label>
                                                                <input value={it.descricao} onChange={(e) => updateFormItem(vol.id, it.id, { descricao: e.target.value.toUpperCase() })} placeholder="Ex: CX 15UN" className={`${inputCls} py-1.5 text-xs uppercase`} />
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Código</label>
                                                                <div className="flex gap-1">
                                                                    <input value={it.codigo_interno} onChange={(e) => updateFormItem(vol.id, it.id, { codigo_interno: e.target.value })} placeholder="INT-1000" className={`${inputCls} py-1.5 text-xs`} />
                                                                    <button type="button" onClick={() => gerarCodigoParaItem(it.id)} disabled={!!codigoLoadingItemId} className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1.5 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300" title="Gerar próximo código interno">
                                                                        {codigoLoadingItemId === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Gerar"}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">EAN</label>
                                                                <input value={it.codigo_barras_ean} onChange={(e) => updateFormItem(vol.id, it.id, { codigo_barras_ean: e.target.value })} placeholder="789..." className={`${inputCls} py-1.5 text-xs`} inputMode="numeric" />
                                                            </div>
                                                            <div className="sm:col-span-2">
                                                                <label className="mb-0.5 block text-[10px] font-semibold text-zinc-500">Tags / Sinônimos <span className="font-normal text-zinc-400">(usado no chatbot)</span></label>
                                                                <input value={it.tags} onChange={(e) => updateFormItem(vol.id, it.id, { tags: e.target.value })} placeholder="latinha, gelada, skolzinha…" className={`${inputCls} py-1.5 text-xs`} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Ativo + Acompanhamento */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Ativo no catálogo</p>
                            <Toggle checked={isActive} onChange={setIsActive} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Acompanhamento (Chatbot)</p>
                                <p className="text-[10px] text-zinc-400">O bot sugere estes itens após o pedido.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setAcompModalOpen(true)} className="rounded-md bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600">Selecionar</button>
                                <Toggle checked={isAccomp} onChange={setIsAccomp} />
                            </div>
                        </div>
                    </div>
                    {acompSelected.length > 0 && (
                        <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <p className="text-xs font-semibold text-zinc-500">Acompanhamento: {acompSelected.map((a) => a.name).join(", ")}</p>
                        </div>
                    )}

                    {msg && <p className="text-xs font-semibold text-red-600">{msg}</p>}

                    <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button onClick={saveCreate} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {saving ? "Salvando…" : "Cadastrar"}
                        </button>
                        <button onClick={() => setOpenCreate(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                    </div>
                </div>

                <Modal title="Nova Categoria" open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)}>
                    <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Ex: Cerveja" className={inputCls} />
                    <div className="mt-4 flex gap-2">
                        <button onClick={async () => { const id = await quickCreateCategory(newCategoryName); if (id) { setCategoryId(id); setNewCategoryName(""); setAddCategoryOpen(false); } }} className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600">Criar e selecionar</button>
                        <button onClick={() => setAddCategoryOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                    </div>
                </Modal>
                <Modal title="Nova sigla comercial" open={addSiglaOpen} onClose={() => setAddSiglaOpen(false)}>
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Sigla</label>
                            <input value={newSiglaValue} onChange={(e) => setNewSiglaValue(e.target.value.toUpperCase())} placeholder="CX, FARD, PAC…" className={inputCls} />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Descrição (opcional)</label>
                            <input value={newSiglaDesc} onChange={(e) => setNewSiglaDesc(e.target.value)} placeholder="Caixa, Fardo, Pacote…" className={inputCls} />
                        </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button onClick={async () => { const id = await quickCreateSigla(newSiglaValue, newSiglaDesc); if (id) { setNewSiglaValue(""); setNewSiglaDesc(""); setAddSiglaOpen(false); load(); } }} className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600">Criar</button>
                        <button onClick={() => setAddSiglaOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                    </div>
                </Modal>
            </Modal>

            {/* Modal: Selecionar produtos de acompanhamento */}
            <Modal title="Selecionar produtos de acompanhamento (máx. 2)" open={acompModalOpen} onClose={() => setAcompModalOpen(false)} wide>
                <p className="mb-3 text-xs text-zinc-500">O chatbot oferecerá estes itens após o pedido. Selecione até 2.</p>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                    {acompCandidates.map((r) => {
                        const name = [r.products?.categories?.name, r.details].filter(Boolean).join(" ") || r.products?.name || "—";
                        const isSel = acompSelected.some((a) => a.id === r.id);
                        const canAdd = isSel || acompSelected.length < 2;
                        return (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                    if (isSel) {
                                        setAcompSelected((prev) => prev.filter((a) => a.id !== r.id));
                                    } else if (canAdd) {
                                        setAcompSelected((prev) => [...prev, { id: r.id, name }].slice(0, 2));
                                    }
                                }}
                                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                    isSel ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                }`}
                            >
                                <span className="truncate">{name}</span>
                                {isSel && <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-600" />}
                            </button>
                        );
                    })}
                </div>
                <div className="mt-4 flex justify-end">
                    <button onClick={() => setAcompModalOpen(false)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700">
                        Fechar
                    </button>
                </div>
            </Modal>
        </div>
    );
}
