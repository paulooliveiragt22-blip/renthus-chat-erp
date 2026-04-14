"use client";

import React, { useEffect, useState } from "react";
import EditOrderModal from "@/lib/orders/EditOrderModal";
import type {
  CartItem,
  Driver,
  DraftQty,
  OrderFull,
  PaymentMethod,
  Variant,
} from "@/lib/orders/types";
import {
  brlToNumber,
  buildItemsPayload,
  calcTroco,
  cartSubtotal,
  formatBRL,
} from "@/lib/orders/helpers";

interface Props {
  orderId: string;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FilaOrderEditOverlay({ orderId, companyId, onClose, onSaved }: Props) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [order, setOrder]       = useState<OrderFull | null>(null);
  const [msg, setMsg]           = useState<string | null>(null);

  // form state
  const [customerName,    setCustomerName]    = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [paymentMethod,   setPaymentMethod]   = useState<PaymentMethod>("pix");
  const [paid,            setPaid]            = useState(false);
  const [changeFor,       setChangeFor]       = useState("0,00");
  const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(false);
  const [deliveryFee,     setDeliveryFee]     = useState("0,00");
  const [drivers,         setDrivers]         = useState<Driver[]>([]);
  const [driverId,        setDriverId]        = useState<string | null>(null);

  // cart + search
  const [cart,      setCart]      = useState<CartItem[]>([]);
  const [q,         setQ]         = useState("");
  const [results,   setResults]   = useState<Variant[]>([]);
  const [searching, setSearching] = useState(false);
  const [draftQty,  setDraftQty]  = useState<Record<string, DraftQty>>({});

  const getDraft   = (id: string): DraftQty => draftQty[id] ?? { unit: "", box: "" };
  const setDraft   = (id: string, p: Partial<DraftQty>) => setDraftQty((prev) => ({ ...prev, [id]: { ...getDraft(id), ...p } }));
  const clearDraft = (id: string) => setDraftQty((prev) => ({ ...prev, [id]: { unit: "", box: "" } }));

  // totals
  const fee         = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
  const totalNow    = cartSubtotal(cart) + fee;
  const custPays    = paymentMethod === "cash" ? brlToNumber(changeFor) : 0;
  const trocoNow    = calcTroco(totalNow, custPays);

  const canEditOrder = order ? (order as any).status === "new" : false;

  // ── load order ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, { credentials: "include", cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const ord = json.order as Record<string, unknown> | undefined;
      if (!res.ok || !ord) { setLoading(false); return; }
      if (cancelled) { setLoading(false); return; }

      const rawItems = Array.isArray(ord.items) ? (ord.items as Record<string, unknown>[]) : [];

      const mappedItems = rawItems.map((it: any) => ({
        ...it,
        qty: it?.qty ?? it?.quantity ?? 0,
        quantity: it?.quantity ?? it?.qty ?? 0,
        _emb: it?._emb ?? null,
      }));

      const full = { ...ord, items: mappedItems } as unknown as OrderFull;
      setOrder(full);

      // populate form
      setCustomerName((ord as any).customers?.name ?? "");
      setCustomerPhone((ord as any).customers?.phone ?? "");
      setCustomerAddress((ord as any).customers?.address ?? "");
      setPaymentMethod((ord as any).payment_method ?? "pix");
      setPaid(!!(ord as any).paid);
      setChangeFor(formatBRL(Number((ord as any).change_for ?? 0)));
      const feeVal = Number((ord as any).delivery_fee ?? 0);
      setDeliveryFeeEnabled(feeVal > 0);
      setDeliveryFee(formatBRL(feeVal));
      setDriverId((ord as any).driver_id ?? null);

