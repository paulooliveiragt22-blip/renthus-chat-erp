"use client";

import React from "react";
import { cva } from "class-variance-authority";
import { Search, Store, Truck } from "lucide-react";
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
import {
    brlToNumber,
    cartSubtotal,
    formatBRL,
    formatBRLInput,
} from "@/lib/orders/helpers";
import VariantResultRow from "./VariantResultRow";
import CartRow from "./CartRow";
import type { FulfillmentType } from "@/lib/delivery/fulfillment";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const inputCls = cn(
    "w-full rounded-lg border border-border bg-background-card px-3 py-2 text-sm text-foreground",
    "placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent",
    "disabled:cursor-not-allowed disabled:opacity-50"
);

const sectionCls =
    "rounded-xl border border-border bg-background-card p-4";

const labelCls =
    "mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted";

const modeChipVariants = cva(
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    {
        variants: {
            selected: {
                true: "bg-primary text-white shadow-sm",
                false:
                    "border border-border bg-background text-foreground-muted hover:bg-zinc-100 dark:hover:bg-zinc-800",
            },
            size: {
                default: "px-3 py-1.5",
                cozy: "px-3.5 py-2",
            },
        },
        defaultVariants: { selected: false, size: "default" },
    }
);

const MANUAL_CUSTOMER = "__manual__";
const NO_DRIVER = "__none__";

const ADDR_MODE_LABEL: Record<OrderAddressMode, string> = {
    saved: "Endereço salvo",
    new: "Salvar novo endereço",
    free: "Texto livre",
};

