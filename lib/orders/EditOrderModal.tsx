"use client";

import React from "react";
import Modal from "./Modal";
import OrderForm from "./OrderForm";
import { formatDT, prettyStatus } from "@/lib/orders/helpers";
import type { CartItem, Driver, DraftQty, OrderFull, PaymentMethod, Variant } from "@/lib/orders/types";
import type { FulfillmentType } from "@/lib/delivery/fulfillment";
import { Lock } from "lucide-react";

export default function EditOrderModal({
    open,
    onClose,
    loading,
    saving,
    order,
    canEditOrder,
    onSave,
    onSaveAndPrint,
    msg,

    customerName,       setCustomerName,
    customerPhone,      setCustomerPhone,
    customerAddress,    setCustomerAddress,

    paymentMethod,      setPaymentMethod,
    paid,               setPaid,
    changeFor,          setChangeFor,

    deliveryFeeEnabled, setDeliveryFeeEnabled,
    deliveryFee,        setDeliveryFee,

    fulfillmentType,    setFulfillmentType,
    deliveriesEnabled = true,
    pickupEnabled = true,

    serviceFeeOptions = [],
    selectedServiceFeeIds = [],
    onToggleServiceFee,

    drivers,
    driverId,           setDriverId,

    q,                  onSearchChange,
    searching,          results,

    getDraft,           setDraft,           clearDraft,
    cart,               setCart,            addToCart,

    totalNow,           customerPaysNow,    trocoNow,
}: {
    open: boolean;
    onClose: () => void;
    loading: boolean;
    saving: boolean;
    order: OrderFull | null;
    canEditOrder: boolean;
    onSave: () => void;
    onSaveAndPrint?: () => void;
    msg: string | null;

    customerName: string;       setCustomerName: (v: string) => void;
    customerPhone: string;      setCustomerPhone: (v: string) => void;
    customerAddress: string;    setCustomerAddress: (v: string) => void;

    paymentMethod: PaymentMethod; setPaymentMethod: (v: PaymentMethod) => void;
    paid: boolean;              setPaid: (v: boolean) => void;
    changeFor: string;          setChangeFor: (v: string) => void;

    deliveryFeeEnabled: boolean; setDeliveryFeeEnabled: (v: boolean) => void;
    deliveryFee: string;        setDeliveryFee: (v: string) => void;

    fulfillmentType: FulfillmentType;
    setFulfillmentType: (v: FulfillmentType) => void;
    deliveriesEnabled?: boolean;
    pickupEnabled?: boolean;

    serviceFeeOptions?: Array<{
        id: string;
        name: string;
        calc_mode: "fixed" | "percent";
        value: number;
    }>;
    selectedServiceFeeIds?: string[];
    onToggleServiceFee?: (id: string) => void;

    drivers: Driver[];
    driverId: string | null;    setDriverId: (v: string | null) => void;

    q: string;                  onSearchChange: (t: string) => void;
    searching: boolean;         results: Variant[];

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
    const title = `Editar pedido${order ? ` · ${formatDT(order.created_at)} · ${prettyStatus(String(order.status))}` : ""}`;

    return (
        <Modal
            title={title}
            open={open}
            onClose={onClose}
            footer={
                canEditOrder && order && !loading ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving}
                            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? "Salvando..." : "Salvar alterações"}
                        </button>
                        {onSaveAndPrint && (order as { confirmation_status?: string })?.confirmation_status === "confirmed" && (
                            <button
                                type="button"
                                onClick={onSaveAndPrint}
                                disabled={saving}
                                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {saving ? "Salvando..." : "Salvar e Reimprimir"}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                            Cancelar
                        </button>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            Ao editar, os itens são <strong>substituídos</strong>.
                        </p>
                        {msg && (
                            <span
                                className={`ml-auto text-xs font-medium ${
                                    msg.startsWith("✅") ? "text-emerald-600" : "text-rose-600"
                                }`}
                            >
                                {msg}
                            </span>
                        )}
                    </div>
                ) : undefined
            }
        >
            {loading ? (
                <p className="py-8 text-center text-sm text-zinc-400">Carregando...</p>
            ) : !order ? (
                <p className="py-8 text-center text-sm text-zinc-400">Nenhum pedido selecionado.</p>
            ) : !canEditOrder ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Edição bloqueada</p>
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            Este pedido já teve uma ação de status (
                            <strong>{prettyStatus(String(order.status))}</strong>
                            ). Pela regra, não pode mais editar.
                        </p>
                    </div>
                </div>
            ) : (
                <OrderForm
                    customerName={customerName}         setCustomerName={setCustomerName}
                    customerPhone={customerPhone}       setCustomerPhone={setCustomerPhone}
                    customerAddress={customerAddress}   setCustomerAddress={setCustomerAddress}
                    paymentMethod={paymentMethod}       setPaymentMethod={setPaymentMethod}
                    paid={paid}                         setPaid={setPaid}
                    changeFor={changeFor}               setChangeFor={setChangeFor}
                    deliveryFeeEnabled={deliveryFeeEnabled} setDeliveryFeeEnabled={setDeliveryFeeEnabled}
                    deliveryFee={deliveryFee}           setDeliveryFee={setDeliveryFee}
                    fulfillmentType={fulfillmentType}   setFulfillmentType={setFulfillmentType}
                    deliveriesEnabled={deliveriesEnabled}
                    pickupEnabled={pickupEnabled}
                    serviceFeeOptions={serviceFeeOptions}
                    selectedServiceFeeIds={selectedServiceFeeIds}
                    onToggleServiceFee={onToggleServiceFee}
                    drivers={drivers}
                    driverId={driverId}                 setDriverId={setDriverId}
                    q={q}                               onSearchChange={onSearchChange}
                    searching={searching}               results={results}
                    getDraft={getDraft}                 setDraft={setDraft}         clearDraft={clearDraft}
                    cart={cart}                         setCart={setCart}           addToCart={addToCart}
                    totalNow={totalNow}                 customerPaysNow={customerPaysNow} trocoNow={trocoNow}
                    modeLabel="Itens do pedido"
                />
            )}
        </Modal>
    );
}
