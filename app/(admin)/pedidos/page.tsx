"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createPortal } from "react-dom";

type PaymentMethod = "pix" | "card" | "cash";
type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

type OrderRow = {
    id: string;
    status: OrderStatus | string;
    channel: string;
    total_amount: number;
    delivery_fee: number;
    payment_method: PaymentMethod;
    paid: boolean;
    change_for: number | null;
    created_at: string;
    details: string | null;
    customers: { name: string | null; phone: string | null; address: string | null } | null;
};

type OrderItemRow = {
    id: string;
    order_id: string;
    product_variant_id: string | null;
    product_name: string | null;
    unit_type: string | null;
    quantity: number;
    unit_price: number;
    line_total: number | null;
    qty: number;
    created_at: string;
};

type OrderFull = OrderRow & { items: OrderItemRow[] };

type Variant = {
    id: string;
    unit_price: number;
    case_price: number | null;
    case_qty: number | null;
    has_case: boolean;
    unit: "none" | "ml" | "l" | "kg";
    volume_value: number | null;
    details: string | null;
    is_active: boolean;
    products: {
        categories: { name: string } | null;
        brands: { name: string } | null;
    } | null;
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
function formatDT(ts: string) {
    try {
        return new Date(ts).toLocaleString("pt-BR");
    } catch {
        return ts;
    }
}
function labelUnit(u: Variant["unit"]) {
    if (u === "none") return "";
    if (u === "l") return "L";
    if (u === "ml") return "ml";
    if (u === "kg") return "kg";
    return u;
}
function prettyStatus(s: string) {
    if (s === "new") return "Novo";
    if (s === "canceled") return "Cancelado";
    if (s === "delivered") return "Entregue";
    if (s === "finalized") return "Finalizado";
    return s;
}

function statusColor(s: string) {
    if (s === "new") return "green";
    if (s === "canceled") return "crimson";
    if (s === "finalized") return "dodgerblue";
    if (s === "delivered") return "#666";
    return "#333";
}
function statusBadgeStyle(s: string): React.CSSProperties {
    const c = statusColor(s);
    return {
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 999,
        fontWeight: 900,
        border: `1px solid ${c}`,
        color: c,
        background: "rgba(0,0,0,0.02)",
        lineHeight: 1,
        fontSize: 12,
        whiteSpace: "nowrap",
    };
}

// regras
function canCancel(status: string) {
    if (status === "canceled" || status === "finalized") return false;
    if (status === "delivered") return false;
    return true;
}
function canDeliver(status: string) {
    if (status === "canceled" || status === "finalized") return false;
    if (status === "delivered") return false;
    return true;
}
function canFinalize(status: string) {
    if (status === "canceled" || status === "finalized") return false;
    return true;
}
function canEdit(status: string) {
    return String(status) === "new";
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
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!open) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);

        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open || !mounted) return null;

    return createPortal(
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                display: "grid",
                placeItems: "center",
                padding: 12,
                zIndex: 999999,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(1080px, 100%)",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    padding: 12,
                    maxHeight: "90vh",
                    overflow: "auto",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{
                            border: "1px solid #ccc",
                            borderRadius: 10,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 900,
                        }}
                    >
                        Fechar
                    </button>
                </div>

                <div style={{ marginTop: 10 }}>{children}</div>
            </div>
        </div>,
        document.body
    );
}

