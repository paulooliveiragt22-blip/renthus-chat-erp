// app/(admin)/pedidos/PedidosClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
    X,
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

type OrderPrintItemInfo = {
    productName: string;
    detail: string;
    unitLabel: string;
    fator: number | null;
};

/** Texto padrão para aviso de saiu para entrega / entregue (WhatsApp). */
function deliveryStatusWhatsAppText(
    kind: "out_for_delivery" | "delivered_message",
    customerName: string
): string {
    const name = customerName.trim();
    const namePart = name ? `, ${name}` : "";
    if (kind === "out_for_delivery") {
        return `Ótima notícia${namePart}: seu pedido já está com nosso entregador e a caminho de você! 🛵💨`;
    }
    return `Confirmamos que seu pedido foi entregue${namePart}! 🎉 Esperamos que tenha chegado tudo certinho. Qualquer coisa, é só chamar!`;
}

type PrintEmb = {
    product_name?: unknown;
    sigla_comercial?: unknown;
    descricao?: unknown;
    volume_formatado?: unknown;
    fator_conversao?: unknown;
};

function siglaDisplayNameForPrint(sigla: string): string {
    if (sigla === "CX") return "Caixa";
    if (sigla === "FARD") return "Fardo";
    if (sigla === "PAC") return "Pacote";
    return sigla;
}

function unitLabelFromSiglaForPrint(sigla: string): string {
    if (sigla === "CX") return "cx";
    if (sigla === "UN") return "un";
    return sigla.toLowerCase();
}

/** Evita S6551: `String` em objeto vira "[object Object]"; aqui só primitivos viram texto. */
function printScalarToString(value: unknown, fallback: string): string {
    if (value == null) return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
}

function orderPrintItemFromEmb(
    it: { product_name?: unknown; _emb?: PrintEmb },
    emb: PrintEmb
): OrderPrintItemInfo {
    const prodName = printScalarToString(emb.product_name, "").toUpperCase().trim();
    const sigla = printScalarToString(emb.sigla_comercial, "UN").toUpperCase();
    const descricao = printScalarToString(emb.descricao, "").trim();
    const volStr = printScalarToString(emb.volume_formatado, "").trim();
    const fator = Number(emb.fator_conversao) || null;
    const siglaHuman = siglaDisplayNameForPrint(sigla);
    const detailPrefix = descricao || (sigla !== "UN" ? siglaHuman : "");
    const detail = [detailPrefix, volStr].filter(Boolean).join(" ");
    const unitLabel = unitLabelFromSiglaForPrint(sigla);
    const fallbackName = printScalarToString(it.product_name, "PRODUTO").split(" • ")[0].toUpperCase().trim();
    return {
        productName: prodName || fallbackName,
        detail:      detail || prodName || "Item",
        unitLabel,
        fator:       sigla === "CX" && fator && fator > 1 ? fator : null,
    };
}

function orderPrintItemFromFlat(it: { product_name?: unknown; unit_type?: unknown }): OrderPrintItemInfo {
    const raw = printScalarToString(it.product_name, "PRODUTO");
    const bIdx = raw.indexOf(" • ");
    const prodName = bIdx >= 0 ? raw.slice(0, bIdx).toUpperCase().trim() : raw.toUpperCase().trim();
    const detail = bIdx >= 0 ? raw.slice(bIdx + 3).trim() : raw.trim();
    return {
        productName: prodName,
        detail,
        unitLabel:   it.unit_type === "case" ? "cx" : "un",
        fator:       null,
    };
}

/** Mesma lógica do ticket de impressão (view_pdv_produtos / product_name). */
function orderPrintGetItemInfo(it: { product_name?: unknown; unit_type?: unknown; _emb?: PrintEmb }): OrderPrintItemInfo {
    const emb = it._emb ?? null;
    if (emb) return orderPrintItemFromEmb(it, emb);
    return orderPrintItemFromFlat(it);
}

