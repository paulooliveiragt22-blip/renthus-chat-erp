"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { Check, Clock, MessageCircle, Pencil, RefreshCcw, X } from "lucide-react";
import { playBeep } from "@/lib/utils/playBeep";
import { FilaOrderEditOverlay } from "@/components/fila/FilaOrderEditOverlay";
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number | null;
}

interface PendingOrder {
  id: string;
  customer_id: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
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
  const d = phone.replace(/\D/g, "").replace(/^55/, "");
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
  const supabase   = useMemo(() => createClient(), []);
  const { currentCompanyId: companyId } = useWorkspace();

  const [orders,     setOrders]     = useState<PendingOrder[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null);
  const prevCountRef = useRef(0);

  // ── Overlay state ─────────────────────────────────────────────────────────
  const [chatPhone,      setChatPhone]      = useState<string | null>(null);
  const [editOrderId,    setEditOrderId]    = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchOrders = useMemo(() => async () => {
    if (!companyId) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, customer_id, customer_phone, delivery_address, payment_method,
        total, total_amount, delivery_fee, change_for, created_at,
        customers ( name, phone ),
        order_items ( product_name, quantity, unit_price, line_total )
      `)
      .eq("company_id", companyId)
      .eq("confirmation_status", "pending_confirmation")
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) { console.error("[Fila] fetch error:", error); setLoading(false); return; }

    const next = (data ?? []) as unknown as PendingOrder[];

    if (prevCountRef.current > 0 && next.length > prevCountRef.current) {
      playBeep();
    }
    prevCountRef.current = next.length;

    setOrders(next);
    setLoading(false);
  }, [companyId, supabase]);

  // ── Realtime + polling ────────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return;

    fetchOrders();
    const poll = setInterval(fetchOrders, 8000);

    const channel = supabase
      .channel(`fila-pending-${companyId}`)
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "orders",
        filter: `company_id=eq.${companyId}`,
      }, () => fetchOrders())
      .on("postgres_changes", {
        event:  "UPDATE",
        schema: "public",
        table:  "orders",
        filter: `company_id=eq.${companyId}`,
      }, () => fetchOrders())
      .subscribe();

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [companyId, fetchOrders, supabase]);

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
      const { error } = await supabase
        .from("orders")
        .update({
          confirmation_status: "confirmed",
          confirmed_at:        new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) throw error;

      const order   = orders.find((o) => o.id === orderId);
      const phone   = order?.customer_phone ?? order?.customers?.phone ?? null;
      const shortId = orderId.replace(/-/g, "").slice(-6).toUpperCase();
      const total   = Number(order?.total_amount || order?.total || 0)
        .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      await sendWhatsApp(phone,
        `✅ *Pedido Confirmado!*\n\n` +
        `Pedido #${shortId}\n` +
        `Total: ${total}\n\n` +
        `🚚 *Previsão de entrega:* 30–40 minutos\n\n` +
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
      const { error } = await supabase
        .from("orders")
        .update({
          confirmation_status: "rejected",
          confirmed_at:        new Date().toISOString(),
          status:              "canceled",
        })
        .eq("id", orderId);

      if (error) throw error;

      const order   = orders.find((o) => o.id === orderId);
      const phone   = order?.customer_phone ?? order?.customers?.phone ?? null;
      const shortId = orderId.replace(/-/g, "").slice(-6).toUpperCase();

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

        <button
          onClick={() => fetchOrders()}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
          Atualizar
        </button>
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
          const shortId  = order.id.replace(/-/g, "").slice(-6).toUpperCase();
          const total    = Number(order.total_amount || order.total || 0);
          const items    = order.order_items ?? [];
          const phone    = order.customer_phone ?? order.customers?.phone ?? null;
          const name     = order.customers?.name ?? null;
          const pm       = PM_LABELS[order.payment_method ?? ""] ?? (order.payment_method ?? "-");
          const isBusy   = processing === order.id;

          return (
            <div
              key={order.id}
              className={`bg-white dark:bg-zinc-800 rounded-xl shadow-sm border-l-4 flex flex-col overflow-hidden ${
                isFirst
                  ? "border-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-800"
                  : "border-gray-200 dark:border-zinc-600"
              }`}
            >
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

                {/* Itens */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Itens</p>
                  <div className="space-y-0.5">
                    {items.map((item, i) => (
                      <div key={i} className="flex justify-between gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <span className="truncate">• {item.quantity ?? 1}x {item.product_name}</span>
                        <span className="shrink-0 font-medium">
                          R$ {Number(item.line_total ?? item.unit_price * (item.quantity ?? 1)).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Endereço */}
                {order.delivery_address && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Entrega</p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-400">{order.delivery_address}</p>
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
                    {order.delivery_fee > 0
                      ? `+ R$ ${Number(order.delivery_fee).toFixed(2)} entrega`
                      : "Sem taxa de entrega"}
                  </span>
                  <span className="text-base font-bold text-green-600">
                    R$ {total.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Ações secundárias */}
              <div className="px-3 pb-1 flex gap-2">
                {phone && (
                  <button
                    onClick={() => setChatPhone(toE164(phone) ?? phone)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Abrir Chat
                  </button>
                )}
                <button
                  onClick={() => setEditOrderId(order.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Editar Pedido
                </button>
              </div>

              {/* Ações principais */}
              <div className="px-3 pb-3 flex gap-2">
                <button
                  disabled={isBusy}
                  onClick={() => handleReject(order.id)}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                  Rejeitar
                </button>
                <button
                  disabled={isBusy}
                  onClick={() => handleConfirm(order.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isBusy ? "Processando..." : "Confirmar Pedido"}
                </button>
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
