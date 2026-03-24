"use client";

import React from "react";
import type { CartItem, Driver, DraftQty, PaymentMethod, Variant } from "@/lib/orders/types";
import {
    brlToNumber,
    cartSubtotal,
    cartTotalPreview,
    formatBRL,
    formatBRLInput,
} from "@/lib/orders/helpers";
import VariantResultRow from "./VariantResultRow";
import CartRow from "./CartRow";
import { Search, Truck } from "lucide-react";

const inputCls =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500";

const sectionCls =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

const labelCls =
    "mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

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

    // entregador (opcional)
    drivers,
    driverId,
    setDriverId,

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

    drivers?: Driver[];
    driverId?: string | null;
    setDriverId?: (v: string | null) => void;

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

            {/* ── Cliente ── */}
            <div className={`${sectionCls} sm:col-span-2`}>
                <div className={labelCls}>Cliente</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
                    <input
                        placeholder="Nome"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className={inputCls}
                    />
                    <input
                        placeholder="Telefone (WhatsApp)"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className={inputCls}
                    />
                </div>
                <input
                    placeholder="Endereço (texto livre)"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    className={`${inputCls} mt-2`}
                />
            </div>

            {/* ── Pagamento ── */}
            <div className={sectionCls}>
                <div className={labelCls}>Pagamento</div>

                <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className={inputCls}
                >
                    <option value="pix">PIX</option>
                    <option value="card">Cartão</option>
                    <option value="cash">Dinheiro</option>
                    <option value="debit">Débito</option>
                    <option value="credit_installment">Crédito Parcelado</option>
                    <option value="a_prazo">A Prazo / Fiado</option>
                </select>

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <input
                        type="checkbox"
                        checked={paid}
                        onChange={(e) => setPaid(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                    />
                    Já está pago
                </label>

                {paymentMethod === "cash" && (
                    <div className="mt-3 space-y-2">
                        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                            Cliente paga com (R$)
                        </label>
                        <input
                            value={changeFor}
                            onChange={(e) => setChangeFor(formatBRLInput(e.target.value))}
                            className={inputCls}
                            inputMode="numeric"
                        />
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
                            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-50">
                                Troco: R$ {formatBRL(trocoNow)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                Total: R$ {formatBRL(totalNow)} · Paga: R$ {formatBRL(customerPaysNow)}
                            </div>
                        </div>
                    </div>
                )}

                {paymentMethod === "card" && (
                    <p className="mt-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        Levar maquininha
                    </p>
                )}
            </div>

            {/* ── Entrega ── */}
            <div className={sectionCls}>
                <div className={labelCls}>Entrega</div>

                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <input
                        type="checkbox"
                        checked={deliveryFeeEnabled}
                        onChange={(e) => setDeliveryFeeEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                    />
                    Cobrar taxa de entrega
                </label>

                <div className="mt-3 space-y-1">
                    <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Taxa (R$)
                    </label>
                    <input
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(formatBRLInput(e.target.value))}
                        disabled={!deliveryFeeEnabled}
                        className={`${inputCls} disabled:opacity-50`}
                        inputMode="numeric"
                    />
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Se desligado, taxa fica R$ 0,00.
                    </p>
                </div>
            </div>

            {/* ── Entregador ── */}
            {drivers && drivers.length > 0 && (
                <div className={`${sectionCls} sm:col-span-2`}>
                    <div className={`${labelCls} flex items-center gap-1.5`}>
                        <Truck className="h-3.5 w-3.5" />
                        Entregador
                    </div>
                    <select
                        value={driverId ?? ""}
                        onChange={(e) => setDriverId?.(e.target.value || null)}
                        className={inputCls}
                    >
                        <option value="">— Sem entregador —</option>
                        {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                                {d.vehicle ? ` · ${d.vehicle}` : ""}
                                {d.plate ? ` (${d.plate})` : ""}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* ── Adicionar itens ── */}
            <div className={`${sectionCls} sm:col-span-2`}>
                <div className={labelCls}>Adicionar itens</div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                        placeholder="Buscar por categoria, marca, detalhes, volume..."
                        value={q}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className={`${inputCls} pl-9`}
                    />
                </div>

                <div className="mt-3">
                    {searching ? (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">Buscando...</p>
                    ) : results.length === 0 ? (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                            Digite pelo menos 2 letras para buscar.
                        </p>
                    ) : (
                        <div className="grid gap-2">
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

            {/* ── Carrinho ── */}
            <div className={`${sectionCls} sm:col-span-2`}>
                <div className={labelCls}>{modeLabel}</div>

                {cart.length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Nenhum item adicionado.</p>
                ) : (
                    <div className="grid gap-2">
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

                <div className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                        <span>Subtotal</span>
                        <span className="font-semibold">R$ {formatBRL(cartSubtotal(cart))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                        <span>Taxa de entrega</span>
                        <span className="font-semibold">R$ {formatBRL(deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-50">Total</span>
                        <span className="font-bold text-violet-700 dark:text-violet-400">
                            R$ {formatBRL(cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee))}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
