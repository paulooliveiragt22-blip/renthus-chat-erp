"use client";

import React from "react";
import Modal from "./Modal";
import OrderForm from "./OrderForm";
import type {
    CartItem,
    Driver,
    DraftQty,
    NewOrderAddrForm,
    OrderAddressMode,
    OrderCustomerPick,
    PaymentMethod,
    SavedCustomerAddress,
    Variant,
} from "@/lib/orders/types";

export default function NewOrderModal({
    open,
    onClose,
    saving,
    onSave,
    msg,

    customerName,       setCustomerName,
    customerPhone,      setCustomerPhone,
    customerAddress,    setCustomerAddress,

    orderCustomers,
    orderCustomersLoading,
    selectedOrderCustomerId,
    onSelectOrderCustomer,
    orderSavedAddresses,
    orderAddressMode,
    setOrderAddressMode,
    orderSelectedAddrId,
    setOrderSelectedAddrId,
    newOrderAddrForm,
    setNewOrderAddrForm,

    paymentMethod,      setPaymentMethod,
    paid,               setPaid,
    changeFor,          setChangeFor,

    deliveryFeeEnabled, setDeliveryFeeEnabled,
    deliveryFee,        setDeliveryFee,

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
    saving: boolean;
    onSave: () => void;
    msg: string | null;

    customerName: string;       setCustomerName: (v: string) => void;
    customerPhone: string;      setCustomerPhone: (v: string) => void;
    customerAddress: string;    setCustomerAddress: (v: string) => void;

    orderCustomers: OrderCustomerPick[];
    orderCustomersLoading: boolean;
    selectedOrderCustomerId: string | null;
    onSelectOrderCustomer: (id: string | null) => void;
    orderSavedAddresses: SavedCustomerAddress[];
    orderAddressMode: OrderAddressMode;
    setOrderAddressMode: (m: OrderAddressMode) => void;
    orderSelectedAddrId: string | null;
    setOrderSelectedAddrId: (id: string | null) => void;
    newOrderAddrForm: NewOrderAddrForm;
    setNewOrderAddrForm: React.Dispatch<React.SetStateAction<NewOrderAddrForm>>;

    paymentMethod: PaymentMethod; setPaymentMethod: (v: PaymentMethod) => void;
    paid: boolean;              setPaid: (v: boolean) => void;
    changeFor: string;          setChangeFor: (v: string) => void;

    deliveryFeeEnabled: boolean; setDeliveryFeeEnabled: (v: boolean) => void;
    deliveryFee: string;        setDeliveryFee: (v: string) => void;

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
    return (
        <Modal title="Novo pedido" open={open} onClose={onClose}>
            <OrderForm
                customerName={customerName}         setCustomerName={setCustomerName}
                customerPhone={customerPhone}       setCustomerPhone={setCustomerPhone}
                customerAddress={customerAddress}   setCustomerAddress={setCustomerAddress}
                orderCustomers={orderCustomers}
                orderCustomersLoading={orderCustomersLoading}
                selectedOrderCustomerId={selectedOrderCustomerId}
                onSelectOrderCustomer={onSelectOrderCustomer}
                orderSavedAddresses={orderSavedAddresses}
                orderAddressMode={orderAddressMode}
                setOrderAddressMode={setOrderAddressMode}
                orderSelectedAddrId={orderSelectedAddrId}
                setOrderSelectedAddrId={setOrderSelectedAddrId}
                newOrderAddrForm={newOrderAddrForm}
                setNewOrderAddrForm={setNewOrderAddrForm}
                paymentMethod={paymentMethod}       setPaymentMethod={setPaymentMethod}
                paid={paid}                         setPaid={setPaid}
                changeFor={changeFor}               setChangeFor={setChangeFor}
                deliveryFeeEnabled={deliveryFeeEnabled} setDeliveryFeeEnabled={setDeliveryFeeEnabled}
                deliveryFee={deliveryFee}           setDeliveryFee={setDeliveryFee}
                drivers={drivers}
                driverId={driverId}                 setDriverId={setDriverId}
                q={q}                               onSearchChange={onSearchChange}
                searching={searching}               results={results}
                getDraft={getDraft}                 setDraft={setDraft}         clearDraft={clearDraft}
                cart={cart}                         setCart={setCart}           addToCart={addToCart}
                totalNow={totalNow}                 customerPaysNow={customerPaysNow} trocoNow={trocoNow}
                modeLabel="Carrinho"
            />

            <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? "Salvando..." : "Salvar pedido"}
                </button>
                <button
                    onClick={onClose}
                    disabled={saving}
                    className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                    Cancelar
                </button>
                {msg && (
                    <span className={`ml-auto text-xs font-medium ${msg.startsWith("✅") ? "text-emerald-600" : "text-rose-600"}`}>
                        {msg}
                    </span>
                )}
            </div>
        </Modal>
    );
}
