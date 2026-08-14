"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { Check, Clock, MessageCircle, Pencil, RefreshCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { FilaOrderEditOverlay } from "@/components/fila/FilaOrderEditOverlay";
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";
import {
  formatFulfillmentLabel,
  isPickupFulfillment,
  orderFulfillmentAddressLine,
} from "@/lib/delivery/fulfillment";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number | null;
  produto_embalagem_id?: string | null;
  _emb?: any;
}

function getItemInfo(it: OrderItem) {
  const emb = it._emb ?? null;
  if (emb) {
    const prodName  = String(emb.product_name ?? "").toUpperCase().trim();
    const sigla     = String(emb.sigla_comercial ?? "UN").toUpperCase();
    const descricao = (emb.descricao ?? "").trim();
    const volStr    = (emb.volume_formatado ?? "").trim();
    const fator     = Number(emb.fator_conversao) || null;
    const unitLabel = sigla === "CX" ? "cx" : sigla === "UN" ? "un" : sigla.toLowerCase();
    let detail = [descricao, volStr].filter(Boolean).join(" ");
    if (sigla !== "UN") {
      const fatorPart = fator && fator > 1 ? ` C/${fator}UN` : "";
      detail = [detail, `${sigla}${fatorPart}`].filter(Boolean).join(" ");
    }
    return {
      productName: prodName || String(it.product_name ?? "PRODUTO").split(" • ")[0].toUpperCase().trim(),
      detail: detail || prodName || "Item",
      unitLabel,
    };
  }
  const raw    = String(it.product_name ?? "PRODUTO");
  const bIdx   = raw.indexOf(" • ");
  const pName  = bIdx >= 0 ? raw.slice(0, bIdx).toUpperCase().trim() : raw.toUpperCase().trim();
  const detail = bIdx >= 0 ? raw.slice(bIdx + 3).trim() : raw.trim();
  return { productName: pName, detail, unitLabel: "un" };
}

type GroupedOrderLine = { it: OrderItem; info: ReturnType<typeof getItemInfo> };

function groupOrderItemsByProduct(items: OrderItem[]): [string, GroupedOrderLine[]][] {
  const groups = new Map<string, GroupedOrderLine[]>();
  for (const it of items) {
    const info = getItemInfo(it);
    if (!groups.has(info.productName)) groups.set(info.productName, []);
    groups.get(info.productName)!.push({ it, info });
  }
  return [...groups.entries()];
}

function scheduleClearNewOrderFlash(
  addedIds: string[],
  setNewOrderIds: Dispatch<SetStateAction<Set<string>>>
): void {
  setTimeout(() => {
    setNewOrderIds((prev) => {
      const copy = new Set(prev);
      for (const id of addedIds) copy.delete(id);
      return copy;
    });
  }, 2000);
}

