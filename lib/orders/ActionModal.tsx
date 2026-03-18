"use client";

import React from "react";
import Modal from "./Modal";
import { btnPurple, btnPurpleOutline, prettyStatus } from "@/lib/orders/helpers";
import type { OrderStatus } from "@/lib/orders/types";

export type ActionKind = "cancel" | "deliver" | "finalize";

const PAYMENT_OPTIONS = [
  { value: "pix",   label: "PIX" },
  { value: "card",  label: "Cartão" },
  { value: "cash",  label: "Dinheiro" },
  { value: "a_prazo", label: "A Prazo / Fiado" },
] as const;

export default function ActionModal({
  open,
  onClose,
  kind,
  note,
  setNote,
  saving,
  onConfirm,
  orderPaymentMethod,
  paymentMethod,
  setPaymentMethod,
}: {
  open: boolean;
  onClose: () => void;
  kind: ActionKind;
  note: string;
  setNote: (v: string) => void;
  saving: boolean;
  onConfirm: () => void;
  orderPaymentMethod?: string;
  paymentMethod?: string;
  setPaymentMethod?: (v: string) => void;
}) {
  const showPayment = (kind === "finalize" || kind === "deliver") && !!setPaymentMethod;

  function actionTitle(k: ActionKind) {
    if (k === "cancel")   return "Cancelar/Inativar pedido";
    if (k === "deliver")  return "Marcar como entregue";
    return "Finalizar e registrar pagamento";
  }
  function actionStatus(k: ActionKind): OrderStatus {
    if (k === "cancel")  return "canceled";
    if (k === "deliver") return "delivered";
    return "finalized";
  }

  return (
    <Modal title={actionTitle(kind)} open={open} onClose={onClose}>
      <div style={{ display: "grid", gap: 12, fontSize: 12 }}>

        {showPayment && (
          <div>
            <p style={{ margin: "0 0 8px", color: "#555", fontWeight: 700 }}>
              Forma de pagamento recebida:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {PAYMENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentMethod?.(opt.value)}
                  style={{
                    padding: "8px 10px",
                    border: `2px solid ${paymentMethod === opt.value ? "#7c3aed" : "#ddd"}`,
                    borderRadius: 10,
                    background: paymentMethod === opt.value ? "#ede9fe" : "#fafafa",
                    color: paymentMethod === opt.value ? "#5b21b6" : "#555",
                    fontWeight: paymentMethod === opt.value ? 900 : 500,
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  {opt.label}
                  {opt.value === orderPaymentMethod && paymentMethod !== opt.value && (
                    <span style={{ color: "#aaa", fontWeight: 400 }}> (pedido)</span>
                  )}
                </button>
              ))}
            </div>
            {paymentMethod && (
              <p style={{ margin: "6px 0 0", color: "#7c3aed", fontSize: 11 }}>
                ✅ Será registrado em <b>Financeiro</b> como <b>{PAYMENT_OPTIONS.find(o => o.value === paymentMethod)?.label}</b>
              </p>
            )}
          </div>
        )}

        <div>
          <p style={{ margin: "0 0 6px", color: "#666" }}>
            {showPayment ? "Observação (opcional):" : "Informe uma observação para registrar essa ação."}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={showPayment ? "Ex: Pago na entrega, cupom fiscal entregue…" : "Digite a observação..."}
            rows={3}
            style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, fontWeight: 600, fontSize: 12, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onConfirm}
            disabled={saving || (showPayment && !paymentMethod)}
            style={btnPurple(saving || (showPayment && !paymentMethod))}
          >
            {saving ? "Salvando..." : showPayment ? "Confirmar & Registrar" : "Confirmar"}
          </button>
          <button onClick={onClose} disabled={saving} style={btnPurpleOutline(false)}>
            Voltar
          </button>
        </div>

        <small style={{ color: "#999" }}>
          Status: <b>{prettyStatus(actionStatus(kind))}</b>
          {showPayment && " · pagamento registrado em financial_entries"}
        </small>
      </div>
    </Modal>
  );
}