function escapeHtml(s: string) {
    return (s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const PURPLE = "#3B246B";

function btnBaseSlim(disabled?: boolean): React.CSSProperties {
    return {
        padding: "6px 9px",
        borderRadius: 10,
        border: "1px solid #999",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
    };
}
function btnPurple(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${PURPLE}`,
        background: disabled ? "#f5f1fb" : PURPLE,
        color: disabled ? PURPLE : "#fff",
    };
}
function btnPurpleOutline(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${PURPLE}`,
        background: "transparent",
        color: PURPLE,
    };
}
function chip(active: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(false),
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? PURPLE : "#ddd"}`,
        background: active ? "#f5f1fb" : "#fff",
        color: active ? PURPLE : "#333",
    };
}

function calcTroco(total: number, customerPays: number) {
    const t = Number.isFinite(total) ? total : 0;
    const p = Number.isFinite(customerPays) ? customerPays : 0;
    return Math.max(0, p - t);
}

function OrderPaymentInfo({
    payment_method,
    paid,
    change_for,
    total_amount,
    compact,
}: {
    payment_method: PaymentMethod | string;
    paid: boolean;
    change_for: number | null;
    total_amount: number | null | undefined;
    compact?: boolean;
}) {
    const pm = String(payment_method) as PaymentMethod | string;
    const label = pm === "pix" ? "PIX" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : pm;

    const total = Number(total_amount ?? 0);
    const customerPays = Number(change_for ?? 0);
    const troco = calcTroco(total, customerPays);

    const baseText: React.CSSProperties = { fontSize: compact ? 12 : 12, lineHeight: 1.2 };
    const muted: React.CSSProperties = { ...baseText, color: "#666" };
    const strong: React.CSSProperties = { ...baseText, fontWeight: 900, color: "#111" };

    if (pm === "card") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Levar maquininha</div>
            </div>
        );
    }

    if (pm === "cash") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Cliente paga com: R$ {formatBRL(customerPays)}</div>
                <div style={muted}>Levar de troco: R$ {formatBRL(troco)}</div>
            </div>
        );
    }

    return (
        <div>
            <div style={strong}>
                {label}
                {paid ? " (pago)" : ""}
            </div>
        </div>
    );
}

export default function PedidosPage() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router = useRouter();

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);

    // filtro de lista (ordem pedida)
    const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");

    // ✅ sincroniza o filtro de status com a URL (?status=...)
    useEffect(() => {
        const s = searchParams.get("status");
        if (s === "new" || s === "delivered" || s === "finalized" || s === "canceled") {
            setStatusFilter(s);
        } else {
            setStatusFilter("all");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // modal novo pedido
    const [openNew, setOpenNew] = useState(false);
    const [saving, setSaving] = useState(false);

    // cliente
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerAddress, setCustomerAddress] = useState("");

    // pagamento
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
    const [paid, setPaid] = useState(false);
    const [changeFor, setChangeFor] = useState("0,00");

    // taxa entrega
    const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState("0,00");

    // ---- quantidades rascunho
    type DraftQty = { unit: string; box: string };
    const [draftQty, setDraftQty] = useState<Record<string, DraftQty>>({});
    function getDraft(id: string): DraftQty {
        return draftQty[id] ?? { unit: "", box: "" };
    }
    function setDraft(id: string, patch: Partial<DraftQty>) {
        setDraftQty((prev) => ({ ...prev, [id]: { ...getDraft(id), ...patch } }));
    }
    function toQtyInt(v: string) {
        const n = parseInt((v ?? "").replace(/\D/g, ""), 10);
        return Number.isFinite(n) ? n : 0;
    }

    // carrinho
    type CartItem = { variant: Variant; qty: number; price: number; mode: "unit" | "case" };
    const [cart, setCart] = useState<CartItem[]>([]);

    // busca
    const [q, setQ] = useState("");
    const [results, setResults] = useState<Variant[]>([]);
    const [searching, setSearching] = useState(false);

    // ver pedido
    const [openView, setOpenView] = useState(false);
    const [viewLoading, setViewLoading] = useState(false);
    const [viewOrder, setViewOrder] = useState<OrderFull | null>(null);

    // ação
    type ActionKind = "cancel" | "deliver" | "finalize";
    const [openAction, setOpenAction] = useState(false);
    const [actionKind, setActionKind] = useState<ActionKind>("cancel");
    const [actionOrderId, setActionOrderId] = useState<string | null>(null);
    const [actionNote, setActionNote] = useState("");
    const [actionSaving, setActionSaving] = useState(false);

    // editar
    const [openEdit, setOpenEdit] = useState(false);
    const [editLoading, setEditLoading] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    const [editOrder, setEditOrder] = useState<OrderFull | null>(null);

    const [editCustomerName, setEditCustomerName] = useState("");
    const [editCustomerPhone, setEditCustomerPhone] = useState("");
    const [editCustomerAddress, setEditCustomerAddress] = useState("");
    const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>("pix");
    const [editPaid, setEditPaid] = useState(false);
    const [editChangeFor, setEditChangeFor] = useState("0,00");
    const [editDeliveryFeeEnabled, setEditDeliveryFeeEnabled] = useState(false);
    const [editDeliveryFee, setEditDeliveryFee] = useState("0,00");
    const [editCart, setEditCart] = useState<CartItem[]>([]);

    const [editQ, setEditQ] = useState("");
    const [editResults, setEditResults] = useState<Variant[]>([]);
    const [editSearching, setEditSearching] = useState(false);
    const [editDraftQty, setEditDraftQty] = useState<Record<string, DraftQty>>({});

    function getEditDraft(id: string): DraftQty {
        return editDraftQty[id] ?? { unit: "", box: "" };
    }
    function setEditDraft(id: string, patch: Partial<DraftQty>) {
        setEditDraftQty((prev) => ({ ...prev, [id]: { ...getEditDraft(id), ...patch } }));
    }

    // refs p/ realtime não precisar resubscrever
    const viewOrderIdRef = useRef<string | null>(null);
    const editOrderIdRef = useRef<string | null>(null);

    useEffect(() => {
        viewOrderIdRef.current = openView ? viewOrder?.id ?? null : null;
    }, [openView, viewOrder?.id]);

    useEffect(() => {
        editOrderIdRef.current = openEdit ? editOrder?.id ?? null : null;
    }, [openEdit, editOrder?.id]);

    async function loadCompanySettings() {
        const { data: cu, error: cuErr } = await supabase
            .from("company_users")
            .select("company_id")
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (cuErr || !cu?.company_id) return;

        const { data: comp } = await supabase
            .from("companies")
            .select("delivery_fee_enabled, default_delivery_fee")
            .eq("id", cu.company_id)
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
            .select(
                `
        id, status, channel, total_amount, delivery_fee, payment_method, paid, change_for, created_at,
        details,
        customers ( name, phone, address )
      `
            )
            .order("created_at", { ascending: false })
            .limit(80);

        if (error) {
            setMsg(`Erro ao carregar pedidos: ${error.message}`);
            setOrders([]);
            setLoading(false);
            return;
        }

        const rows = Array.isArray(data) ? data : [];
        setOrders(
            rows.map((o: any) => ({
                ...o,
                customers: o.customers
                    ? {
                        name: o.customers.name ?? null,
                        phone: o.customers.phone ?? null,
                        address: o.customers.address ?? null,
                    }
                    : null,
            })) as OrderRow[]
        );

        setLoading(false);
    }

    useEffect(() => {
        loadCompanySettings();
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // REALTIME (orders + order_items)
    useEffect(() => {
        const ch = supabase
            .channel("realtime-orders-admin")
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload: any) => {
                try {
                    await loadOrders();

                    const orderId = (payload?.new?.id ?? payload?.old?.id ?? null) as string | null;
                    if (!orderId) return;

                    if (viewOrderIdRef.current === orderId) {
                        const full = await fetchOrderFull(orderId);
                        setViewOrder(full);
                    }
                    if (editOrderIdRef.current === orderId) {
                        const full = await fetchOrderFull(orderId);
                        if (full) setEditOrder(full);
                    }
                } catch {
                    // silencioso
                }
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, async (payload: any) => {
                try {
                    await loadOrders();

                    const orderId = (payload?.new?.order_id ?? payload?.old?.order_id ?? null) as string | null;
                    if (!orderId) return;

                    if (viewOrderIdRef.current === orderId) {
                        const full = await fetchOrderFull(orderId);
                        setViewOrder(full);
                    }
                    if (editOrderIdRef.current === orderId) {
                        const full = await fetchOrderFull(orderId);
                        if (full) setEditOrder(full);
                    }
                } catch {
                    // silencioso
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase]);

    function resetNewOrder() {
        setCustomerName("");
        setCustomerPhone("");
        setCustomerAddress("");
        setPaymentMethod("pix");
        setPaid(false);
        setChangeFor("0,00");
        setCart([]);
        setQ("");
        setResults([]);
        setDraftQty({});
        setMsg(null);
    }

    async function searchVariants(text: string) {
        const t = text.trim();
        setQ(text);
        setMsg(null);

        if (t.length < 2) {
            setResults([]);
            return;
        }

        setSearching(true);

        const { data, error } = await supabase
            .from("product_variants")
            .select(
                `
        id, unit_price, has_case, case_qty, case_price,
        unit, volume_value, details, is_active,
        products (
          categories ( name ),
          brands ( name )
        )
      `
            )
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) {
            setMsg(`Erro na busca: ${error.message}`);
            setResults([]);
            setSearching(false);
            return;
        }

        const s = t.toLowerCase();
        const filtered = ((data as Variant[]) ?? []).filter((v) => {
            const cat = v.products?.categories?.name?.toLowerCase() ?? "";
            const brand = v.products?.brands?.name?.toLowerCase() ?? "";
            const det = (v.details ?? "").toLowerCase();
            const vol = v.volume_value ? String(v.volume_value).toLowerCase() : "";
            const unit = v.unit.toLowerCase();
            return [cat, brand, det, vol, unit].some((x) => x.includes(s));
        });

        const top = filtered.slice(0, 40);
        setResults(top);

        setDraftQty((prev) => {
            const next = { ...prev };
            for (const v of top) if (!next[v.id]) next[v.id] = { unit: "", box: "" };
            return next;
        });

        setSearching(false);
    }

    async function searchVariantsEdit(text: string) {
        const t = text.trim();
        setEditQ(text);

        if (t.length < 2) {
            setEditResults([]);
            return;
        }

        setEditSearching(true);

        const { data, error } = await supabase
            .from("product_variants")
            .select(
                `
        id, unit_price, has_case, case_qty, case_price,
        unit, volume_value, details, is_active,
        products (
          categories ( name ),
          brands ( name )
        )
      `
            )
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) {
            setMsg(`Erro na busca: ${error.message}`);
            setEditResults([]);
            setEditSearching(false);
            return;
        }

        const s = t.toLowerCase();
        const filtered = ((data as Variant[]) ?? []).filter((v) => {
            const cat = v.products?.categories?.name?.toLowerCase() ?? "";
            const brand = v.products?.brands?.name?.toLowerCase() ?? "";
            const det = (v.details ?? "").toLowerCase();
            const vol = v.volume_value ? String(v.volume_value).toLowerCase() : "";
            const unit = v.unit.toLowerCase();
            return [cat, brand, det, vol, unit].some((x) => x.includes(s));
        });

        const top = filtered.slice(0, 40);
        setEditResults(top);

        setEditDraftQty((prev) => {
            const next = { ...prev };
            for (const v of top) if (!next[v.id]) next[v.id] = { unit: "", box: "" };
            return next;
        });

        setEditSearching(false);
    }

    function addToCart(variant: Variant, mode: "unit" | "case", qtyToAdd: number) {
        const qAdd = Math.max(0, qtyToAdd || 0);
        if (qAdd <= 0) return;

        const price = mode === "case" ? Number(variant.case_price ?? 0) : Number(variant.unit_price ?? 0);

        setCart((prev) => {
            const idx = prev.findIndex((i) => i.variant.id === variant.id && i.mode === mode);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], qty: copy[idx].qty + qAdd };
                return copy;
            }
            return [...prev, { variant, qty: qAdd, price, mode }];
        });
    }

    function addToEditCart(variant: Variant, mode: "unit" | "case", qtyToAdd: number) {
        const qAdd = Math.max(0, qtyToAdd || 0);
        if (qAdd <= 0) return;

        const price = mode === "case" ? Number(variant.case_price ?? 0) : Number(variant.unit_price ?? 0);

        setEditCart((prev) => {
            const idx = prev.findIndex((i) => i.variant.id === variant.id && i.mode === mode);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], qty: copy[idx].qty + qAdd };
                return copy;
            }
            return [...prev, { variant, qty: qAdd, price, mode }];
        });
    }

    function cartSubtotal(list: CartItem[]) {
        return list.reduce((sum, item) => sum + item.qty * item.price, 0);
    }
    function cartTotalPreview(list: CartItem[], feeEnabled: boolean, feeStr: string) {
        const fee = brlToNumber(feeStr);
        return cartSubtotal(list) + (feeEnabled ? fee : 0);
    }

    async function upsertCustomerFromFields(nameRaw: string, phoneRaw: string, addressRaw: string): Promise<string | null> {
        const phone = phoneRaw.trim();
        const name = nameRaw.trim();
        const address = addressRaw.trim();

        if (!phone || phone.length < 8) {
            setMsg("Informe um telefone válido.");
            return null;
        }
        if (!name) {
            setMsg("Informe o nome do cliente.");
            return null;
        }

        const { data: found, error: findErr } = await supabase
            .from("customers")
            .select("id,name,phone,address")
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();

        if (findErr) {
            setMsg(`Erro ao buscar cliente: ${findErr.message}`);
            return null;
        }

        if (found?.id) {
            const { error: upErr } = await supabase.from("customers").update({ name, address: address || null }).eq("id", found.id);
            if (upErr) {
                setMsg(`Erro ao atualizar cliente: ${upErr.message}`);
                return null;
            }
            return found.id as string;
        }

        const { data: created, error: insErr } = await supabase
            .from("customers")
            .insert({ name, phone, address: address || null })
            .select("id")
            .single();

        if (insErr) {
            setMsg(`Erro ao criar cliente: ${insErr.message}`);
            return null;
        }

        return created.id as string;
    }

    async function upsertCustomer(): Promise<string | null> {
        return upsertCustomerFromFields(customerName, customerPhone, customerAddress);
    }

    async function fetchOrderFull(orderId: string): Promise<OrderFull | null> {
        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .select(
                `
        id, status, channel, total_amount, delivery_fee, payment_method, paid, change_for, created_at,
        details,
        customers ( name, phone, address )
      `
            )
            .eq("id", orderId)
            .single();

        if (ordErr) {
            setMsg(`Erro ao carregar pedido: ${ordErr.message}`);
            return null;
        }

        const { data: items, error: itemsErr } = await supabase
            .from("order_items")
            .select(`id, order_id, product_variant_id, product_name, unit_type, quantity, unit_price, line_total, qty, created_at`)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        if (itemsErr) {
            setMsg(`Erro ao carregar itens: ${itemsErr.message}`);
            return null;
        }

        return { ...(ord as any), items: (items as any) ?? [] };
    }

    async function openOrder(orderId: string, alsoCleanUrl?: boolean) {
        setViewLoading(true);
        setMsg(null);
        const full = await fetchOrderFull(orderId);
        setViewOrder(full);
        setOpenView(true);
        setViewLoading(false);

        if (alsoCleanUrl) {
            router.replace("/pedidos");
        }
    }

    // auto-abrir via ?open=id
    useEffect(() => {
        const id = searchParams.get("open");
        if (!id) return;
        if (viewOrder?.id === id && openView) return;
        openOrder(id, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    function openActionModal(kind: ActionKind, orderId: string) {
        setActionKind(kind);
        setActionOrderId(orderId);
        setActionNote("");
        setOpenAction(true);
    }

    function actionTitle(kind: ActionKind) {
        if (kind === "cancel") return "Cancelar/Inativar pedido";
        if (kind === "deliver") return "Marcar como entregue";
        return "Marcar como finalizado";
    }
    function actionStatus(kind: ActionKind): OrderStatus {
        if (kind === "cancel") return "canceled";
        if (kind === "deliver") return "delivered";
        return "finalized";
    }

    async function runAction() {
        const orderId = actionOrderId;
        if (!orderId) return;

        const note = actionNote.trim();
        if (!note) {
            setMsg("Informe uma observação para essa ação (ex.: falta recolher cascos).");
            return;
        }

        setActionSaving(true);
        setMsg(null);

        const newStatus = actionStatus(actionKind);

        const { error } = await supabase.from("orders").update({ status: newStatus, details: note }).eq("id", orderId);
        if (error) {
            setMsg(`Erro ao atualizar status: ${error.message}`);
            setActionSaving(false);
            return;
        }

        setMsg("✅ Pedido atualizado.");
        setOpenAction(false);
        setActionSaving(false);

        await loadOrders();

        if (viewOrder?.id === orderId) {
            const full = await fetchOrderFull(orderId);
            setViewOrder(full);
        }
        if (editOrder?.id === orderId) {
            const full = await fetchOrderFull(orderId);
            if (full) setEditOrder(full);
        }
    }

    async function printOrder(orderId: string) {
        const full = await fetchOrderFull(orderId);
        if (!full) return;

        const rows = full.items
            .map((it) => {
                const name = escapeHtml(it.product_name ?? "Item");
                const qIt = Number(it.quantity ?? 0);
                const price = Number(it.unit_price ?? 0);
                const total = Number(it.line_total ?? qIt * price);

                return `
          <tr>
            <td>${name}</td>
            <td style="text-align:right;">${qIt}</td>
            <td style="text-align:right;">R$ ${formatBRL(price)}</td>
            <td style="text-align:right;">R$ ${formatBRL(total)}</td>
          </tr>
        `;
            })
            .join("");

        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) {
            setMsg("Erro: popup bloqueado para impressão.");
            return;
        }

        const cust = full.customers;
        const title = `Pedido • ${new Date(full.created_at).toLocaleString("pt-BR")}`;

        const pm = full.payment_method;
        const total = Number(full.total_amount ?? 0);
        const customerPays = Number(full.change_for ?? 0);
        const troco = calcTroco(total, customerPays);

        let payExtra = "";
        if (pm === "card") {
            payExtra = `<div><b>Levar maquininha</b></div>`;
        } else if (pm === "cash") {
            payExtra = `
        <div><b>Cliente paga com:</b> R$ ${formatBRL(customerPays)}</div>
        <div><b>Levar de troco:</b> R$ ${formatBRL(troco)}</div>
      `;
        }

        w.document.open();
        w.document.write(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 12px; font-size: 12px; }
            h1 { margin: 0 0 8px; font-size: 16px; }
            .muted { color: #555; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border-bottom: 1px solid #ddd; padding: 6px; }
            th { text-align: left; background: #f5f5f5; }
            .totals { margin-top: 10px; display: grid; gap: 6px; }
            .row { display:flex; justify-content: space-between; }
            .strong { font-weight: 900; }
            .box { border: 1px solid #ddd; border-radius: 10px; padding: 8px; margin-top: 10px; }
            .obsTitle { font-weight: 900; font-size: 14px; }
            .obsText { font-weight: 900; font-size: 14px; }
            @media print { button { display:none; } }
          </style>
        </head>
        <body>
          <button onclick="window.print()" style="padding:6px 8px; border:1px solid #999; border-radius:10px; cursor:pointer; font-size:12px;">
            Imprimir
          </button>

          <h1>${escapeHtml(title)}</h1>

          <div class="muted">
            <div><b>Status:</b> ${escapeHtml(prettyStatus(String(full.status)))}</div>
            <div><b>Cliente:</b> ${escapeHtml(cust?.name ?? "-")} • ${escapeHtml(cust?.phone ?? "")}</div>
            <div><b>Endereço:</b> ${escapeHtml(cust?.address ?? "-")}</div>

            <div style="margin-top:6px;">
              <div><b>Pagamento:</b> ${escapeHtml(String(full.payment_method))} ${full.paid ? "(pago)" : ""}</div>
              ${payExtra}
            </div>
          </div>

          ${full.details ? `<div class="box"><div class="obsTitle">Observações:</div><div class="obsText">${escapeHtml(full.details)}</div></div>` : ""}

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:right;">Qtd</th>
                <th style="text-align:right;">Preço</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="4">Sem itens</td></tr>`}
            </tbody>
          </table>

          <div class="totals">
            <div class="row"><span>Taxa entrega</span><span>R$ ${formatBRL(full.delivery_fee ?? 0)}</span></div>
            <div class="row strong"><span>Total</span><span>R$ ${formatBRL(full.total_amount ?? 0)}</span></div>
          </div>

          <script>setTimeout(() => window.print(), 200);</script>
        </body>
      </html>
    `);
        w.document.close();
    }

    async function createOrder() {
        if (cart.length === 0) {
            setMsg("Adicione pelo menos 1 item no pedido.");
            return;
        }

        setSaving(true);
        setMsg(null);

        const customerId = await upsertCustomer();
        if (!customerId) {
            setSaving(false);
            return;
        }

        const fee = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
        const change = paymentMethod === "cash" ? brlToNumber(changeFor) : null;

        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .insert({
                customer_id: customerId,
                channel: "admin",
                status: "new",
                payment_method: paymentMethod,
                paid,
                change_for: change,
                delivery_fee: fee,
                details: null,
            })
            .select("id")
            .single();

        if (ordErr) {
            setMsg(`Erro ao criar pedido: ${ordErr.message}`);
            setSaving(false);
            return;
        }

        const orderId = ord.id as string;

        const itemsPayload = cart.map((item) => {
            const qItem = Math.max(1, Number(item.qty) || 0);
            return {
                order_id: orderId,
                product_variant_id: item.variant.id,
                quantity: qItem,
                qty: qItem,
                unit_price: item.price,
            };
        });

        const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
        if (itemsErr) {
            setMsg(`Erro ao salvar itens: ${itemsErr.message}`);
            setSaving(false);
            return;
        }

        setSaving(false);
        setOpenNew(false);
        resetNewOrder();
        await loadOrders();
    }

    async function openEditOrder(orderId: string) {
        setEditLoading(true);
        setMsg(null);

        const full = await fetchOrderFull(orderId);
        if (!full) {
            setEditLoading(false);
            return;
        }

        setEditOrder(full);

        setEditCustomerName(full.customers?.name ?? "");
        setEditCustomerPhone(full.customers?.phone ?? "");
        setEditCustomerAddress(full.customers?.address ?? "");
        setEditPaymentMethod(full.payment_method);
        setEditPaid(!!full.paid);
        setEditChangeFor(formatBRL(Number(full.change_for ?? 0)));
        setEditDeliveryFeeEnabled(Number(full.delivery_fee ?? 0) > 0);
        setEditDeliveryFee(formatBRL(Number(full.delivery_fee ?? 0)));

        const mapped: CartItem[] = (full.items ?? []).map((it) => {
            const fake: Variant = {
                id: it.product_variant_id ?? `legacy-${it.id}`,
                unit_price: Number(it.unit_price ?? 0),
                has_case: false,
                case_price: null,
                case_qty: null,
                unit: "none",
                volume_value: null,
                details: it.product_name ?? null,
                is_active: true,
                products: { categories: { name: "" }, brands: { name: "" } },
            };
            return { variant: fake, qty: Number(it.quantity ?? 1), price: Number(it.unit_price ?? 0), mode: "unit" };
        });

        setEditCart(mapped);
        setEditQ("");
        setEditResults([]);
        setEditDraftQty({});

        setOpenEdit(true);
        setEditLoading(false);
    }

    async function saveEditOrder() {
        if (!editOrder) return;

        if (editCart.length === 0) {
            setMsg("O pedido precisa ter pelo menos 1 item.");
            return;
        }

        setEditSaving(true);
        setMsg(null);

        const customerId = await upsertCustomerFromFields(editCustomerName, editCustomerPhone, editCustomerAddress);
        if (!customerId) {
            setEditSaving(false);
            return;
        }

        const fee = editDeliveryFeeEnabled ? brlToNumber(editDeliveryFee) : 0;
        const change = editPaymentMethod === "cash" ? brlToNumber(editChangeFor) : null;

        const { error: upOrdErr } = await supabase
            .from("orders")
            .update({
                customer_id: customerId,
                payment_method: editPaymentMethod,
                paid: editPaid,
                change_for: change,
                delivery_fee: fee,
            })
            .eq("id", editOrder.id);

        if (upOrdErr) {
            setMsg(`Erro ao atualizar pedido: ${upOrdErr.message}`);
            setEditSaving(false);
            return;
        }

        const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", editOrder.id);
        if (delErr) {
            setMsg(`Erro ao apagar itens antigos: ${delErr.message}`);
            setEditSaving(false);
            return;
        }

        const itemsToInsert = editCart.map((item) => {
            const qItem = Math.max(1, Number(item.qty) || 0);
            return {
                order_id: editOrder.id,
                product_variant_id: item.variant.id,
                quantity: qItem,
                qty: qItem,
                unit_price: Number(item.price ?? 0),
            };
        });

        const { error: insErr } = await supabase.from("order_items").insert(itemsToInsert);
        if (insErr) {
            setMsg(`Erro ao inserir itens: ${insErr.message}`);
            setEditSaving(false);
            return;
        }

        setMsg("✅ Pedido editado com sucesso.");
        setEditSaving(false);
        setOpenEdit(false);

        await loadOrders();

        if (viewOrder?.id === editOrder.id) {
            const full = await fetchOrderFull(editOrder.id);
            setViewOrder(full);
        }
    }

    // stats + ordenação/filtro
    const stats = useMemo(() => {
        const by = { new: 0, delivered: 0, finalized: 0, canceled: 0 } as Record<OrderStatus, number>;
        for (const o of orders) {
            const s = String(o.status) as OrderStatus;
            if (by[s] !== undefined) by[s] += 1;
        }
        return { total: orders.length, ...by };
    }, [orders]);

    const filteredOrders = useMemo(() => {
        const priority: Record<string, number> = { new: 0, delivered: 1, finalized: 2, canceled: 3 };
        const base = statusFilter === "all" ? orders : orders.filter((o) => String(o.status) === statusFilter);

        return [...base].sort((a, b) => {
            const pa = priority[String(a.status)] ?? 99;
            const pb = priority[String(b.status)] ?? 99;
            if (pa !== pb) return pa - pb;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    }, [orders, statusFilter]);

    // cálculo "Levar de troco" (novo)
    const newTotalNow = useMemo(() => cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee), [cart, deliveryFeeEnabled, deliveryFee]);
    const newCustomerPays = useMemo(() => brlToNumber(changeFor), [changeFor]);
    const newTroco = useMemo(() => calcTroco(newTotalNow, newCustomerPays), [newTotalNow, newCustomerPays]);

    // cálculo "Levar de troco" (editar)
    const editTotalNow = useMemo(() => cartTotalPreview(editCart, editDeliveryFeeEnabled, editDeliveryFee), [editCart, editDeliveryFeeEnabled, editDeliveryFee]);
    const editCustomerPays = useMemo(() => brlToNumber(editChangeFor), [editChangeFor]);
    const editTroco = useMemo(() => calcTroco(editTotalNow, editCustomerPays), [editTotalNow, editCustomerPays]);

    return (
        <div style={{ fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Pedidos</h1>
                    <p style={{ marginTop: 6, color: "#666", fontSize: 12, lineHeight: 1.2 }}>Acessar • Cancelar/Inativar • Entregue • Finalizado • Imprimir • Editar</p>
                    <p style={{ marginTop: 4, color: "#777", fontSize: 12, lineHeight: 1.2 }}>
                        Obs.: para <b>cancelar/entregar/finalizar</b>, será exigida uma observação.
                    </p>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={loadOrders} style={btnPurpleOutline(false)}>
                        Recarregar
                    </button>

                    <button
                        onClick={() => {
                            resetNewOrder();
                            setOpenNew(true);
                        }}
                        style={btnPurple(false)}
                    >
                        + Novo pedido
                    </button>
                </div>
            </div>

            {msg && <p style={{ color: msg.startsWith("✅") ? "green" : "crimson", marginTop: 10 }}>{msg}</p>}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setStatusFilter("new")} style={chip(statusFilter === "new")}>
                    Novo ({stats.new})
                </button>
                <button onClick={() => setStatusFilter("delivered")} style={chip(statusFilter === "delivered")}>
                    Entregue ({stats.delivered})
                </button>
                <button onClick={() => setStatusFilter("finalized")} style={chip(statusFilter === "finalized")}>
                    Finalizado ({stats.finalized})
                </button>
                <button onClick={() => setStatusFilter("canceled")} style={chip(statusFilter === "canceled")}>
                    Cancelado ({stats.canceled})
                </button>
                <button onClick={() => setStatusFilter("all")} style={chip(statusFilter === "all")}>
                    Ver todos ({stats.total})
                </button>
            </div>

            <section style={{ marginTop: 12, padding: 12, border: "1px solid #e6e6e6", borderRadius: 14 }}>
                {loading ? (
                    <p>Carregando...</p>
                ) : (
                    <div style={{ width: "100%", overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
                            <thead>
                                <tr style={{ background: "#f7f7f7" }}>
                                    <th style={{ textAlign: "left", padding: 8, fontSize: 12 }}>Data</th>
                                    <th style={{ textAlign: "left", padding: 8, fontSize: 12 }}>Cliente</th>
                                    <th style={{ textAlign: "left", padding: 8, fontSize: 12 }}>Pagamento</th>
                                    <th style={{ textAlign: "center", padding: 8, fontSize: 12 }}>Status</th>
                                    <th style={{ textAlign: "right", padding: 8, fontSize: 12 }}>Total</th>
                                    <th style={{ textAlign: "right", padding: 8, fontSize: 12 }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((o) => {
                                    const st = String(o.status);
                                    const editOk = canEdit(st);

                                    return (
                                        <tr key={o.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                                            <td style={{ padding: 8, whiteSpace: "nowrap" }}>{formatDT(o.created_at)}</td>

                                            <td style={{ padding: 8, minWidth: 360 }}>
                                                <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customers?.name ?? "-"}</div>
                                                <div style={{ color: "#666", fontSize: 12, whiteSpace: "nowrap" }}>{o.customers?.phone ?? ""}</div>

                                                {o.details ? <div style={{ color: "#111", marginTop: 6, fontSize: 13, fontWeight: 900 }}>OBS: {o.details}</div> : null}
                                            </td>

                                            <td style={{ padding: 8, minWidth: 220 }}>
                                                <OrderPaymentInfo payment_method={o.payment_method} paid={!!o.paid} change_for={o.change_for} total_amount={o.total_amount} compact />
                                            </td>

                                            <td style={{ padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                                                <span style={statusBadgeStyle(st)}>{prettyStatus(st)}</span>
                                            </td>

                                            <td style={{ padding: 8, textAlign: "right", fontWeight: 900, whiteSpace: "nowrap" }}>R$ {formatBRL(o.total_amount)}</td>

                                            <td style={{ padding: 8, textAlign: "right" }}>
                                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                                                    <button onClick={() => openOrder(o.id)} style={btnPurpleOutline(false)}>
                                                        Ver
                                                    </button>

                                                    <button onClick={() => printOrder(o.id)} style={btnPurpleOutline(false)}>
                                                        Imprimir
                                                    </button>

                                                    <button onClick={() => openActionModal("cancel", o.id)} disabled={!canCancel(st)} style={btnPurple(!canCancel(st))}>
                                                        Cancelar
                                                    </button>

                                                    <button onClick={() => openActionModal("deliver", o.id)} disabled={!canDeliver(st)} style={btnPurple(!canDeliver(st))}>
                                                        Entregue
                                                    </button>

                                                    <button onClick={() => openActionModal("finalize", o.id)} disabled={!canFinalize(st)} style={btnPurple(!canFinalize(st))}>
                                                        Finalizar
                                                    </button>

                                                    <button
                                                        onClick={() => openEditOrder(o.id)}
                                                        disabled={!editOk}
                                                        title={!editOk ? "Editar bloqueado após ação de status" : "Editar pedido"}
                                                        style={{ ...btnPurpleOutline(!editOk), borderWidth: 2, fontWeight: 900 }}
                                                    >
                                                        EDITAR
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}

                                {filteredOrders.length === 0 && (
                                    <tr>
                                        <td colSpan={6} style={{ padding: 10, color: "#666", fontSize: 12 }}>
                                            Nenhum pedido nesse filtro.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ========= MODAIS ========= */}

            {/* MODAL NOVO PEDIDO */}
            <Modal title="Novo pedido" open={openNew} onClose={() => setOpenNew(false)}>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", fontSize: 12 }}>
                    <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Cliente</div>
                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 200px" }}>
                            <input
                                placeholder="Nome"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                            />
                            <input
                                placeholder="Telefone (WhatsApp)"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                            />
                        </div>
                        <input
                            placeholder="Endereço (texto livre)"
                            value={customerAddress}
                            onChange={(e) => setCustomerAddress(e.target.value)}
                            style={{ marginTop: 8, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                        />
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Pagamento</div>

                        <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                            style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                        >
                            <option value="pix">PIX</option>
                            <option value="card">Cartão</option>
                            <option value="cash">Dinheiro</option>
                        </select>

                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontWeight: 700 }}>
                            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
                            Já está pago
                        </label>

                        {paymentMethod === "cash" && (
                            <div style={{ marginTop: 8 }}>
                                <label style={{ fontWeight: 700 }}>Cliente paga com (R$)</label>
                                <input
                                    value={changeFor}
                                    onChange={(e) => setChangeFor(formatBRLInput(e.target.value))}
                                    style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                    inputMode="numeric"
                                />

                                <div style={{ marginTop: 8, padding: 8, borderRadius: 10, border: "1px solid #eee", background: "#fafafa" }}>
                                    <div style={{ fontWeight: 900, color: "#111" }}>Levar de troco: R$ {formatBRL(newTroco)}</div>
                                    <div style={{ color: "#666", fontSize: 12 }}>
                                        Total atual: R$ {formatBRL(newTotalNow)} • Cliente paga com: R$ {formatBRL(newCustomerPays)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {paymentMethod === "card" && (
                            <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                                <b>Levar maquininha</b>
                            </div>
                        )}
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Entrega</div>

                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                            <input type="checkbox" checked={deliveryFeeEnabled} onChange={(e) => setDeliveryFeeEnabled(e.target.checked)} />
                            Cobrar taxa
                        </label>

                        <div style={{ marginTop: 8 }}>
                            <label style={{ fontWeight: 700 }}>Taxa de entrega (R$)</label>
                            <input
                                value={deliveryFee}
                                onChange={(e) => setDeliveryFee(formatBRLInput(e.target.value))}
                                disabled={!deliveryFeeEnabled}
                                style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                inputMode="numeric"
                            />
                            <small style={{ color: "#666" }}>Se desligado, fica 0.</small>
                        </div>
                    </div>

                    <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Adicionar itens</div>

                        <input
                            placeholder="Buscar (categoria, marca, detalhes, volume...)"
                            value={q}
                            onChange={(e) => searchVariants(e.target.value)}
                            style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                        />

                        <div style={{ marginTop: 8 }}>
                            {searching ? (
                                <p>Buscando...</p>
                            ) : results.length === 0 ? (
                                <p style={{ color: "#666" }}>Digite pelo menos 2 letras para buscar.</p>
                            ) : (
                                <div style={{ display: "grid", gap: 8 }}>
                                    {results.map((v) => {
                                        const cat = v.products?.categories?.name ?? "";
                                        const brand = v.products?.brands?.name ?? "";
                                        const vol = v.volume_value ? `${v.volume_value}${labelUnit(v.unit)}` : "";
                                        const title = `${cat} • ${brand}`.trim();
                                        const sub = [v.details ?? "", vol].filter(Boolean).join(" • ");

                                        const d = getDraft(v.id);
                                        const unitN = toQtyInt(d.unit);
                                        const boxN = toQtyInt(d.box);
                                        const canAdd = unitN > 0 || boxN > 0;

                                        return (
                                            <div
                                                key={v.id}
                                                style={{
                                                    border: "1px solid #eee",
                                                    borderRadius: 12,
                                                    padding: 10,
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    gap: 10,
                                                    alignItems: "center",
                                                }}
                                            >
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {title || "Produto"}
                                                    </div>
                                                    <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub || "-"}</div>
                                                    <div style={{ color: "#111", marginTop: 4, fontSize: 12 }}>
                                                        Unit: <b>R$ {formatBRL(v.unit_price)}</b>{" "}
                                                        {v.has_case ? (
                                                            <>
                                                                • Caixa: <b>R$ {formatBRL(v.case_price ?? 0)}</b> ({v.case_qty ?? "?"} un)
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <label style={{ fontSize: 11, fontWeight: 900 }}>Un</label>
                                                        <input
                                                            value={d.unit}
                                                            onChange={(e) => setDraft(v.id, { unit: e.target.value })}
                                                            placeholder="0"
                                                            inputMode="numeric"
                                                            style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                                                        />
                                                    </div>

                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <label style={{ fontSize: 11, fontWeight: 900 }}>Cx</label>
                                                        <input
                                                            value={d.box}
                                                            onChange={(e) => setDraft(v.id, { box: e.target.value })}
                                                            placeholder="0"
                                                            inputMode="numeric"
                                                            style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                                                        />
                                                    </div>

                                                    <button
                                                        disabled={!canAdd}
                                                        onClick={() => {
                                                            if (unitN > 0) addToCart(v, "unit", unitN);
                                                            if (boxN > 0) {
                                                                if (v.has_case && v.case_price) addToCart(v, "case", boxN);
                                                            }
                                                            setDraftQty((prev) => ({ ...prev, [v.id]: { unit: "", box: "" } }));
                                                        }}
                                                        style={btnPurple(!canAdd)}
                                                    >
                                                        Adicionar
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Carrinho</div>

                        {cart.length === 0 ? (
                            <p style={{ color: "#666" }}>Nenhum item ainda.</p>
                        ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                                {cart.map((item, idx) => {
                                    const cat = item.variant.products?.categories?.name ?? "";
                                    const brand = item.variant.products?.brands?.name ?? "";
                                    const vol = item.variant.volume_value ? `${item.variant.volume_value}${labelUnit(item.variant.unit)}` : "";
                                    const line = `${cat} • ${brand}`.trim();
                                    const sub = [item.variant.details ?? "", vol].filter(Boolean).join(" • ");

                                    return (
                                        <div
                                            key={`${item.variant.id}-${item.mode}-${idx}`}
                                            style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}
                                        >
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {line || "Produto"} — {item.mode === "unit" ? "Unit" : "Caixa"}
                                                </div>
                                                <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub || "-"}</div>
                                                <div style={{ marginTop: 4, fontSize: 12 }}>
                                                    <b>{item.qty}</b> × <b>R$ {formatBRL(item.price)}</b> = <b>R$ {formatBRL(item.qty * item.price)}</b>
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                <button
                                                    onClick={() =>
                                                        setCart((prev) => {
                                                            const copy = [...prev];
                                                            copy[idx] = { ...copy[idx], qty: Math.max(1, copy[idx].qty - 1) };
                                                            return copy;
                                                        })
                                                    }
                                                    style={btnPurpleOutline(false)}
                                                >
                                                    -
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        setCart((prev) => {
                                                            const copy = [...prev];
                                                            copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
                                                            return copy;
                                                        })
                                                    }
                                                    style={btnPurpleOutline(false)}
                                                >
                                                    +
                                                </button>
                                                <button onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))} style={btnPurpleOutline(false)}>
                                                    Remover
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Subtotal</span>
                                <b>R$ {formatBRL(cartSubtotal(cart))}</b>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Taxa de entrega</span>
                                <b>R$ {formatBRL(deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0)}</b>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                <span>Total</span>
                                <b>R$ {formatBRL(cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee))}</b>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                    <button onClick={createOrder} disabled={saving} style={btnPurple(saving)}>
                        {saving ? "Salvando..." : "Salvar pedido"}
                    </button>

                    {msg && <span style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</span>}
                </div>
            </Modal>

            {/* MODAL VER PEDIDO */}
            <Modal title={`Pedido ${viewOrder ? `• ${formatDT(viewOrder.created_at)} • ${prettyStatus(String(viewOrder.status))}` : ""}`} open={openView} onClose={() => setOpenView(false)}>
                {viewLoading ? (
                    <p>Carregando pedido...</p>
                ) : !viewOrder ? (
                    <p>Nenhum pedido selecionado.</p>
                ) : (
                    <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => printOrder(viewOrder.id)} style={btnPurpleOutline(false)}>
                                Imprimir
                            </button>

                            <button onClick={() => openActionModal("cancel", viewOrder.id)} disabled={!canCancel(String(viewOrder.status))} style={btnPurple(!canCancel(String(viewOrder.status)))}>
                                Cancelar
                            </button>

                            <button onClick={() => openActionModal("deliver", viewOrder.id)} disabled={!canDeliver(String(viewOrder.status))} style={btnPurple(!canDeliver(String(viewOrder.status)))}>
                                Entregue
                            </button>

                            <button onClick={() => openActionModal("finalize", viewOrder.id)} disabled={!canFinalize(String(viewOrder.status))} style={btnPurple(!canFinalize(String(viewOrder.status)))}>
                                Finalizar
                            </button>

                            <button onClick={() => openEditOrder(viewOrder.id)} disabled={!canEdit(String(viewOrder.status))} style={btnPurpleOutline(!canEdit(String(viewOrder.status)))}>
                                EDITAR
                            </button>
                        </div>

                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Cliente</div>
                            <div style={{ fontWeight: 900 }}>{viewOrder.customers?.name ?? "-"}</div>
                            <div style={{ color: "#666" }}>{viewOrder.customers?.phone ?? ""}</div>
                            <div style={{ color: "#666" }}>{viewOrder.customers?.address ?? "-"}</div>

                            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <span style={statusBadgeStyle(String(viewOrder.status))}>{prettyStatus(String(viewOrder.status))}</span>

                                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 8, background: "#fafafa", minWidth: 260 }}>
                                    <div style={{ fontWeight: 900, marginBottom: 4 }}>Pagamento</div>
                                    <OrderPaymentInfo
                                        payment_method={viewOrder.payment_method}
                                        paid={!!viewOrder.paid}
                                        change_for={viewOrder.change_for}
                                        total_amount={viewOrder.total_amount}
                                    />
                                </div>
                            </div>
                        </div>

                        {viewOrder.details ? (
                            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                                <div style={{ fontWeight: 900, marginBottom: 6, fontSize: 14 }}>OBSERVAÇÕES</div>
                                <div style={{ color: "#111", fontWeight: 900, fontSize: 14 }}>{viewOrder.details}</div>
                            </div>
                        ) : null}

                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Itens</div>

                            {viewOrder.items.length === 0 ? (
                                <p style={{ color: "#666" }}>Sem itens.</p>
                            ) : (
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr style={{ background: "#f7f7f7" }}>
                                            <th style={{ textAlign: "left", padding: 6, fontSize: 12 }}>Item</th>
                                            <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Qtd</th>
                                            <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Preço</th>
                                            <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {viewOrder.items.map((it) => {
                                            const qIt = Number(it.quantity ?? 0);
                                            const price = Number(it.unit_price ?? 0);
                                            const total = Number(it.line_total ?? qIt * price);

                                            return (
                                                <tr key={it.id} style={{ borderTop: "1px solid #eee" }}>
                                                    <td style={{ padding: 6 }}>{it.product_name ?? "Item"}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>{qIt}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(price)}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(total)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}

                            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>Taxa de entrega</span>
                                    <b>R$ {formatBRL(viewOrder.delivery_fee ?? 0)}</b>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                    <span>Total</span>
                                    <b>R$ {formatBRL(viewOrder.total_amount ?? 0)}</b>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* MODAL AÇÃO */}
            <Modal title={actionTitle(actionKind)} open={openAction} onClose={() => setOpenAction(false)}>
                <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                    <p style={{ margin: 0, color: "#666" }}>Informe uma observação para registrar essa ação.</p>

                    <textarea
                        value={actionNote}
                        onChange={(e) => setActionNote(e.target.value)}
                        placeholder="Digite a observação..."
                        rows={4}
                        style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, fontWeight: 900, fontSize: 12 }}
                    />

                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={runAction} disabled={actionSaving} style={btnPurple(actionSaving)}>
                            {actionSaving ? "Salvando..." : "Confirmar"}
                        </button>

                        <button onClick={() => setOpenAction(false)} disabled={actionSaving} style={btnPurpleOutline(false)}>
                            Voltar
                        </button>
                    </div>

                    <small style={{ color: "#777" }}>
                        Status: <b>{prettyStatus(actionStatus(actionKind))}</b> • observação salva em <b>orders.details</b>.
                    </small>
                </div>
            </Modal>

            {/* MODAL EDITAR */}
            <Modal title={`Editar pedido ${editOrder ? `• ${formatDT(editOrder.created_at)} • ${prettyStatus(String(editOrder.status))}` : ""}`} open={openEdit} onClose={() => setOpenEdit(false)}>
                {editLoading ? (
                    <p>Carregando...</p>
                ) : !editOrder ? (
                    <p>Nenhum pedido selecionado.</p>
                ) : !canEdit(String(editOrder.status)) ? (
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, fontSize: 12 }}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Edição bloqueada</div>
                        <p style={{ margin: 0, color: "#666" }}>
                            Este pedido já teve uma ação de status (<b>{prettyStatus(String(editOrder.status))}</b>). Pela regra, não pode mais editar.
                        </p>
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Cliente</div>
                            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 200px" }}>
                                <input
                                    placeholder="Nome"
                                    value={editCustomerName}
                                    onChange={(e) => setEditCustomerName(e.target.value)}
                                    style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                />
                                <input
                                    placeholder="Telefone (WhatsApp)"
                                    value={editCustomerPhone}
                                    onChange={(e) => setEditCustomerPhone(e.target.value)}
                                    style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                />
                            </div>
                            <input
                                placeholder="Endereço"
                                value={editCustomerAddress}
                                onChange={(e) => setEditCustomerAddress(e.target.value)}
                                style={{ marginTop: 8, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                            />
                        </div>

                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                                <div style={{ fontWeight: 900, marginBottom: 8 }}>Pagamento</div>

                                <select
                                    value={editPaymentMethod}
                                    onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                                    style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                >
                                    <option value="pix">PIX</option>
                                    <option value="card">Cartão</option>
                                    <option value="cash">Dinheiro</option>
                                </select>

                                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontWeight: 700 }}>
                                    <input type="checkbox" checked={editPaid} onChange={(e) => setEditPaid(e.target.checked)} />
                                    Já está pago
                                </label>

                                {editPaymentMethod === "cash" && (
                                    <div style={{ marginTop: 8 }}>
                                        <label style={{ fontWeight: 700 }}>Cliente paga com (R$)</label>
                                        <input
                                            value={editChangeFor}
                                            onChange={(e) => setEditChangeFor(formatBRLInput(e.target.value))}
                                            style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                            inputMode="numeric"
                                        />

                                        <div style={{ marginTop: 8, padding: 8, borderRadius: 10, border: "1px solid #eee", background: "#fafafa" }}>
                                            <div style={{ fontWeight: 900, color: "#111" }}>Levar de troco: R$ {formatBRL(editTroco)}</div>
                                            <div style={{ color: "#666", fontSize: 12 }}>
                                                Total atual: R$ {formatBRL(editTotalNow)} • Cliente paga com: R$ {formatBRL(editCustomerPays)}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {editPaymentMethod === "card" && (
                                    <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                                        <b>Levar maquininha</b>
                                    </div>
                                )}
                            </div>

                            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                                <div style={{ fontWeight: 900, marginBottom: 8 }}>Entrega</div>

                                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                                    <input type="checkbox" checked={editDeliveryFeeEnabled} onChange={(e) => setEditDeliveryFeeEnabled(e.target.checked)} />
                                    Cobrar taxa
                                </label>

                                <div style={{ marginTop: 8 }}>
                                    <label style={{ fontWeight: 700 }}>Taxa de entrega (R$)</label>
                                    <input
                                        value={editDeliveryFee}
                                        onChange={(e) => setEditDeliveryFee(formatBRLInput(e.target.value))}
                                        disabled={!editDeliveryFeeEnabled}
                                        style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                                        inputMode="numeric"
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Adicionar itens</div>

                            <input
                                placeholder="Buscar..."
                                value={editQ}
                                onChange={(e) => searchVariantsEdit(e.target.value)}
                                style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                            />

                            <div style={{ marginTop: 8 }}>
                                {editSearching ? (
                                    <p>Buscando...</p>
                                ) : editResults.length === 0 ? (
                                    <p style={{ color: "#666" }}>Digite pelo menos 2 letras para buscar.</p>
                                ) : (
                                    <div style={{ display: "grid", gap: 8 }}>
                                        {editResults.map((v) => {
                                            const cat = v.products?.categories?.name ?? "";
                                            const brand = v.products?.brands?.name ?? "";
                                            const vol = v.volume_value ? `${v.volume_value}${labelUnit(v.unit)}` : "";
                                            const title = `${cat} • ${brand}`.trim();
                                            const sub = [v.details ?? "", vol].filter(Boolean).join(" • ");

                                            const d = getEditDraft(v.id);
                                            const unitN = toQtyInt(d.unit);
                                            const boxN = toQtyInt(d.box);
                                            const canAdd = unitN > 0 || boxN > 0;

                                            return (
                                                <div
                                                    key={v.id}
                                                    style={{
                                                        border: "1px solid #eee",
                                                        borderRadius: 12,
                                                        padding: 10,
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        gap: 10,
                                                        alignItems: "center",
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                            {title || "Produto"}
                                                        </div>
                                                        <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub || "-"}</div>
                                                        <div style={{ color: "#111", marginTop: 4, fontSize: 12 }}>
                                                            Unit: <b>R$ {formatBRL(v.unit_price)}</b>{" "}
                                                            {v.has_case ? (
                                                                <>
                                                                    • Caixa: <b>R$ {formatBRL(v.case_price ?? 0)}</b> ({v.case_qty ?? "?"} un)
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                        <div style={{ display: "grid", gap: 6 }}>
                                                            <label style={{ fontSize: 11, fontWeight: 900 }}>Un</label>
                                                            <input
                                                                value={d.unit}
                                                                onChange={(e) => setEditDraft(v.id, { unit: e.target.value })}
                                                                placeholder="0"
                                                                inputMode="numeric"
                                                                style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                                                            />
                                                        </div>

                                                        <div style={{ display: "grid", gap: 6 }}>
                                                            <label style={{ fontSize: 11, fontWeight: 900 }}>Cx</label>
                                                            <input
                                                                value={d.box}
                                                                onChange={(e) => setEditDraft(v.id, { box: e.target.value })}
                                                                placeholder="0"
                                                                inputMode="numeric"
                                                                style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                                                            />
                                                        </div>

                                                        <button
                                                            disabled={!canAdd}
                                                            onClick={() => {
                                                                if (unitN > 0) addToEditCart(v, "unit", unitN);
                                                                if (boxN > 0) {
                                                                    if (v.has_case && v.case_price) addToEditCart(v, "case", boxN);
                                                                }
                                                                setEditDraftQty((prev) => ({ ...prev, [v.id]: { unit: "", box: "" } }));
                                                            }}
                                                            style={btnPurple(!canAdd)}
                                                        >
                                                            Adicionar
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Itens do pedido</div>

                            {editCart.length === 0 ? (
                                <p style={{ color: "#666" }}>Nenhum item.</p>
                            ) : (
                                <div style={{ display: "grid", gap: 8 }}>
                                    {editCart.map((item, idx) => {
                                        const cat = item.variant.products?.categories?.name ?? "";
                                        const brand = item.variant.products?.brands?.name ?? "";
                                        const vol = item.variant.volume_value ? `${item.variant.volume_value}${labelUnit(item.variant.unit)}` : "";
                                        const line = `${cat} • ${brand}`.trim();
                                        const sub = [item.variant.details ?? "", vol].filter(Boolean).join(" • ");

                                        return (
                                            <div
                                                key={`${item.variant.id}-${item.mode}-${idx}`}
                                                style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}
                                            >
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {line || item.variant.details || "Produto"} — {item.mode === "unit" ? "Unit" : "Caixa"}
                                                    </div>
                                                    <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub || "-"}</div>
                                                    <div style={{ marginTop: 4, fontSize: 12 }}>
                                                        <b>{item.qty}</b> × <b>R$ {formatBRL(item.price)}</b> = <b>R$ {formatBRL(item.qty * item.price)}</b>
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                    <button
                                                        onClick={() =>
                                                            setEditCart((prev) => {
                                                                const copy = [...prev];
                                                                copy[idx] = { ...copy[idx], qty: Math.max(1, copy[idx].qty - 1) };
                                                                return copy;
                                                            })
                                                        }
                                                        style={btnPurpleOutline(false)}
                                                    >
                                                        -
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            setEditCart((prev) => {
                                                                const copy = [...prev];
                                                                copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
                                                                return copy;
                                                            })
                                                        }
                                                        style={btnPurpleOutline(false)}
                                                    >
                                                        +
                                                    </button>
                                                    <button onClick={() => setEditCart((prev) => prev.filter((_, i) => i !== idx))} style={btnPurpleOutline(false)}>
                                                        Remover
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>Subtotal</span>
                                    <b>R$ {formatBRL(cartSubtotal(editCart))}</b>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>Taxa de entrega</span>
                                    <b>R$ {formatBRL(editDeliveryFeeEnabled ? brlToNumber(editDeliveryFee) : 0)}</b>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                    <span>Total (prévia)</span>
                                    <b>R$ {formatBRL(cartTotalPreview(editCart, editDeliveryFeeEnabled, editDeliveryFee))}</b>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={saveEditOrder} disabled={editSaving} style={btnPurple(editSaving)}>
                                {editSaving ? "Salvando..." : "Salvar alterações"}
                            </button>
                            <button onClick={() => setOpenEdit(false)} disabled={editSaving} style={btnPurpleOutline(false)}>
                                Cancelar
                            </button>
                        </div>

                        <small style={{ color: "#777" }}>
                            Importante: ao editar, os itens são <b>substituídos</b>. Se algum item estiver sem <b>product_variant_id</b> válido, remova e adicione pelo buscador.
                        </small>
                    </div>
                )}
            </Modal>
        </div>
    );
}