const STATUS_BADGE: Record<string, string> = {
    new:       "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    finalized: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    canceled:  "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
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
    pix:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    card: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    cash: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

// ─── componente principal ─────────────────────────────────────────────────────

export default function PedidosPage() {
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
    const ordersSnapshotRef = useRef<Record<string, { status: string; total: number }>>({});

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

    // ── reprint ───────────────────────────────────────────────────────────────
    const [reprintLoading, setReprintLoading] = useState(false);
    const [reprintMsg,     setReprintMsg]     = useState<{ ok: boolean; text: string } | null>(null);

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
    /** Incrementa a cada fechamento/troca de modal — descarta fetch async antigo (evita reabrir modal errado). */
    const modalSessionRef = useRef(0);

    useEffect(() => { viewOrderIdRef.current = openView  ? viewOrder?.id ?? null : null; }, [openView,  viewOrder?.id]);
    useEffect(() => { editOrderIdRef.current = openEdit  ? editOrder?.id ?? null : null; }, [openEdit,  editOrder?.id]);

    // ── data fetching ─────────────────────────────────────────────────────────
    async function loadCompanySettings(cid: string) {
        const res = await fetch("/api/companies/update", { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        const comp = json?.company ?? null;
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
        const res = await fetch("/api/admin/orders", { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`Erro ao carregar pedidos: ${json?.error ?? "falha desconhecida"}`); setOrders([]); setLoading(false); return; }
        const incoming = (Array.isArray(json.orders) ? json.orders : []) as OrderRow[];
        const nextSnapshot: Record<string, { status: string; total: number }> = {};
        const toFlash: string[] = [];
        const now = Date.now();
        setRecentOrders((prev) => {
            const next = { ...prev };
            for (const o of incoming) {
                nextSnapshot[o.id] = { status: String(o.status ?? ""), total: Number(o.total_amount ?? 0) };
                const old = ordersSnapshotRef.current[o.id];
                if (!old) {
                    next[o.id] = now;
                    toFlash.push(o.id);
                } else if (old.status !== nextSnapshot[o.id].status || old.total !== nextSnapshot[o.id].total) {
                    toFlash.push(o.id);
                }
            }
            return next;
        });
        ordersSnapshotRef.current = nextSnapshot;
        if (toFlash.length > 0) {
            setFlashOrders((prev) => new Set([...prev, ...toFlash]));
            globalThis.setTimeout(() => {
                setFlashOrders((prev) => {
                    const next = new Set(prev);
                    for (const id of toFlash) next.delete(id);
                    return next;
                });
            }, 2000);
        }
        setOrders(incoming as any);
        setLoading(false);
    }

    async function runVariantSearch(text: string, opts: { setText:(v:string)=>void; setResults:(v:Variant[])=>void; setSearching:(v:boolean)=>void; ensureDraft:(ids:string[])=>void; }) {
        const t = text.trim();
        opts.setText(text);
        setMsg(null);
        if (t.length < 2) { opts.setResults([]); return; }
        opts.setSearching(true);
        const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(t)}`, {
            cache: "no-store",
            credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMsg(`Erro na busca: ${json?.error ?? "falha desconhecida"}`);
            opts.setResults([]);
            opts.setSearching(false);
            return;
        }

        const top = (json.variants ?? []) as Variant[];
        opts.setResults(top);
        opts.ensureDraft(top.map((x) => x.id));
        opts.setSearching(false);
    }

    async function loadDrivers(cid: string) {
        const res = await fetch("/api/admin/drivers", { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        const data = (json.drivers ?? []) as Driver[];
        setDrivers(data.filter((d) => d.is_active));
    }

    async function fetchOrderSavedAddresses(customerId: string) {
        const res = await fetch(`/api/admin/order-addresses?customer_id=${encodeURIComponent(customerId)}`, {
            cache: "no-store",
            credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMsg(`Erro ao buscar endereços: ${json?.error ?? "falha desconhecida"}`);
            setOrderSavedAddresses([]);
            return;
        }
        const list = (json.addresses ?? []) as SavedCustomerAddress[];
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
        const row = orderCustomers.find((c) => c.id === id) ?? null;
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
            const res = await fetch("/api/admin/order-customers", { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!cancelled) {
                if (!res.ok) {
                    setMsg(`Erro ao carregar clientes: ${json?.error ?? "falha desconhecida"}`);
                    setOrderCustomers([]);
                } else {
                    setOrderCustomers((json.customers ?? []) as OrderCustomerPick[]);
                }
                setOrderCustomersLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [openNew, companyId]);

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
        const res = await fetch("/api/admin/order-customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name, phone, address }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`Erro ao salvar cliente: ${json?.error ?? "falha desconhecida"}`); return null; }
        return String(json.customer_id ?? "");
    }

    async function fetchOrderFull(orderId: string): Promise<OrderFull | null> {
        const res = await fetch(`/api/admin/orders/${orderId}`, { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`Erro ao carregar pedido: ${json?.error ?? "falha desconhecida"}`); return null; }
        const order = (json.order ?? {}) as any;
        const rows = Array.isArray(order.items) ? order.items : [];
        const mappedItems = rows.map((it: any) => ({
            ...it,
            qty: it?.qty ?? it?.quantity ?? 0,
            quantity: it?.quantity ?? it?.qty ?? 0,
            _emb: it?._emb ?? null,
        }));
        return { ...order, items: mappedItems as any };
    }

    async function openOrder(orderId: string, alsoCleanUrl?: boolean) {
        closeAllPedidosModals();
        const session = modalSessionRef.current;
        setViewLoading(true);
        setMsg(null);
        const full = await fetchOrderFull(orderId);
        if (session !== modalSessionRef.current) return;
        setViewLoading(false);
        if (!full) {
            setMsg("Pedido não encontrado.");
            return;
        }
        setViewOrder(full);
        setOpenView(true);
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

    // ── auto refresh ──────────────────────────────────────────────────────────
    useEffect(() => {
        const timer = setInterval(() => {
            void loadOrders();
            if (viewOrderIdRef.current) void fetchOrderFull(viewOrderIdRef.current).then((full) => full && setViewOrder(full));
            if (editOrderIdRef.current) void fetchOrderFull(editOrderIdRef.current).then((full) => full && setEditOrder(full));
        }, 12000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    /** Vários `<dialog>.showModal()` empilham; só um modal “grande” pode ficar aberto por vez. */
    function closeAllPedidosModals() {
        modalSessionRef.current += 1;
        setOpenNew(false);
        setOpenView(false);
        setOpenAction(false);
        setOpenEdit(false);
        setViewOrder(null);
        setEditOrder(null);
        setViewLoading(false);
        setEditLoading(false);
    }

    function openPedidosNewModal() {
        closeAllPedidosModals();
        resetNewOrder();
        setOpenNew(true);
    }

    function openActionModal(kind: ActionKind, orderId: string) {
        modalSessionRef.current += 1;
        setOpenNew(false);
        setOpenEdit(false);
        setEditOrder(null);
        setEditLoading(false);
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
        const res = await fetch("/api/admin/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                id: orderId,
                status: newStatus,
                details: note || null,
                ...(actionPayMethod ? { payment_method: actionPayMethod } : {}),
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`Erro ao atualizar status: ${json?.error ?? "falha desconhecida"}`); setActionSaving(false); return; }

        // Registrar em financial_entries ao finalizar ou entregar
        if ((actionKind === "finalize" || actionKind === "deliver") && companyId) {
            const ord = orders.find(o => o.id === orderId);
            const totalAmt = Number((ord as any)?.total_amount ?? 0);
            if (totalAmt > 0) {
                const feRes = await fetch("/api/admin/financial-entries", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        order_id: orderId,
                        type: "income",
                        amount: totalAmt,
                        payment_method: actionPayMethod || (ord as any)?.payment_method || "pix",
                        description: `Pedido #${orderId.slice(0,8)} — ${note || ""}`.trim().replace(/— $/, ""),
                        reference_date: new Date().toISOString().slice(0, 10),
                    }),
                });
                const feJson = await feRes.json().catch(() => ({}));
                if (!feRes.ok) console.warn("[runAction] financial_entries:", feJson?.error ?? "falha desconhecida");
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
                const addrRes = await fetch("/api/admin/order-addresses", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        customer_id: customerId,
                        apelido: f.apelido.trim() || "Entrega",
                        logradouro: f.logradouro.trim() || null,
                        numero: f.numero.trim() || null,
                        complemento: f.complemento.trim() || null,
                        bairro: f.bairro.trim() || null,
                        cidade: f.cidade.trim() || null,
                        estado: f.estado.trim() || null,
                        cep: f.cep.trim() || null,
                        is_principal: orderSavedAddresses.length === 0,
                    }),
                });
                const addrJson = await addrRes.json().catch(() => ({}));
                if (!addrRes.ok) {
                    setMsg(`Erro ao salvar endereço: ${addrJson?.error ?? "falha desconhecida"}`);
                    setSaving(false);
                    return;
                }
                addressForOrder = formatEnderecoLine(f);
            }
            const customerRes = await fetch("/api/admin/order-customers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    id: customerId,
                    name: customerName.trim(),
                    phone: customerPhone.trim(),
                    address: addressForOrder || null,
                }),
            });
            const customerJson = await customerRes.json().catch(() => ({}));
            if (!customerRes.ok) {
                setMsg(`Erro ao atualizar cliente: ${customerJson?.error ?? "falha desconhecida"}`);
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
        const createRes = await fetch("/api/admin/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                customer_id: customerId,
                channel: "admin",
                status: "new",
                payment_method: paymentMethod,
                paid,
                change_for: change,
                delivery_fee: fee,
                total_amount: total,
                details: null,
                driver_id: driverId || null,
                items: buildItemsPayload("temp", companyId, cart),
            }),
        });
        const createJson = await createRes.json().catch(() => ({}));
        if (!createRes.ok) { setMsg(`Erro ao criar pedido: ${createJson?.error ?? "falha desconhecida"}`); setSaving(false); return; }
        setSaving(false); setOpenNew(false); resetNewOrder(); await loadOrders();
    }

    async function openEditOrder(orderId: string) {
        closeAllPedidosModals();
        const session = modalSessionRef.current;
        setEditLoading(true); setMsg(null);
        const full = await fetchOrderFull(orderId);
        if (session !== modalSessionRef.current) {
            setEditLoading(false);
            return;
        }
        if (!full) {
            setEditLoading(false);
            setMsg("Pedido não encontrado.");
            return;
        }
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
        const mapped: CartItem[] = ((full as any).items ?? []).map((it: any) => {
            const emb = it._emb;
            const pName   = emb?.product_name ?? it.product_name ?? null;
            const details = emb
                ? [emb.descricao, emb.volume_formatado].filter(Boolean).join(" ") || pName
                : pName;
            const embId = it.produto_embalagem_id ? String(it.produto_embalagem_id) : null;
            const mode = it.unit_type === "case" ? "case" : "unit";
            const lineKey = embId ? `${embId}-${mode}` : `row:${String(it.id)}`;
            return {
                variant: {
                    id: lineKey,
                    unit_price: Number(it.unit_price ?? 0),
                    has_case: false,
                    case_price: null,
                    case_qty: null,
                    unit: it.unit_type ?? "none",
                    volume_value: null,
                    details: details ?? null,
                    is_active: true,
                    unit_embalagem_id: mode === "unit" ? embId : null,
                    case_embalagem_id: mode === "case" ? embId : null,
                    products: { name: pName ?? "", categories: { name: "" } },
                } as Variant,
                qty: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
                price: Number(it.unit_price ?? 0),
                mode,
            };
        });
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
        const orderRes = await fetch("/api/admin/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                id: editOrder.id,
                customer_id: customerId,
                payment_method: editPaymentMethod,
                paid: editPaid,
                change_for: change,
                delivery_fee: fee,
                total_amount: total,
                driver_id: editDriverId || null,
            }),
        });
        const orderJson = await orderRes.json().catch(() => ({}));
        if (!orderRes.ok) { setMsg(`Erro ao atualizar pedido: ${orderJson?.error ?? "falha desconhecida"}`); setEditSaving(false); return; }
        if (!companyId) { setMsg("Nenhuma empresa ativa selecionada."); setEditSaving(false); return; }
        const itemsRes = await fetch("/api/admin/orders/items", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                order_id: editOrder.id,
                items: buildItemsPayload(editOrder.id, companyId, editCart),
            }),
        });
        const itemsJson = await itemsRes.json().catch(() => ({}));
        if (!itemsRes.ok) { setMsg(`Erro ao inserir itens: ${itemsJson?.error ?? "falha desconhecida"}`); setEditSaving(false); return; }
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
                const addrRes = await fetch("/api/admin/order-addresses", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        customer_id: customerId,
                        apelido: f.apelido.trim() || "Entrega",
                        logradouro: f.logradouro.trim() || null,
                        numero: f.numero.trim() || null,
                        complemento: f.complemento.trim() || null,
                        bairro: f.bairro.trim() || null,
                        cidade: f.cidade.trim() || null,
                        estado: f.estado.trim() || null,
                        cep: f.cep.trim() || null,
                        is_principal: orderSavedAddresses.length === 0,
                    }),
                });
                const addrJson = await addrRes.json().catch(() => ({}));
                if (!addrRes.ok) { setMsg(`Erro ao salvar endereço: ${addrJson?.error ?? "falha desconhecida"}`); setSaving(false); return; }
                addressForOrder = formatEnderecoLine(f);
            }
            const customerRes = await fetch("/api/admin/order-customers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    id: customerId,
                    name: customerName.trim(),
                    phone: customerPhone.trim(),
                    address: addressForOrder || null,
                }),
            });
            const customerJson = await customerRes.json().catch(() => ({}));
            if (!customerRes.ok) { setMsg(`Erro ao atualizar cliente: ${customerJson?.error ?? "falha desconhecida"}`); setSaving(false); return; }
        } else {
            const createdId = await upsertCustomerFromFields(customerName, customerPhone, customerAddress);
            if (!createdId) { setSaving(false); return; }
            customerId = createdId;
        }

        const fee    = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
        const change = paymentMethod === "cash" ? brlToNumber(changeFor) : null;
        const total  = cartSubtotal(cart) + fee;

        const createRes = await fetch("/api/admin/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                customer_id: customerId,
                channel: "admin",
                status: "new",
                payment_method: paymentMethod,
                paid,
                change_for: change,
                delivery_fee: fee,
                total_amount: total,
                details: null,
                driver_id: driverId || null,
                items: buildItemsPayload("temp", companyId, cart),
            }),
        });
        const createJson = await createRes.json().catch(() => ({}));
        if (!createRes.ok) { setMsg(`Erro ao criar pedido: ${createJson?.error ?? "falha desconhecida"}`); setSaving(false); return; }

        // Usa reprint explícito (source='reprint') — não depende do trigger de confirmation_status
        // para evitar dupla impressão quando trigger antigo (status='new') ainda coexiste
        await callReprint(String(createJson?.order_id ?? ""));
        setSaving(false); setOpenNew(false); resetNewOrder(); await loadOrders();
    }

    async function saveEditAndPrint() {
        if (!editOrder) return;
        await saveEditOrder();
        // saveEditOrder closes the modal on success — call reprint after
        await callReprint(editOrder.id);
    }

    async function syncViewOrderAfterOutForDelivery(ordId: string) {
        await fetch("/api/admin/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: ordId, status: "delivered" }),
        });
        const updated = await fetchOrderFull(ordId);
        if (updated) setViewOrder(updated);
        await loadOrders();
    }

    async function sendWhatsAppForCurrentOrder(kind: "out_for_delivery" | "delivered_message") {
        const ord = viewOrder;
        if (!ord || !ord.customers?.phone) { setMsg("Telefone do cliente não encontrado."); return; }
        const phone = String(ord.customers.phone).trim();
        if (!phone.startsWith("+")) { setMsg("Telefone precisa estar em formato internacional (+55...)."); return; }
        const text = deliveryStatusWhatsAppText(kind, ord.customers.name || "");
        try {
            if (kind === "out_for_delivery") setSendingOutForDelivery(true); else setSendingDeliveredMessage(true);
            setMsg(null);
            const res = await fetch("/api/whatsapp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to_phone_e164: phone, kind: "text", text }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                setMsg(`Erro WhatsApp: ${d?.error || res.statusText}`);
                return;
            }
            if (kind === "out_for_delivery") await syncViewOrderAfterOutForDelivery(ord.id);
            setMsg("✅ Mensagem enviada no WhatsApp.");
        } catch (err: unknown) {
            setMsg(`Erro WhatsApp: ${String((err as Error)?.message ?? err)}`);
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

        // Agrupa itens por produto
        const groups = new Map<string, { it: any; info: OrderPrintItemInfo }[]>();
        for (const it of (full.items ?? [])) {
            const info = orderPrintGetItemInfo(it);
            if (!groups.has(info.productName)) groups.set(info.productName, []);
            groups.get(info.productName)!.push({ it, info });
        }

        const tdName  = `style="padding:7px 5px 2px;border-bottom:none;font-size:14px;font-weight:700;color:#111"`;
        const tdEmb   = `style="padding:2px 5px 2px 16px;font-size:11px;font-weight:400;color:#333;border-bottom:1px solid #eee"`;
        const tdNum   = `style="text-align:right;white-space:nowrap;font-size:12px;font-weight:500;border-bottom:1px solid #eee"`;
        const tdSep   = `style="padding:0;height:5px;border:none"`;

        const itemsHtml = Array.from(groups.entries()).map(([productName, entries], gIdx) => {
            const sep    = gIdx > 0 ? `<tr><td colspan="3" ${tdSep}></td></tr>` : "";
            const header = `<tr><td colspan="3" ${tdName}>${escapeHtml(productName)}</td></tr>`;
            const lines  = entries.map(({ it, info }) => {
                const q = Number(it.quantity ?? it.qty ?? 0);
                const p = Number(it.unit_price ?? 0);
                const t = Number(it.line_total ?? q * p);
                const fatorStr = info.fator ? ` c/${info.fator}` : "";
                const qtyLabel = `${q} ${info.unitLabel}${fatorStr}`;
                return `<tr><td ${tdEmb}>${escapeHtml(info.detail)}</td><td ${tdNum}>${escapeHtml(qtyLabel)}</td><td ${tdNum}>R$ ${formatBRL(t)}</td></tr>`;
            }).join("");
            return sep + header + lines;
        }).join("") || `<tr><td colspan="3">Sem itens</td></tr>`;

        let payExtra = "";
        if (pm === "card" || pm === "pix") payExtra = `<div class="s">Levar maquininha</div>`;
        else if (pm === "cash") payExtra = `<div class="s">${custPays > 0 ? `Troco p/ R$ ${formatBRL(custPays)}` : "Troco p/: -"}</div><div class="s">Levar de troco: R$ ${formatBRL(troco)}</div>`;

        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) { setMsg("Erro: popup bloqueado."); return; }
        w.document.open();
        const driverLine = driver?.name
            ? `<div style="margin-top:4px"><b>Entregador:</b> <b>${escapeHtml(driver.name)}</b>${driver.vehicle ? ` • ${escapeHtml(driver.vehicle)}` : ""}${driver.plate ? ` (${escapeHtml(driver.plate)})` : ""}</div>`
            : "";

        w.document.write(`<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;padding:10px;max-width:460px}h1{font-size:16px;font-weight:700;margin:5px 0 3px}table{width:100%;border-collapse:collapse;margin-top:6px}.obs{border:1px solid #ddd;border-radius:5px;padding:5px;margin-top:6px;font-size:10px;font-weight:700;color:${ORANGE}}@media print{button{display:none}}</style></head><body><button onclick="window.print()" style="padding:3px 8px;border:1px solid #999;border-radius:5px;cursor:pointer;font-size:10px;margin-bottom:5px">Imprimir</button><h1>Pedido #${String(full.id).slice(0,8).toUpperCase()} &bull; ${new Date(full.created_at).toLocaleString("pt-BR")}</h1><div style="font-size:10px;margin:1px 0"><b>Status:</b> ${escapeHtml(prettyStatus(String((full as any).status)))}</div><div style="font-size:10px;margin:1px 0"><b>Cliente:</b> ${escapeHtml(cust?.name ?? "-")} &bull; ${escapeHtml(cust?.phone ?? "")}</div><div style="font-size:10px;margin:1px 0"><b>End:</b> ${escapeHtml(cust?.address ?? "-")}</div>${driverLine}<div style="font-size:10px;margin-top:3px"><b>Pagamento:</b> ${escapeHtml(pmLabel)}${paidFlag ? " <b>(pago)</b>" : ""}${payExtra}</div>${(full as any).details ? `<div class="obs">OBS: ${escapeHtml(String((full as any).details))}</div>` : ""}<table><tbody>${itemsHtml}</tbody></table><div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span>Taxa entrega</span><span>R$ ${formatBRL((full as any).delivery_fee ?? 0)}</span></div><div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;border-top:2px solid #222;padding-top:3px;margin-top:3px"><span>TOTAL</span><span>R$ ${formatBRL((full as any).total_amount ?? 0)}</span></div></div><script>setTimeout(()=>window.print(),200)<\/script></body></html>`);
        w.document.close();
    }

    // ── reprint via agente ────────────────────────────────────────────────────
    async function reprintOrder(orderId: string) {
        setReprintLoading(true);
        setReprintMsg(null);
        try {
            const res  = await fetch("/api/agent/reprint", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ order_id: orderId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");
            setReprintMsg({ ok: true, text: "Pedido enviado para impressão!" });
        } catch (e: unknown) {
            setReprintMsg({ ok: false, text: "Erro: " + String((e as Error)?.message ?? e) });
        } finally {
            setReprintLoading(false);
            setTimeout(() => setReprintMsg(null), 5000);
        }
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
                        type="button"
                        onClick={() => { openPedidosNewModal(); }}
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
                            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">Saíram pra entrega</p>
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
                            {f === "all" ? `Todos (${stats.total})` : f === "new" ? `Novos (${stats.new})` : f === "delivered" ? `Em entrega (${stats.delivered})` : f === "finalized" ? `Finalizados (${stats.finalized})` : `Cancelados (${stats.canceled})`}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── ORDER CARDS ── */}
            {loading ? (
                <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60" />
                    ))}
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 dark:text-zinc-600 rounded-xl border border-zinc-100 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <Package className="mb-3 h-10 w-10" />
                    <p className="text-sm font-medium">Nenhum pedido encontrado</p>
                </div>
            ) : (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                    {pagedOrders.map((o) => {
                        const st         = String(o.status);
                        const num        = orderNum(o.id);
                        const name       = o.customers?.name ?? "-";
                        const phone      = o.customers?.phone ?? "";
                        const addr       = o.customers?.address ?? "";
                        const pmKey      = String((o as any).payment_method ?? "");
                        const pmStr      = paymentLabel(pmKey);
                        const obs        = ((o as any).details ?? "").trim();
                        const recentTs   = recentOrders[o.id];
                        const isRecent   = !!recentTs && Date.now() - recentTs < 60000;
                        const isFlashing = flashOrders.has(o.id);
                        const source     = String((o as any).source ?? (o as any).channel ?? "");
                        const items      = ((o as any).order_items ?? []) as { product_name: string; quantity: number; unit_price: number; line_total: number | null }[];

                        const SOURCE_LABEL: Record<string, string> = { chatbot:"Chat", whatsapp:"Chat", flow_catalog:"Flow", pdv:"PDV", pdv_direct:"PDV", balcao:"PDV", ui_order:"UI", admin:"UI", ui:"UI" };
                        const SOURCE_CLS:   Record<string, string> = {
                            chatbot:"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                            whatsapp:"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                            flow_catalog:"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                            pdv:"bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                            pdv_direct:"bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                            balcao:"bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                            ui_order:"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                            admin:"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                            ui:"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                        };
                        const BORDER_COLOR: Record<string, string> = { new:"#f97316", delivered:"#10b981", finalized:"#8b5cf6", canceled:"#52525b" };

                        // Agrupa itens por produto (fallback: parse string)
                        const itemGroups = new Map<string, typeof items>();
                        for (const it of items) {
                            const raw   = String(it.product_name ?? "");
                            const bIdx  = raw.indexOf(" • ");
                            const pName = bIdx >= 0 ? raw.slice(0, bIdx).toUpperCase().trim() : raw.toUpperCase().trim();
                            if (!itemGroups.has(pName)) itemGroups.set(pName, []);
                            itemGroups.get(pName)!.push(it);
                        }
                        const groupEntries = Array.from(itemGroups.entries());

                        return (
                            <div
                                key={o.id}
                                className={`relative bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:hover:bg-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800 ${
                                    isFlashing ? "ring-2 ring-emerald-400 dark:ring-emerald-600" : ""
                                }`}
                            >
                                <button
                                    type="button"
                                    className="absolute inset-0 z-[1] rounded-xl border-0 bg-transparent p-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
                                    aria-label={`Abrir pedido ${num}`}
                                    onClick={() => openOrder(o.id)}
                                />
                                <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
                                <div className="flex flex-col pointer-events-none divide-y divide-zinc-100 dark:divide-zinc-800">
                                {/* ── Header: ID + status na mesma linha ── */}
                                <div className="px-3 py-2 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {isRecent && (
                                            <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                            </span>
                                        )}
                                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">#{num}</span>
                                        {SOURCE_LABEL[source] && (
                                            <span className={`inline-flex rounded-full px-1.5 py-px text-[9px] font-bold ${SOURCE_CLS[source] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                                                {SOURCE_LABEL[source]}
                                            </span>
                                        )}
                                        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 truncate">{timeAgo(o.created_at)}</span>
                                    </div>
                                    <span className={`shrink-0 inline-flex rounded-full px-2 py-px text-[9px] font-bold ${STATUS_BADGE[st] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                                        {prettyStatus(st)}
                                    </span>
                                </div>

                                {/* ── Cliente ── */}
                                <div className="px-3 py-2">
                                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight">{name}</p>
                                    {(phone || addr) && (
                                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate leading-tight mt-0.5">{[phone, addr].filter(Boolean).join(" · ")}</p>
                                    )}
                                </div>

                                {/* ── Itens — todos os grupos, hierarquia igual à Fila ── */}
                                {groupEntries.length > 0 && (
                                    <div className="px-3 py-2 space-y-1">
                                        {groupEntries.map(([pName, grpItems]) => (
                                            <div key={pName}>
                                                <p className="text-[11px] font-bold text-zinc-800 dark:text-zinc-100 leading-tight">{pName}</p>
                                                {grpItems.map((it, i) => {
                                                    const raw    = String(it.product_name ?? "");
                                                    const bIdx   = raw.indexOf(" • ");
                                                    const detail = bIdx >= 0 ? raw.slice(bIdx + 3).trim() : "";
                                                    const q      = Number(it.quantity ?? 1);
                                                    const tot    = Number(it.line_total ?? it.unit_price * q);
                                                    return (
                                                        <div key={i} className="flex items-center justify-between gap-2 pl-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                                                            <span className="truncate">{detail || pName} · <b className="text-zinc-700 dark:text-zinc-300">{q} un</b></span>
                                                            <span className="shrink-0 font-medium">R$ {formatBRL(tot)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                        {obs && (
                                            <p className="mt-1 rounded bg-amber-50 dark:bg-amber-900/20 px-1.5 py-px text-[9px] font-medium text-amber-700 dark:text-amber-400 italic">{obs}</p>
                                        )}
                                    </div>
                                )}
                                {!groupEntries.length && obs && (
                                    <div className="px-3 py-2">
                                        <p className="rounded bg-amber-50 dark:bg-amber-900/20 px-1.5 py-px text-[9px] font-medium text-amber-700 dark:text-amber-400 italic">{obs}</p>
                                    </div>
                                )}

                                {/* ── Footer: pagamento + total ── */}
                                <div className="px-3 py-2 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1">
                                        <span className={`inline-flex rounded-full px-1.5 py-px text-[9px] font-semibold ${PAYMENT_BADGE[pmKey] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                                            {pmStr}
                                        </span>
                                        {(o as any).paid && (
                                            <span className="text-[9px] font-bold text-emerald-500 dark:text-emerald-400">✓ pago</span>
                                        )}
                                    </div>
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-emerald-400">R$ {formatBRL(o.total_amount)}</span>
                                </div>
                                </div>

                                {/* ── Ações: ghost compacto ── */}
                                <div className="relative z-[2] flex items-center gap-1 border-t border-zinc-100 px-2.5 py-2 dark:border-zinc-800 pointer-events-auto">
                                    {/* Ver — destaque principal */}
                                    <button
                                        type="button"
                                        title="Ver pedido"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openOrder(o.id);
                                        }}
                                        className="flex items-center gap-0.5 px-2 py-1 text-[9px] font-bold text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-md hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
                                    >
                                        <Eye className="h-3 w-3" /> Ver
                                    </button>
                                    {/* Imprimir — ícone */}
                                    <button
                                        type="button"
                                        title="Imprimir"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            printOrder(o.id);
                                        }}
                                        className="flex items-center justify-center h-6 w-6 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                    >
                                        <Printer className="h-3 w-3" />
                                    </button>
                                    {/* Chat — ícone */}
                                    {phone && (
                                        <button
                                            type="button"
                                            title="WhatsApp"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/whatsapp?phone=${encodeURIComponent(phone)}`);
                                            }}
                                            className="flex items-center justify-center h-6 w-6 rounded-md border border-zinc-200 dark:border-zinc-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                        >
                                            <MessageCircle className="h-3 w-3" />
                                        </button>
                                    )}
                                    {/* PDV — destaque laranja */}
                                    {st === "new" && (source === "chatbot" || source === "whatsapp" || source.startsWith("flow_") || source === "ui_order" || source === "admin" || source === "ui") && (
                                        <button
                                            type="button"
                                            title="Fechar no PDV"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/pdv?from_order=${o.id}`);
                                            }}
                                            className="flex items-center gap-0.5 px-2 py-1 text-[9px] font-bold text-orange-600 dark:text-orange-400 border border-orange-400 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                                        >
                                            <ShoppingCart className="h-3 w-3" /> PDV
                                        </button>
                                    )}
                                    {/* Cancelar — ícone ghost red, empurrado p/ direita */}
                                    {canCancel(st) && (
                                        <button
                                            type="button"
                                            title="Cancelar pedido"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openActionModal("cancel", o.id);
                                            }}
                                            className="ml-auto flex items-center justify-center h-6 w-6 rounded-md border border-zinc-200 dark:border-zinc-700 text-red-400 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 transition-colors"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

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
                onClose={() => {
                    modalSessionRef.current += 1;
                    setOpenAction(false);
                    setOpenView(false);
                    setViewLoading(false);
                    setViewOrder(null);
                }}
                loading={viewLoading}
                order={viewOrder}
                onPrint={() => viewOrder ? printOrder(viewOrder.id) : undefined}
                onReprint={() => viewOrder ? reprintOrder(viewOrder.id) : undefined}
                reprintLoading={reprintLoading}
                reprintMsg={reprintMsg}
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
                onClose={() => {
                    modalSessionRef.current += 1;
                    setOpenAction(false);
                    setOpenEdit(false);
                    setEditLoading(false);
                    setEditOrder(null);
                }}
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