export default function OrderForm({
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerAddress,
    setCustomerAddress,

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

    paymentMethod,
    setPaymentMethod,
    paid,
    setPaid,
    changeFor,
    setChangeFor,

    fulfillmentType,
    setFulfillmentType,
    deliveriesEnabled = true,
    pickupEnabled = true,
    deliveryFeeEnabled,
    setDeliveryFeeEnabled,
    deliveryFee,
    setDeliveryFee,

    serviceFeeOptions = [],
    selectedServiceFeeIds = [],
    onToggleServiceFee,

    drivers,
    driverId,
    setDriverId,

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

    modeLabel,
}: {
    customerName: string;
    setCustomerName: (v: string) => void;
    customerPhone: string;
    setCustomerPhone: (v: string) => void;
    customerAddress: string;
    setCustomerAddress: (v: string) => void;

    orderCustomers?: OrderCustomerPick[];
    orderCustomersLoading?: boolean;
    selectedOrderCustomerId?: string | null;
    onSelectOrderCustomer?: (id: string | null) => void;
    orderSavedAddresses?: SavedCustomerAddress[];
    orderAddressMode?: OrderAddressMode;
    setOrderAddressMode?: (m: OrderAddressMode) => void;
    orderSelectedAddrId?: string | null;
    setOrderSelectedAddrId?: (id: string | null) => void;
    newOrderAddrForm?: NewOrderAddrForm;
    setNewOrderAddrForm?: React.Dispatch<React.SetStateAction<NewOrderAddrForm>>;

    paymentMethod: PaymentMethod;
    setPaymentMethod: (v: PaymentMethod) => void;
    paid: boolean;
    setPaid: (v: boolean) => void;
    changeFor: string;
    setChangeFor: (v: string) => void;

    fulfillmentType: FulfillmentType;
    setFulfillmentType: (v: FulfillmentType) => void;
    deliveriesEnabled?: boolean;
    pickupEnabled?: boolean;

    deliveryFeeEnabled: boolean;
    setDeliveryFeeEnabled: (v: boolean) => void;
    deliveryFee: string;
    setDeliveryFee: (v: string) => void;

    serviceFeeOptions?: Array<{
        id: string;
        name: string;
        calc_mode: "fixed" | "percent";
        value: number;
    }>;
    selectedServiceFeeIds?: string[];
    onToggleServiceFee?: (id: string) => void;

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
    const pickMode = orderCustomers !== undefined && !!onSelectOrderCustomer;
    const oc = orderCustomers ?? [];
    const ocLoading = orderCustomersLoading ?? false;
    const selCust = selectedOrderCustomerId ?? null;
    const addrs = orderSavedAddresses ?? [];
    const addrMode = orderAddressMode ?? "free";
    const setAddrMode = setOrderAddressMode ?? (() => {});
    const selAddrId = orderSelectedAddrId ?? null;
    const setSelAddrId = setOrderSelectedAddrId ?? (() => {});
    const naForm = newOrderAddrForm ?? {
        apelido: "",
        logradouro: "",
        numero: "",
        complemento: "",
        bairro: "",
        cidade: "",
        estado: "",
        cep: "",
    };
    const setNaForm = setNewOrderAddrForm ?? (() => {});
    const isPickup = fulfillmentType === "pickup";
    const showModeToggle = deliveriesEnabled && pickupEnabled;
    const offline =
        typeof navigator !== "undefined" && !navigator.onLine;

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(showModeToggle || isPickup || !deliveriesEnabled || !pickupEnabled) && (
                <div className={cn(sectionCls, "sm:col-span-2")}>
                    <div className={labelCls}>Modo do pedido</div>
                    {showModeToggle ? (
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Modo do pedido">
                            <button
                                type="button"
                                aria-pressed={!isPickup}
                                onClick={() => setFulfillmentType("delivery")}
                                className={modeChipVariants({
                                    selected: !isPickup,
                                    size: "cozy",
                                })}
                            >
                                <Truck className="h-3.5 w-3.5" aria-hidden />
                                Entrega
                            </button>
                            <button
                                type="button"
                                aria-pressed={isPickup}
                                onClick={() => setFulfillmentType("pickup")}
                                className={modeChipVariants({
                                    selected: isPickup,
                                    size: "cozy",
                                })}
                            >
                                <Store className="h-3.5 w-3.5" aria-hidden />
                                Retirada no local
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm font-medium text-foreground">
                            {isPickup || !deliveriesEnabled ? "Retirada no local" : "Entrega"}
                        </p>
                    )}
                </div>
            )}

            <div className={cn(sectionCls, "sm:col-span-2")}>
                <div className={labelCls}>Cliente</div>
                {pickMode ? (
                    <>
                        <label
                            htmlFor="order-customer-select"
                            className="mb-2 block text-[11px] font-medium text-foreground-muted"
                        >
                            Cliente cadastrado
                        </label>
                        <Select
                            value={selCust ?? MANUAL_CUSTOMER}
                            onValueChange={(v) =>
                                onSelectOrderCustomer!(v === MANUAL_CUSTOMER ? null : v)
                            }
                            disabled={ocLoading}
                        >
                            <SelectTrigger
                                id="order-customer-select"
                                className="mb-3"
                                aria-busy={ocLoading}
                            >
                                <SelectValue
                                    placeholder={
                                        ocLoading
                                            ? "Carregando clientes…"
                                            : "Cadastro manual"
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={MANUAL_CUSTOMER}>
                                    {ocLoading
                                        ? "Carregando clientes…"
                                        : "Cadastro manual (digitar nome, telefone e endereço)"}
                                </SelectItem>
                                {oc.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        <span className="truncate">
                                            {(c.name || "Sem nome").trim()} · {c.phone || "—"}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_minmax(10rem,11.25rem)]">
                            <input
                                placeholder="Nome"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                className={inputCls}
                                disabled={!!selCust}
                                aria-label="Nome do cliente"
                            />
                            <input
                                placeholder="Telefone (WhatsApp)"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                className={inputCls}
                                disabled={!!selCust}
                                aria-label="Telefone do cliente"
                            />
                        </div>
                        {selCust && (
                            <p className="mt-1.5 text-[11px] text-foreground-muted">
                                Nome e telefone vêm do cadastro. Para alterar, use a tela Clientes
                                ou selecione cadastro manual.
                            </p>
                        )}

                        {!isPickup && (
                            <>
                                <div className={cn(labelCls, "mt-4")}>Endereço de entrega</div>
                                {selCust ? (
                                    <div className="space-y-3">
                                        <div
                                            className="flex flex-wrap gap-2"
                                            role="group"
                                            aria-label="Modo do endereço"
                                        >
                                            {(["saved", "new", "free"] as const).map((m) => (
                                                <button
                                                    key={m}
                                                    type="button"
                                                    aria-pressed={addrMode === m}
                                                    onClick={() => setAddrMode(m)}
                                                    className={modeChipVariants({
                                                        selected: addrMode === m,
                                                    })}
                                                >
                                                    {ADDR_MODE_LABEL[m]}
                                                </button>
                                            ))}
                                        </div>

                                        {addrMode === "saved" && (
                                            <div>
                                                {addrs.length === 0 ? (
                                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                                        {offline
                                                            ? "Offline: sem endereços em cache. Abra online uma vez ou use “Texto livre” / “Salvar novo” (só neste pedido)."
                                                            : "Este cliente não tem endereços salvos. Use “Salvar novo endereço” ou “Texto livre”."}
                                                    </p>
                                                ) : (
                                                    <>
                                                        <label
                                                            htmlFor="order-saved-address"
                                                            className="sr-only"
                                                        >
                                                            Endereço salvo
                                                        </label>
                                                        <Select
                                                            value={selAddrId ?? addrs[0]!.id}
                                                            onValueChange={(v) => setSelAddrId(v)}
                                                        >
                                                            <SelectTrigger id="order-saved-address">
                                                                <SelectValue placeholder="Selecione o endereço" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {addrs.map((a) => (
                                                                    <SelectItem key={a.id} value={a.id}>
                                                                        <span className="truncate">
                                                                            {a.apelido}
                                                                            {a.is_principal
                                                                                ? " (principal)"
                                                                                : ""}
                                                                        </span>
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <p className="mt-2 rounded-lg border border-border bg-zinc-50 px-3 py-2 text-xs text-foreground line-clamp-4 dark:bg-zinc-900/50">
                                                            {customerAddress || "—"}
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {addrMode === "new" && (
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                <input
                                                    placeholder="Apelido (ex: Casa, Trabalho)"
                                                    value={naForm.apelido}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            apelido: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="Apelido do endereço"
                                                />
                                                <input
                                                    placeholder="CEP"
                                                    value={naForm.cep}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            cep: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="CEP"
                                                />
                                                <input
                                                    placeholder="Logradouro *"
                                                    value={naForm.logradouro}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            logradouro: e.target.value,
                                                        }))
                                                    }
                                                    className={cn(inputCls, "sm:col-span-2")}
                                                    aria-label="Logradouro"
                                                    required
                                                />
                                                <input
                                                    placeholder="Número"
                                                    value={naForm.numero}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            numero: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="Número"
                                                />
                                                <input
                                                    placeholder="Complemento"
                                                    value={naForm.complemento}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            complemento: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="Complemento"
                                                />
                                                <input
                                                    placeholder="Bairro"
                                                    value={naForm.bairro}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            bairro: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="Bairro"
                                                />
                                                <input
                                                    placeholder="Cidade"
                                                    value={naForm.cidade}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            cidade: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="Cidade"
                                                />
                                                <input
                                                    placeholder="UF"
                                                    value={naForm.estado}
                                                    onChange={(e) =>
                                                        setNaForm((p) => ({
                                                            ...p,
                                                            estado: e.target.value,
                                                        }))
                                                    }
                                                    className={inputCls}
                                                    aria-label="UF"
                                                />
                                                <p className="text-[11px] text-foreground-muted sm:col-span-2">
                                                    {offline
                                                        ? "Offline: o endereço entra só neste pedido (não grava no cadastro até sincronizar online)."
                                                        : "Será gravado no cadastro do cliente e usado neste pedido."}
                                                </p>
                                            </div>
                                        )}

                                        {addrMode === "free" && (
                                            <>
                                                <textarea
                                                    placeholder="Endereço completo (texto livre, não salva em endereços)"
                                                    value={customerAddress}
                                                    onChange={(e) =>
                                                        setCustomerAddress(e.target.value)
                                                    }
                                                    rows={3}
                                                    className={cn(
                                                        inputCls,
                                                        "min-h-[4.5rem] resize-y"
                                                    )}
                                                    aria-label="Endereço em texto livre"
                                                />
                                                <p className="text-[11px] text-foreground-muted">
                                                    Atualiza apenas o campo de endereço do cliente
                                                    neste pedido.
                                                </p>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <textarea
                                        placeholder="Endereço (texto livre)"
                                        value={customerAddress}
                                        onChange={(e) => setCustomerAddress(e.target.value)}
                                        rows={3}
                                        className={cn(inputCls, "min-h-[4.5rem] resize-y")}
                                        aria-label="Endereço"
                                    />
                                )}
                            </>
                        )}
                        {isPickup && (
                            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                                Retirada no local — endereço de entrega não é necessário.
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_minmax(10rem,11.25rem)]">
                            <input
                                placeholder="Nome"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                className={inputCls}
                                aria-label="Nome do cliente"
                            />
                            <input
                                placeholder="Telefone (WhatsApp)"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                className={inputCls}
                                aria-label="Telefone do cliente"
                            />
                        </div>
                        {!isPickup ? (
                            <textarea
                                placeholder="Endereço (texto livre)"
                                value={customerAddress}
                                onChange={(e) => setCustomerAddress(e.target.value)}
                                rows={3}
                                className={cn(inputCls, "mt-2 min-h-[4.5rem] resize-y")}
                                aria-label="Endereço"
                            />
                        ) : (
                            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                                Retirada no local — endereço de entrega não é necessário.
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className={sectionCls}>
                <div className={labelCls}>Pagamento</div>

                <Select
                    value={paymentMethod}
                    onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                >
                    <SelectTrigger aria-label="Forma de pagamento">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="card">Cartão</SelectItem>
                        <SelectItem value="cash">Dinheiro</SelectItem>
                        <SelectItem value="debit">Débito</SelectItem>
                        <SelectItem value="credit_installment">Crédito Parcelado</SelectItem>
                        <SelectItem value="a_prazo">A Prazo / Fiado</SelectItem>
                    </SelectContent>
                </Select>

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                    <input
                        type="checkbox"
                        checked={paid}
                        onChange={(e) => setPaid(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                    />
                    Já está pago
                </label>

                {paymentMethod === "cash" && (
                    <div className="mt-3 space-y-2">
                        <label className="text-xs font-semibold text-foreground-muted">
                            Cliente paga com (R$)
                        </label>
                        <input
                            value={changeFor}
                            onChange={(e) => setChangeFor(formatBRLInput(e.target.value))}
                            className={inputCls}
                            inputMode="numeric"
                            aria-label="Valor pago pelo cliente"
                        />
                        <div className="rounded-lg border border-border bg-zinc-50 px-3 py-2 dark:bg-zinc-900/50">
                            <div className="text-xs font-bold text-foreground">
                                Troco: R$ {formatBRL(trocoNow)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-foreground-muted">
                                Total: R$ {formatBRL(totalNow)} · Paga: R${" "}
                                {formatBRL(customerPaysNow)}
                            </div>
                        </div>
                    </div>
                )}

                {paymentMethod === "card" && (
                    <p className="mt-3 text-xs font-semibold text-foreground-muted">
                        Levar maquininha
                    </p>
                )}
            </div>

            {!isPickup && (
                <div className={sectionCls}>
                    <div className={labelCls}>Taxa de entrega</div>

                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                        <input
                            type="checkbox"
                            checked={deliveryFeeEnabled}
                            onChange={(e) => setDeliveryFeeEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                        />
                        Cobrar taxa de entrega
                    </label>

                    <div className="mt-3 space-y-1">
                        <label className="text-xs font-semibold text-foreground-muted">
                            Taxa (R$)
                        </label>
                        <input
                            value={deliveryFee}
                            onChange={(e) => setDeliveryFee(formatBRLInput(e.target.value))}
                            disabled={!deliveryFeeEnabled}
                            className={inputCls}
                            inputMode="numeric"
                            aria-label="Taxa de entrega"
                        />
                        <p className="text-[11px] text-foreground-muted">
                            Se desligado, taxa fica R$ 0,00.
                        </p>
                    </div>

                    {serviceFeeOptions.length > 0 && onToggleServiceFee && (
                        <div className="mt-4 space-y-2 border-t border-border pt-3">
                            <p className="text-xs font-semibold text-foreground-muted">
                                Outras taxas
                            </p>
                            {serviceFeeOptions.map((opt) => {
                                const checked = selectedServiceFeeIds.includes(opt.id);
                                const labelExtra =
                                    opt.calc_mode === "percent"
                                        ? `${opt.value}%`
                                        : `R$ ${formatBRL(opt.value)}`;
                                return (
                                    <label
                                        key={opt.id}
                                        className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => onToggleServiceFee(opt.id)}
                                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                                        />
                                        <span className="truncate">{opt.name}</span>
                                        <span className="shrink-0 text-xs text-foreground-muted">
                                            ({labelExtra})
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {isPickup && serviceFeeOptions.length > 0 && onToggleServiceFee && (
                <div className={sectionCls}>
                    <div className={labelCls}>Outras taxas</div>
                    <div className="space-y-2">
                        {serviceFeeOptions.map((opt) => {
                            const checked = selectedServiceFeeIds.includes(opt.id);
                            const labelExtra =
                                opt.calc_mode === "percent"
                                    ? `${opt.value}%`
                                    : `R$ ${formatBRL(opt.value)}`;
                            return (
                                <label
                                    key={opt.id}
                                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => onToggleServiceFee(opt.id)}
                                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                                    />
                                    <span className="truncate">{opt.name}</span>
                                    <span className="shrink-0 text-xs text-foreground-muted">
                                        ({labelExtra})
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {!isPickup && drivers && drivers.length > 0 && (
                <div className={cn(sectionCls, "sm:col-span-2")}>
                    <div className={cn(labelCls, "flex items-center gap-1.5")}>
                        <Truck className="h-3.5 w-3.5" aria-hidden />
                        Entregador
                    </div>
                    <Select
                        value={driverId ?? NO_DRIVER}
                        onValueChange={(v) => setDriverId?.(v === NO_DRIVER ? null : v)}
                    >
                        <SelectTrigger aria-label="Entregador">
                            <SelectValue placeholder="Sem entregador" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_DRIVER}>— Sem entregador —</SelectItem>
                            {drivers.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                    <span className="truncate">
                                        {d.name}
                                        {d.vehicle ? ` · ${d.vehicle}` : ""}
                                        {d.plate ? ` (${d.plate})` : ""}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className={cn(sectionCls, "sm:col-span-2")}>
                <div className={labelCls}>Adicionar itens</div>

                <div className="relative">
                    <Search
                        className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
                        aria-hidden
                    />
                    <input
                        placeholder="Buscar por categoria, marca, detalhes, volume..."
                        value={q}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className={cn(inputCls, "pl-9")}
                        aria-label="Buscar produtos"
                    />
                </div>

                <div className="mt-3">
                    {searching ? (
                        <p className="text-xs text-foreground-muted">Buscando...</p>
                    ) : results.length === 0 ? (
                        <p className="text-xs text-foreground-muted">
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
                                        if (boxN > 0 && v.has_case && v.case_price)
                                            addToCart(v, "case", boxN);
                                        clearDraft(v.id);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className={cn(sectionCls, "sm:col-span-2")}>
                <div className={labelCls}>{modeLabel}</div>

                {cart.length === 0 ? (
                    <p className="text-xs text-foreground-muted">Nenhum item adicionado.</p>
                ) : (
                    <div className="grid gap-2">
                        {cart.map((item, idx) => (
                            <CartRow
                                key={`${item.variant.id}-${item.mode}-${idx}`}
                                item={item}
                                onDec={() =>
                                    setCart((prev) => {
                                        const copy = [...prev];
                                        copy[idx] = {
                                            ...copy[idx],
                                            qty: Math.max(1, copy[idx].qty - 1),
                                        };
                                        return copy;
                                    })
                                }
                                onInc={() =>
                                    setCart((prev) => {
                                        const copy = [...prev];
                                        copy[idx] = {
                                            ...copy[idx],
                                            qty: copy[idx].qty + 1,
                                        };
                                        return copy;
                                    })
                                }
                                onRemove={() =>
                                    setCart((prev) => prev.filter((_, i) => i !== idx))
                                }
                            />
                        ))}
                    </div>
                )}

                <div className="mt-4 space-y-1.5 border-t border-border pt-3">
                    <div className="flex items-center justify-between text-xs text-foreground-muted">
                        <span>Subtotal</span>
                        <span className="font-semibold">R$ {formatBRL(cartSubtotal(cart))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-foreground-muted">
                        <span>Taxa de entrega</span>
                        <span className="font-semibold">
                            R$ {formatBRL(deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0)}
                        </span>
                    </div>
                    {serviceFeeOptions
                        .filter((o) => selectedServiceFeeIds.includes(o.id))
                        .map((o) => {
                            const amt =
                                o.calc_mode === "percent"
                                    ? Math.round(cartSubtotal(cart) * (o.value / 100) * 100) /
                                      100
                                    : o.value;
                            return (
                                <div
                                    key={o.id}
                                    className="flex items-center justify-between text-xs text-foreground-muted"
                                >
                                    <span className="truncate">{o.name}</span>
                                    <span className="shrink-0 font-semibold">
                                        R$ {formatBRL(amt)}
                                    </span>
                                </div>
                            );
                        })}
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-foreground">Total</span>
                        <span className="font-bold text-primary">R$ {formatBRL(totalNow)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
