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
    cost_price:  number | null;
    tags:        string | null;
    codigo_barras_ean: string | null;
    is_acompanhamento: boolean;
    codigo_interno: string | null;
    has_case:    boolean;
    case_qty:    number | null;
    case_price:  number | null;
    case_id:     string | null;
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
            cost_price:   r?.cost_price != null ? Number(r.cost_price) : null,
            tags:         r?.tags ?? null,
            codigo_barras_ean: r?.codigo_barras_ean ?? null,
            is_acompanhamento: Boolean(r?.is_acompanhamento),
            has_case:     Boolean(r?.has_case),
            case_id:      r?.case_id ?? null,
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
            codigo_interno: r?.codigo_interno ?? null,
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
    const [openCreate, setOpenCreate] = useState(false);
    const [selected, setSelected] = useState<Row | null>(null);
    const [saving,   setSaving]   = useState(false);

    // edit fields — variant
    const [details,     setDetails]     = useState("");
    const [hasVolume,   setHasVolume]   = useState(false);
        const [volumeValue, setVolumeValue] = useState("");
    const [unit,        setUnit]        = useState<Unit>("none");
    const [unitPrice,   setUnitPrice]   = useState("0,00");
    const [costPrice,   setCostPrice]   = useState("0,00");
    const [hasCase,     setHasCase]     = useState(false);
    const [caseQty,     setCaseQty]     = useState("");
    const [casePrice,   setCasePrice]   = useState("0,00");
    const [isActive,    setIsActive]    = useState(true);
    const [tags,        setTags]        = useState("");
    const [ean,         setEan]         = useState("");
    const [isAccomp,    setIsAccomp]    = useState(false);
    const [codigoInterno, setCodigoInterno] = useState<string | null>(null);
    const [codigoLoading, setCodigoLoading] = useState(false);
    const [codigoCaixa, setCodigoCaixa] = useState<string | null>(null);
    const [codigoCaixaLoading, setCodigoCaixaLoading] = useState(false);

    // edit fields — product base
    const [categoryId,       setCategoryId]       = useState("");
    const [brandId,          setBrandId]          = useState("");
    const [newCategoryName,  setNewCategoryName]  = useState("");
    const [newBrandName,     setNewBrandName]     = useState("");
    const [addCategoryOpen,  setAddCategoryOpen]  = useState(false);
    const [addBrandOpen,     setAddBrandOpen]     = useState(false);
    const [siglaUnId, setSiglaUnId] = useState<string | null>(null);
    const [siglaCxId, setSiglaCxId] = useState<string | null>(null);
    const [siglas, setSiglas] = useState<{ id: string; sigla: string }[]>([]);
    const [siglaExtraId, setSiglaExtraId] = useState<string | null>(null);
    const [addSiglaOpen, setAddSiglaOpen] = useState(false);
    const [newSiglaValue, setNewSiglaValue] = useState("");
    const [newSiglaDesc, setNewSiglaDesc] = useState("");

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
        const [prodRes, catRes, brRes] = await Promise.all([
            supabase.from("products").select(`
              id,
              name,
              category_id,
              brand_id,
              is_active,
              codigo_interno,
              preco_custo_unitario,
              estoque_atual,
              estoque_minimo,
              categories(id,name),
              brands(id,name),
              produto_embalagens(
                id, descricao, fator_conversao, preco_venda, tags, codigo_barras_ean, is_acompanhamento,
                id_sigla_comercial, id_unit_type, volume_quantidade,
                siglas_comerciais(sigla, descricao),
                unit_types(sigla, descricao)
              )
            `).eq("company_id", companyId).order("created_at", { ascending: false }).limit(500),
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);

        if (prodRes.error) {
            setMsg(`Erro: ${prodRes.error?.message ?? ""}`);
            setLoading(false);
            return;
        }

        // Lookup para garantir que `name` venha sempre como texto.
        // (O join `categories(name)`/`brands(name)` pode acabar retornando `name` como boolean em alguns cenarios.)
        const catById = new Map<string, string>(
            ((catRes.data ?? []) as any[]).map((c) => [String(c.id), String(typeof c.name === "string" ? c.name : (c.name ?? ""))]),
        );
        const brandById = new Map<string, string>(
            ((brRes.data ?? []) as any[]).map((b) => [String(b.id), String(typeof b.name === "string" ? b.name : (b.name ?? ""))]),
        );

        const mapped = (prodRes.data ?? []).map((p: any) => {
            const packs: any[] = Array.isArray(p.produto_embalagens) ? p.produto_embalagens : [];
            const sigla = (x: any) => String((x?.siglas_comerciais?.sigla ?? x?.sigla_comercial) ?? "").toUpperCase();
            const unPack = packs.find((x) => sigla(x) === "UN") ?? null;
            if (!unPack) return null;
            const cxPack = packs.find((x) => sigla(x) === "CX") ?? null;

            return {
                id: String(unPack.id),
                product_id: String(p.id),
                details: unPack.descricao ?? null,
                volume_value: null,
                unit: "none",
                unit_price: Number(unPack.preco_venda ?? 0),
                cost_price: Number(p.preco_custo_unitario ?? 0),
                tags: unPack.tags ?? null,
                codigo_barras_ean: unPack.codigo_barras_ean ?? null,
                is_acompanhamento: Boolean(unPack.is_acompanhamento),
            codigo_interno: p.codigo_interno ?? null,
                has_case: Boolean(cxPack),
                case_id: cxPack?.id ? String(cxPack.id) : null,
                case_qty: cxPack ? Number(cxPack.fator_conversao ?? 0) : null,
                case_price: cxPack ? Number(cxPack.preco_venda ?? 0) : null,
                is_active: Boolean(p.is_active),
                products: p ? {
                    name: p.name ?? null,
                    category_id: p.category_id ?? null,
                    brand_id: p.brand_id ?? null,
                    // Usa `category_id`/`brand_id` como fonte da verdade para o nome.
                    // Assim evitamos o bug de renderizar `true/false` quando o join retorna `name` boolean.
                    categories: p.category_id ? {
                        id: String(p.category_id),
                        name: catById.get(String(p.category_id)) ?? "",
                    } : null,
                    brands: p.brand_id ? {
                        id: String(p.brand_id),
                        name: brandById.get(String(p.brand_id)) ?? "",
                    } : null,
                } : null,
            } as Row;
        }).filter(Boolean) as Row[];

        setRows(mapped);
        if (!catRes.error) setCategories((catRes.data as any[]).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })));
        if (!brRes.error)  setBrands((brRes.data as any[]).map((b)  => ({
            id: String(b.id),
            name: typeof b.name === "string" ? b.name : "",
        })));

        const { data: siglasData } = await supabase
            .from("siglas_comerciais")
            .select("id, sigla")
            .eq("company_id", companyId);
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
                if (!siglaExtraId) setSiglaExtraId(cx.id);
            }
        }
        setLoading(false);
    }

    async function reloadCatsAndBrands() {
        const [cats, brs] = await Promise.all([
            supabase.from("categories").select("id,name").eq("is_active", true).order("name"),
            supabase.from("brands").select("id,name").eq("is_active", true).order("name"),
        ]);
        if (!cats.error) setCategories((cats.data as any[]).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })));
        if (!brs.error)  setBrands((brs.data as any[]).map((b)   => ({
            id: String(b.id),
            name: typeof b.name === "string" ? b.name : "",
        })));
    }

    async function quickCreateSigla(sigla: string, descricao: string) {
        if (!sigla.trim() || !companyId) return null;
        const payload: any = {
            sigla: sigla.trim().toUpperCase(),
            descricao: descricao.trim() || null,
            company_id: companyId,
        };
        const { data, error } = await supabase
            .from("siglas_comerciais")
            .insert(payload)
            .select("id, sigla")
            .single();
        if (error) {
            setMsg(`Erro: ${error.message}`);
            return null;
        }
        const created = { id: String((data as any).id), sigla: String((data as any).sigla ?? "").toUpperCase() };
        setSiglas((prev) => [...prev, created]);
        if (created.sigla === "UN") setSiglaUnId(created.id);
        if (!siglaExtraId) setSiglaExtraId(created.id);
        return created.id;
    }

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
        await supabase.from("products").update({ is_active: next }).eq("id", row.product_id).eq("company_id", companyId);
        flashRow(row.id);
    }

    // ── open edit ─────────────────────────────────────────────────────────────

    function openEdit(r: Row) {
        setSelected(r); setOpen(true); setMsg(null);
        setDetails(r.details ?? "");
        const hv = r.unit !== "none" && r.volume_value !== null;
        setHasVolume(hv); setVolumeValue(hv ? String(r.volume_value ?? "") : ""); setUnit(hv ? r.unit : "none");
        setUnitPrice(brl(r.unit_price));
        setCostPrice(brl(r.cost_price ?? 0));
        setHasCase(!!r.has_case); setCaseQty(r.case_qty ? String(r.case_qty) : ""); setCasePrice(brl(r.case_price ?? 0));
        setIsActive(!!r.is_active);
        setTags(r.tags ?? "");
        setEan(r.codigo_barras_ean ?? "");
        setIsAccomp(!!r.is_acompanhamento);
        setCodigoInterno(r.codigo_interno ?? null);
        setCategoryId(r.products?.category_id ?? r.products?.categories?.id ?? "");
        setBrandId(r.products?.brand_id ?? r.products?.brands?.id ?? "");
        setNewCategoryName(""); setNewBrandName("");
    }

    function openNew() {
        setSelected(null);
        setMsg(null);
        setDetails("");
        setHasVolume(false);
        setVolumeValue("");
        setUnit("none");
        setUnitPrice("0,00");
        setCostPrice("0,00");
        setHasCase(false);
        setCaseQty("");
        setCasePrice("0,00");
        setIsActive(true);
        setTags("");
        setEan("");
        setIsAccomp(false);
        setCodigoInterno(null);
        setOpenCreate(true);
    }

    // ── save edit ─────────────────────────────────────────────────────────────

    async function saveEdit() {
        if (!selected) return;
        setSaving(true); setMsg(null);
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        if (!brandId)    { setMsg("Selecione uma marca.");    setSaving(false); return; }
        const cpVal = brlToNumber(costPrice);

        // Atualiza `products` (custo + ativo + categoria/marca)
        const { error: pErr } = await supabase.from("products").update({
            category_id: categoryId,
            brand_id: brandId,
            preco_custo_unitario: cpVal,
            is_active: isActive,
        }).eq("id", selected.product_id).eq("company_id", companyId);

        if (pErr) { setMsg(`Erro: ${pErr.message}`); setSaving(false); return; }

        // Atualiza embalagem UN (descricao + preco_venda)
        const { error: unErr } = await supabase.from("produto_embalagens").update({
            descricao: details.trim() || null,
            preco_venda: brlToNumber(unitPrice),
            tags: tags.trim() || null,
            codigo_barras_ean: ean.trim() || null,
            is_acompanhamento: isAccomp,
        }).eq("id", selected.id).eq("company_id", companyId);

        if (unErr) { setMsg(`Erro: ${unErr.message}`); setSaving(false); return; }

        // Atualiza / cria / remove embalagem CX
        const caseFator = Math.max(0, Number((caseQty ?? "").replace(",", ".")));
        const casePV = brlToNumber(casePrice);

        if (!siglaCxId) { setMsg("Sigla comercial CX não encontrada. Recarregue a página."); setSaving(false); return; }
        const { data: cxRow, error: cxFindErr } = await supabase
            .from("produto_embalagens")
            .select("id")
            .eq("produto_id", selected.product_id)
            .eq("company_id", companyId)
            .eq("id_sigla_comercial", siglaCxId)
            .maybeSingle();

        if (cxFindErr) { setMsg(`Erro: ${cxFindErr.message}`); setSaving(false); return; }

        if (hasCase) {
            if (!caseFator || caseFator <= 0) { setMsg("Informe 'Cx c/' válido."); setSaving(false); return; }
            if (cxRow?.id) {
                const { error: cxUpErr } = await supabase.from("produto_embalagens").update({
                    descricao: `CX ${caseFator}un`,
                    fator_conversao: caseFator,
                    preco_venda: casePV,
                    tags: tags.trim() || null,
                    is_acompanhamento: isAccomp,
                }).eq("id", cxRow.id).eq("company_id", companyId);
                if (cxUpErr) { setMsg(`Erro: ${cxUpErr.message}`); setSaving(false); return; }
            } else {
                const { error: cxInsErr } = await supabase.from("produto_embalagens").insert({
                    company_id: companyId,
                    produto_id: selected.product_id,
                    id_sigla_comercial: siglaCxId,
                    descricao: `CX ${caseFator}un`,
                    fator_conversao: caseFator,
                    preco_venda: casePV,
                    tags: tags.trim() || null,
                    is_acompanhamento: isAccomp,
                });
                if (cxInsErr) { setMsg(`Erro: ${cxInsErr.message}`); setSaving(false); return; }
            }
        } else {
            if (cxRow?.id) {
                const { error: cxDelErr } = await supabase.from("produto_embalagens").delete().eq("id", cxRow.id).eq("company_id", companyId);
                if (cxDelErr) { setMsg(`Erro: ${cxDelErr.message}`); setSaving(false); return; }
            }
        }

        setSaving(false);
        setOpen(false);
        setSelected(null);
    }

    async function saveCreate() {
        setSaving(true);
        setMsg(null);
        if (!companyId) { setMsg("Nenhuma empresa ativa."); setSaving(false); return; }
        if (!categoryId) { setMsg("Selecione uma categoria."); setSaving(false); return; }
        if (!details.trim()) { setMsg("Informe a descrição da unidade (ex: 600ml / long neck)."); setSaving(false); return; }
        if (!codigoInterno) { setMsg("Gere ou informe o código interno."); setSaving(false); return; }

        const catName = categories.find((c) => c.id === categoryId)?.name ?? "Produto";
        const productName = [catName, details.trim()].filter(Boolean).join(" ");

        try {
            let nextCode = codigoInterno;
            if (!nextCode) {
                const { data, error: rpcErr } = await supabase.rpc("gerar_proximo_codigo_interno");
                if (rpcErr) throw new Error(rpcErr.message);
                nextCode = String(data ?? "");
            }

                const custoInformado = brlToNumber(costPrice);
                const temCaixa = hasCase;
                const caseFator = Math.max(0, Number((caseQty ?? "").replace(",", ".")));

                const precoCustoUnitario = temCaixa && caseFator > 0
                    ? custoInformado / caseFator
                    : custoInformado;

                const { data: prod, error: prodErr } = await supabase.from("products").insert({
                company_id: companyId,
                name: productName,
                category_id: categoryId,
                brand_id: brandId || null,
                is_active: isActive,
                codigo_interno: String(nextCode ?? ""),
                preco_custo_unitario: precoCustoUnitario,
                estoque_atual: 0,
                estoque_minimo: 0,
            }).select("id").single();
            if (prodErr) throw new Error(prodErr.message);

            const pid = String((prod as any)?.id ?? "");
            if (!pid) throw new Error("Falha ao criar produto (id ausente).");

            if (!siglaUnId) throw new Error("Sigla comercial UN não encontrada. Recarregue a página.");
            const { error: unErr } = await supabase.from("produto_embalagens").insert({
                company_id: companyId,
                produto_id: pid,
                descricao: details.trim(),
                id_sigla_comercial: siglaUnId,
                fator_conversao: 1,
                codigo_interno: codigoInterno,
                codigo_barras_ean: ean.trim() || null,
                preco_venda: brlToNumber(unitPrice),
                tags: tags.trim() || null,
                is_acompanhamento: isAccomp,
            });
            if (unErr) throw new Error(unErr.message);

            if (hasCase) {
                const siglaId = siglaExtraId || siglaCxId;
                if (!siglaId) throw new Error("Sigla comercial da segunda embalagem não encontrada. Recarregue a página.");
                const caseFatorCreate = Math.max(0, Number((caseQty ?? "").replace(",", ".")));
                if (!caseFatorCreate || caseFatorCreate <= 0) throw new Error("Informe 'Cx/Fardo c/' válido.");
                const { error: cxErr } = await supabase.from("produto_embalagens").insert({
                    company_id: companyId,
                    produto_id: pid,
                    descricao: details.trim() || undefined,
                    id_sigla_comercial: siglaId,
                    fator_conversao: caseFatorCreate,
                    preco_venda: brlToNumber(casePrice),
                    codigo_interno: codigoCaixa,
                    tags: tags.trim() || null,
                    is_acompanhamento: isAccomp,
                });
                if (cxErr) throw new Error(cxErr.message);
            }

            setSaving(false);
            setOpenCreate(false);
            await load();
        } catch (e: any) {
            setMsg(`Erro: ${String(e?.message ?? e)}`);
            setSaving(false);
        }
    }

    async function gerarCodigoInterno() {
        setCodigoLoading(true);
        setMsg(null);
        try {
            const { data, error } = await supabase.rpc("gerar_proximo_codigo_interno");
            if (error) throw new Error(error.message);
            setCodigoInterno(String(data ?? ""));
        } catch (e: any) {
            setMsg(`Erro ao gerar código interno: ${String(e?.message ?? e)}`);
        } finally {
            setCodigoLoading(false);
        }
    }

    async function gerarCodigoCaixa() {
        setCodigoCaixaLoading(true);
        setMsg(null);
        try {
            const { data, error } = await supabase.rpc("gerar_proximo_codigo_interno");
            if (error) throw new Error(error.message);
            setCodigoCaixa(String(data ?? ""));
        } catch (e: any) {
            setMsg(`Erro ao gerar código interno da embalagem: ${String(e?.message ?? e)}`);
        } finally {
            setCodigoCaixaLoading(false);
        }
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
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
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
                <div className="grid grid-cols-[1fr_1fr_1.5fr_80px_80px_80px_80px_1fr_60px_80px] gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800">
                    <span>Categoria</span><span>Marca</span><span>Detalhes</span>
                    <span className="text-right">Vol.</span>
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
                                className={`grid grid-cols-[1fr_1fr_1.5fr_80px_80px_80px_80px_1fr_60px_80px] items-center gap-2 px-4 py-3 transition-colors ${
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
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Tags / Sinônimos</label>
                            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="latinha, gelada, skolzinha…" className={inputCls} />
                        </div>
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">EAN (opcional)</label>
                            <input value={ean} onChange={(e) => setEan(e.target.value)} placeholder="789..." className={inputCls} inputMode="numeric" />
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
                        <div className="rounded-lg border border-red-100 bg-red-50/40 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                            <label className="mb-1 block text-xs font-semibold text-red-700 dark:text-red-400">
                                Preço de Custo (R$) <span className="text-[10px] font-normal text-zinc-400">— usado no Lucro Real do Financeiro</span>
                            </label>
                            <input value={costPrice} onChange={(e) => setCostPrice(formatBRLInput(e.target.value))} className={`${inputCls} border-red-200 focus:border-red-400 focus:ring-red-400/30 dark:border-red-900`} inputMode="numeric" placeholder="0,00" />
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
                        <div className="col-span-2 flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Acompanhamento (Chatbot)</p>
                                <p className="text-xs text-zinc-400">Se marcado, o bot pode sugerir este item após o pedido.</p>
                            </div>
                            <Toggle checked={isAccomp} onChange={setIsAccomp} />
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

                {/* Sub-modal: nova marca (ainda usado no editar) */}
                <Modal title="Nova Marca" open={addBrandOpen} onClose={() => setAddBrandOpen(false)}>
                    <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Ex: Skol" className={inputCls} />
                    <div className="mt-4 flex gap-2">
                        <button onClick={async () => { const id = await quickCreateBrand(newBrandName); if (id) { setBrandId(id); setNewBrandName(""); setAddBrandOpen(false); } }} className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600">Criar e selecionar</button>
                        <button onClick={() => setAddBrandOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                    </div>
                </Modal>

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

            {/* Create Modal (mesmo layout do editar) */}
            <Modal title="Cadastrar novo produto" open={openCreate} onClose={() => { setOpenCreate(false); setMsg(null); }} wide>
                <div className="flex flex-col gap-5">
                    <div className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Código interno</p>
                                <p className="text-xs text-zinc-400">Use este código para busca no PDV/ERP</p>
                            </div>
                            <button
                                type="button"
                                onClick={gerarCodigoInterno}
                                disabled={codigoLoading}
                                className="flex items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60"
                            >
                                {codigoLoading ? "Gerando…" : "Gerar"}
                            </button>
                        </div>
                        <input
                            value={codigoInterno ?? ""}
                            onChange={(e) => setCodigoInterno(e.target.value)}
                            placeholder="INT-1000"
                            className={inputCls}
                        />
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

                    {/* Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Descrição da unidade (UN)</label>
                            <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Ex: 600ml, long neck, retornável…" className={inputCls} />
                        </div>
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Tags / Sinônimos</label>
                            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="latinha, gelada, skolzinha…" className={inputCls} />
                        </div>
                        <div className="col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">EAN (opcional)</label>
                            <input value={ean} onChange={(e) => setEan(e.target.value)} placeholder="789..." className={inputCls} inputMode="numeric" />
                        </div>
                        <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">Valor unitário (R$)</label>
                            <input value={unitPrice} onChange={(e) => setUnitPrice(formatBRLInput(e.target.value))} className={inputCls} inputMode="numeric" />
                        </div>
                        <div className="rounded-lg border border-red-100 bg-red-50/40 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                            <label className="mb-1 block text-xs font-semibold text-red-700 dark:text-red-400">
                                Preço de Custo (R$) <span className="text-[10px] font-normal text-zinc-400">— usado no Lucro Real</span>
                            </label>
                            <input value={costPrice} onChange={(e) => setCostPrice(formatBRLInput(e.target.value))} className={`${inputCls} border-red-200 focus:border-red-400 focus:ring-red-400/30 dark:border-red-900`} inputMode="numeric" placeholder="0,00" />
                        </div>
                        <div className="col-span-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <label className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                <input
                                    type="checkbox"
                                    checked={hasCase}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setHasCase(checked);
                                        if (!checked) {
                                            setCaseQty("");
                                            setCasePrice("0,00");
                                            setCodigoCaixa(null);
                                        }
                                    }}
                                    className="h-4 w-4 accent-violet-600 rounded"
                                />
                                Vende em outra embalagem (CX, fardo, pacote…)
                            </label>
                            {hasCase && (
                                <div className="mt-3 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold text-zinc-500">Sigla comercial</label>
                                            <div className="flex gap-2">
                                                <select
                                                    value={siglaExtraId ?? ""}
                                                    onChange={(e) => setSiglaExtraId(e.target.value || null)}
                                                    className={selectCls}
                                                >
                                                    <option value="">Selecione…</option>
                                                    {siglas.map((s) => (
                                                        <option key={s.id} value={s.id}>{s.sigla}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => setAddSiglaOpen(true)}
                                                    className="shrink-0 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600"
                                                >
                                                    Nova
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold text-zinc-500">Caixa/Fardo com</label>
                                            <input
                                                disabled={!hasCase}
                                                value={caseQty}
                                                onChange={(e) => setCaseQty(e.target.value)}
                                                placeholder="12"
                                                className={inputCls}
                                                inputMode="numeric"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold text-zinc-500">Valor da embalagem (R$)</label>
                                            <input
                                                disabled={!hasCase}
                                                value={casePrice}
                                                onChange={(e) => setCasePrice(formatBRLInput(e.target.value))}
                                                className={inputCls}
                                                inputMode="numeric"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold text-zinc-500">Código interno da embalagem</label>
                                            <div className="flex gap-2">
                                                <input
                                                    value={codigoCaixa ?? ""}
                                                    onChange={(e) => setCodigoCaixa(e.target.value)}
                                                    placeholder="INT-1001"
                                                    className={inputCls}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={gerarCodigoCaixa}
                                                    disabled={codigoCaixaLoading}
                                                    className="shrink-0 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60"
                                                >
                                                    {codigoCaixaLoading ? "Gerando…" : "Gerar"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Ativo no catálogo</p>
                                <p className="text-xs text-zinc-400">Se desativar, some do PDV/Chatbot.</p>
                            </div>
                            <Toggle checked={isActive} onChange={setIsActive} />
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <div>
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Acompanhamento (Chatbot)</p>
                                <p className="text-xs text-zinc-400">Se marcado, o bot pode sugerir este item.</p>
                            </div>
                            <Toggle checked={isAccomp} onChange={setIsAccomp} />
                        </div>
                    </div>

                    {msg && <p className="text-xs font-semibold text-red-600">{msg}</p>}

                    <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button onClick={saveCreate} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {saving ? "Salvando…" : "Cadastrar"}
                        </button>
                        <button onClick={() => setOpenCreate(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
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
