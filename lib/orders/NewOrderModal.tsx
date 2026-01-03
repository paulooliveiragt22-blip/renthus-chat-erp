"use client";

import React from "react";
import Modal from "./Modal";
import OrderForm from "./OrderForm";
import { btnPurple } from "@/lib/orders/helpers";
import type { CartItem, DraftQty, PaymentMethod, Variant } from "@/lib/orders/types";

export default function NewOrderModal({
    open,
    onClose,
    saving,
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
    saving: boolean;
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
    return (
        <Modal title="Novo pedido" open={open} onClose={onClose}>
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
                modeLabel="Carrinho"
            />

            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                <button onClick={onSave} disabled={saving} style={btnPurple(saving)}>
                    {saving ? "Salvando..." : "Salvar pedido"}
                </button>

                {msg && <span style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</span>}
            </div>
        </Modal>
    );
}
