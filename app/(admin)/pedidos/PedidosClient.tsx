// app/(admin)/pedidos/PedidosClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

import NewOrderModal from "@/lib/orders/NewOrderModal";
import ViewOrderModal from "@/lib/orders/ViewOrderModal";
import EditOrderModal from "@/lib/orders/EditOrderModal";
import ActionModal, { ActionKind } from "@/lib/orders/ActionModal";

// Nota: removido OrderPaymentInfo pois pagamento/infos ficam só no modal agora.

import type {
    CartItem,
    DraftQty,
    OrderFull,
    OrderRow,
    OrderStatus,
    PaymentMethod,
    Variant,
} from "@/lib/orders/types";

import {
    brlToNumber,
    buildItemsPayload,
    calcTroco,
    cartSubtotal,
    cartTotalPreview,
    chip,
    formatBRL,
    formatDT,
    prettyStatus,
    statusBadgeStyle,
    btnPurple,
    btnPurpleOutline,
    btnOrange,
    btnOrangeOutline,
    ORANGE,
    escapeHtml,
} from "@/lib/orders/helpers";

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

function addToCartLocal(
    setter: React.Dispatch<React.SetStateAction<CartItem[]>>,
    variant: Variant,
    mode: "unit" | "case",
    qtyToAdd: number
) {
    const qAdd = Math.max(0, qtyToAdd || 0);
    if (qAdd <= 0) return;
    const price =
        mode === "case" ? Number(variant.case_price ?? 0) : Number(variant.unit_price ?? 0);

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

export default function PedidosPage() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router = useRouter();

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
    useEffect(() => {
        const s = searchParams.get("status");
        if (s === "new" || s === "delivered" || s === "finalized" || s === "canceled") {
            setStatusFilter(s);
        } else {
            setStatusFilter("all");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // company settings -> taxa
    const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState("0,00");

    const [openNew, setOpenNew] = useState(false);
    const [saving, setSaving] = useState(false);

    // NEW FORM
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerAddress, setCustomerAddress] = useState("");
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
    const [paid, setPaid] = useState(false);
    const [changeFor, setChangeFor] = useState("0,00");

    const [q, setQ] = useState("");
    const [results, setResults] = useState<Variant[]>([]);
    const [searching, setSearching] = useState(false);

    const [draftQty, setDraftQty] = useState<Record<string, DraftQty>>({});
    const getDraft = (id: string): DraftQty => draftQty[id] ?? { unit: "", box: "" };
    const setDraft = (id: string, patch: Partial<DraftQty>) => {
        setDraftQty((prev) => ({ ...prev, [id]: { ...getDraft(id), ...patch } }));
    };
    const clearDraft = (id: string) =>
        setDraftQty((prev) => ({ ...prev, [id]: { unit: "", box: "" } }));

    const [cart, setCart] = useState<CartItem[]>([]);

    // VIEW
    const [openView, setOpenView] = useState(false);
    const [viewLoading, setViewLoading] = useState(false);
    const [viewOrder, setViewOrder] = useState<OrderFull | null>(null);

    // ACTION
    const [openAction, setOpenAction] = useState(false);
    const [actionKind, setActionKind] = useState<ActionKind>("cancel");
    const [actionOrderId, setActionOrderId] = useState<string | null>(null);
    const [actionNote, setActionNote] = useState("");
    const [actionSaving, setActionSaving] = useState(false);

    // EDIT
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
    const getEditDraft = (id: string): DraftQty => editDraftQty[id] ?? { unit: "", box: "" };
    const setEditDraft = (id: string, patch: Partial<DraftQty>) => {
        setEditDraftQty((prev) => ({ ...prev, [id]: { ...getEditDraft(id), ...patch } }));
    };
    const clearEditDraft = (id: string) =>
        setEditDraftQty((prev) => ({ ...prev, [id]: { unit: "", box: "" } }));

    // refs p/ realtime
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

        setOrders((Array.isArray(data) ? data : []) as any);
        setLoading(false);
    }

    // ✅ runVariantSearch unificado
    async function runVariantSearch(
        text: string,
        opts: {
            setText: (v: string) => void;
            setResults: (v: Variant[]) => void;
            setSearching: (v: boolean) => void;
            ensureDraft: (ids: string[]) => void;
        }
    ) {
        const t = text.trim();
        opts.setText(text);
        setMsg(null);

        if (t.length < 2) {
            opts.setResults([]);
            return;
        }

        opts.setSearching(true);

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
            opts.setResults([]);
            opts.setSearching(false);
            return;
        }

        const s = t.toLowerCase();
        const filtered = ((data as Variant[]) ?? []).filter((v) => {
            const cat = v.products?.categories?.name?.toLowerCase() ?? "";
            const brand = v.products?.brands?.name?.toLowerCase() ?? "";
            const det = String(v.details ?? "").toLowerCase();
            const vol = v.volume_value != null ? String(v.volume_value).toLowerCase() : "";
            const unit = String(v.unit ?? "").toLowerCase();
            return [cat, brand, det, vol, unit].some((x) => x.includes(s));
        });

        const top = filtered.slice(0, 40);
        opts.setResults(top);
        opts.ensureDraft(top.map((x) => x.id));
        opts.setSearching(false);
    }

    async function upsertCustomerFromFields(
        nameRaw: string,
        phoneRaw: string,
        addressRaw: string
    ): Promise<string | null> {
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
            const { error: upErr } = await supabase
                .from("customers")
                .update({ name, address: address || null })
                .eq("id", found.id);

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

        // itens + trazer case_qty do product_variants
        const { data: items, error: itemsErr } = await supabase
            .from("order_items")
            .select(
                `
      id, order_id, product_variant_id, product_name,
      quantity, unit_type, unit_price, line_total, created_at, qty,
      product_variants ( case_qty )
    `
            )
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        if (itemsErr) {
            setMsg(`Erro ao carregar itens: ${itemsErr.message}`);
            return null;
        }

        // compat: alguns modais esperam qty ao invés de quantity
        const mappedItems = (Array.isArray(items) ? items : []).map((it: any) => {
            // product_variants pode vir como objeto ou array — tratamos ambos
            const pv = it.product_variants;
            let caseQty = null;
            if (pv != null) {
                if (Array.isArray(pv)) {
                    caseQty = pv[0]?.case_qty ?? null;
                } else {
                    caseQty = pv.case_qty ?? null;
                }
            }

            return {
                ...it,
                qty: it?.qty ?? it?.quantity ?? 0,
                quantity: it?.quantity ?? it?.qty ?? 0,
                // coloca case_qty direto no item para facilitar leitura no modal
                case_qty: caseQty ?? null,
                // mantém product_variants caso seja necessário
                product_variants: pv,
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

    // INIT: company settings + orders
    useEffect(() => {
        loadCompanySettings();
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ?open
    useEffect(() => {
        const id = searchParams.get("open");
        if (!id) return;
        if (viewOrder?.id === id && openView) return;
        openOrder(id, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // REALTIME
    useEffect(() => {
        const ch = supabase
            .channel("realtime-orders-admin")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "orders" },
                async (payload: any) => {
                    try {
                        await loadOrders();
                        const orderId = (payload?.new?.id ?? payload?.old?.id ?? null) as string | null;
                        if (!orderId) return;

                        if (viewOrderIdRef.current === orderId) setViewOrder(await fetchOrderFull(orderId));
                        if (editOrderIdRef.current === orderId) setEditOrder(await fetchOrderFull(orderId));
                    } catch { }
                }
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "order_items" },
                async (payload: any) => {
                    try {
                        await loadOrders();
                        const orderId = (payload?.new?.order_id ??
                            payload?.old?.order_id ??
                            null) as string | null;
                        if (!orderId) return;

                        if (viewOrderIdRef.current === orderId) setViewOrder(await fetchOrderFull(orderId));
                        if (editOrderIdRef.current === orderId) setEditOrder(await fetchOrderFull(orderId));
                    } catch { }
                }
            )
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

    function openActionModal(kind: ActionKind, orderId: string) {
        setActionKind(kind);
        setActionOrderId(orderId);
        setActionNote("");
        setOpenAction(true);
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

        const newStatus: OrderStatus =
            actionKind === "cancel" ? "canceled" : actionKind === "deliver" ? "delivered" : "finalized";

        const { error } = await supabase
            .from("orders")
            .update({ status: newStatus, details: note })
            .eq("id", orderId);

        if (error) {
            setMsg(`Erro ao atualizar status: ${error.message}`);
            setActionSaving(false);
            return;
        }

        setMsg("✅ Pedido atualizado.");
        setOpenAction(false);
        setActionSaving(false);

        await loadOrders();

        if (viewOrder?.id === orderId) setViewOrder(await fetchOrderFull(orderId));
        if (editOrder?.id === orderId) setEditOrder(await fetchOrderFull(orderId));
    }

    async function printOrder(orderId: string) {
        const full = await fetchOrderFull(orderId);
        if (!full) return;

        const pm = (full as any).payment_method as string;
        const paidFlag = !!(full as any).paid;

        const pmLabel =
            pm === "pix" ? "Pix" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : String(pm);

        const total = Number((full as any).total_amount ?? 0);
        const customerPays = Number((full as any).change_for ?? 0);
        const troco = calcTroco(total, customerPays);

        // Qtd: unidade vs caixa (com quantidade por caixa)
        const qtyDisplay = (it: any) => {
            const qIt = Number(it.quantity ?? it.qty ?? 0);
            const unitType = String(it.unit_type ?? "unit");

            if (unitType === "case") {
                const caseQty = Number(it.case_qty ?? it?.product_variants?.case_qty ?? 0);
                // texto no padrão do modal: "caixa com: X • N caixas"
                return caseQty > 0
                    ? `caixa com: ${caseQty} • ${qIt} caixas`
                    : `caixa • ${qIt} caixas`;
            }

            // unit
            return `${qIt} unidades`;
        };

        const rows = (full.items ?? [])
            .map((it: any) => {
                const name = escapeHtml(it.product_name ?? "Item");
                const qIt = Number(it.quantity ?? it.qty ?? 0);
                const price = Number(it.unit_price ?? 0);
                const totalLine = Number(it.line_total ?? qIt * price);

                return `
        <tr>
          <td>${name}</td>
          <td style="text-align:right;">${escapeHtml(qtyDisplay(it))}</td>
          <td style="text-align:right;">R$ ${formatBRL(price)}</td>
          <td style="text-align:right;">R$ ${formatBRL(totalLine)}</td>
        </tr>
      `;
            })
            .join("");

        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) {
            setMsg("Erro: popup bloqueado para impressão.");
            return;
        }

        const cust = (full as any).customers;
        const title = `Pedido • ${new Date(full.created_at).toLocaleString("pt-BR")}`;

        // Pagamento: maquininha (cartão/pix) | troco (dinheiro)
        let payExtra = "";
        if (pm === "card" || pm === "pix") {
            payExtra = `<div class="strong">Levar maquininha</div>`;
        } else if (pm === "cash") {
            payExtra = `
    <div class="strong">${customerPays > 0 ? `Troco para: R$ ${formatBRL(customerPays)}` : `Troco para: -`
                }</div>
    <div class="strong">Levar de troco: R$ ${formatBRL(troco)}</div>
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
          .strong { font-weight: 900; color: #000; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border-bottom: 1px solid #ddd; padding: 6px; }
          th { text-align: left; background: #f5f5f5; }
          .totals { margin-top: 10px; display: grid; gap: 6px; }
          .row { display:flex; justify-content: space-between; }
          .strong { font-weight: 900; }
          .box { border: 1px solid #ddd; border-radius: 10px; padding: 8px; margin-top: 10px; }
          .obsTitle { font-weight: 900; font-size: 14px; }
          .obsText { font-weight: 900; font-size: 14px; color: ${ORANGE}; }
          @media print { button { display:none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="padding:6px 8px; border:1px solid #999; border-radius:10px; cursor:pointer; font-size:12px;">
          Imprimir
        </button>

        <h1>${escapeHtml(title)}</h1>

        <div class="muted">
          <div><b>Status:</b> ${escapeHtml(prettyStatus(String((full as any).status)))}</div>

          <!-- Cliente: tudo em negrito -->
          <div><b>Cliente:</b> <b>${escapeHtml(cust?.name ?? "-")}</b> • <b>${escapeHtml(
            cust?.phone ?? ""
        )}</b></div>
          <div><b>Endereço:</b> <b>${escapeHtml(cust?.address ?? "-")}</b></div>

          <div style="margin-top:6px;">
            <div><b>Pagamento:</b> <b>${escapeHtml(pmLabel)}</b> ${paidFlag ? "<b>(pago)</b>" : ""
            }</div>
            ${payExtra}
          </div>
        </div>

        ${(full as any).details
                ? `<div class="box"><div class="obsTitle">Observações:</div><div class="obsText">${escapeHtml(
                    String((full as any).details)
                )}</div></div>`
                : ""
            }

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
          <div class="row"><span>Taxa entrega</span><span>R$ ${formatBRL((full as any).delivery_fee ?? 0)}</span></div>
          <div class="row strong"><span>Total</span><span>R$ ${formatBRL((full as any).total_amount ?? 0)}</span></div>
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

        const customerId = await upsertCustomerFromFields(customerName, customerPhone, customerAddress);
        if (!customerId) {
            setSaving(false);
            return;
        }

        const fee = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
        const change = paymentMethod === "cash" ? brlToNumber(changeFor) : null;

        const totalNow = cartSubtotal(cart) + fee;

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
                total_amount: totalNow,
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

        const itemsPayload = buildItemsPayload(orderId, cart);
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

        setEditCustomerName((full as any).customers?.name ?? "");
        setEditCustomerPhone((full as any).customers?.phone ?? "");
        setEditCustomerAddress((full as any).customers?.address ?? "");
        setEditPaymentMethod((full as any).payment_method);
        setEditPaid(!!(full as any).paid);
        setEditChangeFor(formatBRL(Number((full as any).change_for ?? 0)));

        const feeValue = Number((full as any).delivery_fee ?? 0);
        setEditDeliveryFeeEnabled(feeValue > 0);
        setEditDeliveryFee(formatBRL(feeValue));

        // map itens -> cart
        const mapped: CartItem[] = ((full as any).items ?? []).map((it: any) => {
            const fallbackVariant: Variant = {
                id: it.product_variant_id ?? `legacy-${it.id}`,
                unit_price: Number(it.unit_price ?? 0),
                has_case: false,
                case_price: null,
                case_qty: it.case_qty ?? null,
                unit: it.unit_type ?? "none",
                volume_value: null,
                details: it.product_name ?? null,
                is_active: true,
                products: { categories: { name: "" }, brands: { name: "" } },
            };

            const price = Number(it.unit_price ?? 0);
            return {
                variant: fallbackVariant,
                qty: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
                price,
                mode: it.unit_type === "case" ? "case" : "unit",
            };
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

        const customerId = await upsertCustomerFromFields(
            editCustomerName,
            editCustomerPhone,
            editCustomerAddress
        );
        if (!customerId) {
            setEditSaving(false);
            return;
        }

        const fee = editDeliveryFeeEnabled ? brlToNumber(editDeliveryFee) : 0;
        const change = editPaymentMethod === "cash" ? brlToNumber(editChangeFor) : null;

        const newTotal = cartSubtotal(editCart) + fee;

        const { error: upOrdErr } = await supabase
            .from("orders")
            .update({
                customer_id: customerId,
                payment_method: editPaymentMethod,
                paid: editPaid,
                change_for: change,
                delivery_fee: fee,
                total_amount: newTotal,
            })
            .eq("id", editOrder.id);

        if (upOrdErr) {
            setMsg(`Erro ao atualizar pedido: ${upOrdErr.message}`);
            setEditSaving(false);
            return;
        }

        const { error: delErr } = await supabase
            .from("order_items")
            .delete()
            .eq("order_id", editOrder.id);

        if (delErr) {
            setMsg(`Erro ao apagar itens antigos: ${delErr.message}`);
            setEditSaving(false);
            return;
        }

        const itemsToInsert = buildItemsPayload(editOrder.id, editCart);
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
        if (viewOrder?.id === editOrder.id) setViewOrder(await fetchOrderFull(editOrder.id));
    }

    // stats
    const stats = useMemo(() => {
        const by = { new: 0, delivered: 0, finalized: 0, canceled: 0 } as Record<OrderStatus, number>;
        for (const o of orders) {
            const s = String(o.status) as OrderStatus;
            if ((by as any)[s] !== undefined) (by as any)[s] += 1;
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

    // troco preview (novo)
    const newTotalNow = useMemo(
        () => cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee),
        [cart, deliveryFeeEnabled, deliveryFee]
    );
    const newCustomerPays = useMemo(() => brlToNumber(changeFor), [changeFor]);
    const newTroco = useMemo(() => calcTroco(newTotalNow, newCustomerPays), [newTotalNow, newCustomerPays]);

    // troco preview (edit)
    const editTotalNow = useMemo(
        () => cartTotalPreview(editCart, editDeliveryFeeEnabled, editDeliveryFee),
        [editCart, editDeliveryFeeEnabled, editDeliveryFee]
    );
    const editCustomerPays = useMemo(() => brlToNumber(editChangeFor), [editChangeFor]);
    const editTroco = useMemo(
        () => calcTroco(editTotalNow, editCustomerPays),
        [editTotalNow, editCustomerPays]
    );

    return (
        <div style={{ fontSize: 13 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Pedidos</h1>
                    <p style={{ marginTop: 6, color: "#666", fontSize: 12, lineHeight: 1.2 }}>
                        Acessar • Ações (Cancelar/Entregue/Finalizar/Imprimir/Editar) e Data estão disponíveis no modal do pedido.
                    </p>
                    <p style={{ marginTop: 4, color: "#777", fontSize: 12, lineHeight: 1.2 }}>
                        Obs.: para <b>cancelar/entregar/finalizar</b>, será exigida uma observação.
                    </p>
                </div>
            </div>

            {msg && <p style={{ color: msg.startsWith("✅") ? "green" : "crimson", marginTop: 10 }}>{msg}</p>}

            {/* CHIPS + BOTÕES */}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={loadOrders} style={btnOrangeOutline(false)}>
                        Recarregar
                    </button>

                    <button
                        onClick={() => {
                            resetNewOrder();
                            setOpenNew(true);
                        }}
                        style={btnOrange(false)}
                    >
                        + Novo pedido
                    </button>
                </div>
            </div>

            <section style={{ marginTop: 12, padding: 12, border: "1px solid #e6e6e6", borderRadius: 14 }}>
                {loading ? (
                    <p>Carregando...</p>
                ) : (
                    <div style={{ width: "100%", overflowX: "auto" }}>
                        {/* tabela compacta: apenas Cliente | Status | Total */}
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                            <thead>
                                <tr style={{ background: "#f7f7f7" }}>
                                    <th style={{ textAlign: "left", padding: 6, fontSize: 12 }}>Cliente</th>
                                    <th style={{ textAlign: "center", padding: 6, fontSize: 12 }}>Status</th>
                                    <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((o) => {
                                    const st = String(o.status);
                                    return (
                                        <tr
                                            key={o.id}
                                            style={{ borderTop: "1px solid #f0f0f0", cursor: "pointer" }}
                                            onClick={() => openOrder(o.id)}
                                        >
                                            <td style={{ padding: 6, minWidth: 240 }}>
                                                <div
                                                    style={{
                                                        fontWeight: 900,
                                                        fontSize: 13,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {o.customers?.name ?? "-"}
                                                </div>
                                            </td>

                                            <td style={{ padding: 6, textAlign: "center", whiteSpace: "nowrap" }}>
                                                <span style={statusBadgeStyle(st)}>{prettyStatus(st)}</span>
                                            </td>

                                            <td style={{ padding: 6, textAlign: "right", fontWeight: 900, whiteSpace: "nowrap" }}>
                                                R$ {formatBRL(o.total_amount)}
                                            </td>
                                        </tr>
                                    );
                                })}

                                {filteredOrders.length === 0 && (
                                    <tr>
                                        <td colSpan={3} style={{ padding: 10, color: "#666", fontSize: 12 }}>
                                            Nenhum pedido nesse filtro.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* MODAIS (mantidos; ViewOrderModal contém data, ações e forma de apagamento) */}

            <NewOrderModal
                open={openNew}
                onClose={() => setOpenNew(false)}
                saving={saving}
                onSave={createOrder}
                msg={msg}
                customerName={customerName}
                setCustomerName={setCustomerName}
                customerPhone={customerPhone}
                setCustomerPhone={setCustomerPhone}
                customerAddress={customerAddress}
                setCustomerAddress={setCustomerAddress}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                paid={paid}
                setPaid={setPaid}
                changeFor={changeFor}
                setChangeFor={setChangeFor}
                deliveryFeeEnabled={deliveryFeeEnabled}
                setDeliveryFeeEnabled={setDeliveryFeeEnabled}
                deliveryFee={deliveryFee}
                setDeliveryFee={setDeliveryFee}
                q={q}
                onSearchChange={(text) =>
                    runVariantSearch(text, {
                        setText: setQ,
                        setResults,
                        setSearching,
                        ensureDraft: (ids) =>
                            setDraftQty((prev) => {
                                const next = { ...prev };
                                for (const id of ids) if (!next[id]) next[id] = { unit: "", box: "" };
                                return next;
                            }),
                    })
                }
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
                onPrint={() => (viewOrder ? printOrder(viewOrder.id) : undefined)}
                onEdit={() => (viewOrder ? openEditOrder(viewOrder.id) : undefined)}
                onAction={(k) => (viewOrder ? openActionModal(k, viewOrder.id) : undefined)}
                canCancel={viewOrder ? canCancel(String((viewOrder as any).status)) : false}
                canDeliver={viewOrder ? canDeliver(String((viewOrder as any).status)) : false}
                canFinalize={viewOrder ? canFinalize(String((viewOrder as any).status)) : false}
                canEdit={viewOrder ? canEdit(String((viewOrder as any).status)) : false}
            />

            <ActionModal
                open={openAction}
                onClose={() => setOpenAction(false)}
                kind={actionKind}
                note={actionNote}
                setNote={setActionNote}
                saving={actionSaving}
                onConfirm={runAction}
            />

            <EditOrderModal
                open={openEdit}
                onClose={() => setOpenEdit(false)}
                loading={editLoading}
                saving={editSaving}
                order={editOrder}
                canEditOrder={editOrder ? canEdit(String((editOrder as any).status)) : false}
                onSave={saveEditOrder}
                msg={msg}
                customerName={editCustomerName}
                setCustomerName={setEditCustomerName}
                customerPhone={editCustomerPhone}
                setCustomerPhone={setEditCustomerPhone}
                customerAddress={editCustomerAddress}
                setCustomerAddress={setEditCustomerAddress}
                paymentMethod={editPaymentMethod}
                setPaymentMethod={setEditPaymentMethod}
                paid={editPaid}
                setPaid={setEditPaid}
                changeFor={editChangeFor}
                setChangeFor={setEditChangeFor}
                deliveryFeeEnabled={editDeliveryFeeEnabled}
                setDeliveryFeeEnabled={setEditDeliveryFeeEnabled}
                deliveryFee={editDeliveryFee}
                setDeliveryFee={setEditDeliveryFee}
                q={editQ}
                onSearchChange={(text) =>
                    runVariantSearch(text, {
                        setText: setEditQ,
                        setResults: setEditResults,
                        setSearching: setEditSearching,
                        ensureDraft: (ids) =>
                            setEditDraftQty((prev) => {
                                const next = { ...prev };
                                for (const id of ids) if (!next[id]) next[id] = { unit: "", box: "" };
                                return next;
                            }),
                    })
                }
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
