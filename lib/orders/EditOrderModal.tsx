"use client";

import React from "react";
import Modal from "./Modal";
import OrderForm from "./OrderForm";
import { btnPurple, btnPurpleOutline, formatDT, prettyStatus } from "@/lib/orders/helpers";
import type { CartItem, DraftQty, OrderFull, PaymentMethod, Variant } from "@/lib/orders/types";

export default function EditOrderModal({
    open,
    onClose,
    loading,
    saving,
    order,
    canEditOrder,
    onSave,

    msg,

    // form state
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerAddress,
    setCustomerAddress,

    paymentMethod,
    setPaymentMethod,
    paid,
    setPaid,
    changeFor,
    setChangeFor,

    deliveryFeeEnabled,
    setDeliveryFeeEnabled,
    deliveryFee,
    setDeliveryFee,

    q,
    onSearchChange,
    searching,
    results,

    getDraft,
    setDraft,
    clearDraft,

    cart,
    setCart,
    addToCart,

    totalNow,
    customerPaysNow,
    trocoNow,
}: {
    open: boolean;
    onClose: () => void;
    loading: boolean;
    saving: boolean;
    order: OrderFull | null;
    canEditOrder: boolean;
    onSave: () => void;

    msg: string | null;

    customerName: string;
    setCustomerName: (v: string) => void;
    customerPhone: string;
    setCustomerPhone: (v: string) => void;
    customerAddress: string;
    setCustomerAddress: (v: string) => void;

    paymentMethod: PaymentMethod;
    setPaymentMethod: (v: PaymentMethod) => void;
    paid: boolean;
    setPaid: (v: boolean) => void;
    changeFor: string;
    setChangeFor: (v: string) => void;

    deliveryFeeEnabled: boolean;
    setDeliveryFeeEnabled: (v: boolean) => void;
    deliveryFee: string;
    setDeliveryFee: (v: string) => void;

    q: string;
    onSearchChange: (t: string) => void;
    searching: boolean;
    results: Variant[];

    getDraft: (id: string) => DraftQty;
    setDraft: (id: string, patch: Partial<DraftQty>) => void;
    clearDraft: (id: string) => void;

    cart: CartItem[];
    setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
    addToCart: (v: Variant, mode: "unit" | "case", qty: number) => void;

    totalNow: number;
    customerPaysNow: number;
    trocoNow: number;
}) {
    const title = `Editar pedido ${order ? `• ${formatDT(order.created_at)} • ${prettyStatus(String(order.status))}` : ""
        }`;

    return (
        <Modal title={title} open={open} onClose={onClose}>
            {loading ? (
                <p>Carregando...</p>
            ) : !order ? (
                <p>Nenhum pedido selecionado.</p>
            ) : !canEditOrder ? (
                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Edição bloqueada</div>
                    <p style={{ margin: 0, color: "#666" }}>
                        Este pedido já teve uma ação de status (<b>{prettyStatus(String(order.status))}</b>). Pela regra, não pode mais editar.
                    </p>
                </div>
            ) : (
                <>
                    <OrderForm
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
                        onSearchChange={onSearchChange}
                        searching={searching}
                        results={results}
                        getDraft={getDraft}
                        setDraft={setDraft}
                        clearDraft={clearDraft}
                        cart={cart}
                        setCart={setCart}
                        addToCart={addToCart}
                        totalNow={totalNow}
                        customerPaysNow={customerPaysNow}
                        trocoNow={trocoNow}
                        modeLabel="Itens do pedido"
                    />

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                        <button onClick={onSave} disabled={saving} style={btnPurple(saving)}>
                            {saving ? "Salvando..." : "Salvar alterações"}
                        </button>
                        <button onClick={onClose} disabled={saving} style={btnPurpleOutline(false)}>
                            Cancelar
                        </button>

                        <small style={{ color: "#777" }}>
                            Importante: ao editar, os itens são <b>substituídos</b>.
                        </small>

                        {msg && <span style={{ marginLeft: "auto", color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</span>}
                    </div>
                </>
            )}
        </Modal>
    );
}