      const mapped: CartItem[] = mappedItems.map((it: any) => {
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
      setCart(mapped);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ── load drivers ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/drivers", { credentials: "include", cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      const list = (j.drivers ?? []) as Driver[];
      setDrivers(list.filter((d) => d.is_active));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // ── variant search ────────────────────────────────────────────────────────

  async function onSearchChange(text: string) {
    setQ(text);
    const t = text.trim();
    if (t.length < 2) { setResults([]); return; }
    setSearching(true);

    const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(t)}`, {
      credentials: "include",
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setResults([]); setSearching(false); return; }

    setResults((json.variants ?? []) as Variant[]);
    setSearching(false);
  }

  function addToCart(v: Variant, mode: "unit" | "case", qty: number) {
    const qAdd = Math.max(0, qty || 0);
    if (qAdd <= 0) return;
    const price = mode === "case" ? Number(v.case_price ?? 0) : Number(v.unit_price ?? 0);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.variant.id === v.id && i.mode === mode);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + qAdd };
        return copy;
      }
      return [...prev, { variant: v, qty: qAdd, price, mode }];
    });
  }

  // ── save ──────────────────────────────────────────────────────────────────

  async function saveEditOrder() {
    if (!order) return;
    if (cart.length === 0) { setMsg("O pedido precisa ter pelo menos 1 item."); return; }
    setSaving(true); setMsg(null);

    // upsert customer
    const phone   = customerPhone.trim();
    const name    = customerName.trim();
    const address = customerAddress.trim();
    if (!phone || phone.length < 8) { setMsg("Informe um telefone válido."); setSaving(false); return; }
    if (!name) { setMsg("Informe o nome do cliente."); setSaving(false); return; }

    const custRes = await fetch("/api/admin/order-customers", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, address }),
    });
    const custJson = await custRes.json().catch(() => ({}));
    if (!custRes.ok) { setMsg(`Erro ao salvar cliente: ${custJson?.error ?? "falha"}`); setSaving(false); return; }
    const customerId = String(custJson.customer_id ?? "");

    const feeVal   = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
    const change   = paymentMethod === "cash" ? brlToNumber(changeFor) : null;
    const o        = order as Record<string, unknown>;

    const itemsRes = await fetch("/api/admin/orders/items", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: order.id,
        customer_id: customerId,
        channel: o.channel != null ? String(o.channel) : null,
        status: o.status != null ? String(o.status) : null,
        confirmation_status: o.confirmation_status != null ? String(o.confirmation_status) : null,
        source: o.source != null ? String(o.source) : null,
        payment_method: paymentMethod,
        paid,
        change_for: change,
        delivery_fee: feeVal,
        details: o.details === undefined || o.details === null ? undefined : String(o.details),
        driver_id: driverId || null,
        items: buildItemsPayload(order.id, companyId, cart),
      }),
    });
    const itemsJson = await itemsRes.json().catch(() => ({}));
    if (!itemsRes.ok) { setMsg(`Erro ao inserir itens: ${itemsJson?.error ?? "falha"}`); setSaving(false); return; }

    setMsg("✅ Pedido editado com sucesso.");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <EditOrderModal
      open={true}
      onClose={onClose}
      loading={loading}
      saving={saving}
      order={order}
      canEditOrder={canEditOrder}
      onSave={saveEditOrder}
      msg={msg}
      customerName={customerName}       setCustomerName={setCustomerName}
      customerPhone={customerPhone}     setCustomerPhone={setCustomerPhone}
      customerAddress={customerAddress} setCustomerAddress={setCustomerAddress}
      paymentMethod={paymentMethod}     setPaymentMethod={setPaymentMethod}
      paid={paid}                       setPaid={setPaid}
      changeFor={changeFor}             setChangeFor={setChangeFor}
      deliveryFeeEnabled={deliveryFeeEnabled} setDeliveryFeeEnabled={setDeliveryFeeEnabled}
      deliveryFee={deliveryFee}         setDeliveryFee={setDeliveryFee}
      drivers={drivers}
      driverId={driverId}               setDriverId={setDriverId}
      q={q}                             onSearchChange={onSearchChange}
      searching={searching}             results={results}
      getDraft={getDraft}               setDraft={setDraft}           clearDraft={clearDraft}
      cart={cart}                       setCart={setCart}             addToCart={addToCart}
      totalNow={totalNow}               customerPaysNow={custPays}    trocoNow={trocoNow}
    />
  );
}
