// app/(admin)/pedidos/PedidosClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    AlertTriangle,
    Bike,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Eye,
    MessageCircle,
    Package,
    Plus,
    Printer,
    RefreshCcw,
    Search,
    ShoppingCart,
} from "lucide-react";

const PAGE_SIZE = 20;

import NewOrderModal from "@/lib/orders/NewOrderModal";
import ViewOrderModal from "@/lib/orders/ViewOrderModal";
import EditOrderModal from "@/lib/orders/EditOrderModal";
import ActionModal, { ActionKind } from "@/lib/orders/ActionModal";

import type {
    CartItem,
    Driver,
    DraftQty,
    NewOrderAddrForm,
    OrderAddressMode,
    OrderCustomerPick,
    OrderFull,
    OrderRow,
    OrderStatus,
    PaymentMethod,
    SavedCustomerAddress,
    Variant,
} from "@/lib/orders/types";

import {
    brlToNumber,
    buildItemsPayload,
    calcTroco,
    cartSubtotal,
    cartTotalPreview,
    escapeHtml,
    formatBRL,
    formatEnderecoLine,
    formatDT,
    ORANGE,
    prettyStatus,
} from "@/lib/orders/helpers";

// ─── helpers puros ───────────────────────────────────────────────────────────

function canCancel(s: string) { return s !== "canceled" && s !== "finalized" && s !== "delivered"; }
function canDeliver(s: string) { return s !== "canceled" && s !== "finalized" && s !== "delivered"; }
function canFinalize(s: string) { return s !== "canceled" && s !== "finalized"; }
function canEdit(s: string) { return s === "new"; }

function addToCartLocal(
    setter: React.Dispatch<React.SetStateAction<CartItem[]>>,
    variant: Variant,
    mode: "unit" | "case",
    qtyToAdd: number
) {
    const qAdd = Math.max(0, qtyToAdd || 0);
    if (qAdd <= 0) return;
    const price = mode === "case" ? Number(variant.case_price ?? 0) : Number(variant.unit_price ?? 0);
    setter((prev) => {
        const idx = prev.findIndex((i) => i.variant.id === variant.id && i.mode === mode);
        if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], qty: copy[idx].qty + qAdd };
            return copy;
        }
        return [...prev, { variant, qty: qAdd, price, mode }];
    });
}

function paymentLabel(pm: string) {
    const labels: Record<string, string> = {
        pix: "Pix", card: "Cartão", cash: "Dinheiro", debit: "Débito",
        credit_installment: "Crédito Parc.", boleto: "Boleto",
        promissoria: "Promissória", cheque: "Cheque", credit: "A Prazo",
    };
    return labels[pm] ?? String(pm || "-");
}