function FilaOrderItemsGrouped({ items }: Readonly<{ items: OrderItem[] }>) {
  const entries = groupOrderItemsByProduct(items);
  return (
    <>
      {entries.map(([pName, grpItems]) => (
        <div key={pName} className="mb-1">
          <p className="text-[11px] font-bold text-gray-800 dark:text-gray-100 leading-tight">{pName}</p>
          {grpItems.map(({ it, info }) => {
            const q = Number(it.quantity ?? 1);
            const tot = Number(it.line_total ?? it.unit_price * q);
            const lineKey = `${it.product_name}\0${q}\0${it.unit_price}\0${it.line_total ?? ""}\0${it.produto_embalagem_id ?? ""}`;
            return (
              <div
                key={lineKey}
                className="flex items-center justify-between gap-2 pl-2 text-[11px] text-gray-500 dark:text-gray-400"
              >
                <span className="truncate">
                  {info.detail} · <b className="text-gray-700 dark:text-gray-300">{q} {info.unitLabel}</b>
                </span>
                <span className="shrink-0 font-medium">R$ {tot.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

interface PendingOrder {
  id: string;
  customer_id: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  fulfillment_type?: string | null;
  payment_method: string | null;
  total: number;
  total_amount: number;
  delivery_fee: number;
  change_for: number | null;
  created_at: string;
  customers: { name: string | null; phone: string | null } | null;
  order_items: OrderItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "agora";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function formatPhone(phone: string | null): string {
  if (!phone) return "-";
  const d = phone.replaceAll(/\D/g, "").replaceAll(/^55/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function toE164(phone: string | null): string | null {
  if (!phone) return null;
  const clean = phone.trim();
  return clean.startsWith("+") ? clean : "+" + clean;
}

const PM_LABELS: Record<string, string> = {
  pix: "PIX", card: "Cartão", cash: "Dinheiro", debit: "Débito",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function FilaClient() {
  const { currentCompanyId: companyId } = useWorkspace();

  const [orders,     setOrders]     = useState<PendingOrder[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null);
  const prevIdsRef    = useRef<Set<string>>(new Set());
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [requireApproval, setRequireApproval] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [deliveryEtaMin, setDeliveryEtaMin] = useState<number | null>(null);

  // ── Overlay state ─────────────────────────────────────────────────────────
  const [chatPhone,      setChatPhone]      = useState<string | null>(null);
  const [editOrderId,    setEditOrderId]    = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }

    const res = await fetch("/api/admin/fila/pending-orders", { credentials: "include", cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error("[Fila] fetch error:", json?.error ?? res.statusText); setLoading(false); return; }

    const next = (json.orders ?? []) as PendingOrder[];

    // Flash visual em pedidos novos (som fica a cargo do GlobalOrderNotifier)
    const nextIds = new Set(next.map((o) => o.id));
    if (prevIdsRef.current.size > 0) {
      const addedIds = next.map((o) => o.id).filter((id) => !prevIdsRef.current.has(id));
      if (addedIds.length > 0) {
        setNewOrderIds((prev) => new Set([...prev, ...addedIds]));
        scheduleClearNewOrderFlash(addedIds, setNewOrderIds);
      }
    }
    prevIdsRef.current   = nextIds;

    setOrders(next);
    setLoading(false);
  }, [companyId]);

  const fetchApprovalSetting = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch("/api/admin/company-settings", { credentials: "include", cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRequireApproval(Boolean(json?.settings?.require_order_approval));
    } catch { /* ignore */ }
  }, [companyId]);

  const fetchDeliveryEta = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch("/api/delivery/policy", { credentials: "include", cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const raw = (json?.company?.settings as Record<string, unknown> | undefined)?.delivery_est_minutes;
      const n = raw == null ? NaN : Math.floor(Number(raw));
      setDeliveryEtaMin(Number.isFinite(n) ? n : null);
    } catch { /* ignore */ }
  }, [companyId]);

  // ── Realtime + polling ────────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return;

    fetchOrders();
    fetchApprovalSetting();
    fetchDeliveryEta();
    const poll = setInterval(fetchOrders, 8000);

    return () => {
      clearInterval(poll);
    };
  }, [companyId, fetchOrders, fetchApprovalSetting, fetchDeliveryEta]);

  // ── Atalhos de teclado ────────────────────────────────────────────────────

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "F1") { e.preventDefault(); if (orders[0]) handleConfirm(orders[0].id); }
      if (e.key === "F2") { e.preventDefault(); if (orders[0]) handleReject(orders[0].id); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  // ── Notify ────────────────────────────────────────────────────────────────

  function notify(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function toggleApproval() {
    if (!companyId || approvalBusy) return;
    const next = !requireApproval;
    setApprovalBusy(true);
    try {
      const res = await fetch("/api/admin/company-settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_order_approval: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "falha ao salvar");
      setRequireApproval(next);
      notify(true, next
        ? "Confirmação manual ativada — novos pedidos vão para a fila"
        : "Confirmação manual desativada — pedidos confirmam automaticamente");
    } catch (e: unknown) {
      notify(false, "Erro ao alterar confirmação: " + String((e as Error)?.message ?? e));
    } finally {
      setApprovalBusy(false);
    }
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────

  async function sendWhatsApp(rawPhone: string | null, text: string) {
    const phone = toE164(rawPhone);
    if (!phone) return;
    try {
      await fetch("/api/whatsapp/send", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ to_phone_e164: phone, text }),
      });
    } catch (_) { /* falha silenciosa — pedido já está confirmado */ }
  }

  // ── Confirmar ─────────────────────────────────────────────────────────────

  async function handleConfirm(orderId: string) {
    if (processing) return;
    setProcessing(orderId);
    try {
      const res = await fetch(`/api/admin/fila/orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "falha");

      const order   = orders.find((o) => o.id === orderId);
      const phone   = order?.customer_phone ?? order?.customers?.phone ?? null;
      const shortId = orderId.replaceAll("-", "").slice(-6).toUpperCase();
      const total   = Number(order?.total_amount || order?.total || 0)
        .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const isPickup = isPickupFulfillment(order?.fulfillment_type);
      const modeLine = isPickup ? `🏪 *Retirada no local*\n\n` : "";
      const etaLine =
        !isPickup && deliveryEtaMin != null && Number.isFinite(deliveryEtaMin)
        ? `🚚 *Previsão de entrega:* ${Math.max(0, Math.floor(deliveryEtaMin))} minutos\n\n`
        : "";

      await sendWhatsApp(phone,
        `✅ *Pedido Confirmado!*\n\n` +
        `Pedido #${shortId}\n` +
        `Total: ${total}\n\n` +
        modeLine +
        etaLine +
        `Obrigado pela preferência! 🍺`
      );

      notify(true, `Pedido #${shortId} confirmado! Cupom sendo impresso...`);
      fetchOrders();
    } catch (e: unknown) {
      notify(false, "Erro ao confirmar: " + String((e as Error)?.message ?? e));
    } finally {
      setProcessing(null);
    }
  }

  // ── Rejeitar ──────────────────────────────────────────────────────────────

  async function handleReject(orderId: string) {
    if (processing) return;
    const reason = window.prompt("Motivo da rejeição (deixe vazio para mensagem padrão):");
    if (reason === null) return; // cliente cancelou o prompt

    setProcessing(orderId);
    try {
      const res = await fetch(`/api/admin/fila/orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "falha");

      const order   = orders.find((o) => o.id === orderId);
      const phone   = order?.customer_phone ?? order?.customers?.phone ?? null;
      const shortId = orderId.replaceAll("-", "").slice(-6).toUpperCase();

      await sendWhatsApp(phone,
        `❌ Infelizmente seu pedido não pôde ser confirmado.\n\n` +
        (reason.trim() ? `Motivo: ${reason.trim()}\n\n` : "") +
        `Entre em contato conosco para mais informações.`
      );

      notify(true, `Pedido #${shortId} rejeitado.`);
      fetchOrders();
    } catch (e: unknown) {
      notify(false, "Erro ao rejeitar: " + String((e as Error)?.message ?? e));
    } finally {
      setProcessing(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!companyId || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">
        <Clock className="w-6 h-6 mr-2 animate-spin opacity-50" />
        Carregando fila...
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-500" />
            Fila de Confirmação
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {orders.length === 0
              ? "Nenhum pedido aguardando"
              : `${orders.length} pedido${orders.length > 1 ? "s" : ""} aguardando confirmação`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={approvalBusy}
            onClick={() => void toggleApproval()}
            title={requireApproval
              ? "Confirmação manual ativa — clique para desativar"
              : "Confirmação automática — clique para exigir aprovação na fila"}
            className={[
              "flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-50",
              requireApproval
                ? "text-yellow-800 bg-yellow-50 border-yellow-200 hover:bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-800 dark:hover:bg-yellow-900/40"
                : "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800 dark:hover:bg-emerald-900/40",
            ].join(" ")}
          >
            {requireApproval
              ? <ShieldAlert className="w-3.5 h-3.5" />
              : <ShieldCheck className="w-3.5 h-3.5" />}
            {approvalBusy ? "Salvando…" : `Confirmação manual: ${requireApproval ? "ON" : "OFF"}`}
          </button>
          <button
            type="button"
            onClick={() => fetchOrders()}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Toast inline */}
      {msg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium border ${
          msg.ok
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {msg.text}
        </div>
      )}

      {/* Hotkeys */}
      {orders.length > 0 && (
        <p className="text-[11px] text-gray-400 mb-4">
          Atalhos (primeiro da fila):&nbsp;
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-zinc-700 rounded font-mono text-[10px]">F1</kbd> Confirmar &nbsp;
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-zinc-700 rounded font-mono text-[10px]">F2</kbd> Rejeitar
        </p>
      )}

      {/* Empty */}
      {orders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <Clock className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold text-lg">Fila vazia</p>
          <p className="text-sm mt-1">Novos pedidos aparecerão aqui em tempo real</p>
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {orders.map((order, idx) => {
          const isFirst  = idx === 0;
          const shortId  = order.id.replaceAll("-", "").slice(-6).toUpperCase();
          const total    = Number(order.total_amount || order.total || 0);
          const items    = order.order_items ?? [];
          const phone    = order.customer_phone ?? order.customers?.phone ?? null;
          const name     = order.customers?.name ?? null;
          const pm       = PM_LABELS[order.payment_method ?? ""] ?? (order.payment_method ?? "-");
          const isBusy   = processing === order.id;

          const isNew = newOrderIds.has(order.id);

          return (
            <div
              key={order.id}
              style={{ animationDelay: `${idx * 60}ms` }}
              className={[
                "relative bg-white dark:bg-zinc-800 rounded-xl shadow-sm border-l-4 flex flex-col overflow-hidden",
                "fila-card-enter fila-card-hover",
                isFirst ? "border-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-800 fila-card-first-pulse" : "border-gray-200 dark:border-zinc-600",
                isNew ? "fila-card-new-flash" : "",
              ].join(" ")}
            >
              <button
                type="button"
                className="absolute inset-0 z-[1] rounded-xl border-0 bg-transparent p-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                aria-label={`Abrir pedido ${shortId}`}
                onClick={() => setEditOrderId(order.id)}
              />
              <div className="relative z-[2] flex min-h-0 flex-1 flex-col pointer-events-none">
              {/* Card header */}
              <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900 dark:text-white text-sm">
                    Pedido #{shortId}
                    {isFirst && (
                      <span className="ml-2 text-[10px] font-semibold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">
                        PRÓXIMO
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(order.created_at)}</p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full mt-0.5">
                  Aguardando
                </span>
              </div>

              {/* Body */}
              <div className="px-4 pb-3 space-y-2 text-sm flex-1">
                {/* Cliente */}
                {(name || phone) && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliente</p>
                    {name  && <p className="font-medium text-gray-800 dark:text-gray-100 text-xs">{name}</p>}
                    {phone && <p className="text-gray-500 text-[11px]">{formatPhone(phone)}</p>}
                  </div>
                )}

                {/* Itens — agrupados por produto (padrão hierarquia UI) */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Itens</p>
                  <FilaOrderItemsGrouped items={items} />
                </div>

                {/* Entrega / Retirada */}
                {(order.delivery_address || order.fulfillment_type) && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {formatFulfillmentLabel(order.fulfillment_type)}
                    </p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-400">
                      {orderFulfillmentAddressLine({
                        fulfillmentType: order.fulfillment_type,
                        deliveryAddress: order.delivery_address,
                      })}
                    </p>
                  </div>
                )}

                {/* Pagamento */}
                <div className="flex gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pagamento</p>
                    <p className="text-xs text-gray-700 dark:text-gray-300">{pm}</p>
                  </div>
                  {order.change_for && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Troco p/</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300">
                        R$ {Number(order.change_for).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Total */}
                <div className="pt-2 border-t dark:border-zinc-700 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {isPickupFulfillment(order.fulfillment_type)
                      ? "Retirada no local"
                      : order.delivery_fee > 0
                      ? `+ R$ ${Number(order.delivery_fee).toFixed(2)} entrega`
                      : "Sem taxa de entrega"}
                  </span>
                  <span className="text-base font-bold text-green-600">
                    R$ {total.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Ações secundárias */}
              <div className="px-3 pb-1 flex gap-2 pointer-events-auto">
                {phone && (
                  <button
                    type="button"
                    onClick={() => setChatPhone(toE164(phone) ?? phone)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Abrir Chat
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditOrderId(order.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Editar Pedido
                </button>
              </div>

              {/* Ações principais */}
              <div className="px-3 pb-3 flex gap-2 pointer-events-auto">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleReject(order.id)}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                  Rejeitar
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleConfirm(order.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isBusy ? "Processando..." : "Confirmar Pedido"}
                </button>
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {/* ── Edit Order Overlay ─────────────────────────────────────────────── */}
    {editOrderId && companyId && (
      <FilaOrderEditOverlay
        orderId={editOrderId}
        companyId={companyId}
        onClose={() => setEditOrderId(null)}
        onSaved={() => { setEditOrderId(null); fetchOrders(); }}
      />
    )}

    {/* ── WhatsApp Chat Overlay ──────────────────────────────────────────── */}
    {chatPhone && (
      <div className="fixed inset-0 z-[9998] flex flex-col bg-white dark:bg-zinc-900">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Chat WhatsApp</span>
          <button
            onClick={() => setChatPhone(null)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <WhatsAppInbox initialPhone={chatPhone} />
        </div>
      </div>
    )}
  </>
  );
}
