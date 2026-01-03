"use client";

import React from "react";
import Modal from "./Modal";
import { btnPurple, btnPurpleOutline, prettyStatus } from "@/lib/orders/helpers";
import type { OrderStatus } from "@/lib/orders/types";

export type ActionKind = "cancel" | "deliver" | "finalize";

export default function ActionModal({
    open,
    onClose,
    kind,
    note,
    setNote,
    saving,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    kind: ActionKind;
    note: string;
    setNote: (v: string) => void;
    saving: boolean;
    onConfirm: () => void;
}) {
    function actionTitle(k: ActionKind) {
        if (k === "cancel") return "Cancelar/Inativar pedido";
        if (k === "deliver") return "Marcar como entregue";
        return "Marcar como finalizado";
    }
    function actionStatus(k: ActionKind): OrderStatus {
        if (k === "cancel") return "canceled";
        if (k === "deliver") return "delivered";
        return "finalized";
    }

    return (
        <Modal title={actionTitle(kind)} open={open} onClose={onClose}>
            <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                <p style={{ margin: 0, color: "#666" }}>Informe uma observação para registrar essa ação.</p>

                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Digite a observação..."
                    rows={4}
                    style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 10, fontWeight: 900, fontSize: 12 }}
                />

                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={onConfirm} disabled={saving} style={btnPurple(saving)}>
                        {saving ? "Salvando..." : "Confirmar"}
                    </button>

                    <button onClick={onClose} disabled={saving} style={btnPurpleOutline(false)}>
                        Voltar
                    </button>
                </div>

                <small style={{ color: "#777" }}>
                    Status: <b>{prettyStatus(actionStatus(kind))}</b> • observação salva em <b>orders.details</b>.
                </small>
            </div>
        </Modal>
    );
}