function orderNum(id: string) { return String(id || "").slice(-6).toUpperCase() || "-"; }

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    if (!diff || diff < 0) return "";
    const m = Math.floor(diff / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h} h`;
    return `há ${Math.floor(h / 24)} d`;
}

const STATUS_BADGE: Record<string, string> = {
    new:       "bg-blue-100 text-blue-700",
    delivered: "bg-emerald-100 text-emerald-700",
    finalized: "bg-violet-100 text-violet-700",
    canceled:  "bg-zinc-100 text-zinc-500",
};

const EMPTY_NEW_ORDER_ADDR: NewOrderAddrForm = {
    apelido: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
};

const PAYMENT_BADGE: Record<string, string> = {
    pix:  "bg-green-100 text-green-700",
    card: "bg-purple-100 text-purple-700",
    cash: "bg-amber-100 text-amber-700",
};

// ─── componente principal ─────────────────────────────────────────────────────

export default function PedidosPage() {
    const supabase   = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router       = useRouter();
    const { currentCompanyId: companyId } = useWorkspace();

    // ── orders state ──────────────────────────────────────────────────────────
    const [orders,  setOrders]  = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg,     setMsg]     = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
    const [searchText,   setSearchText]   = useState("");
    const [page,         setPage]         = useState(1);
    const [recentOrders, setRecentOrders] = useState<Record<string, number>>({});
    // IDs com flash ativo (ring verde por ~2s após INSERT ou UPDATE via realtime)
    const [flashOrders,  setFlashOrders]  = useState<Set<string>>(new Set());

    // restore filter from URL or localStorage
    useEffect(() => {
        const s = searchParams.get("status") as OrderStatus | null;
        const valid = ["new", "delivered", "finalized", "canceled", "all"] as const;
        if (s && (valid as readonly string[]).includes(s)) { setStatusFilter(s as any); return; }
        if (typeof window !== "undefined") {
            const saved = window.localStorage.getItem("orders_status_filter") as any;
            if (saved && (valid as readonly string[]).includes(saved)) setStatusFilter(saved);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // ── delivery fee ──────────────────────────────────────────────────────────
    const [deliveryFeeEnabled,     setDeliveryFeeEnabled]     = useState(false);
    const [deliveryFee,            setDeliveryFee]            = useState("0,00");
    const [editDeliveryFeeEnabled, setEditDeliveryFeeEnabled] = useState(false);
    const [editDeliveryFee,        setEditDeliveryFee]        = useState("0,00");

    // ── new order form ────────────────────────────────────────────────────────
    const [openNew,         setOpenNew]         = useState(false);
    const [saving,          setSaving]          = useState(false);
    const [customerName,    setCustomerName]    = useState("");
    const [customerPhone,   setCustomerPhone]   = useState("");
    const [customerAddress, setCustomerAddress] = useState("");

    const [orderCustomers,           setOrderCustomers]           = useState<OrderCustomerPick[]>([]);
    const [orderCustomersLoading,   setOrderCustomersLoading]   = useState(false);
    const [selectedOrderCustomerId, setSelectedOrderCustomerId] = useState<string | null>(null);
    const [orderSavedAddresses,     setOrderSavedAddresses]     = useState<SavedCustomerAddress[]>([]);
    const [orderAddressMode,        setOrderAddressMode]        = useState<OrderAddressMode>("free");
    const [orderSelectedAddrId,     setOrderSelectedAddrId]     = useState<string | null>(null);
    const [newOrderAddrForm,        setNewOrderAddrForm]        = useState<NewOrderAddrForm>(EMPTY_NEW_ORDER_ADDR);
    const [paymentMethod,   setPaymentMethod]   = useState<PaymentMethod>("pix");
    const [paid,            setPaid]            = useState(false);
    const [changeFor,       setChangeFor]       = useState("0,00");
    const [q,               setQ]               = useState("");
    const [results,         setResults]         = useState<Variant[]>([]);
    const [searching,       setSearching]       = useState(false);
    const [draftQty,        setDraftQty]        = useState<Record<string, DraftQty>>({});
    const [cart,            setCart]            = useState<CartItem[]>([]);
    const getDraft     = (id: string): DraftQty => draftQty[id] ?? { unit: "", box: "" };
    const setDraft     = (id: string, p: Partial<DraftQty>) => setDraftQty((prev) => ({ ...prev, [id]: { ...getDraft(id), ...p } }));
    const clearDraft   = (id: string) => setDraftQty((prev) => ({ ...prev, [id]: { unit: "", box: "" } }));

    // ── view modal ────────────────────────────────────────────────────────────
    const [openView,    setOpenView]    = useState(false);
    const [viewLoading, setViewLoading] = useState(false);
    const [viewOrder,   setViewOrder]   = useState<OrderFull | null>(null);

    // ── action modal ──────────────────────────────────────────────────────────
    const [openAction,    setOpenAction]    = useState(false);
    const [actionKind,       setActionKind]       = useState<ActionKind>("cancel");
    const [actionPayMethod,  setActionPayMethod]  = useState<string>("");
    const [actionOrderId, setActionOrderId] = useState<string | null>(null);
    const [actionNote,    setActionNote]    = useState("");
    const [actionSaving,  setActionSaving]  = useState(false);

    // ── edit modal ────────────────────────────────────────────────────────────
    const [openEdit,            setOpenEdit]            = useState(false);
    const [editLoading,         setEditLoading]         = useState(false);
    const [editSaving,          setEditSaving]          = useState(false);
    const [editOrder,           setEditOrder]           = useState<OrderFull | null>(null);
    const [editCustomerName,    setEditCustomerName]    = useState("");
    const [editCustomerPhone,   setEditCustomerPhone]   = useState("");
    const [editCustomerAddress, setEditCustomerAddress] = useState("");
    const [editPaymentMethod,   setEditPaymentMethod]   = useState<PaymentMethod>("pix");
    const [editPaid,            setEditPaid]            = useState(false);
    const [editChangeFor,       setEditChangeFor]       = useState("0,00");
    const [editCart,            setEditCart]            = useState<CartItem[]>([]);
    const [editQ,               setEditQ]               = useState("");
    const [editResults,         setEditResults]         = useState<Variant[]>([]);
    const [editSearching,       setEditSearching]       = useState(false);
    const [editDraftQty,        setEditDraftQty]        = useState<Record<string, DraftQty>>({});
    const getEditDraft   = (id: string): DraftQty => editDraftQty[id] ?? { unit: "", box: "" };
    const setEditDraft   = (id: string, p: Partial<DraftQty>) => setEditDraftQty((prev) => ({ ...prev, [id]: { ...getEditDraft(id), ...p } }));
    const clearEditDraft = (id: string) => setEditDraftQty((prev) => ({ ...prev, [id]: { unit: "", box: "" } }));

    // ── drivers ───────────────────────────────────────────────────────────────
    const [drivers,      setDrivers]      = useState<Driver[]>([]);
    const [driverId,     setDriverId]     = useState<string | null>(null);
    const [editDriverId, setEditDriverId] = useState<string | null>(null);

    // ── whatsapp sending ──────────────────────────────────────────────────────
    const [sendingOutForDelivery,  setSendingOutForDelivery]  = useState(false);
    const [sendingDeliveredMessage, setSendingDeliveredMessage] = useState(false);

    // ── refs for realtime ─────────────────────────────────────────────────────
    const viewOrderIdRef = useRef<string | null>(null);
    const editOrderIdRef = useRef<string | null>(null);

    useEffect(() => { viewOrderIdRef.current = openView  ? viewOrder?.id ?? null : null; }, [openView,  viewOrder?.id]);
    useEffect(() => { editOrderIdRef.current = openEdit  ? editOrder?.id ?? null : null; }, [openEdit,  editOrder?.id]);

    // ── data fetching ─────────────────────────────────────────────────────────
    async function loadCompanySettings(cid: string) {
        const { data: comp } = await supabase
            .from("companies")
            .select("delivery_fee_enabled, default_delivery_fee")
            .eq("id", cid)
            .maybeSingle();
        if (comp) {
            setDeliveryFeeEnabled(!!comp.delivery_fee_enabled);
            setDeliveryFee(formatBRL(Number(comp.default_delivery_fee ?? 0)));
            setEditDeliveryFeeEnabled(!!comp.delivery_fee_enabled);
            setEditDeliveryFee(formatBRL(Number(comp.default_delivery_fee ?? 0)));
        }
    }

    async function loadOrders() {
        setLoading(true);
        setMsg(null);
        const { data, error } = await supabase
            .from("orders")
            .select(`id, status, channel, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address )`)
            .neq("confirmation_status", "pending_confirmation")
            .order("created_at", { ascending: false })
            .limit(500);
        if (error) { setMsg(`Erro ao carregar pedidos: ${error.message}`); setOrders([]); setLoading(false); return; }
        setOrders((Array.isArray(data) ? data : []) as any);
        setLoading(false);
    }

    async function runVariantSearch(text: string, opts: { setText:(v:string)=>void; setResults:(v:Variant[])=>void; setSearching:(v:boolean)=>void; ensureDraft:(ids:string[])=>void; }) {
        const t = text.trim();
        opts.setText(text);
        setMsg(null);
        if (t.length < 2) { opts.setResults([]); return; }
        opts.setSearching(true);
        const { data, error } = await supabase
            .from("view_pdv_produtos")
            .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, codigo_interno, sigla_comercial, volume_formatado, product_name, product_unit_type, product_details, category_name")
            .eq("company_id", companyId)
            .limit(400);

        if (error) { setMsg(`Erro na busca: ${error.message}`); opts.setResults([]); opts.setSearching(false); return; }

        const s = t.toLowerCase();

        const byProduto = new Map<string, any>();
        for (const r of (data ?? []) as any[]) {
            const pid = String(r.produto_id);
            const entry = byProduto.get(pid) ?? {
                id: pid,
                products: { name: r.product_name ?? "", categories: { name: r.category_name ?? "" } },
                tags: [] as string[],
                unitPack: null as any,
                casePack: null as any,
                unit_price: 0,
                details: null as string | null,
                unit: r.product_unit_type ?? null,
                is_active: true,
                codigo_interno: null as string | null,
            };

            if (r.tags) entry.tags.push(String(r.tags));
            const sig = String(r.sigla_comercial ?? "").toUpperCase();
            if (sig === "UN") { entry.unitPack = r; entry.codigo_interno = r.codigo_interno ?? null; }
            if (sig === "CX") entry.casePack = r;
            byProduto.set(pid, entry);
        }

        const variants: Variant[] = Array.from(byProduto.values()).map((e: any) => {
            const unitPack = e.unitPack ?? e.casePack;
            const casePack = e.casePack;
            return {
                id: String(e.id),
                unit_price: Number(unitPack?.preco_venda ?? 0),
                has_case: Boolean(casePack),
                case_qty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
                case_price: casePack ? Number(casePack.preco_venda ?? 0) : null,
                unit: e.unit ?? null,
                volume_value: null,
                details: [unitPack?.descricao, unitPack?.volume_formatado].filter(Boolean).join(" ") || e.products?.name || null,
                tags: e.tags.filter(Boolean).join(","),
                is_active: e.is_active,
                codigo_interno: e.codigo_interno ?? null,
                unit_embalagem_id: unitPack?.id ? String(unitPack.id) : null,
                case_embalagem_id: casePack?.id ? String(casePack.id) : null,
                products: e.products,
            };
        });

        const filtered = variants.filter((v) => {
            const cat   = v.products?.categories?.name?.toLowerCase() ?? "";
            const det   = String(v.details ?? "").toLowerCase();
            const unit  = String(v.unit ?? "").toLowerCase();
            const internal = (v.codigo_interno ?? "").toLowerCase();
            const tags = (v.tags ?? "").toLowerCase();
            return [cat, det, unit, internal, tags].some((x) => x.includes(s));
        });

        const top = filtered.slice(0, 40);
        opts.setResults(top);
        opts.ensureDraft(top.map((x) => x.id));
        opts.setSearching(false);
    }

    async function loadDrivers(cid: string) {
        const { data } = await supabase
            .from("drivers")
            .select("id, company_id, name, phone, vehicle, plate, is_active")
            .eq("company_id", cid)
            .eq("is_active", true)
            .order("name");
        if (data) setDrivers(data as Driver[]);
    }

    async function fetchOrderSavedAddresses(customerId: string) {
        const { data } = await supabase
            .from("enderecos_cliente")
            .select("id,apelido,logradouro,numero,complemento,bairro,cidade,estado,cep,is_principal")
            .eq("customer_id", customerId)
            .order("is_principal", { ascending: false });
        const list = (data as SavedCustomerAddress[]) ?? [];
        setOrderSavedAddresses(list);
        if (list.length > 0) {
            setOrderAddressMode("saved");
            const first = list.find((a) => a.is_principal) ?? list[0];
            setOrderSelectedAddrId(first.id);
            setCustomerAddress(formatEnderecoLine(first));
        } else {
            setOrderAddressMode("new");
            setOrderSelectedAddrId(null);
            setCustomerAddress("");
            setNewOrderAddrForm(EMPTY_NEW_ORDER_ADDR);
        }
    }

    async function handleSelectOrderCustomer(id: string | null) {
        setSelectedOrderCustomerId(id);
        setMsg(null);
        if (!id) {
            setOrderSavedAddresses([]);
            setOrderAddressMode("free");
            setOrderSelectedAddrId(null);
            setCustomerName("");
            setCustomerPhone("");
            setCustomerAddress("");
            setNewOrderAddrForm(EMPTY_NEW_ORDER_ADDR);
            return;
        }
        const { data: row } = await supabase.from("customers").select("name,phone").eq("id", id).maybeSingle();
        if (row) {
            setCustomerName(row.name ?? "");
            setCustomerPhone(row.phone ?? "");
        }
        await fetchOrderSavedAddresses(id);
    }

    useEffect(() => {
        if (!openNew || !companyId) return;
        let cancelled = false;
        (async () => {
            setOrderCustomersLoading(true);
            const { data } = await supabase
                .from("customers")
                .select("id,name,phone")
                .eq("company_id", companyId)
                .order("name", { ascending: true, nullsFirst: false })
                .limit(500);
            if (!cancelled) {
                setOrderCustomers((data as OrderCustomerPick[]) ?? []);
                setOrderCustomersLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [openNew, companyId, supabase]);

    useEffect(() => {
        if (selectedOrderCustomerId && orderAddressMode === "saved" && orderSelectedAddrId) {
            const e = orderSavedAddresses.find((a) => a.id === orderSelectedAddrId);
            if (e) setCustomerAddress(formatEnderecoLine(e));
        }
    }, [selectedOrderCustomerId, orderAddressMode, orderSelectedAddrId, orderSavedAddresses]);

    async function upsertCustomerFromFields(nameRaw: string, phoneRaw: string, addressRaw: string): Promise<string | null> {
        const phone   = phoneRaw.trim();
        const name    = nameRaw.trim();
        const address = addressRaw.trim();
        if (!phone || phone.length < 8) { setMsg("Informe um telefone válido."); return null; }
        if (!name) { setMsg("Informe o nome do cliente."); return null; }
        const { data: found, error: findErr } = await supabase
            .from("customers")
            .select("id,name,phone,address")
            .eq("company_id", companyId as string)
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();
        if (findErr) { setMsg(`Erro ao buscar cliente: ${findErr.message}`); return null; }
        if (found?.id) {
            const { error: upErr } = await supabase.from("customers").update({ name, address: address || null }).eq("id", found.id);
            if (upErr) { setMsg(`Erro ao atualizar cliente: ${upErr.message}`); return null; }
            return found.id as string;
        }
        const { data: created, error: insErr } = await supabase.from("customers").insert({ name, phone, address: address || null, company_id: companyId }).select("id").single();
        if (insErr) { setMsg(`Erro ao criar cliente: ${insErr.message}`); return null; }
        return created.id as string;
    }

    /** Acende o ring verde numa linha por 2 segundos e depois apaga */
    function flashRow(orderId: string) {
        setFlashOrders((prev) => new Set([...prev, orderId]));
        setTimeout(() => {
            setFlashOrders((prev) => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
        }, 2000);
    }

    /** Busca uma única linha de pedido (sem itens) para update cirúrgico na lista */
    async function fetchOrderRow(orderId: string): Promise<OrderRow | null> {
        const { data } = await supabase
            .from("orders")
            .select(`id, status, channel, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address )`)
            .eq("id", orderId)
            .maybeSingle();
        return data as OrderRow | null;
    }

    async function fetchOrderFull(orderId: string): Promise<OrderFull | null> {
        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .select(`id, status, confirmation_status, channel, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address ), drivers ( id, name, vehicle, plate )`)
            .eq("id", orderId)
            .single();
        if (ordErr) { setMsg(`Erro ao carregar pedido: ${ordErr.message}`); return null; }
        const { data: items, error: itemsErr } = await supabase
            .from("order_items")
            .select(`id, order_id, produto_embalagem_id, product_name, quantity, unit_type, unit_price, line_total, created_at, qty`)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });
        if (itemsErr) { setMsg(`Erro ao carregar itens: ${itemsErr.message}`); return null; }
        const mappedItems = (Array.isArray(items) ? items : []).map((it: any) => {
            return {
                ...it,
                qty: it?.qty ?? it?.quantity ?? 0,
                quantity: it?.quantity ?? it?.qty ?? 0,
            };
        });
        return { ...(ord as any), items: mappedItems as any };
    }

    async function openOrder(orderId: string, alsoCleanUrl?: boolean) {
        setViewLoading(true);
        setMsg(null);
        const full = await fetchOrderFull(orderId);
        setViewOrder(full);
        setOpenView(true);
        setViewLoading(false);
        if (alsoCleanUrl) router.replace("/pedidos");
    }

    useEffect(() => {
        if (companyId) {
            loadCompanySettings(companyId);
            loadDrivers(companyId);
        }
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    useEffect(() => {
        const id = searchParams.get("open");
        if (!id) return;
        if (viewOrder?.id === id && openView) return;
        openOrder(id, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        const id = searchParams.get("edit");
        if (!id) return;
        if (editOrder?.id === id && openEdit) return;
        openEditOrder(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // ── realtime ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const ch = supabase
            .channel("realtime-orders-admin-v3")

            // ── orders: INSERT → topo da lista | UPDATE → substituição cirúrgica
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload: any) => {
                console.log("Mudança detectada no Realtime [orders]:", payload);
                try {
                    const eventType = payload.eventType as string;
                    const orderId   = (payload?.new?.id ?? payload?.old?.id ?? null) as string | null;
                    if (!orderId) return;

                    if (eventType === "INSERT") {
                        const row = await fetchOrderRow(orderId);
                        if (row) {
                            setOrders((prev) => [row, ...prev]);
                            setRecentOrders((prev) => ({ ...prev, [orderId]: Date.now() }));
                            flashRow(orderId);
                        }
                    } else if (eventType === "UPDATE") {
                        const row = await fetchOrderRow(orderId);
                        if (row) {
                            setOrders((prev) => prev.map((o) => o.id === orderId ? row : o));
                            flashRow(orderId);
                        }
                        // Re-hidrata modais abertos para o mesmo pedido
                        if (viewOrderIdRef.current === orderId) setViewOrder(await fetchOrderFull(orderId));
                        if (editOrderIdRef.current === orderId) setEditOrder(await fetchOrderFull(orderId));
                    }
                } catch { /* ignore */ }
            })

            // ── order_items: só atualiza modais abertos (não toca na lista)
            .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, async (payload: any) => {
                console.log("Mudança detectada no Realtime [order_items]:", payload);
                try {
                    const orderId = (payload?.new?.order_id ?? payload?.old?.order_id ?? null) as string | null;
                    if (!orderId) return;
                    if (viewOrderIdRef.current === orderId) setViewOrder(await fetchOrderFull(orderId));
                    if (editOrderIdRef.current === orderId) setEditOrder(await fetchOrderFull(orderId));
                } catch { /* ignore */ }
            })

            .subscribe((status) => {
                console.log("[Pedidos Realtime] status do canal:", status);
            });

        return () => { supabase.removeChannel(ch); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase]);

    // ── order actions ─────────────────────────────────────────────────────────
    function resetNewOrder() {
        setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
        setSelectedOrderCustomerId(null);
        setOrderSavedAddresses([]);
        setOrderAddressMode("free");
        setOrderSelectedAddrId(null);
        setNewOrderAddrForm(EMPTY_NEW_ORDER_ADDR);
        setPaymentMethod("pix"); setPaid(false); setChangeFor("0,00");
        setCart([]); setQ(""); setResults([]); setDraftQty({}); setMsg(null);
        setDriverId(null);
    }

    function openActionModal(kind: ActionKind, orderId: string) {
        // Pre-fill payment method from the order if available
        const ord = orders.find(o => o.id === orderId);
        setActionPayMethod((ord as any)?.payment_method ?? "pix");
        setActionKind(kind); setActionOrderId(orderId); setActionNote(""); setOpenAction(true);
    }

    async function runAction() {
        const orderId = actionOrderId;
        if (!orderId) return;
        const note = actionNote.trim();
        if (!note && actionKind === "cancel") { setMsg("Informe uma observação para essa ação."); return; }
        setActionSaving(true); setMsg(null);
        const newStatus: OrderStatus = actionKind === "cancel" ? "canceled" : actionKind === "deliver" ? "delivered" : "finalized";
        const { error } = await supabase.from("orders")
            .update({ status: newStatus, details: note || null, ...(actionPayMethod ? { payment_method: actionPayMethod } : {}) })
            .eq("id", orderId);
        if (error) { setMsg(`Erro ao atualizar status: ${error.message}`); setActionSaving(false); return; }

        // Registrar em financial_entries ao finalizar ou entregar
        if ((actionKind === "finalize" || actionKind === "deliver") && companyId) {
            const ord = orders.find(o => o.id === orderId);
            const totalAmt = Number((ord as any)?.total_amount ?? 0);
            if (totalAmt > 0) {
                const { error: feErr } = await supabase.from("financial_entries").insert({
                    company_id:     companyId,
                    order_id:       orderId,
                    type:           "income",
                    amount:         totalAmt,
                    payment_method: actionPayMethod || (ord as any)?.payment_method || "pix",
                    description:    `Pedido #${orderId.slice(0,8)} — ${note || ""}`.trim().replace(/— $/, ""),
                    reference_date: new Date().toISOString().slice(0, 10),
                });
                if (feErr) console.warn("[runAction] financial_entries:", feErr.message);
            }
        }

        setMsg("✅ Pedido atualizado.");
        setOpenAction(false); setActionSaving(false);
        await loadOrders();
        if (viewOrder?.id === orderId) setViewOrder(await fetchOrderFull(orderId));
        if (editOrder?.id  === orderId) setEditOrder(await fetchOrderFull(orderId));
    }

    async function createOrder() {
        if (cart.length === 0) { setMsg("Adicione pelo menos 1 item no pedido."); return; }
        if (!companyId) { setMsg("Nenhuma empresa ativa selecionada."); return; }
        setSaving(true); setMsg(null);

        let customerId: string | null = selectedOrderCustomerId;
        let addressForOrder = customerAddress.trim();

        if (customerId) {
            if (!customerName.trim() || !customerPhone.trim()) {
                setMsg("Cliente sem nome ou telefone.");
                setSaving(false);
                return;
            }
            if (orderAddressMode === "saved") {
                if (orderSavedAddresses.length === 0) {
                    setMsg("Este cliente não tem endereço salvo. Escolha “Salvar novo endereço” ou “Texto livre”.");
                    setSaving(false);
                    return;
                }
                if (!orderSelectedAddrId) {
                    setMsg("Selecione um endereço salvo.");
                    setSaving(false);
                    return;
                }
                const e = orderSavedAddresses.find((a) => a.id === orderSelectedAddrId);
                if (!e) {
                    setMsg("Endereço selecionado não encontrado.");
                    setSaving(false);
                    return;
                }
                addressForOrder = formatEnderecoLine(e);
            } else if (orderAddressMode === "new") {
                const f = newOrderAddrForm;
                if (!f.logradouro?.trim()) {
                    setMsg("Informe o logradouro do novo endereço.");
                    setSaving(false);
                    return;
                }
                const { error: addrErr } = await supabase.from("enderecos_cliente").insert({
                    company_id:  companyId,
                    customer_id: customerId,
                    apelido:     f.apelido.trim() || "Entrega",
                    logradouro:  f.logradouro.trim() || null,
                    numero:      f.numero.trim() || null,
                    complemento: f.complemento.trim() || null,
                    bairro:      f.bairro.trim() || null,
                    cidade:      f.cidade.trim() || null,
                    estado:      f.estado.trim() || null,
                    cep:         f.cep.trim() || null,
                    is_principal: orderSavedAddresses.length === 0,
                });
                if (addrErr) {
                    setMsg(`Erro ao salvar endereço: ${addrErr.message}`);
                    setSaving(false);
                    return;
                }
                addressForOrder = formatEnderecoLine(f);
            }
            const { error: upErr } = await supabase
                .from("customers")
                .update({
                    name: customerName.trim(),
                    phone: customerPhone.trim(),
                    address: addressForOrder || null,
                })
                .eq("id", customerId);
            if (upErr) {
                setMsg(`Erro ao atualizar cliente: ${upErr.message}`);
                setSaving(false);
                return;
            }
        } else {
            const createdId = await upsertCustomerFromFields(customerName, customerPhone, customerAddress);
            if (!createdId) { setSaving(false); return; }
            customerId = createdId;
        }
        const fee    = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
        const change = paymentMethod === "cash" ? brlToNumber(changeFor) : null;
        const total  = cartSubtotal(cart) + fee;
        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .insert({ company_id: companyId, customer_id: customerId, channel: "admin", status: "new", payment_method: paymentMethod, paid, change_for: change, delivery_fee: fee, total_amount: total, details: null, driver_id: driverId || null })
            .select("id").single();
        if (ordErr) { setMsg(`Erro ao criar pedido: ${ordErr.message}`); setSaving(false); return; }
        const { error: itemsErr } = await supabase.from("order_items").insert(buildItemsPayload(ord.id, companyId, cart));
        if (itemsErr) { setMsg(`Erro ao salvar itens: ${itemsErr.message}`); setSaving(false); return; }
        setSaving(false); setOpenNew(false); resetNewOrder(); await loadOrders();
    }

    async function openEditOrder(orderId: string) {
        setEditLoading(true); setMsg(null);
        const full = await fetchOrderFull(orderId);
        if (!full) { setEditLoading(false); return; }
        setEditOrder(full);
        setEditCustomerName((full as any).customers?.name ?? "");
        setEditCustomerPhone((full as any).customers?.phone ?? "");
        setEditCustomerAddress((full as any).customers?.address ?? "");
        setEditPaymentMethod((full as any).payment_method);
        setEditPaid(!!(full as any).paid);
        setEditChangeFor(formatBRL(Number((full as any).change_for ?? 0)));
        const feeVal = Number((full as any).delivery_fee ?? 0);
        setEditDeliveryFeeEnabled(feeVal > 0);
        setEditDeliveryFee(formatBRL(feeVal));
        const mapped: CartItem[] = ((full as any).items ?? []).map((it: any) => ({
            variant: {
                id: it.produto_embalagem_id ?? `legacy-${it.id}`,
                unit_price: Number(it.unit_price ?? 0),
                has_case: false,
                case_price: null,
                case_qty: null,
                unit: it.unit_type ?? "none",
                volume_value: null,
                details: it.product_name ?? null,
                is_active: true,
                unit_embalagem_id: it.unit_type === "unit" ? (it.produto_embalagem_id ?? null) : null,
                case_embalagem_id: it.unit_type === "case" ? (it.produto_embalagem_id ?? null) : null,
                products: { categories: { name: "" } },
            } as Variant,
            qty: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
            price: Number(it.unit_price ?? 0),
            mode: it.unit_type === "case" ? "case" : "unit",
        }));
        setEditDriverId((full as any).driver_id ?? null);
        setEditCart(mapped); setEditQ(""); setEditResults([]); setEditDraftQty({});
        setOpenEdit(true); setEditLoading(false);
    }

    async function saveEditOrder() {
        if (!editOrder) return;
        if (editCart.length === 0) { setMsg("O pedido precisa ter pelo menos 1 item."); return; }
        setEditSaving(true); setMsg(null);
        const customerId = await upsertCustomerFromFields(editCustomerName, editCustomerPhone, editCustomerAddress);
        if (!customerId) { setEditSaving(false); return; }
        const fee    = editDeliveryFeeEnabled ? brlToNumber(editDeliveryFee) : 0;
        const change = editPaymentMethod === "cash" ? brlToNumber(editChangeFor) : null;
        const total  = cartSubtotal(editCart) + fee;
        const { error: upErr } = await supabase.from("orders").update({ customer_id: customerId, payment_method: editPaymentMethod, paid: editPaid, change_for: change, delivery_fee: fee, total_amount: total, driver_id: editDriverId || null }).eq("id", editOrder.id);
        if (upErr) { setMsg(`Erro ao atualizar pedido: ${upErr.message}`); setEditSaving(false); return; }
        const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", editOrder.id);
        if (delErr) { setMsg(`Erro ao apagar itens: ${delErr.message}`); setEditSaving(false); return; }
        if (!companyId) { setMsg("Nenhuma empresa ativa selecionada."); setEditSaving(false); return; }
        const { error: insErr } = await supabase.from("order_items").insert(buildItemsPayload(editOrder.id, companyId, editCart));
        if (insErr) { setMsg(`Erro ao inserir itens: ${insErr.message}`); setEditSaving(false); return; }
        setMsg("✅ Pedido editado com sucesso."); setEditSaving(false); setOpenEdit(false);
        await loadOrders();
        if (viewOrder?.id === editOrder.id) setViewOrder(await fetchOrderFull(editOrder.id));
    }

    async function callReprint(orderId: string) {
        try {
            await fetch("/api/agent/reprint", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ order_id: orderId }),
            });
        } catch { /* silent — print job is best-effort */ }
    }

    async function createOrderAndPrint() {
        if (cart.length === 0) { setMsg("Adicione pelo menos 1 item no pedido."); return; }
        if (!companyId) { setMsg("Nenhuma empresa ativa selecionada."); return; }
        setSaving(true); setMsg(null);

        let customerId: string | null = selectedOrderCustomerId;
        let addressForOrder = customerAddress.trim();

        if (customerId) {
            if (!customerName.trim() || !customerPhone.trim()) { setMsg("Cliente sem nome ou telefone."); setSaving(false); return; }
            if (orderAddressMode === "saved") {
                if (orderSavedAddresses.length === 0) { setMsg("Este cliente não tem endereço salvo."); setSaving(false); return; }
                if (!orderSelectedAddrId) { setMsg("Selecione um endereço salvo."); setSaving(false); return; }
                const e = orderSavedAddresses.find((a) => a.id === orderSelectedAddrId);
                if (!e) { setMsg("Endereço selecionado não encontrado."); setSaving(false); return; }
                addressForOrder = formatEnderecoLine(e);
            } else if (orderAddressMode === "new") {
                const f = newOrderAddrForm;
                if (!f.logradouro?.trim()) { setMsg("Informe o logradouro do novo endereço."); setSaving(false); return; }
                const { error: addrErr } = await supabase.from("enderecos_cliente").insert({
                    company_id: companyId, customer_id: customerId,
                    apelido: f.apelido.trim() || "Entrega", logradouro: f.logradouro.trim() || null,
                    numero: f.numero.trim() || null, complemento: f.complemento.trim() || null,
                    bairro: f.bairro.trim() || null, cidade: f.cidade.trim() || null,
                    estado: f.estado.trim() || null, cep: f.cep.trim() || null,
                    is_principal: orderSavedAddresses.length === 0,
                });
                if (addrErr) { setMsg(`Erro ao salvar endereço: ${addrErr.message}`); setSaving(false); return; }
                addressForOrder = formatEnderecoLine(f);
            }
            await supabase.from("customers").update({ name: customerName.trim(), phone: customerPhone.trim(), address: addressForOrder || null }).eq("id", customerId);
        } else {
            const createdId = await upsertCustomerFromFields(customerName, customerPhone, customerAddress);
            if (!createdId) { setSaving(false); return; }
            customerId = createdId;
        }

        const fee    = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
        const change = paymentMethod === "cash" ? brlToNumber(changeFor) : null;
        const total  = cartSubtotal(cart) + fee;

        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .insert({ company_id: companyId, customer_id: customerId, channel: "admin", status: "new", payment_method: paymentMethod, paid, change_for: change, delivery_fee: fee, total_amount: total, details: null, driver_id: driverId || null })
            .select("id").single();
        if (ordErr) { setMsg(`Erro ao criar pedido: ${ordErr.message}`); setSaving(false); return; }

        const { error: itemsErr } = await supabase.from("order_items").insert(buildItemsPayload(ord.id, companyId, cart));
        if (itemsErr) { setMsg(`Erro ao salvar itens: ${itemsErr.message}`); setSaving(false); return; }

        // Usa reprint explícito (source='reprint') — não depende do trigger de confirmation_status
        // para evitar dupla impressão quando trigger antigo (status='new') ainda coexiste
        await callReprint(ord.id);
        setSaving(false); setOpenNew(false); resetNewOrder(); await loadOrders();
    }

    async function saveEditAndPrint() {
        if (!editOrder) return;
        await saveEditOrder();
        // saveEditOrder closes the modal on success — call reprint after
        await callReprint(editOrder.id);
    }

    async function sendWhatsAppForCurrentOrder(kind: "out_for_delivery" | "delivered_message") {
        const ord = viewOrder;
        if (!ord || !ord.customers?.phone) { setMsg("Telefone do cliente não encontrado."); return; }
        const phone = String(ord.customers.phone).trim();
        if (!phone.startsWith("+")) { setMsg("Telefone precisa estar em formato internacional (+55...)."); return; }
        const name = (ord.customers.name || "").trim();
        const text = kind === "out_for_delivery"
            ? `Ótima notícia${name ? `, ${name}` : ""}: seu pedido já está com nosso entregador e a caminho de você! 🛵💨`
            : `Confirmamos que seu pedido foi entregue${name ? `, ${name}` : ""}! 🎉 Esperamos que tenha chegado tudo certinho. Qualquer coisa, é só chamar!`;
        try {
            if (kind === "out_for_delivery") setSendingOutForDelivery(true); else setSendingDeliveredMessage(true);
            setMsg(null);
            const res = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to_phone_e164: phone, kind: "text", text }) });
            if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(`Erro WhatsApp: ${d?.error || res.statusText}`); return; }
            setMsg("✅ Mensagem enviada no WhatsApp.");
        } catch (err: any) {
            setMsg(`Erro WhatsApp: ${String(err?.message ?? err)}`);
        } finally {
            if (kind === "out_for_delivery") setSendingOutForDelivery(false); else setSendingDeliveredMessage(false);
        }
    }

    // ── print ─────────────────────────────────────────────────────────────────
    async function printOrder(orderId: string) {
        const full = await fetchOrderFull(orderId);
        if (!full) return;
        const pm        = (full as any).payment_method as string;
        const paidFlag  = !!(full as any).paid;
        const pmLabel   = paymentLabel(pm);
        const total     = Number((full as any).total_amount ?? 0);
        const custPays  = Number((full as any).change_for ?? 0);
        const troco     = calcTroco(total, custPays);
        const cust      = (full as any).customers;
        const driver    = (full as any).drivers as { name?: string; vehicle?: string; plate?: string } | null;

        const qtyDisplay = (it: any) => {
            const q = Number(it.quantity ?? it.qty ?? 0);
            if (String(it.unit_type ?? "unit") === "case") {
                return `cx × ${q}`;
            }
            return `${q} unidades`;
        };

        const rows = (full.items ?? []).map((it: any) => {
            const q = Number(it.quantity ?? it.qty ?? 0);
            const p = Number(it.unit_price ?? 0);
            const t = Number(it.line_total ?? q * p);
            return `<tr><td>${escapeHtml(it.product_name ?? "Item")}</td><td style="text-align:right">${escapeHtml(qtyDisplay(it))}</td><td style="text-align:right">R$ ${formatBRL(p)}</td><td style="text-align:right">R$ ${formatBRL(t)}</td></tr>`;
        }).join("");

        let payExtra = "";
        if (pm === "card" || pm === "pix") payExtra = `<div class="s">Levar maquininha</div>`;
        else if (pm === "cash") payExtra = `<div class="s">${custPays > 0 ? `Troco p/ R$ ${formatBRL(custPays)}` : "Troco p/: -"}</div><div class="s">Levar de troco: R$ ${formatBRL(troco)}</div>`;

        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) { setMsg("Erro: popup bloqueado."); return; }
        w.document.open();
        const driverLine = driver?.name
            ? `<div style="margin-top:4px"><b>Entregador:</b> <b>${escapeHtml(driver.name)}</b>${driver.vehicle ? ` • ${escapeHtml(driver.vehicle)}` : ""}${driver.plate ? ` (${escapeHtml(driver.plate)})` : ""}</div>`
            : "";

        w.document.write(`<html><head><meta charset="utf-8"><style>body{font-family:Arial;font-size:12px;padding:12px}.s{font-weight:900}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:6px}th{background:#f5f5f5;text-align:left}.obs{border:1px solid #ddd;border-radius:10px;padding:8px;margin-top:10px;font-weight:900;color:${ORANGE}}@media print{button{display:none}}</style></head><body><button onclick="window.print()" style="padding:6px 8px;border:1px solid #999;border-radius:10px;cursor:pointer">Imprimir</button><h1 style="font-size:16px;margin:8px 0">Pedido • ${new Date(full.created_at).toLocaleString("pt-BR")}</h1><div><b>Status:</b> ${escapeHtml(prettyStatus(String((full as any).status)))}</div><div><b>Cliente:</b> <b>${escapeHtml(cust?.name ?? "-")}</b> • <b>${escapeHtml(cust?.phone ?? "")}</b></div><div><b>Endereço:</b> <b>${escapeHtml(cust?.address ?? "-")}</b></div>${driverLine}<div style="margin-top:6px"><b>Pagamento:</b> <b>${escapeHtml(pmLabel)}</b>${paidFlag ? " <b>(pago)</b>" : ""}${payExtra}</div>${(full as any).details ? `<div class="obs">OBS: ${escapeHtml(String((full as any).details))}</div>` : ""}<table><thead><tr><th>Item</th><th style="text-align:right">Qtd</th><th style="text-align:right">Preço</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows || "<tr><td colspan=4>Sem itens</td></tr>"}</tbody></table><div style="margin-top:10px"><div style="display:flex;justify-content:space-between"><span>Taxa entrega</span><b>R$ ${formatBRL((full as any).delivery_fee ?? 0)}</b></div><div style="display:flex;justify-content:space-between;font-size:14px"><span>Total</span><b>R$ ${formatBRL((full as any).total_amount ?? 0)}</b></div></div><script>setTimeout(()=>window.print(),200)<\/script></body></html>`);
        w.document.close();
    }

    // ── computed ──────────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const by = { new: 0, delivered: 0, finalized: 0, canceled: 0 } as Record<OrderStatus, number>;
        for (const o of orders) { const s = String(o.status) as OrderStatus; if ((by as any)[s] !== undefined) (by as any)[s]++; }
        return { total: orders.length, ...by };
    }, [orders]);

    const summary = useMemo(() => {
        let novosQtd = 0, novosTotal = 0, prepQtd = 0, entregaQtd = 0, finalHojeQtd = 0, finalHojeTotal = 0;
        const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
        for (const o of orders) {
            const st = String(o.status);
            const tot = Number((o as any).total_amount ?? 0);
            if (st === "new") { novosQtd++; novosTotal += tot; if (!(o as any).paid) prepQtd++; }
            if (st === "delivered") entregaQtd++;
            if (st === "finalized" && new Date(o.created_at) >= startDay) { finalHojeQtd++; finalHojeTotal += tot; }
        }
        return { novosQtd, novosTotal, prepQtd, entregaQtd, finalHojeQtd, finalHojeTotal };
    }, [orders]);

    const filteredOrders = useMemo(() => {
        if (typeof window !== "undefined") window.localStorage.setItem("orders_status_filter", statusFilter);
        const priority: Record<string, number> = { new: 0, delivered: 1, finalized: 2, canceled: 3 };
        const byStatus = statusFilter === "all" ? orders : orders.filter((o) => String(o.status) === statusFilter);
        const sq = searchText.trim().toLowerCase();
        const base = !sq ? byStatus : byStatus.filter((o) => {
            return [(o.customers?.name ?? ""), (o.customers?.phone ?? ""), (o.customers?.address ?? "")].some(v => v.toLowerCase().includes(sq));
        });
        return [...base].sort((a, b) => {
            const pa = priority[String(a.status)] ?? 99, pb = priority[String(b.status)] ?? 99;
            if (pa !== pb) return pa - pb;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    }, [orders, statusFilter, searchText]);

    // ── paginação ─────────────────────────────────────────────────────────────
    const totalPages  = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
    const safePage    = Math.min(page, totalPages);
    const pagedOrders = filteredOrders.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    // Reset para página 1 sempre que filtro ou busca mudar
    useEffect(() => { setPage(1); }, [statusFilter, searchText]);

    const newTotalNow      = useMemo(() => cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee), [cart, deliveryFeeEnabled, deliveryFee]);
    const newCustomerPays  = useMemo(() => brlToNumber(changeFor), [changeFor]);
    const newTroco         = useMemo(() => calcTroco(newTotalNow, newCustomerPays), [newTotalNow, newCustomerPays]);
    const editTotalNow     = useMemo(() => cartTotalPreview(editCart, editDeliveryFeeEnabled, editDeliveryFee), [editCart, editDeliveryFeeEnabled, editDeliveryFee]);
    const editCustomerPays = useMemo(() => brlToNumber(editChangeFor), [editChangeFor]);
    const editTroco        = useMemo(() => calcTroco(editTotalNow, editCustomerPays), [editTotalNow, editCustomerPays]);

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-4 min-h-full">

            {/* ── HEADER ── */}
            <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-purple-900 px-5 py-4 shadow-md">
                <div>
                    <h1 className="text-lg font-bold text-white">Pedidos</h1>
                    <p className="hidden text-xs text-purple-200 mt-0.5 sm:block">
                        Gerencie pedidos em tempo real, com ações rápidas e WhatsApp.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadOrders}
                        className="flex items-center gap-1.5 rounded-lg border border-purple-400 bg-purple-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors"
                    >
                        <RefreshCcw className="h-3 w-3" />
                        Recarregar
                    </button>
                    <button
                        onClick={() => { resetNewOrder(); setOpenNew(true); }}
                        className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-orange-600 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Novo pedido
                    </button>
                </div>
            </header>

            {/* ── MSG ── */}
            {msg && (
                <div className={`rounded-lg border px-4 py-2 text-xs font-medium ${msg.startsWith("✅") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                    {msg}
                </div>
            )}

            {/* ── SUMMARY CARDS ── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {/* Novos */}
                <button
                    onClick={() => setStatusFilter("new")}
                    className={`rounded-xl border-l-4 border-orange-400 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:bg-zinc-900 dark:hover:bg-zinc-800 ${statusFilter === "new" ? "ring-2 ring-orange-300" : ""}`}
>
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Novos pedidos</p>
                            <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{summary.novosQtd}</p>
                            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">R$ {formatBRL(summary.novosTotal)}</p>
                        </div>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-500/10">
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                        </span>
                    </div>
                </button>

                {/* Em preparação */}
                <div className="rounded-xl border-l-4 border-purple-500 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:bg-zinc-900 dark:hover:bg-zinc-800">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Em preparação</p>
                            <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{summary.prepQtd}</p>
                            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">Aguardando pagamento</p>
                        </div>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-50 dark:bg-purple-500/10">
                            <Package className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </span>
                    </div>
                </div>

                {/* Em entrega */}
                <button
                    onClick={() => setStatusFilter("delivered")}
                    className={`rounded-xl border-l-4 border-sky-400 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:bg-zinc-900 dark:hover:bg-zinc-800 ${statusFilter === "delivered" ? "ring-2 ring-sky-300" : ""}`}
>
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Em entrega</p>
                            <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{summary.entregaQtd}</p>
                            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">Pedidos entregues</p>
                        </div>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-500/10">
                            <Bike className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                        </span>
                    </div>
                </button>

                {/* Finalizados hoje */}
                <button
                    onClick={() => setStatusFilter("finalized")}
                    className={`rounded-xl border-l-4 border-emerald-500 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:bg-zinc-900 dark:hover:bg-zinc-800 ${statusFilter === "finalized" ? "ring-2 ring-emerald-300" : ""}`}
>
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Faturamento (hoje)</p>
                            <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">R$ {formatBRL(summary.finalHojeTotal)}</p>
                            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{summary.finalHojeQtd} pedidos</p>
                        </div>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </span>
                    </div>
                </button>
            </div>

            {/* ── SEARCH BAR ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                        type="text"
                        placeholder="Buscar por nome, telefone ou endereço..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-purple-500"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    {(["all", "new", "delivered", "finalized", "canceled"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f)}
                            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                                statusFilter === f
                                    ? "bg-purple-800 text-white"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                            }`}
                        >
                            {f === "all" ? `Todos (${stats.total})` : f === "new" ? `Novos (${stats.new})` : f === "delivered" ? `Entregues (${stats.delivered})` : f === "finalized" ? `Finalizados (${stats.finalized})` : `Cancelados (${stats.canceled})`}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── ORDER LIST ── */}
            <div className="rounded-xl border border-zinc-100 bg-white shadow-sm overflow-hidden dark:border-zinc-800 dark:bg-zinc-900">
                {loading ? (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-5 py-4 bg-white dark:bg-zinc-900">
                                <div className="h-4 w-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                <div className="flex flex-1 flex-col gap-2">
                                    <div className="h-4 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                                    <div className="h-3 w-28 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800/60" />
                                </div>
                                <div className="h-6 w-16 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                            </div>
                        ))}
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-600">
                        <Package className="mb-3 h-8 w-8" />
                        <p className="text-sm font-medium">Nenhum pedido encontrado</p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {/* ── Sticky column header ── */}
                        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2.5 sm:gap-4 sm:px-5 dark:border-zinc-800 dark:bg-zinc-900/95 backdrop-blur">
                            <div className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                Pedido
                            </div>
                            <div className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                Cliente
                            </div>
                            <div className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 sm:block">
                                Pagamento
                            </div>
                            <div className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                Status
                            </div>
                            <div className="w-16 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-400 sm:w-28 dark:text-zinc-500">
                                Valor
                            </div>
                            <div className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                Ações
                            </div>
                        </div>

                        {pagedOrders.map((o) => {
                            const st         = String(o.status);
                            const num        = orderNum(o.id);
                            const name       = o.customers?.name ?? "-";
                            const phone      = o.customers?.phone ?? "";
                            const addr       = o.customers?.address ?? "-";
                            const pmStr      = paymentLabel(String((o as any).payment_method ?? ""));
                            const obs        = (o.details ?? "").trim();
                            const recentTs   = recentOrders[o.id];
                            const isRecent   = !!recentTs && Date.now() - recentTs < 60000;
                            const isFlashing = flashOrders.has(o.id);
                            const source     = String((o as any).source ?? (o as any).channel ?? "");
                            const SOURCE_BADGE: Record<string, string> = {
                                chatbot:  "bg-emerald-100 text-emerald-700",
                                whatsapp: "bg-emerald-100 text-emerald-700",
                                pdv:      "bg-orange-100 text-orange-700",
                                balcao:   "bg-orange-100 text-orange-700",
                                ui_order: "bg-blue-100 text-blue-700",
                                admin:    "bg-blue-100 text-blue-700",
                            };
                            const SOURCE_LABEL: Record<string, string> = {
                                chatbot:  "Chat", whatsapp: "Chat",
                                pdv:      "PDV",  balcao:   "PDV",
                                ui_order: "UI",   admin:    "UI",
                            };

                            const pmKey = String((o as any).payment_method ?? "");

                            return (
                                <div
                                    key={o.id}
                                    onClick={() => openOrder(o.id)}
                                    className={`group flex cursor-pointer items-center gap-2 px-3 py-4 sm:gap-4 sm:px-5 transition-colors ${
                                        isFlashing
                                            ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:ring-emerald-700/50"
                                            : "bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    {/* Ping + Nº + origem */}
                                    <div className="flex w-20 shrink-0 flex-col gap-0.5">
                                        <div className="flex items-center gap-1.5">
                                            {isRecent && (
                                                <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
                                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                                </span>
                                            )}
                                            <span className="text-xs font-bold text-zinc-400">#{num}</span>
                                        </div>
                                        {source && SOURCE_LABEL[source] && (
                                            <span className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold ${SOURCE_BADGE[source] ?? "bg-zinc-100 text-zinc-500"}`}>
                                                {SOURCE_LABEL[source]}
                                            </span>
                                        )}
                                    </div>

                                    {/* Cliente */}
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{name}</span>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{phone}</span>
                                            <span className="text-[11px] text-sky-500 font-medium">{timeAgo(o.created_at)}</span>
                                        </div>
                                        {addr && addr !== "-" && (
                                            <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{addr}</span>
                                        )}
                                        {obs && (
                                            <span className="text-[11px] font-medium text-amber-700 italic">{obs}</span>
                                        )}
                                    </div>

                                    {/* Pagamento badge */}
                                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PAYMENT_BADGE[pmKey] ?? "bg-zinc-100 text-zinc-500"}`}>
                                            {pmStr}
                                        </span>
                                        {(o as any).paid && (
                                            <span className="text-[10px] font-bold text-emerald-600">✓ pago</span>
                                        )}
                                    </div>

                                    {/* Status badge */}
                                    <div className="shrink-0">
                                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${STATUS_BADGE[st] ?? "bg-zinc-100 text-zinc-500"}`}>
                                            {prettyStatus(st)}
                                        </span>
                                    </div>

                                    {/* Total */}
                                    <div className="w-16 shrink-0 text-right sm:w-28">
                                        <span className="text-xs font-bold text-zinc-900 sm:text-sm dark:text-zinc-50">R$ {formatBRL(o.total_amount)}</span>
                                    </div>

                                    {/* Ações rápidas */}
                                    <div
                                        className="flex shrink-0 items-center gap-1"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            title="Ver pedido"
                                            onClick={() => openOrder(o.id)}
                                            className="rounded-lg p-2 text-zinc-400 hover:bg-violet-50 hover:text-violet-600 transition-colors"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </button>
                                        <button
                                            title="Imprimir"
                                            onClick={() => printOrder(o.id)}
                                            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                                        >
                                            <Printer className="h-4 w-4" />
                                        </button>
                                        {phone && (
                                            <button
                                                title="WhatsApp"
                                                onClick={() => router.push(`/whatsapp?phone=${encodeURIComponent(phone)}`)}
                                                className="rounded-lg p-2 text-zinc-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                                            >
                                                <MessageCircle className="h-4 w-4" />
                                            </button>
                                        )}
                                        {/* Fechar no PDV — apenas pedidos de chat/UI não finalizados */}
                                        {st === "new" && (source === "chatbot" || source === "whatsapp" || source === "ui_order" || source === "admin") && (
                                            <button
                                                title="Fechar no PDV"
                                                onClick={() => router.push(`/pdv?from_order=${o.id}`)}
                                                className="flex items-center gap-1 rounded-lg bg-orange-500 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-orange-600 transition-colors sm:px-2.5"
                                            >
                                                <ShoppingCart className="h-3 w-3" /><span className="hidden sm:inline">PDV</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── PAGINAÇÃO ── */}
            {!loading && filteredOrders.length > PAGE_SIZE && (
                <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">

                    {/* Info */}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Exibindo{" "}
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredOrders.length)}
                        </span>{" "}
                        de{" "}
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {filteredOrders.length}
                        </span>{" "}
                        pedidos
                    </p>

                    {/* Controles */}
                    <div className="flex items-center gap-1">
                        {/* Anterior */}
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={safePage === 1}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>

                        {/* Números de página */}
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter((p) => {
                                // Mostra sempre: 1, última, e ±2 da atual
                                return p === 1 || p === totalPages || Math.abs(p - safePage) <= 2;
                            })
                            .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                                acc.push(p);
                                return acc;
                            }, [])
                            .map((p, idx) =>
                                p === "…" ? (
                                    <span key={`ellipsis-${idx}`} className="px-1 text-xs text-zinc-400 dark:text-zinc-600">
                                        …
                                    </span>
                                ) : (
                                    <button
                                        key={p}
                                        onClick={() => setPage(p as number)}
                                        className={`flex h-8 min-w-[2rem] items-center justify-center rounded-lg border px-2 text-xs font-medium transition-colors ${
                                            safePage === p
                                                ? "border-purple-600 bg-purple-700 text-white shadow-sm"
                                                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                        }`}
                                    >
                                        {p}
                                    </button>
                                )
                            )}

                        {/* Próxima */}
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={safePage === totalPages}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* ── MODAIS ── */}
            <NewOrderModal
                open={openNew}
                onClose={() => setOpenNew(false)}
                saving={saving}
                onSave={createOrder}
                onSaveAndPrint={createOrderAndPrint}
                msg={msg}
                customerName={customerName}            setCustomerName={setCustomerName}
                customerPhone={customerPhone}          setCustomerPhone={setCustomerPhone}
                customerAddress={customerAddress}      setCustomerAddress={setCustomerAddress}
                orderCustomers={orderCustomers}
                orderCustomersLoading={orderCustomersLoading}
                selectedOrderCustomerId={selectedOrderCustomerId}
                onSelectOrderCustomer={handleSelectOrderCustomer}
                orderSavedAddresses={orderSavedAddresses}
                orderAddressMode={orderAddressMode}
                setOrderAddressMode={setOrderAddressMode}
                orderSelectedAddrId={orderSelectedAddrId}
                setOrderSelectedAddrId={setOrderSelectedAddrId}
                newOrderAddrForm={newOrderAddrForm}
                setNewOrderAddrForm={setNewOrderAddrForm}
                paymentMethod={paymentMethod}          setPaymentMethod={setPaymentMethod}
                paid={paid}                            setPaid={setPaid}
                changeFor={changeFor}                  setChangeFor={setChangeFor}
                deliveryFeeEnabled={deliveryFeeEnabled} setDeliveryFeeEnabled={setDeliveryFeeEnabled}
                deliveryFee={deliveryFee}              setDeliveryFee={setDeliveryFee}
                drivers={drivers}
                driverId={driverId}                    setDriverId={setDriverId}
                q={q}
                onSearchChange={(text) => runVariantSearch(text, {
                    setText: setQ, setResults, setSearching,
                    ensureDraft: (ids) => setDraftQty((prev) => { const n = { ...prev }; for (const id of ids) if (!n[id]) n[id] = { unit: "", box: "" }; return n; }),
                })}
                searching={searching}
                results={results}
                getDraft={getDraft}
                setDraft={setDraft}
                clearDraft={clearDraft}
                cart={cart}
                setCart={setCart}
                addToCart={(v, mode, qty) => addToCartLocal(setCart, v, mode, qty)}
                totalNow={newTotalNow}
                customerPaysNow={newCustomerPays}
                trocoNow={newTroco}
            />

            <ViewOrderModal
                open={openView}
                onClose={() => setOpenView(false)}
                loading={viewLoading}
                order={viewOrder}
                onPrint={() => viewOrder ? printOrder(viewOrder.id) : undefined}
                onEdit={() => viewOrder ? openEditOrder(viewOrder.id) : undefined}
                onAction={(k) => viewOrder ? openActionModal(k, viewOrder.id) : undefined}
                canCancel={viewOrder ? canCancel(String((viewOrder as any).status)) : false}
                canDeliver={viewOrder ? canDeliver(String((viewOrder as any).status)) : false}
                canFinalize={viewOrder ? canFinalize(String((viewOrder as any).status)) : false}
                canEdit={viewOrder ? canEdit(String((viewOrder as any).status)) : false}
                onOutForDelivery={() => sendWhatsAppForCurrentOrder("out_for_delivery")}
                onDeliveredMessage={() => sendWhatsAppForCurrentOrder("delivered_message")}
                sendingOutForDelivery={sendingOutForDelivery}
                sendingDeliveredMessage={sendingDeliveredMessage}
            />

            <ActionModal
                open={openAction}
                onClose={() => setOpenAction(false)}
                kind={actionKind}
                note={actionNote}
                setNote={setActionNote}
                saving={actionSaving}
                onConfirm={runAction}
                orderPaymentMethod={(orders.find(o => o.id === actionOrderId) as any)?.payment_method}
                paymentMethod={actionPayMethod}
                setPaymentMethod={setActionPayMethod}
            />

            <EditOrderModal
                open={openEdit}
                onClose={() => setOpenEdit(false)}
                loading={editLoading}
                saving={editSaving}
                order={editOrder}
                canEditOrder={editOrder ? canEdit(String((editOrder as any).status)) : false}
                onSave={saveEditOrder}
                onSaveAndPrint={saveEditAndPrint}
                msg={msg}
                customerName={editCustomerName}            setCustomerName={setEditCustomerName}
                customerPhone={editCustomerPhone}          setCustomerPhone={setEditCustomerPhone}
                customerAddress={editCustomerAddress}      setCustomerAddress={setEditCustomerAddress}
                paymentMethod={editPaymentMethod}          setPaymentMethod={setEditPaymentMethod}
                paid={editPaid}                            setPaid={setEditPaid}
                changeFor={editChangeFor}                  setChangeFor={setEditChangeFor}
                deliveryFeeEnabled={editDeliveryFeeEnabled} setDeliveryFeeEnabled={setEditDeliveryFeeEnabled}
                deliveryFee={editDeliveryFee}              setDeliveryFee={setEditDeliveryFee}
                drivers={drivers}
                driverId={editDriverId}                    setDriverId={setEditDriverId}
                q={editQ}
                onSearchChange={(text) => runVariantSearch(text, {
                    setText: setEditQ, setResults: setEditResults, setSearching: setEditSearching,
                    ensureDraft: (ids) => setEditDraftQty((prev) => { const n = { ...prev }; for (const id of ids) if (!n[id]) n[id] = { unit: "", box: "" }; return n; }),
                })}
                searching={editSearching}
                results={editResults}
                getDraft={getEditDraft}
                setDraft={setEditDraft}
                clearDraft={clearEditDraft}
                cart={editCart}
                setCart={setEditCart}
                addToCart={(v, mode, qty) => addToCartLocal(setEditCart, v, mode, qty)}
                totalNow={editTotalNow}
                customerPaysNow={editCustomerPays}
                trocoNow={editTroco}
            />
        </div>
    );
}
