"use client";

import React from "react";
import type { CartItem, DraftQty, PaymentMethod, Variant } from "@/lib/orders/types";
import {
    btnPurple,
    cartSubtotal,
    cartTotalPreview,
    formatBRL,
    formatBRLInput,
    brlToNumber,
} from "@/lib/orders/helpers";
import VariantResultRow from "./VariantResultRow";
import CartRow from "./CartRow";

export default function OrderForm({
    // cliente
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerAddress,
    setCustomerAddress,

    // pagamento
    paymentMethod,
    setPaymentMethod,
    paid,
    setPaid,
    changeFor,
    setChangeFor,

    // entrega
    deliveryFeeEnabled,
    setDeliveryFeeEnabled,
    deliveryFee,
    setDeliveryFee,

    // busca
    q,
    onSearchChange,
    searching,
    results,

    // drafts
    getDraft,
    setDraft,
    clearDraft,

    // cart
    cart,
    setCart,
    addToCart,

    // preview troco
    totalNow,
    customerPaysNow,
    trocoNow,

    // labels
    modeLabel,
}: {
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
    onSearchChange: (text: string) => void;
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

    modeLabel: string;
}) {
    return (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", fontSize: 12 }}>
            {/* Cliente */}
            <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Cliente</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 200px" }}>
                    <input
                        placeholder="Nome"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                    />
                    <input
                        placeholder="Telefone (WhatsApp)"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        style={{ padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                    />
                </div>
                <input
                    placeholder="Endereço (texto livre)"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    style={{ marginTop: 8, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                />
            </div>

            {/* Pagamento */}
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Pagamento</div>

                <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                >
                    <option value="pix">PIX</option>
                    <option value="card">Cartão</option>
                    <option value="cash">Dinheiro</option>
                </select>

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontWeight: 700 }}>
                    <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
                    Já está pago
                </label>

                {paymentMethod === "cash" && (
                    <div style={{ marginTop: 8 }}>
                        <label style={{ fontWeight: 700 }}>Cliente paga com (R$)</label>
                        <input
                            value={changeFor}
                            onChange={(e) => setChangeFor(formatBRLInput(e.target.value))}
                            style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                            inputMode="numeric"
                        />

                        <div style={{ marginTop: 8, padding: 8, borderRadius: 10, border: "1px solid #eee", background: "#fafafa" }}>
                            <div style={{ fontWeight: 900, color: "#111" }}>Levar de troco: R$ {formatBRL(trocoNow)}</div>
                            <div style={{ color: "#666", fontSize: 12 }}>
                                Total atual: R$ {formatBRL(totalNow)} • Cliente paga com: R$ {formatBRL(customerPaysNow)}
                            </div>
                        </div>
                    </div>
                )}

                {paymentMethod === "card" && (
                    <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                        <b>Levar maquininha</b>
                    </div>
                )}
            </div>

            {/* Entrega */}
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Entrega</div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                    <input type="checkbox" checked={deliveryFeeEnabled} onChange={(e) => setDeliveryFeeEnabled(e.target.checked)} />
                    Cobrar taxa
                </label>

                <div style={{ marginTop: 8 }}>
                    <label style={{ fontWeight: 700 }}>Taxa de entrega (R$)</label>
                    <input
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(formatBRLInput(e.target.value))}
                        disabled={!deliveryFeeEnabled}
                        style={{ marginTop: 6, width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                        inputMode="numeric"
                    />
                    <small style={{ color: "#666" }}>Se desligado, fica 0.</small>
                </div>
            </div>

            {/* Buscar/Adicionar */}
            <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Adicionar itens</div>

                <input
                    placeholder="Buscar (categoria, marca, detalhes, volume...)"
                    value={q}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 10, fontSize: 12 }}
                />

                <div style={{ marginTop: 8 }}>
                    {searching ? (
                        <p>Buscando...</p>
                    ) : results.length === 0 ? (
                        <p style={{ color: "#666" }}>Digite pelo menos 2 letras para buscar.</p>
                    ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                            {results.map((v) => (
                                <VariantResultRow
                                    key={v.id}
                                    v={v}
                                    draft={getDraft(v.id)}
                                    onDraftChange={(patch) => setDraft(v.id, patch)}
                                    onAdd={(unitN, boxN) => {
                                        if (unitN > 0) addToCart(v, "unit", unitN);
                                        if (boxN > 0 && v.has_case && v.case_price) addToCart(v, "case", boxN);
                                        clearDraft(v.id);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Carrinho */}
            <div style={{ gridColumn: "1 / -1", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>{modeLabel}</div>

                {cart.length === 0 ? (
                    <p style={{ color: "#666" }}>Nenhum item ainda.</p>
                ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                        {cart.map((item, idx) => (
                            <CartRow
                                key={`${item.variant.id}-${item.mode}-${idx}`}
                                item={item}
                                onDec={() =>
                                    setCart((prev) => {
                                        const copy = [...prev];
                                        copy[idx] = { ...copy[idx], qty: Math.max(1, copy[idx].qty - 1) };
                                        return copy;
                                    })
                                }
                                onInc={() =>
                                    setCart((prev) => {
                                        const copy = [...prev];
                                        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
                                        return copy;
                                    })
                                }
                                onRemove={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                            />
                        ))}
                    </div>
                )}

                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Subtotal</span>
                        <b>R$ {formatBRL(cartSubtotal(cart))}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Taxa de entrega</span>
                        <b>R$ {formatBRL(deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0)}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                        <span>Total</span>
                        <b>R$ {formatBRL(cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee))}</b>
                    </div>
                </div>
            </div>
        </div>
    );
}
