"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = useMemo(() => createClient(), []);

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

      const { data: ord, error: ordErr } = await supabase
        .from("orders")
        .select(`id, status, confirmation_status, channel, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address ), drivers ( id, name, vehicle, plate )`)
        .eq("id", orderId)
        .single();

      if (ordErr || !ord || cancelled) { setLoading(false); return; }

      const { data: items } = await supabase
        .from("order_items")
        .select(`id, order_id, produto_embalagem_id, product_name, quantity, unit_type, unit_price, line_total, created_at, qty`)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      const mappedItems = (Array.isArray(items) ? items : []).map((it: any) => ({
        ...it,
        qty: it?.qty ?? it?.quantity ?? 0,
        quantity: it?.quantity ?? it?.qty ?? 0,
      }));

      const full = { ...(ord as any), items: mappedItems } as OrderFull;
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

      const mapped: CartItem[] = mappedItems.map((it: any) => ({
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
      setCart(mapped);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ── load drivers ──────────────────────────────────────────────────────────

  useEffect(() => {
    supabase
      .from("drivers")
      .select("id, company_id, name, phone, vehicle, plate, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => { if (data) setDrivers(data as Driver[]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // ── variant search ────────────────────────────────────────────────────────

  async function onSearchChange(text: string) {
    setQ(text);
    const t = text.trim();
    if (t.length < 2) { setResults([]); return; }
    setSearching(true);

    const { data, error } = await supabase
      .from("view_pdv_produtos")
      .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, codigo_interno, sigla_comercial, volume_formatado, product_name, product_unit_type, product_details, category_name")
      .eq("company_id", companyId)
      .limit(400);

    if (error) { setResults([]); setSearching(false); return; }

    const s = t.toLowerCase();
    const byProduto = new Map<string, any>();
    for (const r of (data ?? []) as any[]) {
      const pid = String(r.produto_id);
      const entry = byProduto.get(pid) ?? {
        id: pid,
        products: { name: r.product_name ?? "", categories: { name: r.category_name ?? "" } },
        tags: [] as string[],
        unitPack: null,
        casePack: null,
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
      const cat    = v.products?.categories?.name?.toLowerCase() ?? "";
      const det    = String(v.details ?? "").toLowerCase();
      const unit   = String(v.unit ?? "").toLowerCase();
      const intern = (v.codigo_interno ?? "").toLowerCase();
      const tags   = ((v as any).tags ?? "").toLowerCase();
      return [cat, det, unit, intern, tags].some((x) => x.includes(s));
    });

    setResults(filtered.slice(0, 40));
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

    const { data: existingCust } = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .eq("phone", phone)
      .maybeSingle();

    let customerId: string | null = existingCust?.id ?? null;

    if (customerId) {
      await supabase.from("customers").update({ name, phone, address: address || null }).eq("id", customerId);
    } else {
      const { data: newCust, error: custErr } = await supabase
        .from("customers")
        .insert({ company_id: companyId, name, phone, address: address || null })
        .select("id")
        .single();
      if (custErr) { setMsg(`Erro ao criar cliente: ${custErr.message}`); setSaving(false); return; }
      customerId = newCust.id;
    }

    const feeVal   = deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0;
    const change   = paymentMethod === "cash" ? brlToNumber(changeFor) : null;
    const total    = cartSubtotal(cart) + feeVal;

    const { error: upErr } = await supabase
      .from("orders")
      .update({ customer_id: customerId, payment_method: paymentMethod, paid, change_for: change, delivery_fee: feeVal, total_amount: total, driver_id: driverId || null })
      .eq("id", order.id);
    if (upErr) { setMsg(`Erro ao atualizar pedido: ${upErr.message}`); setSaving(false); return; }

    const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", order.id);
    if (delErr) { setMsg(`Erro ao apagar itens: ${delErr.message}`); setSaving(false); return; }

    const { error: insErr } = await supabase.from("order_items").insert(buildItemsPayload(order.id, companyId, cart));
    if (insErr) { setMsg(`Erro ao inserir itens: ${insErr.message}`); setSaving(false); return; }

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
