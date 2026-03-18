// app/(admin)/pedidos/PedidosClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MessageCircle, Printer, Eye, Plus, RefreshCcw, Search } from "lucide-react";

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

function paymentLabel(pm: string) {
    return pm === "pix" ? "Pix" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : String(pm || "-");
}

/**
 * Número "humano" do pedido (somente UI):
 * últimos 6 caracteres do UUID em maiúsculo.
 * (Se você quiser sequencial real, precisa virar campo no banco.)
 */
function orderNumberFromId(id: string) {
    const raw = String(id || "");
    if (!raw) return "-";
    return raw.slice(-6).toUpperCase();
}

export default function PedidosPage() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router = useRouter();

    const { currentCompanyId: companyId } = useWorkspace();

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
    const [searchText, setSearchText] = useState("");
    useEffect(() => {
        // tenta ler da URL
        const s = searchParams.get("status");
        let initial: "all" | OrderStatus = "all";
        if (s === "new" || s === "delivered" || s === "finalized" || s === "canceled") {
            initial = s;
        } else {
            // se não tiver na URL, tenta do localStorage
            if (typeof window !== "undefined") {
                const saved = window.localStorage.getItem("orders_status_filter");
                if (saved === "new" || saved === "delivered" || saved === "finalized" || saved === "canceled" || saved === "all") {
                    initial = saved;
                }
            }
        }
        setStatusFilter(initial);
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
            .insert({ name, phone, address: address || null, company_id: companyId })
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
        if (companyId) loadCompanySettings(companyId);
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

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
                company_id: companyId,
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

        if (!companyId) {
            setMsg("Nenhuma empresa ativa selecionada. Recarregue o painel e escolha uma empresa.");
            setSaving(false);
            return;
        }

        const itemsPayload = buildItemsPayload(orderId, companyId, cart);
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

        if (!companyId) {
            setMsg("Nenhuma empresa ativa selecionada. Recarregue o painel e escolha uma empresa.");
            setEditSaving(false);
            return;
        }

        const itemsToInsert = buildItemsPayload(editOrder.id, companyId, editCart);
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

    function timeAgoIso(iso: string): string {
        if (!iso) return "";
        const created = new Date(iso).getTime();
        const now = Date.now();
        const diffMs = now - created;
        if (Number.isNaN(diffMs) || diffMs < 0) return "";
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return "agora";
        if (diffMin < 60) return `há ${diffMin} min`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `há ${diffH} h`;
        const diffD = Math.floor(diffH / 24);
        return `há ${diffD} d`;
    }

    const filteredOrders = useMemo(() => {
        const priority: Record<string, number> = { new: 0, delivered: 1, finalized: 2, canceled: 3 };
        // salva filtro atual
        if (typeof window !== "undefined") {
            window.localStorage.setItem("orders_status_filter", statusFilter);
        }

        const baseStatus = statusFilter === "all" ? orders : orders.filter((o) => String(o.status) === statusFilter);

        const q = searchText.trim().toLowerCase();
        const base = !q
            ? baseStatus
            : baseStatus.filter((o) => {
                  const name = (o.customers?.name ?? "").toLowerCase();
                  const phone = (o.customers?.phone ?? "").toLowerCase();
                  const addr = (o.customers?.address ?? "").toLowerCase();
                  return name.includes(q) || phone.includes(q) || addr.includes(q);
              });

        return [...base].sort((a, b) => {
            const pa = priority[String(a.status)] ?? 99;
            const pb = priority[String(b.status)] ?? 99;
            if (pa !== pb) return pa - pb;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    }, [orders, statusFilter, searchText]);

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

    const [sendingOutForDelivery, setSendingOutForDelivery] = useState(false);
    const [sendingDeliveredMessage, setSendingDeliveredMessage] = useState(false);

    async function sendWhatsAppForCurrentOrder(kind: "out_for_delivery" | "delivered_message") {
        const ord = viewOrder;
        if (!ord || !ord.customers?.phone) {
            setMsg("Telefone do cliente não encontrado para este pedido.");
            return;
        }

        const phone = String(ord.customers.phone).trim();
        if (!phone.startsWith("+")) {
            setMsg("Telefone do cliente precisa estar em formato internacional (+55...).");
            return;
        }

        const customerName = (ord.customers.name || "").trim();
        const text =
            kind === "out_for_delivery"
                ? `Ótima notícia${customerName ? `, ${customerName}` : ""}: seu pedido já está com nosso entregador e a caminho de você! 🛵💨 Em breve ele chegará no endereço informado`
                : `Confirmamos aqui que seu pedido foi entregue${customerName ? `, ${customerName}` : ""}! 🎉 Esperamos que tenha chegado tudo certinho. Se precisar de qualquer coisa, é só nos chamar por este chat. Conte com a gente!`;

        try {
            if (kind === "out_for_delivery") setSendingOutForDelivery(true);
            else setSendingDeliveredMessage(true);

            setMsg(null);

            const res = await fetch("/api/whatsapp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to_phone_e164: phone,
                    kind: "text",
                    text,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setMsg(
                    `Erro ao enviar mensagem no WhatsApp: ${data?.error || res.statusText || "erro desconhecido"}`
                );
                return;
            }

            setMsg("✅ Mensagem enviada no WhatsApp.");
        } catch (err: any) {
            setMsg(`Erro ao enviar mensagem no WhatsApp: ${String(err?.message ?? err)}`);
        } finally {
            if (kind === "out_for_delivery") setSendingOutForDelivery(false);
            else setSendingDeliveredMessage(false);
        }
    }

    return (
        <div className="space-y-4 text-[13px] text-slate-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
                    <p className="mt-1 text-xs text-slate-500">
                        Gerencie pedidos em tempo real, com ações rápidas e integração ao WhatsApp.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={loadOrders}
                        className="gap-1"
                    >
                        <RefreshCcw className="h-3 w-3" />
                        Recarregar
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            resetNewOrder();
                            setOpenNew(true);
                        }}
                        className="gap-1 shadow-sm"
                    >
                        <Plus className="h-3 w-3" />
                        Novo pedido
                    </Button>
                </div>
            </div>

            {msg && (
                <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                        msg.startsWith("✅")
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-rose-200 bg-rose-50 text-rose-800"
                    }`}
                >
                    {msg}
                </div>
            )}

            {/* CARDS DE STATUS */}
            <div className="grid gap-3 md:grid-cols-4">
                <Card
                    className={`cursor-pointer bg-gradient-to-br from-sky-50 to-slate-50 transition hover:shadow-md ${
                        statusFilter === "new" ? "ring-2 ring-sky-300" : ""
                    }`}
                    onClick={() => setStatusFilter("new")}
                >
                    <CardHeader className="flex flex-row items-center justify-between border-b border-sky-100/70 pb-2">
                        <span className="text-xs font-medium text-sky-700">Novos</span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                            Ativos
                        </span>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-3">
                        <div className="text-lg font-semibold text-slate-900">{stats.new}</div>
                        <div className="text-[11px] text-slate-500">
                            Pedidos aguardando separação/entrega
                        </div>
                    </CardContent>
                </Card>

                <Card
                    className={`cursor-pointer bg-gradient-to-br from-emerald-50 to-slate-50 transition hover:shadow-md ${
                        statusFilter === "delivered" ? "ring-2 ring-emerald-300" : ""
                    }`}
                    onClick={() => setStatusFilter("delivered")}
                >
                    <CardHeader className="flex flex-row items-center justify-between border-b border-emerald-100/70 pb-2">
                        <span className="text-xs font-medium text-emerald-700">Entregues</span>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-3">
                        <div className="text-lg font-semibold text-slate-900">{stats.delivered}</div>
                        <div className="text-[11px] text-slate-500">
                            Já foram confirmados como entregues
                        </div>
                    </CardContent>
                </Card>

                <Card
                    className={`cursor-pointer bg-gradient-to-br from-violet-50 to-slate-50 transition hover:shadow-md ${
                        statusFilter === "finalized" ? "ring-2 ring-violet-300" : ""
                    }`}
                    onClick={() => setStatusFilter("finalized")}
                >
                    <CardHeader className="flex flex-row items-center justify-between border-b border-violet-100/70 pb-2">
                        <span className="text-xs font-medium text-violet-700">Finalizados</span>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-3">
                        <div className="text-lg font-semibold text-slate-900">{stats.finalized}</div>
                        <div className="text-[11px] text-slate-500">
                            Fechados e contabilizados no caixa
                        </div>
                    </CardContent>
                </Card>

                <Card
                    className={`cursor-pointer bg-gradient-to-br from-slate-50 to-slate-50 transition hover:shadow-md ${
                        statusFilter === "all" ? "ring-2 ring-slate-300" : ""
                    }`}
                    onClick={() => setStatusFilter("all")}
                >
                    <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-xs font-medium text-slate-700">Todos</span>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-3">
                        <div className="text-lg font-semibold text-slate-900">{stats.total}</div>
                        <div className="text-[11px] text-slate-500">
                            Soma de todos os pedidos listados
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* BUSCA */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-72">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder="Buscar por nome, telefone ou endereço..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="pl-7 text-xs"
                        />
                    </div>
                </div>
                <div className="text-[11px] text-slate-500">
                    Clique em um pedido para ver detalhes ou use as ações rápidas.
                </div>
            </div>

            <section className="mt-2 rounded-xl border border-slate-100 bg-white/70 p-3 shadow-sm backdrop-blur-sm">
                {loading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, idx) => (
                            <div
                                key={idx}
                                className="h-10 w-full animate-pulse rounded-lg bg-slate-100/70"
                            />
                        ))}
                    </div>
                ) : (
                    <div className="w-full overflow-x-auto">
                        <table className="min-w-[1100px] w-full border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                                    <th className="px-3 py-2 text-left w-20">Nº</th>
                                    <th className="px-3 py-2 text-left min-w-[260px]">Cliente</th>
                                    <th className="px-3 py-2 text-left min-w-[220px]">Observações</th>
                                    <th className="px-3 py-2 text-left min-w-[160px]">Pagamento</th>
                                    <th className="px-3 py-2 text-left min-w-[260px]">Endereço</th>
                                    <th className="px-3 py-2 text-center w-28">Status</th>
                                    <th className="px-3 py-2 text-right w-24">Total</th>
                                    <th className="px-3 py-2 text-center w-56">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredOrders.map((o) => {
                                    const st = String(o.status);
                                    const num = orderNumberFromId(o.id);
                                    const name = o.customers?.name ?? "-";
                                    const phone = o.customers?.phone ?? "-";
                                    const created = formatDT(o.created_at);
                                    const obs = (o.details ?? "").trim();
                                    const addr = o.customers?.address ?? "-";

                                    const pm = paymentLabel(String((o as any).payment_method ?? ""));
                                    const changeForNow = (o as any).change_for;

                                    return (
                                        <tr
                                            key={o.id}
                                            className="cursor-pointer bg-white/40 hover:bg-slate-50/80 transition-colors"
                                            onClick={() => openOrder(o.id)}
                                        >
                                            {/* Nº */}
                                            <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">
                                                #{num}
                                            </td>

                                            {/* Cliente + (data/hora + telefone) */}
                                            <td className="px-3 py-2 min-w-[260px]">
                                                <div
                                                    className="max-w-xs truncate text-[13px] font-semibold text-slate-900"
                                                    title={name}
                                                >
                                                    {name}
                                                </div>

                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                                    <span className="whitespace-nowrap">{created}</span>
                                                    <span className="whitespace-nowrap text-sky-700">
                                                        {timeAgoIso(o.created_at)}
                                                    </span>
                                                    <span className="whitespace-nowrap">{phone}</span>
                                                </div>
                                            </td>

                                            {/* Observações */}
                                            <td className="px-3 py-2 min-w-[220px] max-w-[320px]">
                                                <div
                                                    className={`max-w-xs truncate text-[12px] ${
                                                        obs ? "text-slate-900" : "text-slate-400"
                                                    }`}
                                                    title={obs || ""}
                                                >
                                                    {obs || "-"}
                                                </div>
                                            </td>

                                            {/* Pagamento */}
                                            <td className="px-3 py-2 min-w-[160px]">
                                                <div className="whitespace-nowrap text-[12px] font-semibold text-slate-900">
                                                    {pm}
                                                    {o.paid ? " (pago)" : ""}
                                                </div>

                                                {String((o as any).payment_method) === "cash" && (
                                                    <div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                                                        Troco p/:{" "}
                                                        {typeof changeForNow === "number" && changeForNow > 0
                                                            ? `R$ ${formatBRL(changeForNow)}`
                                                            : "-"}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Endereço */}
                                            <td className="px-3 py-2 min-w-[260px] max-w-[420px]">
                                                <div
                                                    className={`max-w-xs truncate text-[12px] ${
                                                        addr ? "text-slate-900" : "text-slate-400"
                                                    }`}
                                                    title={addr || ""}
                                                >
                                                    {addr || "-"}
                                                </div>
                                            </td>

                                            {/* Status */}
                                            <td className="px-3 py-2 text-center whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                                        st === "new"
                                                            ? "bg-sky-50 text-sky-800 ring-1 ring-sky-100"
                                                            : st === "delivered"
                                                            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                                                            : st === "finalized"
                                                            ? "bg-violet-50 text-violet-800 ring-1 ring-violet-100"
                                                            : "bg-slate-50 text-slate-700 ring-1 ring-slate-100"
                                                    }`}
                                                >
                                                    {prettyStatus(st)}
                                                </span>
                                            </td>

                                            {/* Total */}
                                            <td className="px-3 py-2 whitespace-nowrap text-right font-semibold text-slate-900">
                                                R$ {formatBRL(o.total_amount)}
                                            </td>

                                            {/* Ações rápidas */}
                                            <td
                                                className="px-3 py-2 whitespace-nowrap text-center"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-1.5 text-[11px] text-slate-600 hover:text-slate-900"
                                                        onClick={() => openOrder(o.id)}
                                                    >
                                                        <Eye className="mr-1 h-3.5 w-3.5" />
                                                        Ver
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-1.5 text-[11px] text-slate-600 hover:text-slate-900"
                                                        onClick={() => printOrder(o.id)}
                                                    >
                                                        <Printer className="mr-1 h-3.5 w-3.5" />
                                                        Imprimir
                                                    </Button>
                                                    {o.customers?.phone && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 px-1.5 text-[11px] border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                                            title="Abrir conversa no WhatsApp"
                                                            onClick={() => {
                                                                const p = String(o.customers?.phone ?? "").trim();
                                                                if (!p) return;
                                                                try {
                                                                    router.push(`/whatsapp?phone=${encodeURIComponent(p)}`);
                                                                } catch {
                                                                    // ignora
                                                                }
                                                            }}
                                                        >
                                                            <MessageCircle className="mr-1 h-3.5 w-3.5" />
                                                            WhatsApp
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}

                                {filteredOrders.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: 10, color: "#666", fontSize: 12 }}>
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
